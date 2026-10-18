import { readFileSync } from "node:fs";
import { MockLanguageModelV4 } from "ai/test";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { KnowledgeSearcher } from "../aci/tools/search-knowledge-base";
import { DEFAULT_HELPDESK } from "../config";
import { PlatformError } from "../errors";
import { createFakeClock } from "../ports/clock";
import { createPgliteDatabase, type RagDatabaseHandle } from "../rag/db";
import { type HelpdeskEvent, type RunHelpdeskParams, runHelpdesk } from "./helpdesk";
import { createTicketStore, type TicketStore } from "./ticket-store";

// A fake credential, assembled so that no secret scanner matches this file.
const FAKE_PASSWORD = ["Fake", "Pw", "0001"].join("-");
const LEAK = `パスワードは ${FAKE_PASSWORD} です。`;

type Kind = "plan" | "decision" | "replan" | "answer" | "task";
type Queued = Exclude<Kind, "task">;

interface Script {
	readonly plan?: readonly unknown[];
	readonly decision?: readonly unknown[];
	readonly replan?: readonly unknown[];
	readonly answer?: readonly unknown[];
	/** The text each task ends with, in order. */
	readonly task?: readonly string[];
}

const json = (value: unknown) => (typeof value === "string" ? value : JSON.stringify(value));

function planOf(...tasks: readonly (readonly [id: string, dependsOn?: readonly string[]])[]) {
	return {
		tasks: tasks.map(([id, dependsOn = []]) => ({ id, description: `説明 ${id}`, dependsOn })),
	};
}
const decision = (value: "continue" | "replan" | "finish", reason = "理由です") => ({
	decision: value,
	reason,
});
const resolvedAnswer = (answer = "設定画面から再接続してください。") => ({
	outcome: "resolved",
	answer,
});
const unresolvedAnswer = (reason = "ナレッジだけでは解決できません。") => ({
	outcome: "unresolved",
	reason,
});

interface ScriptedRun {
	readonly model: MockLanguageModelV4;
	/** The kind of every LLM call, in order (a task's tool round trip counts once). */
	readonly calls: Kind[];
	/** Runs before the model answers a call of that kind. */
	before(listener: (kind: Kind) => void): void;
}

/** Routes each LLM call to a scripted answer by what the prompt asks for, and records the order. */
function scriptedModel(script: Script): ScriptedRun {
	const used: Record<Queued, number> = { plan: 0, decision: 0, replan: 0, answer: 0 };
	let taskIndex = 0;
	const calls: Kind[] = [];
	let listener: ((kind: Kind) => void) | undefined;
	const usage = {
		inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
		outputTokens: { total: 5, text: 5, reasoning: 0 },
	};
	const finish = (text: string) => ({
		content: [{ type: "text" as const, text }],
		finishReason: { unified: "stop" as const, raw: undefined },
		usage,
		warnings: [],
	});
	const model = new MockLanguageModelV4({
		doGenerate: async (options) => {
			const prompt = JSON.stringify(options.prompt);
			const afterTool = options.prompt.at(-1)?.role === "tool";
			let kind: Kind;
			if (prompt.includes("次のタスクを実行してください")) kind = "task";
			else if (prompt.includes("実行計画を作ってください")) kind = "plan";
			else if (prompt.includes("次の動きを選んでください")) kind = "decision";
			else if (prompt.includes("残りのタスクを作り直してください")) kind = "replan";
			else if (prompt.includes("最終回答を作成してください")) kind = "answer";
			else throw new Error(`unrecognised prompt: ${prompt.slice(0, 200)}`);

			if (kind === "task") {
				if (!afterTool) {
					calls.push("task");
					listener?.("task");
					return {
						content: [
							{
								type: "tool-call" as const,
								toolCallId: `call-${calls.length}`,
								toolName: "searchKnowledgeBase",
								input: JSON.stringify({ query: "VPN" }),
							},
						],
						finishReason: { unified: "tool-calls" as const, raw: undefined },
						usage,
						warnings: [],
					};
				}
				const queue = script.task ?? ["要約"];
				const text = queue[Math.min(taskIndex, queue.length - 1)] ?? "要約";
				taskIndex += 1;
				return finish(text);
			}
			calls.push(kind);
			listener?.(kind);
			const queue = script[kind] ?? [];
			const item = queue[Math.min(used[kind], queue.length - 1)];
			used[kind] += 1;
			if (item === undefined) throw new Error(`no scripted ${kind} answer`);
			return finish(json(item));
		},
	});
	return {
		model,
		calls,
		before(next) {
			listener = next;
		},
	};
}

const START = Date.parse("2026-10-18T00:00:00.000Z");
const LIMITS = {
	maxSteps: 6,
	maxTotalTokens: 50_000,
	maxDurationMs: 120_000,
	toolTimeoutMs: 15_000,
};

let handle: RagDatabaseHandle;
let store: TicketStore;

beforeAll(async () => {
	handle = await createPgliteDatabase();
});

afterAll(async () => {
	await handle.close();
});

beforeEach(async () => {
	await handle.db.execute(sql`TRUNCATE helpdesk_plan_revisions, helpdesk_tickets CASCADE`);
	store = createTicketStore(handle.db, { clock: createFakeClock(START) });
});

const HIT = {
	chunk: {
		id: "faq-vpn#1",
		documentId: "faq-vpn",
		documentTitle: "VPN 接続手順",
		headingPath: ["VPN", "接続できないとき"],
		page: null,
		body: "認証アプリの時刻を確認する。",
	},
};

function setup(script: Script, overrides: Partial<RunHelpdeskParams> = {}) {
	const scripted = scriptedModel(script);
	const events: HelpdeskEvent[] = [];
	const searches: string[] = [];
	const search: KnowledgeSearcher = async (query) => {
		searches.push(query);
		return [HIT];
	};
	const params: RunHelpdeskParams = {
		inquiry: "VPN に接続できません。",
		model: scripted.model,
		store,
		knowledge: { search, documentTitles: ["VPN 接続手順"] },
		limits: LIMITS,
		clock: createFakeClock(START),
		signal: new AbortController().signal,
		onEvent: (event) => {
			events.push(event);
		},
		...overrides,
	};
	return { scripted, params, events, searches, run: () => runHelpdesk(params) };
}

const TWO_TASKS = planOf(["t1"], ["t2", ["t1"]]);
const TASKS_CALLS: Kind[] = ["plan", "task", "decision", "task", "decision", "answer"];

describe("runHelpdesk: the happy path", () => {
	it("plans, runs the tasks in dependency order, asks after each task, answers and resolves", async () => {
		// t2 is listed first but depends on t1.
		const plan = { tasks: [TWO_TASKS.tasks[1], TWO_TASKS.tasks[0]] };
		const { scripted, run } = setup({
			plan: [plan],
			decision: [decision("continue")],
			answer: [resolvedAnswer()],
		});

		const outcome = await run();

		expect(scripted.calls).toEqual(TASKS_CALLS);
		expect(outcome).toMatchObject({
			status: "resolved",
			ticketId: "T-0001",
			answer: "設定画面から再接続してください。",
			stepsUsed: 3,
		});
		const ticket = await store.get("T-0001");
		expect(ticket).toMatchObject({
			status: "resolved",
			answer: "設定画面から再接続してください。",
			stepsUsed: 3,
		});
		expect((await store.revisions("T-0001")).map((r) => r.revision)).toEqual([0]);
	});

	it("creates the ticket only after the plan is valid, with the plan as revision 0", async () => {
		const { scripted, run } = setup({
			plan: [TWO_TASKS],
			decision: [decision("finish")],
			answer: [resolvedAnswer()],
		});
		scripted.before(async (kind) => {
			if (kind === "plan") expect(await store.list()).toEqual([]);
		});

		await run();

		const [revision] = await store.revisions("T-0001");
		expect(revision).toMatchObject({ revision: 0, reason: "initial" });
		expect(revision?.plan.tasks.map((t) => t.id)).toEqual(["t1", "t2"]);
	});

	it("finishes early on `finish` without running the remaining tasks", async () => {
		const { scripted, run } = setup({
			plan: [TWO_TASKS],
			decision: [decision("finish", "十分な根拠がそろった")],
			answer: [resolvedAnswer()],
		});

		const outcome = await run();

		expect(scripted.calls).toEqual(["plan", "task", "decision", "answer"]);
		expect(outcome.status).toBe("resolved");
	});
});

describe("runHelpdesk: the step limit (CL-14)", () => {
	const THREE = planOf(["t1"], ["t2", ["t1"]], ["t3", ["t2"]]);

	it("does not start another task once the limit is reached, and leaves the ticket open with the unfinished tasks", async () => {
		// plan (1) + t1 (2) + t2 (3) = the limit; t3 must not run.
		const { scripted, run } = setup(
			{ plan: [THREE], decision: [decision("continue")] },
			{ maxSteps: 3 },
		);

		const outcome = await run();

		expect(scripted.calls.filter((kind) => kind === "task")).toHaveLength(2);
		expect(scripted.calls).not.toContain("answer");
		expect(outcome).toMatchObject({
			status: "open",
			stoppedReason: "step-limit",
			stepsUsed: 3,
			remaining: [{ id: "t3" }],
		});
		expect(await store.get("T-0001")).toMatchObject({
			status: "open",
			stoppedReason: "step-limit",
			stepsUsed: 3,
		});
	});

	it("runs the last task when the limit leaves exactly one more step", async () => {
		const { scripted, run } = setup(
			{ plan: [THREE], decision: [decision("continue")], answer: [resolvedAnswer()] },
			{ maxSteps: 4 },
		);

		const outcome = await run();

		expect(scripted.calls.filter((kind) => kind === "task")).toHaveLength(3);
		expect(outcome).toMatchObject({ status: "resolved", stepsUsed: 4 });
	});

	it("still answers when every task is done on the last step", async () => {
		const { scripted, run } = setup(
			{ plan: [planOf(["t1"])], decision: [decision("continue")], answer: [resolvedAnswer()] },
			{ maxSteps: 2 },
		);

		const outcome = await run();

		expect(outcome.status).toBe("resolved");
		// The step budget is spent, so no decision is asked for.
		expect(scripted.calls).toEqual(["plan", "task", "answer"]);
	});

	it("stops with one step: the plan is made, the ticket stays open and nothing runs", async () => {
		const { scripted, run } = setup({ plan: [THREE] }, { maxSteps: 1 });

		const outcome = await run();

		expect(scripted.calls).toEqual(["plan"]);
		expect(outcome).toMatchObject({ status: "open", stoppedReason: "step-limit", stepsUsed: 1 });
		expect(outcome.status === "open" && outcome.remaining.map((t) => t.id)).toEqual([
			"t1",
			"t2",
			"t3",
		]);
	});

	it.each([0, -1, 1.5, Number.NaN])("rejects maxSteps %s before any LLM call", async (maxSteps) => {
		const { scripted, run } = setup({ plan: [THREE] }, { maxSteps });

		await expect(run()).rejects.toBeInstanceOf(PlatformError);
		expect(scripted.calls).toEqual([]);
	});

	it("uses the default limit of 12", () => {
		expect(DEFAULT_HELPDESK.maxSteps).toBe(12);
	});
});

describe("runHelpdesk: replanning (Req 2.3)", () => {
	it("regenerates the rest, records the revision with its diff and reason, and counts the replan as a step", async () => {
		const replanned = planOf(["t4", ["t1"]]);
		const { scripted, run } = setup({
			plan: [TWO_TASKS],
			decision: [decision("replan", "別の手順があった"), decision("continue")],
			replan: [replanned],
			answer: [resolvedAnswer()],
		});

		const outcome = await run();

		expect(scripted.calls).toEqual([
			"plan",
			"task",
			"decision",
			"replan",
			"task",
			"decision",
			"answer",
		]);
		// plan 1 + t1 1 + replan 1 + t4 1
		expect(outcome).toMatchObject({ status: "resolved", stepsUsed: 4 });
		const revisions = await store.revisions("T-0001");
		expect(revisions.map((r) => r.revision)).toEqual([0, 1]);
		expect(revisions[1]).toMatchObject({
			reason: "別の手順があった",
			diff: { added: ["t4"], removed: ["t2"], changed: [] },
		});
		expect(revisions[1]?.plan.tasks.map((t) => t.id)).toEqual(["t1", "t4"]);
	});

	it("escalates when the replan stays invalid after the regenerations", async () => {
		const bad = planOf(["t4", ["t5"]], ["t5", ["t4"]]);
		const { run } = setup({
			plan: [TWO_TASKS],
			decision: [decision("replan")],
			replan: [bad],
		});

		const outcome = await run();

		expect(outcome).toMatchObject({ status: "escalated" });
		expect(await store.get("T-0001")).toMatchObject({ status: "escalated" });
		expect((await store.revisions("T-0001")).map((r) => r.revision)).toEqual([0]);
	});
});

describe("runHelpdesk: an invalid plan (Req 2.10)", () => {
	const CYCLE = planOf(["t1", ["t2"]], ["t2", ["t1"]]);

	it("regenerates twice, then escalates the ticket with a reason and runs nothing", async () => {
		const { scripted, run } = setup({ plan: [CYCLE, CYCLE, CYCLE, TWO_TASKS] });

		const outcome = await run();

		expect(scripted.calls).toEqual(["plan", "plan", "plan"]);
		expect(outcome).toMatchObject({ status: "escalated", stepsUsed: 1 });
		const ticket = await store.get("T-0001");
		expect(ticket?.status).toBe("escalated");
		expect(ticket?.escalationReason).toContain("計画");
		expect(await store.revisions("T-0001")).toEqual([]);
	});

	it("recovers when the second plan is valid", async () => {
		const { scripted, run } = setup({
			plan: [CYCLE, TWO_TASKS],
			decision: [decision("finish")],
			answer: [resolvedAnswer()],
		});

		const outcome = await run();

		expect(scripted.calls.slice(0, 2)).toEqual(["plan", "plan"]);
		expect(outcome.status).toBe("resolved");
	});

	it("throws output-invalid and leaves no ticket when the plan never fits the schema", async () => {
		const { run } = setup({ plan: ["not json"] });

		await expect(run()).rejects.toMatchObject({ code: "output-invalid" });
		expect(await store.list()).toEqual([]);
	});
});

describe("runHelpdesk: an unexpected error after the ticket exists", () => {
	it.each([
		["the decision", { plan: [TWO_TASKS], decision: ["not json"] }],
		["the replan", { plan: [TWO_TASKS], decision: [decision("replan")], replan: ["not json"] }],
		[
			"the final answer",
			{ plan: [planOf(["t1"])], decision: [decision("finish")], answer: ["not json"] },
		],
	] as const)(
		"escalates the ticket with a fixed reason when %s breaks, and rethrows",
		async (_name, script) => {
			const { run } = setup(script as Script);

			await expect(run()).rejects.toMatchObject({ code: "output-invalid" });

			const ticket = await store.get("T-0001");
			expect(ticket?.status).toBe("escalated");
			expect(ticket?.escalationReason).toContain("エラー");
			expect(ticket?.stepsUsed).toBeGreaterThan(0);
		},
	);
});

describe("runHelpdesk: the final answer", () => {
	it("escalates without asking for an answer when no task found a source", async () => {
		const { scripted, params } = setup({ plan: [TWO_TASKS], decision: [decision("finish")] });
		const noHit: KnowledgeSearcher = async () => [];

		const outcome = await runHelpdeskWith({
			...params,
			knowledge: { ...params.knowledge, search: noHit },
		});

		expect(scripted.calls).not.toContain("answer");
		expect(outcome).toMatchObject({ status: "escalated" });
		expect((await store.get("T-0001"))?.escalationReason).toContain("根拠");
	});

	it("escalates with the model's own reason when it cannot resolve the inquiry (Req 2.7)", async () => {
		const { run } = setup({
			plan: [planOf(["t1"])],
			decision: [decision("finish")],
			answer: [unresolvedAnswer("設定の権限が足りないため、担当者の確認が必要です。")],
		});

		const outcome = await run();

		expect(outcome).toMatchObject({
			status: "escalated",
			reason: "設定の権限が足りないため、担当者の確認が必要です。",
		});
		expect(await store.get("T-0001")).toMatchObject({
			status: "escalated",
			escalationReason: "設定の権限が足りないため、担当者の確認が必要です。",
		});
	});

	it("does not store or show an answer with a credential shape: it asks once more, and saves the clean one", async () => {
		const { scripted, params, events } = setup({
			plan: [planOf(["t1"])],
			decision: [decision("finish")],
			answer: [
				resolvedAnswer(LEAK),
				resolvedAnswer("再設定用のリンクから新しいパスワードを設定してください。"),
			],
		});
		const seenBySave: (string | undefined)[] = [];
		scripted.before((kind) => {
			if (kind === "answer") void store.get("T-0001").then((t) => seenBySave.push(t?.answer));
		});

		const outcome = await runHelpdeskWith(params);

		expect(scripted.calls.filter((kind) => kind === "answer")).toHaveLength(2);
		expect(outcome).toMatchObject({
			status: "resolved",
			answer: "再設定用のリンクから新しいパスワードを設定してください。",
			credentialKinds: ["plaintext-password"],
		});
		expect(seenBySave.every((answer) => answer === undefined)).toBe(true);
		expect((await store.get("T-0001"))?.answer).toBe(
			"再設定用のリンクから新しいパスワードを設定してください。",
		);
		expect(JSON.stringify(events)).not.toContain(FAKE_PASSWORD);
		expect(JSON.stringify(outcome)).not.toContain(FAKE_PASSWORD);
	});

	it("escalates when the re-created answer still has a credential shape, and keeps the value out of the row, the events and the outcome", async () => {
		const { scripted, params, events } = setup({
			plan: [planOf(["t1"])],
			decision: [decision("finish")],
			answer: [resolvedAnswer(LEAK), resolvedAnswer(LEAK)],
		});

		const outcome = await runHelpdeskWith(params);

		expect(scripted.calls.filter((kind) => kind === "answer")).toHaveLength(2);
		expect(outcome).toMatchObject({ status: "escalated", credentialKinds: ["plaintext-password"] });
		const ticket = await store.get("T-0001");
		expect(ticket?.status).toBe("escalated");
		expect(ticket?.answer).toBeUndefined();
		const everything = JSON.stringify({
			outcome,
			events,
			ticket,
			revisions: await store.revisions("T-0001"),
		});
		expect(everything).not.toContain(FAKE_PASSWORD);
		const rows = await handle.db.execute(sql`SELECT * FROM helpdesk_tickets`);
		expect(JSON.stringify(rows)).not.toContain(FAKE_PASSWORD);
	});

	it("answers a password-reset question with a link, which is guidance and not a credential", async () => {
		const { run } = setup({
			plan: [planOf(["t1"])],
			decision: [decision("finish")],
			answer: [
				resolvedAnswer("パスワードは https://id.example.com/reset から再設定してください。"),
			],
		});

		expect(await run()).toMatchObject({ status: "resolved" });
	});

	it("keeps a credential shape in a decision reason out of the row and the events", async () => {
		const { run, events } = setup({
			plan: [TWO_TASKS],
			decision: [decision("replan", LEAK), decision("finish")],
			replan: [planOf(["t4", ["t1"]])],
			answer: [resolvedAnswer()],
		});

		await run();

		const revisions = await store.revisions("T-0001");
		expect(JSON.stringify({ events, revisions })).not.toContain(FAKE_PASSWORD);
	});

	it("does not trust an escalation reason that carries a credential shape", async () => {
		const { params, events } = setup({
			plan: [planOf(["t1"])],
			decision: [decision("finish")],
			answer: [unresolvedAnswer(LEAK)],
		});

		const outcome = await runHelpdeskWith(params);

		expect(outcome.status).toBe("escalated");
		expect(JSON.stringify({ outcome, events, ticket: await store.get("T-0001") })).not.toContain(
			FAKE_PASSWORD,
		);
	});

	it("shows the model the task results as data and never an earlier credential-bearing answer", async () => {
		const prompts: string[] = [];
		const { scripted, run } = setup({
			plan: [planOf(["t1"])],
			decision: [decision("finish")],
			answer: [resolvedAnswer(LEAK), resolvedAnswer()],
			task: ["手順書によると、認証アプリの時刻を確認します。"],
		});
		const original = scripted.model.doGenerate;
		scripted.model.doGenerate = async (options) => {
			prompts.push(JSON.stringify(options.prompt));
			return await (original as (o: typeof options) => ReturnType<typeof original>)(options);
		};

		await run();

		const answerPrompts = prompts.filter((prompt) => prompt.includes("最終回答を作成してください"));
		expect(answerPrompts[0]).toContain("手順書によると、認証アプリの時刻を確認します。");
		expect(answerPrompts[1]).toContain("認証情報");
		expect(answerPrompts[1]).not.toContain(FAKE_PASSWORD);
	});
});

describe("runHelpdesk: progress events (Req 2.5)", () => {
	it("writes each state change as it happens, before the next LLM call", async () => {
		const timeline: string[] = [];
		const { scripted, params } = setup({
			plan: [TWO_TASKS],
			decision: [decision("continue", "計画どおり")],
			answer: [resolvedAnswer()],
		});
		scripted.before((kind) => timeline.push(`call:${kind}`));
		const run = runHelpdeskWith({
			...params,
			onEvent: (event) => void timeline.push(`event:${event.type}`),
		});

		await run;

		const firstTask = timeline.indexOf("call:task");
		expect(timeline.slice(0, firstTask)).toEqual([
			"call:plan",
			"event:plan",
			"event:progress",
			"event:plan",
			"event:progress",
		]);
		expect(timeline.at(-1)).toBe("event:result");
		// Every call is preceded by the event that announced it.
		expect(timeline.indexOf("call:answer")).toBeGreaterThan(
			timeline.lastIndexOf("event:progress", timeline.indexOf("call:answer")),
		);
	});

	it("shows the task states pending → running → done and the decision with its reason", async () => {
		const { run, events } = setup({
			plan: [TWO_TASKS],
			decision: [decision("continue", "計画どおり進める")],
			answer: [resolvedAnswer()],
		});

		await run();

		const states = events
			.filter((event) => event.type === "plan")
			.map((event) => event.tasks.map((task) => task.state).join(","));
		expect(states).toEqual([
			"pending,pending",
			"running,pending",
			"done,pending",
			"done,running",
			"done,done",
		]);
		const decisions = events.flatMap((event) =>
			event.type === "progress" && event.decision ? [event.decision] : [],
		);
		expect(decisions).toEqual([
			{ decision: "continue", reason: "計画どおり進める" },
			{ decision: "continue", reason: "計画どおり進める" },
		]);
		const progress = events.filter((event) => event.type === "progress");
		expect(progress.at(-1)).toMatchObject({ stepsUsed: 3, maxSteps: DEFAULT_HELPDESK.maxSteps });
		expect(events.at(-1)).toMatchObject({ type: "result", ticketId: "T-0001", status: "resolved" });
	});

	it("carries the diff on the plan event of a replan", async () => {
		const { run, events } = setup({
			plan: [TWO_TASKS],
			decision: [decision("replan", "別の手順があった"), decision("continue")],
			replan: [planOf(["t4", ["t1"]])],
			answer: [resolvedAnswer()],
		});

		await run();

		const plans = events.filter((event) => event.type === "plan");
		const withDiff = plans.filter((event) => event.diff);
		// The diff rides on every plan state after the replan, so the last one still shows it.
		expect(withDiff.length).toBeGreaterThan(1);
		expect(plans.at(-1)?.diff).toBeDefined();
		expect(withDiff[0]).toMatchObject({
			revision: 1,
			diff: { added: ["t4"], removed: ["t2"], changed: [] },
		});
	});

	it("reports the unfinished tasks on a step-limit result", async () => {
		const { run, events } = setup(
			{ plan: [planOf(["t1"], ["t2", ["t1"]], ["t3"])] },
			{ maxSteps: 1 },
		);

		await run();

		expect(events.at(-1)).toMatchObject({
			type: "result",
			status: "open",
			remaining: ["t1", "t2", "t3"],
		});
	});
});

describe("runHelpdesk: abort", () => {
	it("starts no further LLM call after an abort during a task, and leaves the ticket open as aborted", async () => {
		const controller = new AbortController();
		const { scripted, run } = setup(
			{ plan: [TWO_TASKS], decision: [decision("continue")], answer: [resolvedAnswer()] },
			{ signal: controller.signal },
		);
		scripted.before((kind) => {
			if (kind === "task") controller.abort(new DOMException("Stopped", "AbortError"));
		});

		const outcome = await run();

		expect(scripted.calls).toEqual(["plan", "task"]);
		expect(outcome).toMatchObject({ status: "open", stoppedReason: "aborted" });
		expect(await store.get("T-0001")).toMatchObject({ status: "open", stoppedReason: "aborted" });
	});

	it("stores the steps used before the abort", async () => {
		const controller = new AbortController();
		const { scripted, run } = setup(
			{ plan: [TWO_TASKS], decision: [decision("continue")] },
			{ signal: controller.signal },
		);
		let tasks = 0;
		scripted.before((kind) => {
			if (kind === "task") tasks += 1;
			if (kind === "decision") controller.abort(new DOMException("Stopped", "AbortError"));
		});

		const outcome = await run();

		expect(tasks).toBe(1);
		expect(outcome).toMatchObject({ status: "open", stoppedReason: "aborted", stepsUsed: 2 });
		expect((await store.get("T-0001"))?.stepsUsed).toBe(2);
	});

	it("throws, and creates no ticket, when the caller aborts before the plan exists", async () => {
		const controller = new AbortController();
		const { scripted, run } = setup({ plan: [TWO_TASKS] }, { signal: controller.signal });
		scripted.before(() => controller.abort(new DOMException("Stopped", "AbortError")));

		await expect(run()).rejects.toThrow();
		expect(await store.list()).toEqual([]);
	});

	it("starts nothing when already aborted", async () => {
		const controller = new AbortController();
		controller.abort(new DOMException("Stopped", "AbortError"));
		const { scripted, run } = setup({ plan: [TWO_TASKS] }, { signal: controller.signal });

		await expect(run()).rejects.toThrow();
		expect(scripted.calls).toEqual([]);
	});
});

describe("planning, replanning and deciding are workflows, not agent loops (ADR-9)", () => {
	it.each(["planner.ts", "replanner.ts", "helpdesk.ts"])(
		"%s does not import ToolLoopAgent or createGuardedAgent",
		(file) => {
			const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
			const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

			expect(code).not.toMatch(/\bToolLoopAgent\b/);
			expect(code).not.toMatch(/\bcreateGuardedAgent\b/);
			expect(code).not.toMatch(/from ["']\.\.\/agents/);
		},
	);

	it("only run.ts creates an agent loop in helpdesk/", () => {
		const source = readFileSync(new URL("./run.ts", import.meta.url), "utf8");
		expect(source).toMatch(/\bcreateGuardedAgent\b/);
	});
});

async function runHelpdeskWith(params: RunHelpdeskParams) {
	return await runHelpdesk(params);
}
