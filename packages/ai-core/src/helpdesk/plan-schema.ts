import { z } from "zod";
import { DEFAULT_HELPDESK } from "../config";
import { detectCredentialShapes } from "./credentials";

/** One step of a help-desk plan. Ids are kept across a replan (CL-13). */
export const PlanTaskSchema = z.strictObject({
	id: z.string().min(1).max(40).describe("タスクの ID（計画内で一意。例: t1）"),
	description: z.string().min(1).max(300).describe("このタスクで何をするか（1〜2 文）"),
	dependsOn: z
		.array(z.string().min(1).max(40))
		.describe("先に完了していなければならないタスクの ID（なければ空の配列）"),
});

/**
 * The shape of a plan. The count and the id uniqueness are not checked here: an empty list, a ninth
 * task and a repeated id are plan problems that `validatePlan` names, so they are fed back and
 * escalate like a cycle does (Req 2.10) instead of ending as `output-invalid`.
 */
export const PlanSchema = z.strictObject({
	tasks: z
		.array(PlanTaskSchema)
		.describe(`実行するタスクの一覧（1〜${DEFAULT_HELPDESK.maxPlanTasks} 件）`),
});

export type PlanTask = z.infer<typeof PlanTaskSchema>;
export type Plan = z.infer<typeof PlanSchema>;

export const PlanDiffSchema = z.strictObject({
	added: z.array(z.string()),
	removed: z.array(z.string()),
	changed: z.array(z.string()),
});

export type PlanDiff = z.infer<typeof PlanDiffSchema>;

export type PlanIssueKind =
	| "cycle"
	| "missing-dependency"
	| "empty"
	| "too-many-tasks"
	| "duplicate-id"
	| "credential-shape";

export interface PlanIssue {
	readonly kind: PlanIssueKind;
	/** `cycle`: the tasks on the cycle. `missing-dependency`: the task, then the missing id. */
	readonly taskIds: readonly string[];
	/** A Japanese sentence that can be fed back to the planner. */
	readonly message: string;
}

/** Finds one cycle with a depth-first walk, or `undefined`. Edges to unknown ids are ignored. */
function findCycle(plan: Plan): readonly string[] | undefined {
	const dependsOn = new Map(plan.tasks.map((task) => [task.id, task.dependsOn] as const));
	const done = new Set<string>();
	const path: string[] = [];
	const onPath = new Set<string>();

	function visit(id: string): readonly string[] | undefined {
		if (onPath.has(id)) return path.slice(path.indexOf(id));
		if (done.has(id)) return undefined;
		onPath.add(id);
		path.push(id);
		for (const next of dependsOn.get(id) ?? []) {
			if (!dependsOn.has(next)) continue;
			const cycle = visit(next);
			if (cycle) return cycle;
		}
		path.pop();
		onPath.delete(id);
		done.add(id);
		return undefined;
	}

	for (const task of plan.tasks) {
		const cycle = visit(task.id);
		if (cycle) return cycle;
	}
	return undefined;
}

/**
 * Checks what the schema cannot (Req 2.10): an empty plan, a dependency on a task that does not
 * exist, and a dependency cycle (a self-dependency included). A pure function; an empty list means
 * the plan can run.
 */
export function validatePlan(plan: Plan): readonly PlanIssue[] {
	if (plan.tasks.length === 0) {
		return [
			{
				kind: "empty",
				taskIds: [],
				message: "計画にタスクがありません。1 つ以上のタスクを含めてください。",
			},
		];
	}
	const ids = new Set(plan.tasks.map((task) => task.id));
	const issues: PlanIssue[] = [];
	if (plan.tasks.length > DEFAULT_HELPDESK.maxPlanTasks) {
		issues.push({
			kind: "too-many-tasks",
			taskIds: [],
			message: `タスクが ${plan.tasks.length} 個あります。${DEFAULT_HELPDESK.maxPlanTasks} 個までにしてください。`,
		});
	}
	// A description is stored and streamed, so a credential shape in it is a problem to fix.
	for (const task of plan.tasks) {
		if (detectCredentialShapes(task.description).length === 0) continue;
		issues.push({
			kind: "credential-shape",
			taskIds: [task.id],
			message: `タスク「${task.id}」の説明に認証情報の形が含まれています。値は書かず、手順だけを書いてください。`,
		});
	}
	for (const id of new Set(
		plan.tasks.map((task) => task.id).filter((id, i, all) => all.indexOf(id) !== i),
	)) {
		issues.push({
			kind: "duplicate-id",
			taskIds: [id],
			message: `タスク ID「${id}」が重複しています。ID は計画の中で一意にしてください。`,
		});
	}
	for (const task of plan.tasks) {
		for (const dependency of task.dependsOn) {
			if (ids.has(dependency)) continue;
			issues.push({
				kind: "missing-dependency",
				taskIds: [task.id, dependency],
				message: `タスク「${task.id}」が、存在しないタスク「${dependency}」に依存しています。存在するタスクの ID だけを指定してください。`,
			});
		}
	}
	const cycle = findCycle(plan);
	if (cycle) {
		issues.push({
			kind: "cycle",
			taskIds: cycle,
			message: `タスクの依存が循環しています（${[...cycle, cycle[0]].join(" → ")}）。依存は一方向になるようにしてください。`,
		});
	}
	return issues;
}

function sameTask(a: PlanTask, b: PlanTask): boolean {
	if (a.description !== b.description) return false;
	const left = [...new Set(a.dependsOn)].sort();
	const right = [...new Set(b.dependsOn)].sort();
	return left.length === right.length && left.every((id, index) => id === right[index]);
}

/**
 * The difference between two revisions of a plan (Req 2.3, CL-13): ids only in `after` are
 * `added`, ids only in `before` are `removed`, and an id present in both whose description or
 * dependencies (compared as a set) differ is `changed`.
 */
export function diffPlan(before: Plan, after: Plan): PlanDiff {
	const was = new Map(before.tasks.map((task) => [task.id, task] as const));
	const now = new Map(after.tasks.map((task) => [task.id, task] as const));
	return {
		added: after.tasks.filter((task) => !was.has(task.id)).map((task) => task.id),
		removed: before.tasks.filter((task) => !now.has(task.id)).map((task) => task.id),
		changed: after.tasks
			.filter((task) => {
				const previous = was.get(task.id);
				return previous !== undefined && !sameTask(previous, task);
			})
			.map((task) => task.id),
	};
}
