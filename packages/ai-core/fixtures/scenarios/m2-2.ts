import { defineScenario, type ScenarioDefinition } from "../../src/mock/scenario";

// Mock responses for the RAG Judge (module 2-2). One turn per evaluation axis: the Judge sends a
// separate prompt per axis and starts it with the axis marker, which `src/mock/m2-scenarios.test.ts` pins to
// `judgeAxisMarker`. Failing and `unknown` verdicts are exercised with fake Judge models in the
// Judge's own tests; a scenario can only match one marker string per turn.

export const M2_2_SCENARIOS: readonly ScenarioDefinition[] = [
	defineScenario({
		id: "m2-2/judge/faithfulness",
		turns: [
			{
				match: { purpose: "judge", lastUserTextIncludes: "[judge-axis:faithfulness]" },
				respond: {
					object: {
						verdict: "pass",
						score: 5,
						rationale: "回答の内容は、取得した資料の記述だけで裏付けられています。",
					},
					usage: { inputTokens: 300, outputTokens: 40 },
				},
			},
		],
	}),
	defineScenario({
		id: "m2-2/judge/answer-relevance",
		turns: [
			{
				match: { purpose: "judge", lastUserTextIncludes: "[judge-axis:answer-relevance]" },
				respond: {
					object: {
						verdict: "pass",
						score: 4,
						rationale: "回答は質問に正面から答えています。",
					},
					usage: { inputTokens: 200, outputTokens: 40 },
				},
			},
		],
	}),
];
