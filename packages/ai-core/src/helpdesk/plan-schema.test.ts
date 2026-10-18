import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_HELPDESK } from "../config";
import { diffPlan, type Plan, PlanSchema, validatePlan } from "./plan-schema";

function fixture(name: string): unknown {
	const path = fileURLToPath(
		new URL(`../../fixtures/helpdesk/plans/${name}.json`, import.meta.url),
	);
	return JSON.parse(readFileSync(path, "utf8"));
}

function plan(
	...tasks: readonly [id: string, dependsOn?: readonly string[], text?: string][]
): Plan {
	return {
		tasks: tasks.map(([id, dependsOn = [], text = `説明 ${id}`]) => ({
			id,
			description: text,
			dependsOn: [...dependsOn],
		})),
	};
}

describe("PlanSchema", () => {
	it("accepts the valid fixture", () => {
		expect(PlanSchema.safeParse(fixture("valid")).success).toBe(true);
	});

	it("rejects an unknown key, an empty id and an empty description", () => {
		expect(PlanSchema.safeParse({ tasks: [], extra: 1 }).success).toBe(false);
		expect(PlanSchema.safeParse(plan([""])).success).toBe(false);
		expect(PlanSchema.safeParse(plan(["t1", [], ""])).success).toBe(false);
		expect(
			PlanSchema.safeParse({ tasks: [{ id: "t1", description: "d", dependsOn: [], note: "x" }] })
				.success,
		).toBe(false);
	});

	it("leaves an empty list, a long list and a repeated id to validatePlan, so the feedback names them", () => {
		const ids = Array.from({ length: DEFAULT_HELPDESK.maxPlanTasks + 1 }, (_, i) => `t${i + 1}`);
		expect(PlanSchema.safeParse(plan(...ids.map((id) => [id] as [string]))).success).toBe(true);
		expect(PlanSchema.safeParse(plan(["t1"], ["t1"])).success).toBe(true);
	});

	it("leaves an empty task list to validatePlan, so the feedback names the problem", () => {
		expect(PlanSchema.safeParse(fixture("empty")).success).toBe(true);
	});
});

describe("validatePlan", () => {
	it("returns no issue for a valid plan", () => {
		expect(validatePlan(PlanSchema.parse(fixture("valid")))).toEqual([]);
	});

	it("reports a cycle with the tasks on it", () => {
		const issues = validatePlan(PlanSchema.parse(fixture("cycle")));
		expect(issues).toHaveLength(1);
		expect(issues[0]?.kind).toBe("cycle");
		expect([...(issues[0]?.taskIds ?? [])].sort()).toEqual(["t1", "t2", "t3"]);
	});

	it("reports a task that depends on itself as a cycle", () => {
		const issues = validatePlan(plan(["t1", ["t1"]]));
		expect(issues.map((i) => i.kind)).toEqual(["cycle"]);
		expect(issues[0]?.taskIds).toEqual(["t1"]);
	});

	it("does not report a diamond (shared dependency) as a cycle", () => {
		expect(validatePlan(plan(["a"], ["b", ["a"]], ["c", ["a"]], ["d", ["b", "c"]]))).toEqual([]);
	});

	it("reports a dependency on a task that does not exist, naming both ids", () => {
		const issues = validatePlan(PlanSchema.parse(fixture("missing-dependency")));
		expect(issues).toHaveLength(1);
		expect(issues[0]?.kind).toBe("missing-dependency");
		expect(issues[0]?.taskIds).toEqual(["t2", "t9"]);
		expect(issues[0]?.message).toContain("t9");
	});

	it("reports an empty plan", () => {
		const issues = validatePlan(PlanSchema.parse(fixture("empty")));
		expect(issues.map((i) => i.kind)).toEqual(["empty"]);
	});

	it("reports a missing dependency and a cycle in the same plan", () => {
		const kinds = validatePlan(plan(["a", ["b"]], ["b", ["a"]], ["c", ["zzz"]])).map((i) => i.kind);
		expect(kinds.sort()).toEqual(["cycle", "missing-dependency"]);
	});

	it("gives every issue a Japanese message the planner can show the model", () => {
		for (const name of ["cycle", "missing-dependency", "empty"]) {
			const issues = validatePlan(PlanSchema.parse(fixture(name)));
			expect(issues[0]?.message).toMatch(/[ぁ-んァ-ン一-龥]/);
		}
	});
});

describe("validatePlan: count, ids and descriptions (Req 2.10, 2.8)", () => {
	it("accepts exactly the maximum number of tasks and reports one more", () => {
		const ids = Array.from({ length: DEFAULT_HELPDESK.maxPlanTasks + 1 }, (_, i) => `t${i + 1}`);
		expect(validatePlan(plan(...ids.slice(0, -1).map((id) => [id] as [string])))).toEqual([]);
		expect(validatePlan(plan(...ids.map((id) => [id] as [string]))).map((i) => i.kind)).toEqual([
			"too-many-tasks",
		]);
	});

	it("reports a repeated id once, naming it", () => {
		const issues = validatePlan(plan(["t1"], ["t1"], ["t1"]));
		expect(issues.map((i) => i.kind)).toEqual(["duplicate-id"]);
		expect(issues[0]?.taskIds).toEqual(["t1"]);
	});

	it("reports a description that carries a credential shape", () => {
		const issues = validatePlan(
			plan(["t1", [], `パスワードは ${["Fake", "Pw", "0001"].join("-")} と案内する`]),
		);
		expect(issues.map((i) => i.kind)).toEqual(["credential-shape"]);
		expect(JSON.stringify(issues)).not.toContain("Fake-Pw");
	});
});

describe("diffPlan", () => {
	const before = plan(["t1", [], "検索"], ["t2", ["t1"], "抜き出し"], ["t3", ["t2"], "整理"]);

	it("returns empty lists when nothing changed", () => {
		expect(diffPlan(before, before)).toEqual({ added: [], removed: [], changed: [] });
	});

	it("lists added and removed ids", () => {
		const after = plan(["t1", [], "検索"], ["t2", ["t1"], "抜き出し"], ["t4", ["t2"], "新規"]);
		expect(diffPlan(before, after)).toEqual({ added: ["t4"], removed: ["t3"], changed: [] });
	});

	it("lists an id whose description changed", () => {
		const after = plan(["t1", [], "検索"], ["t2", ["t1"], "別の説明"], ["t3", ["t2"], "整理"]);
		expect(diffPlan(before, after)).toEqual({ added: [], removed: [], changed: ["t2"] });
	});

	it("lists an id whose dependencies changed", () => {
		const after = plan(["t1", [], "検索"], ["t2", ["t1"], "抜き出し"], ["t3", ["t1"], "整理"]);
		expect(diffPlan(before, after)).toEqual({ added: [], removed: [], changed: ["t3"] });
	});

	it("does not count a reordered dependency list as a change", () => {
		const a = plan(["t1"], ["t2"], ["t3", ["t2", "t1"], "x"]);
		const b = plan(["t1"], ["t2"], ["t3", ["t1", "t2"], "x"]);
		expect(diffPlan(a, b).changed).toEqual([]);
		expect(diffPlan(b, a).changed).toEqual([]);
	});

	it("does not count an added or removed id as changed (ids are kept across a replan, CL-13)", () => {
		const after = plan(["t1", [], "検索"], ["t9", ["t1"], "新しい"]);
		const diff = diffPlan(before, after);
		expect(diff.added).toEqual(["t9"]);
		expect(diff.removed).toEqual(["t2", "t3"]);
		expect(diff.changed).toEqual([]);
	});

	it("the result satisfies the PlanDiff shape used by the DB column", () => {
		const diff = diffPlan(before, plan(["t1"]));
		expect(Object.keys(diff).sort()).toEqual(["added", "changed", "removed"]);
	});
});
