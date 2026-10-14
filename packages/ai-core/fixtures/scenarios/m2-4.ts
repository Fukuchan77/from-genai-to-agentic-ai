import {
	defineScenario,
	type ScenarioDefinition,
	type ScenarioTurn,
} from "../../src/mock/scenario";

// Mock responses for module 2-4 (agent design patterns). Like `m2-3.ts`, a turn matches on the
// model's `purpose` and a stage label that the demo composition in `src/patterns/demos.ts` (or the
// pattern itself) puts in its prompt; the sample task makes the variants distinct.
// `src/patterns/demos.test.ts` runs every demo against these scenarios, which pins the labels.

/** Tasks that the scenarios below answer; the UI offers them as input examples in `mock`. */
export const M2_4_SAMPLE_TASKS = Object.freeze({
	passiveGoal: Object.freeze({
		sufficient: "社内向けの週報テンプレートを A4 1 枚で作ってください。",
		ambiguous: "いい感じに改善しておいてください。",
	}),
	optimizer: Object.freeze({
		prompt: "要約して",
		response: "VPN に繋がらないなら再起動してください。",
	}),
	singlePath: "新入社員の研修資料を作成する。",
	multiPath: "社内の問い合わせ対応を効率化する。",
	selfReflection: "社内ポータルの紹介文を 2 文で書いてください。",
	crossReflection: "新機能のリリースノートを 2 文で書いてください。",
	roleBased: "社内ポータルの利用状況を調べ、集計し、結果をレビューしてください。",
});

const TASKS = M2_4_SAMPLE_TASKS;

function taskBlock(task: string): string {
	return `<task>\n${task}\n</task>`;
}

function stage(label: string, task: string): string {
	return `[段: ${label}]\n${taskBlock(task)}`;
}

function turn(
	purpose: "chat" | "structured" | "judge",
	marker: string,
	respond: ScenarioTurn["respond"],
	stepIndex?: number,
): ScenarioTurn {
	return {
		match: {
			purpose,
			lastUserTextIncludes: marker,
			...(stepIndex === undefined ? {} : { stepIndex }),
		},
		respond,
	};
}

function text(content: string, input: number, output: number): ScenarioTurn["respond"] {
	return { text: content, usage: { inputTokens: input, outputTokens: output } };
}

function object(value: object, input: number, output: number): ScenarioTurn["respond"] {
	return {
		object: value as Record<string, never>,
		usage: { inputTokens: input, outputTokens: output },
	};
}

function critique(note: string, needsRevision: boolean): ScenarioTurn["respond"] {
	return object({ critique: note, needsRevision }, 220, 50);
}

const PLAN_STEPS = Object.freeze({
	one: ["現状の資料を集める", "不足している項目を洗い出す", "資料を書き直して共有する"],
	a: ["問い合わせの種類を分類する", "よくある質問に定型回答を用意する"],
	b: ["担当者ごとの負荷を可視化する", "対応の窓口を一本化する", "週次で振り返る"],
	c: ["問い合わせ内容を要約して一覧にする"],
});

export const M2_4_SCENARIOS: readonly ScenarioDefinition[] = [
	defineScenario({
		id: "m2-4/passive-goal-creator/sufficient",
		turns: [
			turn(
				"structured",
				`<instruction>\n${TASKS.passiveGoal.sufficient}\n</instruction>`,
				object(
					{
						objective: "社内向けの週報テンプレートを作る",
						constraints: ["A4 1 枚に収める"],
						successCriteria: ["5 分で書き終えられる"],
						missingInformation: [],
						clarifyingQuestions: [],
					},
					180,
					70,
				),
			),
		],
	}),
	defineScenario({
		id: "m2-4/passive-goal-creator/ambiguous",
		turns: [
			turn(
				"structured",
				`<instruction>\n${TASKS.passiveGoal.ambiguous}\n</instruction>`,
				object(
					{
						objective: "何かを改善する（対象が未定）",
						constraints: [],
						successCriteria: ["依頼者が改善されたと判断できる"],
						missingInformation: ["改善の対象", "期限"],
						clarifyingQuestions: ["どのシステムや文書を対象にしますか？", "いつまでに必要ですか？"],
					},
					170,
					80,
				),
			),
		],
	}),
	defineScenario({
		id: "m2-4/prompt-response-optimizer/prompt",
		turns: [
			turn(
				"structured",
				`<original>\n${TASKS.optimizer.prompt}\n</original>`,
				object(
					{
						improved:
							"あなたは編集者です。次の文章を 3 行以内の日本語で要約し、結論を最初の 1 行に書いてください。",
						reasons: ["役割を与えた", "出力の形式と長さを指定した"],
					},
					200,
					90,
				),
			),
		],
	}),
	defineScenario({
		id: "m2-4/prompt-response-optimizer/response",
		turns: [
			turn(
				"structured",
				`<original>\n${TASKS.optimizer.response}\n</original>`,
				object(
					{
						improved:
							"VPN に接続できない場合は、まず端末を再起動してください。それでも接続できないときは、情報システム部に連絡してください。",
						reasons: ["次の手段を示した", "連絡先を補った"],
					},
					200,
					90,
				),
			),
		],
	}),
	defineScenario({
		id: "m2-4/single-path-plan",
		turns: [
			turn(
				"structured",
				`<goal>\n${TASKS.singlePath}\n</goal>`,
				object({ steps: PLAN_STEPS.one }, 150, 60),
			),
			turn(
				"chat",
				stage("ステップ 1", TASKS.singlePath),
				text("既存の研修資料を 4 点見つけました。", 120, 30),
			),
			turn(
				"chat",
				stage("ステップ 2", TASKS.singlePath),
				text("セキュリティと経費精算の項目が不足しています。", 150, 30),
			),
			turn(
				"chat",
				stage("ステップ 3", TASKS.singlePath),
				text("資料を更新し、共有フォルダに置きました。", 180, 30),
			),
		],
	}),
	defineScenario({
		id: "m2-4/multi-path-plan",
		turns: [
			turn(
				"structured",
				`候補 1/3 として、他の候補とは異なる切り口で計画を立ててください。\n<goal>\n${TASKS.multiPath}\n</goal>`,
				object({ steps: PLAN_STEPS.a }, 150, 50),
			),
			turn(
				"structured",
				`候補 2/3 として、他の候補とは異なる切り口で計画を立ててください。\n<goal>\n${TASKS.multiPath}\n</goal>`,
				object({ steps: PLAN_STEPS.b }, 150, 60),
			),
			turn(
				"structured",
				`候補 3/3 として、他の候補とは異なる切り口で計画を立ててください。\n<goal>\n${TASKS.multiPath}\n</goal>`,
				object({ steps: PLAN_STEPS.c }, 150, 30),
			),
			turn(
				"judge",
				`<goal>\n${TASKS.multiPath}\n</goal>\n\n<candidate number="1">`,
				object(
					{
						evaluations: [
							{ candidate: 1, score: 70, comment: "すぐ始められるが、負荷の偏りは残る。" },
							{ candidate: 2, score: 85, comment: "原因の可視化から入り、窓口の一本化まで届く。" },
							{ candidate: 3, score: 40, comment: "一覧にするだけで、効率化にはつながらない。" },
						],
						selectedCandidate: 2,
						reason: "負荷の可視化と窓口の一本化まで含み、効率化の効果が最も大きいため。",
					},
					400,
					120,
				),
			),
		],
	}),
	defineScenario({
		id: "m2-4/self-reflection",
		turns: [
			turn(
				"chat",
				stage("初稿", TASKS.selfReflection),
				text("社内ポータルは申請や検索をまとめた入口です。使い方は別に案内します。", 90, 40),
			),
			turn("chat", stage("批評 1", TASKS.selfReflection), critique("使い方への誘導が弱い。", true)),
			turn(
				"chat",
				stage("修正 1", TASKS.selfReflection),
				text(
					"社内ポータルは申請や検索をまとめた入口です。使い方はトップの案内から確認できます。",
					200,
					45,
				),
			),
			turn(
				"chat",
				stage("批評 2", TASKS.selfReflection),
				critique("対象の利用者が書かれていない。", true),
			),
			turn(
				"chat",
				stage("修正 2", TASKS.selfReflection),
				text(
					"社員向けの入口である社内ポータルでは、申請や検索ができます。使い方はトップの案内から確認できます。",
					220,
					50,
				),
			),
			turn(
				"chat",
				stage("批評 3", TASKS.selfReflection),
				critique("2 文で目的と使い方が伝わる。修正は不要。", false),
			),
		],
	}),
	defineScenario({
		id: "m2-4/cross-reflection",
		turns: [
			turn(
				"chat",
				stage("初稿", TASKS.crossReflection),
				text("新機能を追加しました。詳しくはヘルプをご覧ください。", 90, 30),
			),
			turn(
				"judge",
				stage("批評 1", TASKS.crossReflection),
				critique("どんな機能かが書かれていない。", true),
			),
			turn(
				"chat",
				stage("修正 1", TASKS.crossReflection),
				text("ダッシュボードに検索機能を追加しました。詳しくはヘルプをご覧ください。", 200, 40),
			),
			turn(
				"judge",
				stage("批評 2", TASKS.crossReflection),
				critique("機能が具体的になった。修正は不要。", false),
			),
		],
	}),
	defineScenario({
		id: "m2-4/role-based-cooperation",
		turns: [
			turn(
				"chat",
				`[役割: researcher]\n${taskBlock(TASKS.roleBased)}`,
				{
					toolCalls: [{ toolName: "currentTime", input: {} }],
					usage: { inputTokens: 200, outputTokens: 20 },
				},
				0,
			),
			{
				match: {
					purpose: "chat",
					stepIndex: 1,
					toolResultFor: "currentTime",
					lastUserTextIncludes: `[役割: researcher]\n${taskBlock(TASKS.roleBased)}`,
				},
				respond: text("調査: 利用者は 1 日あたり 120 人で、申請系の機能が中心です。", 260, 40),
			},
			turn(
				"chat",
				`[役割: coder]\n${taskBlock(TASKS.roleBased)}`,
				{
					toolCalls: [{ toolName: "calculator", input: { expression: "120 * 22" } }],
					usage: { inputTokens: 300, outputTokens: 25 },
				},
				0,
			),
			{
				match: {
					purpose: "chat",
					stepIndex: 1,
					toolResultFor: "calculator",
					lastUserTextIncludes: `[役割: coder]\n${taskBlock(TASKS.roleBased)}`,
				},
				respond: text("集計: 月間の延べ利用者数は 2,640 人です。", 340, 30),
			},
			turn(
				"chat",
				`[役割: reviewer]\n${taskBlock(TASKS.roleBased)}`,
				text("レビュー: 調査と集計は整合しています。承認します。", 420, 30),
				0,
			),
		],
	}),
];
