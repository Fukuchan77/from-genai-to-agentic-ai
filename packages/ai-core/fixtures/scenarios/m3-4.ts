import {
	defineScenario,
	type ScenarioDefinition,
	type ScenarioMatch,
	type ScenarioResponse,
	type ScenarioTurn,
} from "../../src/mock/scenario";

// Mock responses for module 3-4 (hierarchical research). One model plays the Supervisor and the
// three sub-agents, so every turn names the prompt it answers: the Supervisor's prompt carries the
// theme inside <research-theme>, a search or reading sub-agent's carries its <task>, and the market
// sub-agent's carries its <theme>. The papers the searches "find" come from `fixtures/arxiv/`
// (the mock arXiv client answers every query with `search-multi.xml`: 2401.01234, 2403.05678 and
// cs/0501001).
//
//   default          search, search, reading, market, then the report (four sub-agent calls). The
//                    report also cites 2412.99999, which no search returned, so the citation check
//                    has something to remove.
//   partial-failure  search, reading, market, then the report. The reading sub-agent ends with an
//                    empty answer, so the report names the gap (Req 4.6).

/** Themes that the scenarios below answer; the UI offers them as input examples in `mock`. */
export const M3_4_SAMPLE_THEMES = Object.freeze({
	default: "階層型エージェントの最新動向",
	partialFailure: "リサーチエージェントの評価手法",
});

const chat = "chat" as const;

const supervisorMarker = (theme: string) => `<research-theme>\n${theme}\n</research-theme>`;
const taskMarker = (task: string) => `<task>\n${task}\n</task>`;
const themeMarker = (theme: string) => `<theme>\n${theme}\n</theme>`;

const call = (toolName: string, input: Record<string, string | string[]>) => ({
	toolName,
	input,
});

function turn(match: Omit<ScenarioMatch, "purpose">, respond: ScenarioResponse): ScenarioTurn {
	return { match: { purpose: chat, ...match }, respond };
}

/** The supervisor's turn after `steps` calls: the first has no tool result, later ones follow one. */
function supervisorTurn(
	theme: string,
	steps: number,
	previous: string | undefined,
	respond: ScenarioResponse,
): ScenarioTurn {
	return turn(
		previous === undefined
			? { lastUserTextIncludes: supervisorMarker(theme), stepIndex: steps }
			: {
					lastUserTextIncludes: supervisorMarker(theme),
					stepIndex: steps,
					toolResultFor: previous,
				},
		{
			usage: { inputTokens: 700 + steps * 250, outputTokens: respond.text ? 420 : 90 },
			...respond,
		},
	);
}

/** A search or reading sub-agent: one tool call, then the answer. */
function toolUser(
	marker: string,
	tool: { name: string; input: Record<string, string | string[]> },
	answer: string,
): ScenarioTurn[] {
	return [
		turn(
			{ lastUserTextIncludes: marker, stepIndex: 0 },
			{
				toolCalls: [call(tool.name, tool.input)],
				usage: { inputTokens: 520, outputTokens: 60 },
			},
		),
		turn(
			{ lastUserTextIncludes: marker, stepIndex: 1, toolResultFor: tool.name },
			{ text: answer, usage: { inputTokens: 1_450, outputTokens: 190 } },
		),
	];
}

const DEFAULT_TOPIC_A = "階層型エージェントのツール利用";
const DEFAULT_TOPIC_B = "hierarchical agents evaluation";
const DEFAULT_FOCUS = "手法の違いと評価に使ったデータ";
const DEFAULT_FINDINGS =
	"階層型の計画は担当ごとにツールを分けて精度を上げる。評価基準はまだ揃っていない。";

const DEFAULT_REPORT = [
	"# 階層型エージェントの最新動向",
	"",
	"## 手法",
	"- 階層型の計画（2401.01234）は、上位の計画を担当ごとに分けて実行する。",
	"- 研究エージェントの評価基準（2403.05678）が提案された。",
	"- 未取得の手法 X（2412.99999）が最も高い精度を示したとされる。",
	"",
	"## 市場への影響",
	"導入は段階的に広がるが、評価基準が揃うまでは限定的である。",
	"",
	"## 今後の課題",
	"- 評価基準の統一",
	"- 担当間の責任分界",
].join("\n");

const PARTIAL_TOPIC = "研究エージェントの評価ベンチマーク";
const PARTIAL_FOCUS = "ベンチマークの設計と指標";
const PARTIAL_FINDINGS = "評価ベンチマークは提案されたが、指標の妥当性は未検証である。";

const PARTIAL_REPORT = [
	"# リサーチエージェントの評価手法",
	"",
	"## 手法",
	"- 研究エージェントの評価基準（2403.05678）が提案された。",
	"",
	"## 市場への影響",
	"評価基準が整えば、導入判断の材料になる。",
	"",
	"## 今後の課題",
	"- 指標の妥当性の検証",
].join("\n");

export const M3_4_SCENARIOS: readonly ScenarioDefinition[] = [
	defineScenario({
		id: "m3-4/research/default",
		turns: [
			supervisorTurn(M3_4_SAMPLE_THEMES.default, 0, undefined, {
				toolCalls: [call("searchPapers", { topic: DEFAULT_TOPIC_A })],
			}),
			supervisorTurn(M3_4_SAMPLE_THEMES.default, 1, "searchPapers", {
				toolCalls: [call("searchPapers", { topic: DEFAULT_TOPIC_B })],
			}),
			supervisorTurn(M3_4_SAMPLE_THEMES.default, 2, "searchPapers", {
				toolCalls: [
					call("readPapers", { paperIds: ["2401.01234", "2403.05678"], focus: DEFAULT_FOCUS }),
				],
			}),
			supervisorTurn(M3_4_SAMPLE_THEMES.default, 3, "readPapers", {
				toolCalls: [
					call("assessMarketImpact", {
						theme: M3_4_SAMPLE_THEMES.default,
						findings: DEFAULT_FINDINGS,
					}),
				],
			}),
			supervisorTurn(M3_4_SAMPLE_THEMES.default, 4, "assessMarketImpact", {
				text: DEFAULT_REPORT,
			}),
			...toolUser(
				taskMarker(DEFAULT_TOPIC_A),
				{ name: "searchArxiv", input: { query: "hierarchical agents tool use" } },
				"2401.01234 階層型の計画でツールを担当ごとに分ける。2403.05678 研究エージェントの評価基準を提案。cs/0501001 は古い形式の ID の例。",
			),
			...toolUser(
				taskMarker(DEFAULT_TOPIC_B),
				{ name: "searchArxiv", input: { query: "research agents evaluation benchmark" } },
				"2403.05678 研究エージェントの評価基準。2401.01234 は評価に階層型の計画を使う。",
			),
			...toolUser(
				taskMarker(DEFAULT_FOCUS),
				{ name: "getPaperAbstract", input: { arxivId: "2401.01234" } },
				"2401.01234 は上位の計画を担当ごとに分けて実行する。限界は担当間の調整コスト。2403.05678 は評価の指標を提案する。",
			),
			turn(
				{ lastUserTextIncludes: themeMarker(M3_4_SAMPLE_THEMES.default), stepIndex: 0 },
				{
					text: "導入は段階的に広がる見込み。評価基準が揃うまでは影響は限定的で、前提は担当間の責任分界が整うこと。",
					usage: { inputTokens: 900, outputTokens: 140 },
				},
			),
		],
	}),
	defineScenario({
		id: "m3-4/research/partial-failure",
		turns: [
			supervisorTurn(M3_4_SAMPLE_THEMES.partialFailure, 0, undefined, {
				toolCalls: [call("searchPapers", { topic: PARTIAL_TOPIC })],
			}),
			supervisorTurn(M3_4_SAMPLE_THEMES.partialFailure, 1, "searchPapers", {
				toolCalls: [call("readPapers", { paperIds: ["2403.05678"], focus: PARTIAL_FOCUS })],
			}),
			supervisorTurn(M3_4_SAMPLE_THEMES.partialFailure, 2, "readPapers", {
				toolCalls: [
					call("assessMarketImpact", {
						theme: M3_4_SAMPLE_THEMES.partialFailure,
						findings: PARTIAL_FINDINGS,
					}),
				],
			}),
			supervisorTurn(M3_4_SAMPLE_THEMES.partialFailure, 3, "assessMarketImpact", {
				text: PARTIAL_REPORT,
			}),
			...toolUser(
				taskMarker(PARTIAL_TOPIC),
				{ name: "searchArxiv", input: { query: "research agents evaluation benchmark" } },
				"2403.05678 研究エージェントの評価基準を提案。2401.01234 は階層型の計画。",
			),
			// The reading sub-agent reads the abstract and then answers with nothing: a failed run.
			...toolUser(
				taskMarker(PARTIAL_FOCUS),
				{ name: "getPaperAbstract", input: { arxivId: "2403.05678" } },
				"",
			),
			turn(
				{ lastUserTextIncludes: themeMarker(M3_4_SAMPLE_THEMES.partialFailure), stepIndex: 0 },
				{
					text: "評価基準が整えば導入判断の材料になる。ただし精読が済んでいないため、指標の妥当性は未確認。",
					usage: { inputTokens: 800, outputTokens: 120 },
				},
			),
		],
	}),
];
