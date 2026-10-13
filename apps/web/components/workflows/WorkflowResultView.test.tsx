import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WorkflowResultView, type WorkflowRun } from "./WorkflowResultView";

afterEach(cleanup);

const USAGE = {
	inputTokens: 1200,
	outputTokens: 340,
	totalTokens: 1540,
	cacheReadTokens: 0,
	llmCalls: 4,
};

function show(run: unknown) {
	return render(<WorkflowResultView run={run as WorkflowRun} />);
}

/** The direct items of a list (an item may hold a list of its own). */
function items(name: string) {
	return [...screen.getByRole("list", { name }).children];
}

describe("WorkflowResultView common frame", () => {
	it("shows the number of model calls and the tokens the run used", () => {
		show({
			name: "routing",
			result: { category: "technical", reason: "r", matched: true, output: "o" },
			usage: USAGE,
		});

		const usage = screen.getByRole("region", { name: "使用量" });
		expect(usage.textContent).toContain("モデル呼び出し 4 回");
		expect(usage.textContent).toContain("入力 1,200");
		expect(usage.textContent).toContain("出力 340");
	});
});

describe("prompt-chaining", () => {
	const steps = [
		{ name: "outline", output: "1. 準備\n2. 接続", errors: [] },
		{ name: "body", output: "準備と接続の手順です。", errors: [] },
	];

	it("shows each step's result in order and the final output", () => {
		show({
			name: "prompt-chaining",
			result: { status: "completed", output: "準備と接続の手順です。", steps },
			usage: USAGE,
		});

		const [first, second] = items("ステップ");
		expect(first?.textContent).toContain("outline");
		expect(first?.textContent).toContain("2. 接続");
		expect(second?.textContent).toContain("body");
		expect(screen.getByRole("region", { name: "最終出力" }).textContent).toContain(
			"準備と接続の手順です。",
		);
	});

	it("names the step that failed and shows its validation errors", () => {
		show({
			name: "prompt-chaining",
			result: {
				status: "failed",
				failedStep: "body",
				errors: ["本文にアウトラインの見出し「準備」がありません。"],
				steps: [
					steps[0],
					{
						name: "body",
						output: "短い本文",
						errors: ["本文にアウトラインの見出し「準備」がありません。"],
					},
				],
			},
			usage: USAGE,
		});

		const alert = screen.getByRole("alert");
		expect(alert.textContent).toContain("body");
		expect(alert.textContent).toContain("失敗");
		expect(alert.textContent).toContain("本文にアウトラインの見出し「準備」がありません。");
		expect(screen.queryByRole("region", { name: "最終出力" })).toBeNull();
		expect(items("ステップ")).toHaveLength(2);
	});
});

describe("routing", () => {
	it("shows the category, the reason and the handler's output", () => {
		show({
			name: "routing",
			result: {
				category: "technical",
				reason: "エラーコードがあるため",
				matched: true,
				output: "調べます",
			},
			usage: USAGE,
		});

		expect(screen.getByText("technical")).toBeTruthy();
		expect(screen.getByText("エラーコードがあるため")).toBeTruthy();
		expect(screen.getByText("調べます")).toBeTruthy();
		expect(screen.queryByText(/フォールバック/)).toBeNull();
	});

	it("says so when no category matched and the fallback ran", () => {
		show({
			name: "routing",
			result: {
				category: "unknown",
				reason: "天気は範囲外",
				matched: false,
				output: "お答えできません",
			},
			usage: USAGE,
		});

		expect(screen.getByText(/フォールバック/)).toBeTruthy();
	});
});

describe("model-routing", () => {
	const base = {
		difficulty: "hard",
		reason: "複数の観点を比べるため",
		tier: "capable",
		modelId: "mock:general-v1",
		displayName: "Deterministic Mock Model",
		distinct: true,
		output: "比較の結果です",
		usage: { inputTokens: 300, outputTokens: 80, totalTokens: 380, cacheReadTokens: 0 },
	};

	it("shows the difficulty, the tier, the model and its token use", () => {
		show({ name: "model-routing", result: base, usage: USAGE });

		const decision = screen.getByRole("region", { name: "モデルの選択" });
		expect(decision.textContent).toContain("hard");
		expect(decision.textContent).toContain("高性能");
		expect(decision.textContent).toContain("Deterministic Mock Model");
		expect(decision.textContent).toContain("mock:general-v1");
		expect(decision.textContent).toContain("入力 300");
		expect(decision.textContent).toContain("出力 80");
		expect(screen.getByText("比較の結果です")).toBeTruthy();
	});

	it("labels the light tier", () => {
		show({
			name: "model-routing",
			result: { ...base, difficulty: "easy", tier: "light" },
			usage: USAGE,
		});

		expect(screen.getByRole("region", { name: "モデルの選択" }).textContent).toContain("軽量");
	});

	it("notes that the two tiers are the same model when they are not distinct", () => {
		show({ name: "model-routing", result: { ...base, distinct: false }, usage: USAGE });

		expect(screen.getByText(/同じモデル/)).toBeTruthy();
	});

	it("shows no such note when the tiers differ", () => {
		show({ name: "model-routing", result: base, usage: USAGE });

		expect(screen.queryByText(/同じモデル/)).toBeNull();
	});
});

describe("parallel-sectioning", () => {
	it("shows the result of every section under its aspect", () => {
		show({
			name: "parallel-sectioning",
			result: {
				sections: [
					{ aspect: "技術", output: "技術の検討" },
					{ aspect: "費用", output: "費用の検討" },
				],
				merged: "## 技術\n技術の検討\n\n## 費用\n費用の検討",
			},
			usage: USAGE,
		});

		const [first, second] = items("区画");
		expect(first?.textContent).toContain("技術");
		expect(first?.textContent).toContain("技術の検討");
		expect(second?.textContent).toContain("費用の検討");
	});
});

describe("parallel-voting", () => {
	const ballots = [
		{ index: 1, value: "賛成", label: "賛成" },
		{ index: 2, value: "賛成", label: "賛成" },
		{ index: 3, value: "反対", label: "反対" },
	];

	it("shows the ballots, the tally and the conclusion of a majority", () => {
		show({
			name: "parallel-voting",
			result: {
				outcome: "majority",
				conclusion: "賛成",
				tally: [
					{ label: "賛成", count: 2 },
					{ label: "反対", count: 1 },
				],
				ballots,
			},
			usage: USAGE,
		});

		expect(items("票の内訳")).toHaveLength(3);
		expect(items("集計")[0]?.textContent).toContain("2");
		expect(screen.getByRole("region", { name: "結論" }).textContent).toContain("賛成");
	});

	it("says it is a tie and states no conclusion", () => {
		show({
			name: "parallel-voting",
			result: {
				outcome: "tie",
				tiedLabels: ["賛成", "反対"],
				tally: [
					{ label: "賛成", count: 2 },
					{ label: "反対", count: 2 },
				],
				ballots: [...ballots, { index: 4, value: "反対", label: "反対" }],
			},
			usage: USAGE,
		});

		expect(screen.getByText(/同数/)).toBeTruthy();
		expect(screen.getByText(/賛成.*反対|賛成、反対/)).toBeTruthy();
		expect(screen.queryByRole("region", { name: "結論" })).toBeNull();
	});
});

describe("orchestrator-workers", () => {
	const subtasks = [
		{ title: "調査", instruction: "現状を調べる" },
		{ title: "設計", instruction: "構成を決める" },
	];

	it("lists the subtasks with their results and the synthesis", () => {
		show({
			name: "orchestrator-workers",
			result: {
				subtasks,
				results: [
					{ subtask: subtasks[0], status: "completed", output: "調査の結果" },
					{ subtask: subtasks[1], status: "completed", output: "設計の結果" },
				],
				synthesis: "計画書の本文",
				planAttempts: 1,
				planUsage: {},
			},
			usage: USAGE,
		});

		const [first, second] = items("サブタスク");
		expect(first?.textContent).toContain("調査");
		expect(first?.textContent).toContain("現状を調べる");
		expect(first?.textContent).toContain("完了");
		expect(first?.textContent).toContain("調査の結果");
		expect(second?.textContent).toContain("設計の結果");
		expect(screen.getByRole("region", { name: "統合結果" }).textContent).toContain("計画書の本文");
	});

	it("marks the worker that failed and shows no output for it", () => {
		show({
			name: "orchestrator-workers",
			result: {
				subtasks,
				results: [
					{ subtask: subtasks[0], status: "completed", output: "調査の結果" },
					{ subtask: subtasks[1], status: "failed" },
					{
						subtask: { title: "検証", instruction: "確かめる" },
						status: "completed",
						output: "検証の結果",
					},
				],
				synthesis: "一部だけの統合",
				planAttempts: 2,
				planUsage: {},
			},
			usage: USAGE,
		});

		const [, failed] = items("サブタスク");
		expect(failed?.textContent).toContain("失敗");
		expect(failed?.textContent).not.toContain("完了");
		expect(failed?.textContent).not.toContain("undefined");
		expect(screen.getByText(/1 件のワーカーが失敗/)).toBeTruthy();
	});
});

describe("evaluator-optimizer", () => {
	const history = [
		{
			iteration: 1,
			output: "初稿",
			scores: [
				{ evaluator: "security", score: 60, feedback: "入力検証が足りない" },
				{ evaluator: "performance", score: 80, feedback: "問題なし" },
			],
			combinedScore: 60,
		},
		{
			iteration: 2,
			output: "改稿",
			scores: [
				{ evaluator: "security", score: 90, feedback: "十分" },
				{ evaluator: "performance", score: 88, feedback: "問題なし" },
			],
			combinedScore: 88,
		},
	];

	it("shows each iteration's score and each evaluator's feedback", () => {
		show({
			name: "evaluator-optimizer",
			result: {
				final: "改稿",
				passed: true,
				iterations: 2,
				history,
				bestIteration: 2,
				evaluationUsage: {},
			},
			usage: USAGE,
		});

		const [first, second] = items("反復の履歴");
		expect(first?.textContent).toContain("反復 1");
		expect(first?.textContent).toContain("スコア 60");
		expect(first?.textContent).toContain("security（60 点）");
		expect(first?.textContent).toContain("performance（80 点）");
		expect(first?.textContent).toContain("入力検証が足りない");
		expect(second?.textContent).toContain("反復 2");
		expect(second?.textContent).toContain("スコア 88");
		expect(screen.getByRole("region", { name: "最終出力" }).textContent).toContain("改稿");
	});

	it("marks a passing result as passed and shows no failure notice", () => {
		show({
			name: "evaluator-optimizer",
			result: {
				final: "改稿",
				passed: true,
				iterations: 2,
				history,
				bestIteration: 2,
				evaluationUsage: {},
			},
			usage: USAGE,
		});

		expect(screen.getByText("合格")).toBeTruthy();
		expect(screen.queryByText(/合格基準に達しませんでした/)).toBeNull();
	});

	it("states plainly that the criterion was not met and which iteration was returned", () => {
		show({
			name: "evaluator-optimizer",
			result: {
				final: "初稿",
				passed: false,
				iterations: 2,
				history: [history[0], { ...history[1], combinedScore: 55 }],
				bestIteration: 1,
				evaluationUsage: {},
			},
			usage: USAGE,
		});

		expect(screen.getByText("未合格")).toBeTruthy();
		const notice = screen.getByRole("alert");
		expect(notice.textContent).toContain("合格基準に達しませんでした");
		expect(notice.textContent).toContain("反復 1");
		expect(screen.queryByText("合格")).toBeNull();
	});

	it("marks the best iteration even when it is not the last one", () => {
		show({
			name: "evaluator-optimizer",
			result: {
				final: "初稿",
				passed: false,
				iterations: 2,
				history: [history[0], { ...history[1], combinedScore: 55 }],
				bestIteration: 1,
				evaluationUsage: {},
			},
			usage: USAGE,
		});

		const [first, second] = items("反復の履歴");
		expect(first?.textContent).toContain("採用");
		expect(second?.textContent).not.toContain("採用");
	});

	it("marks the iteration whose output was returned", () => {
		show({
			name: "evaluator-optimizer",
			result: {
				final: "改稿",
				passed: true,
				iterations: 2,
				history,
				bestIteration: 2,
				evaluationUsage: {},
			},
			usage: USAGE,
		});

		const [first, second] = items("反復の履歴");
		expect(first?.textContent).not.toContain("採用");
		expect(second?.textContent).toContain("採用");
	});
});

describe("passive-goal-creator", () => {
	const goal = {
		objective: "週報テンプレートを作る",
		constraints: ["A4 1 枚"],
		successCriteria: ["5 分で書ける"],
		missingInformation: [],
		clarifyingQuestions: [],
	};

	it("shows the goal specification", () => {
		show({ name: "passive-goal-creator", result: goal, usage: USAGE });

		expect(screen.getByRole("region", { name: "目標" }).textContent).toContain(
			"週報テンプレートを作る",
		);
		expect(items("制約")[0]?.textContent).toBe("A4 1 枚");
		expect(items("成功基準")[0]?.textContent).toBe("5 分で書ける");
	});

	it("says nothing is missing when the instruction was sufficient", () => {
		show({ name: "passive-goal-creator", result: goal, usage: USAGE });

		expect(screen.getByText("不足している情報はありません。")).toBeTruthy();
		expect(screen.queryByRole("list", { name: "不足している情報" })).toBeNull();
	});

	it("lists the missing information and the questions to ask", () => {
		show({
			name: "passive-goal-creator",
			result: {
				...goal,
				missingInformation: ["対象の文書", "期限"],
				clarifyingQuestions: ["どの文書を直しますか？", "いつまでですか？"],
			},
			usage: USAGE,
		});

		expect(items("不足している情報").map((item) => item.textContent)).toEqual([
			"対象の文書",
			"期限",
		]);
		expect(items("確認したいこと").map((item) => item.textContent)).toEqual([
			"どの文書を直しますか？",
			"いつまでですか？",
		]);
		expect(screen.queryByText("不足している情報はありません。")).toBeNull();
	});
});

describe("prompt-response-optimizer", () => {
	it("shows the original, the improved text and the reasons", () => {
		show({
			name: "prompt-response-optimizer",
			result: {
				original: "短い指示",
				improved: "次の文章を 3 行で要約してください",
				reasons: ["対象が明確になる", "長さを指定した"],
			},
			usage: USAGE,
		});

		expect(screen.getByRole("region", { name: "改善前" }).textContent).toContain("短い指示");
		expect(screen.getByRole("region", { name: "改善後" }).textContent).toContain("3 行で要約");
		expect(items("改善の理由").map((item) => item.textContent)).toEqual([
			"対象が明確になる",
			"長さを指定した",
		]);
	});
});

describe("single-path-plan", () => {
	it("shows each step with its result in the order they ran", () => {
		show({
			name: "single-path-plan",
			result: {
				steps: ["目次を作る", "本文を書く"],
				results: [
					{ step: "目次を作る", output: "目次です" },
					{ step: "本文を書く", output: "本文です" },
				],
			},
			usage: USAGE,
		});

		const [first, second] = items("計画のステップ");
		expect(first?.textContent).toContain("1");
		expect(first?.textContent).toContain("目次を作る");
		expect(first?.textContent).toContain("目次です");
		expect(second?.textContent).toContain("本文です");
	});
});

describe("multi-path-plan", () => {
	const result = {
		candidates: [{ steps: ["A1", "A2"] }, { steps: ["B1"] }, { steps: ["C1", "C2", "C3"] }],
		evaluations: [
			{ index: 0, score: 70, comment: "手数が多い" },
			{ index: 1, score: 90, comment: "簡潔" },
			{ index: 2, score: 60, comment: "過剰" },
		],
		selectedIndex: 1,
		reason: "最も簡潔で確実なため",
	};

	it("shows every candidate with its score and comment", () => {
		show({ name: "multi-path-plan", result, usage: USAGE });

		const [first, second, third] = items("候補の計画");
		expect(first?.textContent).toContain("候補 1");
		expect(first?.textContent).toContain("A2");
		expect(first?.textContent).toContain("70");
		expect(first?.textContent).toContain("手数が多い");
		expect(second?.textContent).toContain("90");
		expect(third?.textContent).toContain("C3");
	});

	it("marks the selected plan (a 0-based index) and gives the reason", () => {
		show({ name: "multi-path-plan", result, usage: USAGE });

		const [first, second, third] = items("候補の計画");
		expect(second?.textContent).toContain("選択");
		expect(first?.textContent).not.toContain("選択");
		expect(third?.textContent).not.toContain("選択");
		expect(screen.getByRole("region", { name: "選んだ理由" }).textContent).toContain(
			"最も簡潔で確実なため",
		);
	});
});

describe("reflection", () => {
	const result = {
		final: "改訂版の文章",
		history: [
			{ iteration: 1, output: "初稿", critique: "具体性が足りない", revised: "二稿" },
			{ iteration: 2, output: "二稿", critique: "問題なし", revised: "二稿" },
		],
		generatorModelId: "mock:general-v1",
		criticModelId: "mock:general-v1",
	};

	it("shows each iteration's critique and revision and the final text", () => {
		show({ name: "self-reflection", result, usage: USAGE });

		const [first, second] = items("反省の履歴");
		expect(first?.textContent).toContain("反復 1");
		expect(first?.textContent).toContain("初稿");
		expect(first?.textContent).toContain("具体性が足りない");
		expect(first?.textContent).toContain("二稿");
		expect(second?.textContent).toContain("問題なし");
		expect(screen.getByRole("region", { name: "最終出力" }).textContent).toContain("改訂版の文章");
	});

	it("shows the generator and the critic model", () => {
		show({
			name: "cross-reflection",
			result: { ...result, criticModelId: "mock:judge-v1" },
			usage: USAGE,
		});

		const models = screen.getByRole("region", { name: "使ったモデル" });
		expect(models.textContent).toContain("生成: mock:general-v1");
		expect(models.textContent).toContain("批評: mock:judge-v1");
	});

	it("notes that a self-reflection used one model for both roles", () => {
		show({ name: "self-reflection", result, usage: USAGE });

		expect(screen.getByText(/同じモデル/)).toBeTruthy();
	});

	it("shows no such note for a cross-reflection with two models", () => {
		show({
			name: "cross-reflection",
			result: { ...result, criticModelId: "mock:judge-v1" },
			usage: USAGE,
		});

		expect(screen.queryByText(/同じモデル/)).toBeNull();
	});
});

describe("role-based-cooperation", () => {
	const run = {
		stopReason: "completed",
		steps: 2,
		totalTokens: { input: 100, output: 20, cacheRead: 0, reasoning: 0 },
		elapsedMs: 300,
		toolsCalled: [],
		error: undefined,
	};
	const outputs = [
		{ role: "調査", output: "調べた結果", run },
		{ role: "集計", output: "集計した結果", run },
		{ role: "レビュー", output: "レビューした結果", run },
	];

	it("shows each role's output in the order of the hand-off, and the final text", () => {
		show({
			name: "role-based-cooperation",
			result: { outputs, final: "レビューした結果" },
			usage: USAGE,
		});

		const roles = items("役割");
		expect(roles.map((item) => item.querySelector("h3")?.textContent)).toEqual([
			"調査",
			"集計",
			"レビュー",
		]);
		expect(roles[0]?.textContent).toContain("調べた結果");
		expect(screen.getByRole("region", { name: "最終出力" }).textContent).toContain(
			"レビューした結果",
		);
		expect(screen.queryByRole("alert")).toBeNull();
	});

	it("shows a role's stop reason from its run summary", () => {
		show({
			name: "role-based-cooperation",
			result: {
				outputs: [{ role: "調査", output: "", run: { ...run, stopReason: "step-limit" } }],
				final: "",
				stopped: "step-limit",
			},
			usage: USAGE,
		});

		expect(screen.getByText("ステップ数の上限")).toBeTruthy();
		expect(screen.queryByRole("region", { name: "最終出力" })).toBeNull();
	});

	it("says the shared budget ran out and that the later roles did not run", () => {
		show({
			name: "role-based-cooperation",
			result: { outputs: outputs.slice(0, 2), final: "集計した結果", stopped: "budget-exhausted" },
			usage: USAGE,
		});

		const notice = screen.getByRole("alert");
		expect(notice.textContent).toContain("共有トークン予算");
		expect(notice.textContent).toContain("実行されませんでした");
		expect(items("役割")).toHaveLength(2);
	});

	it("says a role ended early for another stop reason", () => {
		show({
			name: "role-based-cooperation",
			result: {
				outputs: [{ role: "調査", output: "", run: { ...run, stopReason: "timeout" } }],
				final: "",
				stopped: "timeout",
			},
			usage: USAGE,
		});

		expect(screen.getByRole("alert").textContent).toContain("途中で終了");
		expect(screen.getByRole("alert").textContent).toContain("実行時間の上限");
	});

	it("shows that a role produced no text", () => {
		show({
			name: "role-based-cooperation",
			result: { outputs: [{ role: "調査", output: "", run }], final: "" },
			usage: USAGE,
		});

		expect(screen.getByText("出力はありません。")).toBeTruthy();
	});
});

describe("unknown result", () => {
	it("says the format is not supported instead of failing", () => {
		show({ name: "something-new", result: {}, usage: USAGE });

		expect(screen.getByText(/表示に対応していない/)).toBeTruthy();
	});
});
