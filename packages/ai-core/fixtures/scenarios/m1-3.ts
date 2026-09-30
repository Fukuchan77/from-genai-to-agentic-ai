import { defineScenario, type ScenarioDefinition } from "../../src/mock/scenario";

const baseSummary = {
	title: "Agentic AI 入門",
	keyPoints: ["目的を明確にする", "ツールを安全に使う", "評価で品質を確認する"],
	tags: ["AI", "agents", "evaluation"],
	actionItems: ["モックでテストする"],
};

export const M1_3_SCENARIOS: readonly ScenarioDefinition[] = [
	defineScenario({
		id: "m1-3/full-summary",
		turns: [
			{
				match: { purpose: "structured", lastUserTextIncludes: "fixture:summary-full" },
				respond: { object: baseSummary, usage: { inputTokens: 120, outputTokens: 60 } },
			},
		],
	}),
	defineScenario({
		id: "m1-3/split-summary",
		turns: [
			{
				match: { purpose: "structured", lastUserTextIncludes: "fixture:summary-split" },
				respond: {
					object: { ...baseSummary, title: "分割要約" },
					usage: { inputTokens: 400, outputTokens: 80, cacheReadTokens: 200 },
				},
			},
		],
	}),
	defineScenario({
		id: "m1-3/validation-retry",
		turns: [
			{
				match: { purpose: "structured", lastUserTextIncludes: "fixture:summary-invalid" },
				respond: { object: { title: "Invalid", keyPoints: [] } },
			},
		],
	}),
	defineScenario({
		id: "m1-3/chapter-summary",
		turns: [
			{
				match: { purpose: "structured", lastUserTextIncludes: "fixture:summary-chapters" },
				respond: {
					object: {
						...baseSummary,
						chapters: [
							{ heading: "導入", startSeconds: 0 },
							{ heading: "実装", startSeconds: 90 },
						],
					},
				},
			},
		],
	}),
];
