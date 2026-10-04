import { defineScenario, type ScenarioDefinition } from "../../src/mock/scenario";

export const M1_2_SCENARIOS: readonly ScenarioDefinition[] = [
	defineScenario({
		id: "m1-2/chat",
		turns: [
			{
				match: { purpose: "chat", lastUserTextIncludes: "こんにちは", stepIndex: 0 },
				respond: {
					text: "こんにちは。モックモードから決定論的に応答しています。",
					chunkSize: 8,
				},
			},
		],
	}),
	defineScenario({
		id: "m1-2/weather-tool",
		turns: [
			{
				match: { purpose: "chat", lastUserTextIncludes: "東京の天気", stepIndex: 0 },
				respond: {
					toolCalls: [{ toolName: "weather", input: { city: "Tokyo" } }],
				},
			},
			{
				match: { purpose: "chat", stepIndex: 1, toolResultFor: "weather" },
				respond: { text: "東京は晴れ、気温は22°Cです。" },
			},
		],
	}),
];
