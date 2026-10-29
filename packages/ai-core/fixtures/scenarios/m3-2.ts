import { defineScenario, type ScenarioDefinition } from "../../src/mock/scenario";

// Mock responses for module 3-2 (the help-desk agent). One chat model answers every call of a run,
// so each turn is told apart by what the prompt asks for and by text only that scenario produces:
//
//   plan      `</knowledge>\n\n<inquiry>\n{inquiry}`                      (helpdesk/planner.ts)
//   task      `タスク {id}: {description}`                                (helpdesk/run.ts)
//   decision  `次の動きを選んでください。` + the plan with its states        (helpdesk/replanner.ts)
//   replan    `残りのタスクを作り直してください。` + the plan with its states (helpdesk/replanner.ts)
//   answer    `最終回答を作成してください。\n\n<inquiry>\n{inquiry}`          (helpdesk/helpdesk.ts)
//
// The wording is copied from those prompts; the route tests run every scenario end to end, so a
// changed prompt fails there instead of silently matching nothing.

/** Inquiries that the scenarios below answer; the UI offers them as input examples in `mock`. */
export const M3_2_SAMPLE_INQUIRIES = Object.freeze({
	resolved: "自宅から VPN に接続できません。確認する手順を教えてください。",
	replanned: "共有プリンターを追加したいのですが、一覧に表示されません。どうすればよいですか。",
	unresolved: "新しい設計ツールを、承認を待たずに今すぐ導入してもよいですか。",
	invalidPlan: "計画を正しく作れない問い合わせの例です（モックの動作確認用）。",
});

interface TaskLine {
	readonly id: string;
	readonly description: string;
	readonly dependsOn?: readonly string[];
	readonly done: boolean;
}

/** `describePlan` of `helpdesk/replanner.ts`. */
function planLines(tasks: readonly TaskLine[]): string {
	return tasks
		.map((task) => {
			const state = task.done ? "完了" : "未完了";
			const deps =
				task.dependsOn && task.dependsOn.length > 0 ? `（依存: ${task.dependsOn.join(", ")}）` : "";
			return `- ${task.id} [${state}] ${task.description}${deps}`;
		})
		.join("\n");
}

const planAnchor = (inquiry: string) => `</knowledge>\n\n<inquiry>\n${inquiry}`;
const answerAnchor = (inquiry: string) => `最終回答を作成してください。\n\n<inquiry>\n${inquiry}`;
const taskAnchor = (id: string, description: string) => `タスク ${id}: ${description}`;
const decisionAnchor = (tasks: readonly TaskLine[]) =>
	`次の動きを選んでください。\n\n<plan>\n${planLines(tasks)}\n</plan>`;
const replanAnchor = (tasks: readonly TaskLine[]) =>
	`残りのタスクを作り直してください。\n\n<plan>\n${planLines(tasks)}\n</plan>`;

/** A task run: a knowledge-base search, then the summary of what it found. */
function taskTurns(id: string, description: string, query: string, summary: string) {
	const anchor = taskAnchor(id, description);
	return [
		{
			match: { purpose: "chat" as const, lastUserTextIncludes: anchor, stepIndex: 0 },
			respond: {
				toolCalls: [{ toolName: "searchKnowledgeBase", input: { query } }],
				usage: { inputTokens: 380, outputTokens: 24 },
			},
		},
		{
			match: {
				purpose: "chat" as const,
				lastUserTextIncludes: anchor,
				stepIndex: 1,
				toolResultFor: "searchKnowledgeBase",
			},
			respond: { text: summary, usage: { inputTokens: 620, outputTokens: 60 } },
		},
	];
}

const planTurn = (inquiry: string, plan: unknown) => ({
	match: { purpose: "chat" as const, lastUserTextIncludes: planAnchor(inquiry) },
	respond: { object: plan as never, usage: { inputTokens: 420, outputTokens: 120 } },
});
const decisionTurn = (
	tasks: readonly TaskLine[],
	decision: "continue" | "replan" | "finish",
	reason: string,
) => ({
	match: { purpose: "chat" as const, lastUserTextIncludes: decisionAnchor(tasks) },
	respond: { object: { decision, reason }, usage: { inputTokens: 520, outputTokens: 40 } },
});
const answerTurn = (inquiry: string, answer: object) => ({
	match: { purpose: "chat" as const, lastUserTextIncludes: answerAnchor(inquiry) },
	respond: { object: answer as never, usage: { inputTokens: 700, outputTokens: 150 } },
});

// --- resolved: two tasks in dependency order, then an answer ---------------------------------------
const R = M3_2_SAMPLE_INQUIRIES.resolved;
const R1 = "VPN に接続できないときの確認手順を調べる";
const R2 = "接続が進まない原因と、その確認方法を調べる";
const RESOLVED_PLAN = {
	tasks: [
		{ id: "t1", description: R1, dependsOn: [] },
		{ id: "t2", description: R2, dependsOn: ["t1"] },
	],
};

// --- replanned: the first result changes the plan -------------------------------------------------
const P = M3_2_SAMPLE_INQUIRIES.replanned;
const P1 = "共有プリンターが一覧に表示されないときの手順を調べる";
const P2 = "プリンターの追加方法を調べる";
const P3 = "社員用の無線ネットワークへの接続手順を調べる";
const REPLANNED_PLAN = {
	tasks: [
		{ id: "t1", description: P1, dependsOn: [] },
		{ id: "t2", description: P2, dependsOn: ["t1"] },
	],
};

// --- unresolved: the knowledge does not settle it -------------------------------------------------
const U = M3_2_SAMPLE_INQUIRIES.unresolved;
const U1 = "ソフトウェアを導入する手順と承認の要否を調べる";

// --- invalid plan: every attempt has a dependency cycle ---------------------------------------------
const X = M3_2_SAMPLE_INQUIRIES.invalidPlan;
const CYCLIC_PLAN = {
	tasks: [
		{ id: "t1", description: "最初の確認をする", dependsOn: ["t2"] },
		{ id: "t2", description: "次の確認をする", dependsOn: ["t1"] },
	],
};

export const M3_2_SCENARIOS: readonly ScenarioDefinition[] = [
	defineScenario({
		id: "m3-2/helpdesk/resolved",
		turns: [
			planTurn(R, RESOLVED_PLAN),
			...taskTurns(
				"t1",
				R1,
				"VPN 接続できないとき",
				"手順書によると、まず社外のネットワークに接続できているかを確認し、次に認証アプリの時刻が正しいかを確認します。",
			),
			decisionTurn(
				[
					{ id: "t1", description: R1, done: true },
					{ id: "t2", description: R2, dependsOn: ["t1"], done: false },
				],
				"continue",
				"確認項目が見つかったので、計画どおり原因の確認方法を調べる。",
			),
			...taskTurns(
				"t2",
				R2,
				"認証アプリ 時刻 ワンタイムコード",
				"端末の時刻がずれているとワンタイムコードが拒否されます。時刻を自動設定にし、VPN クライアントを最新版に更新します。",
			),
			decisionTurn(
				[
					{ id: "t1", description: R1, done: true },
					{ id: "t2", description: R2, dependsOn: ["t1"], done: true },
				],
				"finish",
				"回答に必要な根拠がそろった。",
			),
			answerTurn(R, {
				outcome: "resolved",
				answer:
					"次の順に確認してください。1. 社外のネットワークに接続できているか。2. 認証アプリの時刻が正しいか（端末の時刻を自動設定にします）。3. VPN クライアントが最新版か。それでも接続できない場合は、クライアントの接続ログを保存してヘルプデスクに送ってください。",
			}),
		],
	}),
	defineScenario({
		id: "m3-2/helpdesk/replanned",
		turns: [
			planTurn(P, REPLANNED_PLAN),
			...taskTurns(
				"t1",
				P1,
				"共有プリンター 一覧に表示されない",
				"VPN 経由では共有プリンターを使えません。出社している場合は社内のネットワークに接続し直す必要があります。",
			),
			decisionTurn(
				[
					{ id: "t1", description: P1, done: true },
					{ id: "t2", description: P2, dependsOn: ["t1"], done: false },
				],
				"replan",
				"接続方法が原因だと分かったので、追加方法ではなくネットワークの接続手順を調べる計画に変える。",
			),
			{
				match: {
					purpose: "chat" as const,
					lastUserTextIncludes: replanAnchor([
						{ id: "t1", description: P1, done: true },
						{ id: "t2", description: P2, dependsOn: ["t1"], done: false },
					]),
				},
				respond: {
					object: { tasks: [{ id: "t3", description: P3, dependsOn: ["t1"] }] },
					usage: { inputTokens: 560, outputTokens: 80 },
				},
			},
			...taskTurns(
				"t3",
				P3,
				"社員用の無線ネットワーク 接続",
				"出社している場合は、社員用の無線ネットワークに接続し直してからプリンターを追加します。",
			),
			decisionTurn(
				[
					{ id: "t1", description: P1, done: true },
					{ id: "t3", description: P3, dependsOn: ["t1"], done: true },
				],
				"finish",
				"原因と対処が分かった。",
			),
			answerTurn(P, {
				outcome: "resolved",
				answer:
					"VPN 経由では共有プリンターを使えません。出社している場合は、社員用の無線ネットワークに接続し直してから、プリンターを追加してください。",
			}),
		],
	}),
	defineScenario({
		id: "m3-2/helpdesk/unresolved",
		turns: [
			planTurn(U, { tasks: [{ id: "t1", description: U1, dependsOn: [] }] }),
			...taskTurns(
				"t1",
				U1,
				"ソフトウェア 導入 申請",
				"一覧にないソフトウェアは導入申請が必要で、結果の連絡まで通常 3 営業日かかります。承認を待たずに導入してよい条件は見つかりませんでした。",
			),
			decisionTurn(
				[{ id: "t1", description: U1, done: true }],
				"finish",
				"これ以上調べても、個別の承認の可否は分からない。",
			),
			answerTurn(U, {
				outcome: "unresolved",
				reason:
					"導入申請が必要なことは分かりましたが、承認を待たずに導入してよいかはナレッジから判断できません。担当者の確認が必要です。",
			}),
		],
	}),
	defineScenario({
		id: "m3-2/helpdesk/invalid-plan",
		turns: [planTurn(X, CYCLIC_PLAN)],
	}),
];
