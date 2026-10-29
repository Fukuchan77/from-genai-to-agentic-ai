import {
	defineScenario,
	type ScenarioDefinition,
	type ScenarioTurn,
} from "../../src/mock/scenario";

// Mock responses for module 3-6 (the marketing council and the shopping assistant). One chat model
// speaks for every council persona, judges, and extracts and recommends, so each turn is told apart
// by what its prompt carries (`marketing/council.ts`, `moderator.ts`, `profile.ts`, `recommend.ts`).
// The last user message is all a scenario sees, so the persona's system instructions play no part:
//
//   statement  `[役割: {persona id}]\n<task>\n<draft>\n{working draft}\n</draft>`   (cooperateByRole)
//   moderator  `ラウンド {n} の発言を読み、…\n\n<turn>\n発言者: {name}\n{first statement}`
//   profile    `<message role="user">\n{message}\n</message>\n</conversation>`
//   recommend  `<message>\n{message}\n</message>`
//
// The working draft of round 2 is the draft the last persona proposed in round 1, so each round
// answers its own prompt. Drafts, statements and messages differ between the scenarios.
//
//   council/default               round 1: an objection remains; round 2: agreement.
//   council/agreed-with-objections  round 1: the moderator says `agreed: true` but names an open
//                                 objection (the code rules it out, CL-12); round 2: agreement.
//   profile/default               two messages: interests and a budget, then a concern and a new budget.
//   recommend/default             two messages; the first answer also names P-999, which the catalog
//                                 does not have (CL-15), and a product above the budget.

/** Drafts that the council scenarios answer; the UI offers them as input examples in `mock`. */
export const M3_6_SAMPLE_DRAFTS = Object.freeze({
	default: "毎日使えるステンレス保温ボトル。今ならお得に買えます。",
	objections: "ノイズ低減ワイヤレスイヤホン、新登場。",
});

/** Shopper messages that the profile and recommend scenarios answer. */
export const M3_6_SAMPLE_MESSAGES = Object.freeze({
	first: "ランニングを始めたいので、1 万円以内でシューズを探しています。",
	second: "通勤電車の騒音が気になって集中できません。予算は 5,000 円くらいです。",
});

const chat = "chat" as const;

interface CouncilPersonaRef {
	readonly id: string;
	readonly name: string;
}

/** The seeded personas (`fixtures/marketing/personas.json`), in speaking order. */
const COUNCIL_PERSONAS: readonly CouncilPersonaRef[] = [
	{ id: "marketer-strict", name: "厳しいマーケター" },
	{ id: "consumer", name: "購入を検討する生活者" },
	{ id: "seo-specialist", name: "SEO 担当者" },
];

interface RoundScript {
	/** One statement per persona, each ending with its own improved draft. */
	readonly statements: readonly { readonly comment: string; readonly draft: string }[];
	readonly verdict: {
		readonly agreed: boolean;
		readonly reason: string;
		readonly remainingObjections: readonly string[];
	};
}

const statementAnchor = (personaId: string, draft: string) =>
	`[役割: ${personaId}]\n<task>\n<draft>\n${draft}\n</draft>`;
const moderatorAnchor = (round: number, firstName: string, firstText: string) =>
	`ラウンド ${round} の発言を読み、合意に達したかを判定してください。\n\n<turn>\n発言者: ${firstName}\n${firstText}\n</turn>`;
const profileAnchor = (message: string) =>
	`<message role="user">\n${message}\n</message>\n</conversation>`;
const recommendAnchor = (message: string) => `<message>\n${message}\n</message>`;

// The moderator prompt neutralises the delimiter tags a statement carries (`moderator.ts`).
const neutralized = (text: string) =>
	text.replaceAll("<draft>", "＜draft>").replaceAll("</draft>", "＜/draft>");

const textOf = (statement: RoundScript["statements"][number]) =>
	`${statement.comment}\n<draft>${statement.draft}</draft>`;

function councilScenario(
	id: string,
	initialDraft: string,
	rounds: readonly RoundScript[],
): ScenarioDefinition {
	const turns: ScenarioTurn[] = [];
	let working = initialDraft;
	rounds.forEach((round, index) => {
		round.statements.forEach((statement, n) => {
			const persona = COUNCIL_PERSONAS[n];
			if (!persona) return;
			turns.push({
				match: { purpose: chat, lastUserTextIncludes: statementAnchor(persona.id, working) },
				respond: { text: textOf(statement), usage: { inputTokens: 620, outputTokens: 210 } },
			});
		});
		const first = round.statements[0];
		const last = round.statements.at(-1);
		if (!first || !last) return;
		turns.push({
			match: {
				purpose: chat,
				lastUserTextIncludes: moderatorAnchor(
					index + 1,
					COUNCIL_PERSONAS[0]?.name ?? "",
					neutralized(textOf(first)),
				),
			},
			respond: { object: round.verdict, usage: { inputTokens: 980, outputTokens: 90 } },
		});
		// The next round starts from the last persona's draft.
		working = last.draft;
	});
	return defineScenario({ id, turns });
}

const DEFAULT_ROUNDS: readonly RoundScript[] = [
	{
		statements: [
			{
				comment:
					"【ボトル案・第 1 回】誰に何を訴えたいのかが見えません。「お得」の根拠も示してください。",
				draft: "通勤の 1 杯を 6 時間あたたかく。ステンレス保温ボトル 500ml、2,480 円。",
			},
			{
				comment:
					"【ボトル案・第 1 回】6 時間という数字は分かりやすいです。ただ、洗いやすさが書かれていないのが気になります。",
				draft:
					"通勤の 1 杯を 6 時間あたたかく。口が広くて洗いやすい、ステンレス保温ボトル 500ml、2,480 円。",
			},
			{
				comment:
					"【ボトル案・第 1 回】「保温ボトル」「ステンレス」を見出しに入れると探されやすくなります。",
				draft:
					"【保温ボトル】通勤の 1 杯を 6 時間あたたかく。口が広くて洗いやすい、ステンレス製 500ml、2,480 円。",
			},
		],
		verdict: {
			agreed: false,
			reason: "価格の根拠と検索語句について、まだ意見がそろっていません。",
			remainingObjections: ["2,480 円が妥当な理由が示されていない", "検索されやすい語句が足りない"],
		},
	},
	{
		statements: [
			{
				comment:
					"【ボトル案・第 2 回】価格の理由が入りました。この方向で問題ありません。賛成です。",
				draft:
					"【保温ボトル】通勤の 1 杯を 6 時間あたたかく。洗いやすい広口のステンレス製 500ml、買いやすい 2,480 円。",
			},
			{
				comment: "【ボトル案・第 2 回】広口で洗いやすいと分かり、安心して選べます。賛成です。",
				draft:
					"【保温ボトル】通勤の 1 杯を 6 時間あたたかく。洗いやすい広口のステンレス製 500ml、毎日使える 2,480 円。",
			},
			{
				comment: "【ボトル案・第 2 回】見出しの語句も自然に入りました。この案で賛成します。",
				draft:
					"【保温ボトル】通勤の 1 杯を 6 時間あたたかく。洗いやすい広口のステンレス製 500ml、毎日使える 2,480 円（税込）。",
			},
		],
		verdict: {
			agreed: true,
			reason: "三者とも改善後の文案の方向に賛成しており、反対意見は残っていません。",
			remainingObjections: [],
		},
	},
];

const OBJECTION_ROUNDS: readonly RoundScript[] = [
	{
		statements: [
			{
				comment:
					"【イヤホン案・第 1 回】新登場だけでは何が新しいのか伝わりません。特長を一文で足してください。",
				draft: "電車の騒音をおさえる、ノイズ低減ワイヤレスイヤホン。新登場、4,980 円。",
			},
			{
				comment:
					"【イヤホン案・第 1 回】騒音をおさえるのは魅力的です。保証があるかどうかが気になります。",
				draft: "電車の騒音をおさえる、ノイズ低減ワイヤレスイヤホン。新登場、4,980 円。保証つき。",
			},
			{
				comment:
					"【イヤホン案・第 1 回】「ノイズキャンセリング」の語句も添えると探されやすくなります。",
				draft:
					"電車の騒音をおさえるノイズキャンセリング対応のワイヤレスイヤホン。新登場、4,980 円。",
			},
		],
		verdict: {
			agreed: true,
			reason: "おおむね同意していますが、保証についての懸念が一件残っています。",
			remainingObjections: ["保証期間の記載が無い"],
		},
	},
	{
		statements: [
			{
				comment: "【イヤホン案・第 2 回】保証期間が入れば問題ありません。賛成です。",
				draft:
					"電車の騒音をおさえるノイズキャンセリング対応のワイヤレスイヤホン。新登場、4,980 円。1 年保証つき。",
			},
			{
				comment: "【イヤホン案・第 2 回】1 年の保証があれば安心です。賛成です。",
				draft:
					"電車の騒音をおさえるノイズキャンセリング対応のワイヤレスイヤホン。4,980 円、1 年保証つき。",
			},
			{
				comment: "【イヤホン案・第 2 回】語句も自然に入っています。この案で賛成します。",
				draft:
					"電車の騒音をおさえるノイズキャンセリング対応のワイヤレスイヤホン。4,980 円（税込）、1 年保証つき。",
			},
		],
		verdict: {
			agreed: true,
			reason: "保証の記載で懸念が解消され、全員が賛成しています。",
			remainingObjections: [],
		},
	},
];

function profileTurn(message: string, extracted: object): ScenarioTurn {
	return {
		match: { purpose: chat, lastUserTextIncludes: profileAnchor(message) },
		respond: { object: extracted as never, usage: { inputTokens: 520, outputTokens: 60 } },
	};
}

function recommendTurn(message: string, answer: object): ScenarioTurn {
	return {
		match: { purpose: chat, lastUserTextIncludes: recommendAnchor(message) },
		respond: { object: answer as never, usage: { inputTokens: 1_400, outputTokens: 180 } },
	};
}

export const M3_6_SCENARIOS: readonly ScenarioDefinition[] = [
	councilScenario("m3-6/council/default", M3_6_SAMPLE_DRAFTS.default, DEFAULT_ROUNDS),
	councilScenario(
		"m3-6/council/agreed-with-objections",
		M3_6_SAMPLE_DRAFTS.objections,
		OBJECTION_ROUNDS,
	),
	defineScenario({
		id: "m3-6/profile/default",
		turns: [
			profileTurn(M3_6_SAMPLE_MESSAGES.first, {
				interests: ["ランニング", "シューズ"],
				budgetYen: 10_000,
				concerns: [],
			}),
			profileTurn(M3_6_SAMPLE_MESSAGES.second, {
				interests: ["通勤中の音環境"],
				budgetYen: 5_000,
				concerns: ["電車の騒音"],
			}),
		],
	}),
	defineScenario({
		id: "m3-6/recommend/default",
		turns: [
			recommendTurn(M3_6_SAMPLE_MESSAGES.first, {
				recommendations: [
					{ productId: "P-006", reason: "ランニングを始める方向けの定番のシューズです。" },
					{ productId: "P-010", reason: "走る前後のストレッチに使えます。" },
					{ productId: "P-999", reason: "カタログにはない商品です。" },
				],
				overall: "ランニングを始める方に合う商品を選びました。",
			}),
			recommendTurn(M3_6_SAMPLE_MESSAGES.second, {
				recommendations: [
					{ productId: "P-001", reason: "ノイズ低減で電車の騒音をおさえ、予算にも収まります。" },
					{ productId: "P-004", reason: "集中して作業する机まわりが整います。" },
				],
			}),
		],
	}),
];
