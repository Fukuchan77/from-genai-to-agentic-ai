// Regression (plan C16, Req 2.1, 2.6, 2.7): the plumbing of the help-desk agent, inquiry → plan →
// execute → judge → ticket saved, for both outcomes. The model is a `mock` scenario model and the
// ticket tables live in a throwaway in-memory PGlite. Every assertion is on the end state of the
// whole run (the outcome, the stored ticket row, the stored plan revisions, the events the
// dashboard received), so a run that merely does not throw cannot pass. The prompts' behaviour is
// unit-tested inside `@platform/ai-core`; this file pins what a learner would observe afterwards.
import {
	createTicketStore,
	type HelpdeskEvent,
	type HelpdeskOutcome,
	runHelpdesk,
	type TicketStore,
} from "@platform/ai-core/helpdesk";
import {
	createScenarioModel,
	defineScenario,
	type ScenarioDefinition,
} from "@platform/ai-core/mock";
import { createPgliteDatabase, type RagDatabaseHandle } from "@platform/ai-core/rag";
import { createFakeClock } from "@platform/ai-core/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const LIMITS = {
	maxSteps: 6,
	maxTotalTokens: 50_000,
	maxDurationMs: 120_000,
	toolTimeoutMs: 15_000,
};

const START = Date.parse("2026-10-18T00:00:00.000Z");

/** PGlite start-up plus the migrations: about 1 s alone, several times that on a loaded machine. */
const SETUP_TIMEOUT_MS = 90_000;

interface PlanLine {
	readonly id: string;
	readonly description: string;
	readonly dependsOn?: readonly string[];
	readonly done: boolean;
}

/** The plan as the next-step prompt shows it (`describePlan` in `helpdesk/replanner.ts`). */
function planLines(tasks: readonly PlanLine[]): string {
	return tasks
		.map((task) => {
			const deps =
				task.dependsOn && task.dependsOn.length > 0 ? `（依存: ${task.dependsOn.join(", ")}）` : "";
			return `- ${task.id} [${task.done ? "完了" : "未完了"}] ${task.description}${deps}`;
		})
		.join("\n");
}

/** A task run: one knowledge-base search, then the summary of what it found. */
function taskTurns(id: string, description: string, query: string, summary: string) {
	const anchor = `タスク ${id}: ${description}`;
	return [
		{
			match: { purpose: "chat" as const, lastUserTextIncludes: anchor, stepIndex: 0 },
			respond: { toolCalls: [{ toolName: "searchKnowledgeBase", input: { query } }] },
		},
		{
			match: {
				purpose: "chat" as const,
				lastUserTextIncludes: anchor,
				stepIndex: 1,
				toolResultFor: "searchKnowledgeBase",
			},
			respond: { text: summary },
		},
	];
}

const planTurn = (inquiry: string, plan: object) => ({
	match: {
		purpose: "chat" as const,
		lastUserTextIncludes: `</knowledge>\n\n<inquiry>\n${inquiry}`,
	},
	respond: { object: plan as never },
});

const decisionTurn = (
	tasks: readonly PlanLine[],
	decision: "continue" | "finish",
	reason: string,
) => ({
	match: {
		purpose: "chat" as const,
		lastUserTextIncludes: `次の動きを選んでください。\n\n<plan>\n${planLines(tasks)}\n</plan>`,
	},
	respond: { object: { decision, reason } },
});

const answerTurn = (inquiry: string, answer: object) => ({
	match: {
		purpose: "chat" as const,
		lastUserTextIncludes: `最終回答を作成してください。\n\n<inquiry>\n${inquiry}`,
	},
	respond: { object: answer as never },
});

// --- resolved: two tasks in dependency order, a judge that finishes, a resolved answer -------------
const RESOLVED_INQUIRY = "評価用: 社外から VPN に接続できません。確認する手順を教えてください。";
const RESOLVED_T1 = "評価用: VPN に接続できないときの確認手順を調べる";
const RESOLVED_T2 = "評価用: 接続が進まない原因の確認方法を調べる";
const RESOLVED_ANSWER =
	"社外のネットワークに接続できているかを確認し、認証アプリの時刻を自動設定にしてから、VPN クライアントを最新版に更新してください。";

const RESOLVED_SCENARIO = defineScenario({
	id: "eval/regression/helpdesk/resolved",
	turns: [
		planTurn(RESOLVED_INQUIRY, {
			tasks: [
				{ id: "t1", description: RESOLVED_T1, dependsOn: [] },
				{ id: "t2", description: RESOLVED_T2, dependsOn: ["t1"] },
			],
		}),
		...taskTurns(
			"t1",
			RESOLVED_T1,
			"VPN 接続できない",
			"社外のネットワークと認証アプリの時刻を確認する。",
		),
		decisionTurn(
			[
				{ id: "t1", description: RESOLVED_T1, done: true },
				{ id: "t2", description: RESOLVED_T2, dependsOn: ["t1"], done: false },
			],
			"continue",
			"確認項目が見つかったので、原因の確認方法を調べる。",
		),
		...taskTurns(
			"t2",
			RESOLVED_T2,
			"認証アプリ 時刻",
			"時刻がずれるとコードが拒否される。クライアントを更新する。",
		),
		decisionTurn(
			[
				{ id: "t1", description: RESOLVED_T1, done: true },
				{ id: "t2", description: RESOLVED_T2, dependsOn: ["t1"], done: true },
			],
			"finish",
			"回答に必要な根拠がそろった。",
		),
		answerTurn(RESOLVED_INQUIRY, { outcome: "resolved", answer: RESOLVED_ANSWER }),
	],
});

// --- escalated: the knowledge cannot settle it, so the judge marks the answer unresolved -----------
const ESCALATED_INQUIRY = "評価用: 新しい設計ツールを、承認を待たずに今すぐ導入してもよいですか。";
const ESCALATED_T1 = "評価用: ソフトウェアの導入手順と承認の要否を調べる";
const ESCALATED_REASON =
	"導入申請が必要なことは分かりましたが、承認を待たずに導入してよいかはナレッジから判断できません。担当者の確認が必要です。";

const ESCALATED_SCENARIO = defineScenario({
	id: "eval/regression/helpdesk/escalated",
	turns: [
		planTurn(ESCALATED_INQUIRY, {
			tasks: [{ id: "t1", description: ESCALATED_T1, dependsOn: [] }],
		}),
		...taskTurns(
			"t1",
			ESCALATED_T1,
			"ソフトウェア 導入 申請",
			"導入申請が必要で、承認を待たずに導入してよい条件は見つかりませんでした。",
		),
		decisionTurn(
			[{ id: "t1", description: ESCALATED_T1, done: true }],
			"finish",
			"これ以上調べても、個別の承認の可否は分からない。",
		),
		answerTurn(ESCALATED_INQUIRY, { outcome: "unresolved", reason: ESCALATED_REASON }),
	],
});

const SCENARIOS: readonly ScenarioDefinition[] = [RESOLVED_SCENARIO, ESCALATED_SCENARIO];

const SEARCH_HIT = {
	chunk: {
		id: "eval-faq#1",
		documentId: "eval-faq",
		documentTitle: "評価用 FAQ",
		headingPath: ["評価用", "手順"],
		page: null,
		body: "評価用の手順書の本文。",
	},
};

let handle: RagDatabaseHandle;
let store: TicketStore;

beforeAll(async () => {
	handle = await createPgliteDatabase();
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
	await handle.close();
});

beforeEach(async () => {
	store = createTicketStore(handle.db, { clock: createFakeClock(START) });
	await store.reset();
});

interface Run {
	readonly outcome: HelpdeskOutcome;
	readonly events: readonly HelpdeskEvent[];
	readonly queries: readonly string[];
}

async function run(inquiry: string): Promise<Run> {
	const events: HelpdeskEvent[] = [];
	const queries: string[] = [];
	const outcome = await runHelpdesk({
		inquiry,
		model: createScenarioModel({ purpose: "chat", scenarios: SCENARIOS }),
		store,
		knowledge: {
			search: async (query) => {
				queries.push(query);
				return [SEARCH_HIT];
			},
			documentTitles: ["評価用 FAQ"],
		},
		limits: LIMITS,
		clock: createFakeClock(START),
		signal: new AbortController().signal,
		onEvent: (event) => {
			events.push(event);
		},
	});
	return { outcome, events, queries };
}

describe("help-desk plan → execute → judge → ticket (regression)", () => {
	it("resolves: runs the planned tasks in dependency order and saves the answer on the ticket", async () => {
		const { outcome, events, queries } = await run(RESOLVED_INQUIRY);

		expect(outcome).toEqual({
			status: "resolved",
			ticketId: "T-0001",
			answer: RESOLVED_ANSWER,
			stepsUsed: 3,
		});
		// Each task searched the knowledge base once, t1 before t2 (its dependency).
		expect(queries).toEqual(["VPN 接続できない", "認証アプリ 時刻"]);

		// The stored ticket row is the end state: resolved, with the answer and without an escalation.
		const tickets = await store.list();
		expect(tickets.map((t) => t.id)).toEqual(["T-0001"]);
		const ticket = await store.get("T-0001");
		expect(ticket).toMatchObject({
			id: "T-0001",
			inquiry: RESOLVED_INQUIRY,
			status: "resolved",
			answer: RESOLVED_ANSWER,
			stepsUsed: 3,
		});
		expect(ticket?.escalationReason).toBeUndefined();
		expect(ticket?.stoppedReason).toBeUndefined();

		// The plan was stored as revision 0 and never changed.
		const revisions = await store.revisions("T-0001");
		expect(revisions.map((r) => r.revision)).toEqual([0]);
		expect(revisions[0]?.reason).toBe("initial");
		expect(revisions[0]?.plan.tasks).toEqual([
			{ id: "t1", description: RESOLVED_T1, dependsOn: [] },
			{ id: "t2", description: RESOLVED_T2, dependsOn: ["t1"] },
		]);

		// The dashboard saw both tasks finish and ended on the same result as the stored row.
		const lastPlan = events.findLast((event) => event.type === "plan");
		expect(lastPlan).toMatchObject({
			type: "plan",
			revision: 0,
			tasks: [
				{ id: "t1", state: "done" },
				{ id: "t2", state: "done" },
			],
		});
		expect(events.at(-1)).toEqual({
			type: "result",
			ticketId: "T-0001",
			status: "resolved",
			answer: RESOLVED_ANSWER,
		});
	});

	it("escalates: records the unresolved reason on the ticket and saves no answer", async () => {
		const { outcome, events, queries } = await run(ESCALATED_INQUIRY);

		expect(outcome).toEqual({
			status: "escalated",
			ticketId: "T-0001",
			reason: ESCALATED_REASON,
			stepsUsed: 2,
		});
		expect(queries).toEqual(["ソフトウェア 導入 申請"]);

		// The stored ticket row is the end state: escalated, with the reason and without an answer.
		const tickets = await store.list();
		expect(tickets.map((t) => t.id)).toEqual(["T-0001"]);
		const ticket = await store.get("T-0001");
		expect(ticket).toMatchObject({
			id: "T-0001",
			inquiry: ESCALATED_INQUIRY,
			status: "escalated",
			escalationReason: ESCALATED_REASON,
			stepsUsed: 2,
		});
		expect(ticket?.answer).toBeUndefined();
		expect(ticket?.stoppedReason).toBeUndefined();

		const revisions = await store.revisions("T-0001");
		expect(revisions.map((r) => r.revision)).toEqual([0]);
		expect(revisions[0]?.plan.tasks).toEqual([
			{ id: "t1", description: ESCALATED_T1, dependsOn: [] },
		]);

		expect(events.at(-1)).toEqual({
			type: "result",
			ticketId: "T-0001",
			status: "escalated",
			reason: ESCALATED_REASON,
		});
	});

	it("keeps the two outcomes apart: filtering the stored tickets by status finds each run", async () => {
		await run(RESOLVED_INQUIRY);
		await run(ESCALATED_INQUIRY);

		const resolved = await store.list({ status: "resolved" });
		const escalated = await store.list({ status: "escalated" });
		expect(resolved.map((t) => [t.id, t.inquiry])).toEqual([["T-0001", RESOLVED_INQUIRY]]);
		expect(escalated.map((t) => [t.id, t.inquiry])).toEqual([["T-0002", ESCALATED_INQUIRY]]);
		expect(await store.list({ status: "open" })).toEqual([]);
	});
});
