import {
	defineScenario,
	type ScenarioDefinition,
	type ScenarioTurn,
} from "../../src/mock/scenario";

// Mock responses for module 2-3 (workflow patterns). A scenario turn matches on the `purpose` of the
// model and a stage marker that the demo composition in `src/workflows/demos.ts` puts at the top of
// its prompt (`[段: <stage>]`); where one stage has several variants, the marker also carries the
// sample task, so each variant is a different turn. The markers are plain Japanese labels, not
// `fixture:` strings, so that the production prompts stay readable. `src/workflows/demos.test.ts`
// runs every demo against these scenarios, which pins each marker to the real prompt.

/** Tasks that the scenarios below answer; the UI offers them as input examples in `mock`. */
export const M2_3_SAMPLE_TASKS = Object.freeze({
	promptChain: Object.freeze({
		ok: "新入社員向けに、社内の VPN の接続手順を説明する記事を書いてください。",
		bodyFails: "新入社員向けに、経費精算の手順を説明する記事を書いてください。",
	}),
	routing: Object.freeze({
		technical: "社内システムにログインしようとするとエラー 403 が出ます。",
		outOfScope: "週末の大阪の天気を教えてください。",
	}),
	modelRouting: Object.freeze({
		easy: "1 週間は何日ですか。",
		hard: "マイクロサービスとモジュラーモノリスのどちらを採用すべきか、チームの規模と運用負荷の観点から比較して提案してください。",
	}),
	sectioning: "新しい社内ポータルの導入を検討しています。",
	voting: "この社内ポータルの導入案を承認してよいですか。",
	orchestrator: Object.freeze({
		three: "社内ポータルの導入計画書を作成してください。",
		two: "社内ポータルの導入案を一言でまとめてください。",
	}),
	evaluator: Object.freeze({
		improves: "ログイン画面の入力検証の方針を説明する文章を書いてください。",
		stalls: "障害対応の連絡テンプレートを作ってください。",
	}),
});

const TASKS = M2_3_SAMPLE_TASKS;

/** The prompt of a stage that works on the task: `[段: <stage>]` then the task. */
function stage(label: string, task?: string): string {
	return task === undefined ? `[段: ${label}]` : `[段: ${label}]\n<task>\n${task}\n</task>`;
}

/** A scenario turn that answers a plain-text stage. */
function chatTurn(marker: string, text: string, tokens: readonly [number, number]): ScenarioTurn {
	return {
		match: { purpose: "chat", lastUserTextIncludes: marker },
		respond: { text, usage: { inputTokens: tokens[0], outputTokens: tokens[1] } },
	};
}

/** The Evaluator-Optimizer asks each evaluator about one version of the draft. */
function judgeMarker(version: string, evaluator: string): string {
	return `【版 ${version}】\n</output>\n\n評価者: ${evaluator}`;
}

function judgeTurn(
	version: string,
	evaluator: string,
	score: number,
	feedback: string,
): ScenarioTurn {
	return {
		match: { purpose: "judge", lastUserTextIncludes: judgeMarker(version, evaluator) },
		respond: { object: { score, feedback }, usage: { inputTokens: 260, outputTokens: 40 } },
	};
}

const OUTLINE = "1. 背景\n2. 手順\n3. まとめ";

export const M2_3_SCENARIOS: readonly ScenarioDefinition[] = [
	defineScenario({
		id: "m2-3/prompt-chaining/ok",
		turns: [
			chatTurn(stage("アウトライン", TASKS.promptChain.ok), OUTLINE, [120, 30]),
			chatTurn(
				stage("本文", TASKS.promptChain.ok),
				"## 背景\n社外から社内の資料に安全に接続するために VPN を使います。\n\n## 手順\n1. 専用のクライアントを起動します。\n2. 社員番号とワンタイムパスワードを入力します。\n\n## まとめ\n接続できない場合は情報システム部に連絡してください。",
				[200, 140],
			),
		],
	}),
	defineScenario({
		id: "m2-3/prompt-chaining/body-fails",
		turns: [
			chatTurn(stage("アウトライン", TASKS.promptChain.bodyFails), OUTLINE, [120, 30]),
			chatTurn(
				stage("本文", TASKS.promptChain.bodyFails),
				"## 背景\n経費は月末までに精算します。\n\n## 手順\n1. 申請書を作成します。\n2. 上長の承認を受けます。",
				[200, 90],
			),
		],
	}),
	defineScenario({
		id: "m2-3/routing/technical",
		turns: [
			{
				match: {
					purpose: "structured",
					lastUserTextIncludes: `<input>\n${TASKS.routing.technical}\n</input>`,
				},
				respond: {
					object: {
						category: "technical",
						reason: "エラーコードを伴うログインの不具合の相談です。",
					},
					usage: { inputTokens: 150, outputTokens: 30 },
				},
			},
			chatTurn(
				stage("対応・technical"),
				"403 は権限が足りないときのエラーです。所属グループの設定を確認し、解決しない場合は情報システム部に申請してください。",
				[160, 60],
			),
		],
	}),
	defineScenario({
		id: "m2-3/routing/out-of-scope",
		turns: [
			{
				match: {
					purpose: "structured",
					lastUserTextIncludes: `<input>\n${TASKS.routing.outOfScope}\n</input>`,
				},
				respond: {
					object: { category: "unknown", reason: "社内サポートの対象外（天気の質問）です。" },
					usage: { inputTokens: 150, outputTokens: 30 },
				},
			},
			chatTurn(
				stage("対応・範囲外"),
				"このご質問は社内サポートの対象外です。請求・技術・一般的な問い合わせについてお尋ねください。",
				[100, 40],
			),
		],
	}),
	defineScenario({
		id: "m2-3/model-routing/easy",
		turns: [
			{
				match: {
					purpose: "chat",
					lastUserTextIncludes: `<input>\n${TASKS.modelRouting.easy}\n</input>`,
				},
				respond: {
					object: { category: "easy", reason: "知識を 1 つ答えるだけで済む質問です。" },
					usage: { inputTokens: 120, outputTokens: 25 },
				},
			},
			chatTurn(stage("回答", TASKS.modelRouting.easy), "1 週間は 7 日です。", [80, 15]),
		],
	}),
	defineScenario({
		id: "m2-3/model-routing/hard",
		turns: [
			{
				match: {
					purpose: "chat",
					lastUserTextIncludes: `<input>\n${TASKS.modelRouting.hard}\n</input>`,
				},
				respond: {
					object: { category: "hard", reason: "複数の観点を比較して提案する必要があります。" },
					usage: { inputTokens: 140, outputTokens: 28 },
				},
			},
			chatTurn(
				stage("回答", TASKS.modelRouting.hard),
				"チームが少なく運用に割ける人手が限られるなら、まずモジュラーモノリスを勧めます。境界を保ったまま分割できるため、後から必要な部分だけをサービスに切り出せます。",
				[220, 110],
			),
		],
	}),
	defineScenario({
		id: "m2-3/parallel-sectioning",
		turns: [
			chatTurn(
				stage("観点・技術"),
				"既存の認証基盤と連携でき、移行の作業量は小さいと見込まれます。",
				[110, 40],
			),
			chatTurn(
				stage("観点・費用"),
				"初期費用は小さい一方、利用者数に応じた月額が発生します。",
				[110, 40],
			),
			chatTurn(
				stage("観点・リスク"),
				"移行期間中は旧システムと二重に運用する負担が生じます。",
				[110, 40],
			),
		],
	}),
	defineScenario({
		id: "m2-3/parallel-voting/majority",
		turns: [
			chatTurn("[段: 投票 1/3]", "賛成", [90, 3]),
			chatTurn("[段: 投票 2/3]", "反対", [90, 3]),
			chatTurn("[段: 投票 3/3]", "賛成", [90, 3]),
		],
	}),
	defineScenario({
		id: "m2-3/parallel-voting/tie",
		turns: [
			chatTurn("[段: 投票 1/2]", "賛成", [90, 3]),
			chatTurn("[段: 投票 2/2]", "反対", [90, 3]),
		],
	}),
	defineScenario({
		id: "m2-3/orchestrator-workers/three",
		turns: [
			{
				match: {
					purpose: "structured",
					lastUserTextIncludes: `<task>\n${TASKS.orchestrator.three}\n</task>`,
				},
				respond: {
					object: {
						subtasks: [
							{ title: "現状調査", instruction: "現在の社内ポータルの利用状況をまとめる。" },
							{ title: "設計案", instruction: "新しいポータルの構成案を書く。" },
							{ title: "リスク整理", instruction: "導入時のリスクと対策を列挙する。" },
						],
					},
					usage: { inputTokens: 180, outputTokens: 90 },
				},
			},
			chatTurn(
				stage("ワーカー・現状調査"),
				"利用者の多くは週に数回、申請系の機能だけを使っています。",
				[120, 40],
			),
			chatTurn(
				stage("ワーカー・設計案"),
				"認証は既存の SSO に統一し、機能ごとに画面を分けます。",
				[120, 40],
			),
			chatTurn(
				stage("ワーカー・リスク整理"),
				"移行期間の二重運用と、権限の引き継ぎ漏れが主なリスクです。",
				[120, 40],
			),
			chatTurn(
				stage("統合", TASKS.orchestrator.three),
				"【導入計画書】現状は申請系の利用が中心である。設計は SSO への統一と機能別の画面分割とし、リスクは二重運用と権限の引き継ぎ漏れに備える。",
				[300, 90],
			),
		],
	}),
	defineScenario({
		id: "m2-3/orchestrator-workers/two",
		turns: [
			{
				match: {
					purpose: "structured",
					lastUserTextIncludes: `<task>\n${TASKS.orchestrator.two}\n</task>`,
				},
				respond: {
					object: {
						subtasks: [
							{ title: "要点抽出", instruction: "導入案の要点を 3 つ挙げる。" },
							{ title: "一言要約", instruction: "要点を一文にまとめる。" },
						],
					},
					usage: { inputTokens: 160, outputTokens: 60 },
				},
			},
			chatTurn(
				stage("ワーカー・要点抽出"),
				"SSO への統一、機能別の画面、段階的な移行。",
				[100, 30],
			),
			chatTurn(stage("ワーカー・一言要約"), "SSO に統一して段階的に移行する案です。", [100, 25]),
			chatTurn(
				stage("統合", TASKS.orchestrator.two),
				"SSO に統一し、機能別の画面を段階的に移行する案です。",
				[200, 40],
			),
		],
	}),
	defineScenario({
		id: "m2-3/evaluator-optimizer/improves",
		turns: [
			chatTurn(
				stage("生成 1", TASKS.evaluator.improves),
				"入力は画面側で確認します。\n【版 A1】",
				[100, 30],
			),
			chatTurn(
				stage("生成 2", TASKS.evaluator.improves),
				"入力は画面側でも確認し、サーバー側でも型・長さ・文字種を検証します。検証に失敗した場合の表示も定めます。\n【版 A2】",
				[260, 70],
			),
			judgeTurn("A1", "security", 60, "サーバー側の検証と、不正な入力の扱いが書かれていません。"),
			judgeTurn("A1", "performance", 80, "検証の負荷についての懸念はありません。"),
			judgeTurn("A2", "security", 90, "サーバー側の検証が加わり、必要な観点が揃っています。"),
			judgeTurn("A2", "performance", 88, "検証の範囲が明確で、負荷の面でも問題ありません。"),
		],
	}),
	defineScenario({
		id: "m2-3/evaluator-optimizer/stalls",
		turns: [
			chatTurn(
				stage("生成 1", TASKS.evaluator.stalls),
				"障害が発生しました。対応中です。\n【版 B1】",
				[100, 30],
			),
			chatTurn(
				stage("生成 2", TASKS.evaluator.stalls),
				"障害が発生しました。影響範囲を調査中です。次の連絡は 30 分後です。\n【版 B2】",
				[260, 60],
			),
			chatTurn(
				stage("生成 3", TASKS.evaluator.stalls),
				"障害が発生しています。影響範囲を調査中で、次の連絡は 30 分後です。\n【版 B3】",
				[280, 60],
			),
			judgeTurn("B1", "security", 62, "影響を受ける範囲が書かれていません。"),
			judgeTurn("B1", "performance", 75, "短く、すぐ読めます。"),
			judgeTurn("B2", "security", 70, "影響範囲の記述はありますが、対象が曖昧です。"),
			judgeTurn("B2", "performance", 62, "連絡の頻度の根拠が弱いです。"),
			judgeTurn("B3", "security", 58, "原因の公開範囲についての記述が後退しました。"),
			judgeTurn("B3", "performance", 80, "次の連絡の時刻が明確です。"),
		],
	}),
];
