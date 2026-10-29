import {
	defineScenario,
	type ScenarioDefinition,
	type ScenarioTurn,
} from "../../src/mock/scenario";

// Mock responses for module 3-5 (the requirements interview). One chat model plays the persona
// writer, the interviewer, the extractor and the judge, so each turn is told apart by what its
// prompt carries (`requirements/personas.ts`, `interview.ts`):
//
//   personas   `…ちょうど 3 人作ってください。\n\n<overview>\n{overview}\n</overview>`
//   questions  `第 {n} ラウンドの質問を、次の 3 人…\n\n＜persona>\n名前: {first persona}`
//   extract    `<answer>\n{answer}\n</answer>`
//   judge      `これは第 {n} ラウンドの終わりです（上限は 5 ラウンド）。…<requirements>\n{"functional":[{"text":"{first item}",…`
//
// Persona names and answers differ between the two scenarios, so no turn can answer both. The
// judge's anchor holds the round limit (the default of 5), so the scenarios fit an interview
// started with the default settings.
//
//   default  3 personas, round 1 judged insufficient with two missing items, round 2 questions
//            focus on them, round 2 judged sufficient.
//   limit    always insufficient: the interview ends at the round limit (`forcedEnd`).

/** Overviews that the scenarios below answer; the UI offers them as input examples in `mock`. */
export const M3_5_SAMPLE_OVERVIEWS = Object.freeze({
	default: "社内の問い合わせを自動で振り分けて、担当者に届けるチャットボット",
	limit: "家計簿を自動で付ける、スマートフォンのアプリ",
});

const chat = "chat" as const;
const PERSONA_COUNT = 3;
/** `DEFAULT_INTERVIEW.maxRounds`; `requirements/scenarios.test.ts` checks that they agree. */
const MAX_ROUNDS = 5;

interface ExtractionOutput {
	readonly functional: readonly string[];
	readonly nonFunctional: readonly string[];
	readonly constraints: readonly string[];
	readonly unconfirmed: readonly string[];
}

interface RoundScript {
	readonly questions: readonly string[];
	/** The answers a learner gives to the three questions, and what the extractor finds in each. */
	readonly answers: readonly { readonly text: string; readonly found: ExtractionOutput }[];
	readonly verdict: { readonly sufficient: boolean; readonly missing: readonly string[] };
}

interface InterviewScript {
	readonly id: string;
	readonly overview: string;
	readonly personas: readonly {
		readonly name: string;
		readonly role: string;
		readonly goals: readonly string[];
		readonly viewpoint?: string;
	}[];
	readonly rounds: readonly RoundScript[];
}

const personasAnchor = (overview: string) =>
	`次のプロダクト概要から、想定利用者のペルソナをちょうど ${PERSONA_COUNT} 人作ってください。\n\n<overview>\n${overview}\n</overview>`;
// `askRound` runs its own `<persona>` lines through `neutralizeTags`, so the prompt really opens
// each block with the full-width `＜persona>`; the anchor copies that.
const questionsAnchor = (round: number, firstName: string) =>
	`第 ${round} ラウンドの質問を、次の ${PERSONA_COUNT} 人のペルソナそれぞれに 1 つずつ作ってください。\n\n＜persona>\n名前: ${firstName}`;
const answerAnchor = (text: string) => `<answer>\n${text}\n</answer>`;
/** The first functional item is persona-1's, and it stays first in every later round. */
const judgeAnchor = (round: number, firstFunctional: string) =>
	`これは第 ${round} ラウンドの終わりです（上限は ${MAX_ROUNDS} ラウンド）。次の要件で十分かを判定してください。\n\n<requirements>\n{"functional":[{"text":"${firstFunctional}","personaId":"persona-1"}`;

function turn(anchor: string, object: unknown, tokens: [number, number]): ScenarioTurn {
	return {
		match: { purpose: chat, lastUserTextIncludes: anchor },
		respond: {
			object: object as never,
			usage: { inputTokens: tokens[0], outputTokens: tokens[1] },
		},
	};
}

function interviewScenario(script: InterviewScript): ScenarioDefinition {
	const firstName = script.personas[0]?.name ?? "";
	const firstFunctional = script.rounds[0]?.answers[0]?.found.functional[0] ?? "";
	return defineScenario({
		id: script.id,
		turns: [
			turn(personasAnchor(script.overview), { personas: script.personas }, [420, 260]),
			...script.rounds.flatMap((round, index) => [
				turn(questionsAnchor(index + 1, firstName), { questions: round.questions }, [520, 140]),
				...round.answers.map((answer) => turn(answerAnchor(answer.text), answer.found, [380, 90])),
				turn(judgeAnchor(index + 1, firstFunctional), round.verdict, [640, 60]),
			]),
		],
	});
}

const none: readonly string[] = [];

const DEFAULT_SCRIPT: InterviewScript = {
	id: "m3-5/requirements/default",
	overview: M3_5_SAMPLE_OVERVIEWS.default,
	personas: [
		{
			name: "田中さん",
			role: "総務部の担当者。毎日、社内からの問い合わせを手作業で振り分けている。",
			goals: ["振り分けの手間を減らす", "問い合わせの取りこぼしを防ぐ"],
			viewpoint: "日々の運用の負担",
		},
		{
			name: "佐藤さん",
			role: "営業部のメンバー。社内の手続きを調べるために、よく問い合わせる側にいる。",
			goals: ["手続きの答えをすぐに得る", "担当者を探す手間を省く"],
		},
		{
			name: "鈴木さん",
			role: "情報システム部の管理者。ツールの導入と運用の責任を持つ。",
			goals: ["安全に運用する", "既存の社内システムとつなぐ"],
			viewpoint: "セキュリティと保守",
		},
	],
	rounds: [
		{
			questions: [
				"今の振り分けで、いちばん時間がかかっているのはどの作業ですか。",
				"問い合わせるときに、どんな情報がすぐに分かると助かりますか。",
				"このボットを導入するとき、守らなければならない社内のルールはありますか。",
			],
			answers: [
				{
					text: "問い合わせの内容を読んで担当部署を決める作業に時間がかかる。内容から担当部署を自動で決めてほしい。",
					found: {
						functional: ["問い合わせの内容から担当部署を自動で判定して振り分ける"],
						nonFunctional: none,
						constraints: none,
						unconfirmed: none,
					},
				},
				{
					text: "手続きの進み具合をその場で知りたい。チャットで質問できると助かる。",
					found: {
						functional: ["問い合わせの進み具合をチャットで確認できる"],
						nonFunctional: ["質問への応答が待たされない"],
						constraints: none,
						unconfirmed: none,
					},
				},
				{
					text: "社外には情報を出せないので、社内のネットワークの中だけで動かしてほしい。",
					found: {
						functional: none,
						nonFunctional: none,
						constraints: ["社内ネットワークの外に情報を出さない"],
						unconfirmed: none,
					},
				},
			],
			verdict: { sufficient: false, missing: ["応答時間の目標値", "運用にかけられる予算の上限"] },
		},
		{
			questions: [
				"応答はどのくらいの時間で返ってくれば、待たされていないと感じますか。",
				"問い合わせが増えたとき、どの程度の件数まで同時に扱えれば十分ですか。",
				"導入と運用にかけられる予算の上限はどのくらいですか。",
			],
			answers: [
				{
					text: "返事は 5 秒以内に来てほしい。それより遅いと電話をかけてしまう。",
					found: {
						functional: none,
						nonFunctional: ["応答は 5 秒以内に返す"],
						constraints: none,
						unconfirmed: none,
					},
				},
				{
					text: "繁忙期は 1 日に 300 件ほど来るので、そのくらいは同時にさばけてほしい。",
					found: {
						functional: none,
						nonFunctional: ["1 日 300 件の問い合わせを扱える"],
						constraints: none,
						unconfirmed: none,
					},
				},
				{
					text: "年間の運用費は 120 万円までにしたい。導入は来年度の初めまでに終えたい。",
					found: {
						functional: none,
						nonFunctional: none,
						constraints: ["年間の運用費は 120 万円まで", "導入は来年度の初めまでに終える"],
						unconfirmed: none,
					},
				},
			],
			verdict: { sufficient: true, missing: none },
		},
	],
};

const LIMIT_PERSONAS: InterviewScript["personas"] = [
	{
		name: "山本さん",
		role: "共働きの会社員。家計の管理に使える時間が少ない。",
		goals: ["入力の手間なく支出を把握する"],
	},
	{
		name: "中村さん",
		role: "一人暮らしの大学生。仕送りとアルバイト代でやりくりしている。",
		goals: ["月末に困らないよう使いすぎを防ぐ"],
		viewpoint: "手軽さ",
	},
	{
		name: "小林さん",
		role: "フリーランスのデザイナー。収入が月によって大きく変わる。",
		goals: ["仕事の経費と生活費を分けて記録する"],
	},
];

/** Every round adds new items and ends insufficient, so the interview can only end at the limit. */
function limitRounds(): readonly RoundScript[] {
	return Array.from({ length: MAX_ROUNDS }, (_, index) => {
		const round = index + 1;
		return {
			questions: LIMIT_PERSONAS.map(
				(persona) =>
					`${persona.name}にお尋ねします。第 ${round} ラウンドの確認です。続きを教えてください。`,
			),
			answers: LIMIT_PERSONAS.map((persona, n) => ({
				text: `（第 ${round} 回・${persona.name}）${persona.goals[0]}ために、あと${round}つ条件を足したい。`,
				found: {
					functional: [`${persona.name}の第 ${round} 回の機能要件 ${n + 1}`],
					nonFunctional: none,
					constraints: none,
					unconfirmed: none,
				},
			})),
			verdict: { sufficient: false, missing: [`第 ${round} 回の時点で決まっていない項目`] },
		};
	});
}

const LIMIT_SCRIPT: InterviewScript = {
	id: "m3-5/requirements/limit",
	overview: M3_5_SAMPLE_OVERVIEWS.limit,
	personas: LIMIT_PERSONAS,
	rounds: limitRounds(),
};

/**
 * The answers to give the interview's questions, by round and question order. The extraction turns
 * are keyed on this exact text, so an answer that is not listed here has no scenario in `mock`.
 */
export const M3_5_SAMPLE_ANSWERS = Object.freeze({
	default: DEFAULT_SCRIPT.rounds.map((round) => round.answers.map((answer) => answer.text)),
	limit: LIMIT_SCRIPT.rounds.map((round) => round.answers.map((answer) => answer.text)),
});

export const M3_5_SCENARIOS: readonly ScenarioDefinition[] = [
	interviewScenario(DEFAULT_SCRIPT),
	interviewScenario(LIMIT_SCRIPT),
];
