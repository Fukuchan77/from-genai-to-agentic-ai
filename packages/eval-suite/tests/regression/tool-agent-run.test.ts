// Regression: the M1 tool agent run end to end in `mock` mode (plan C21). The pure functions behind
// it (stop reasons, stop conditions, tool conversion) are unit-tested inside `@platform/ai-core`;
// this file pins only the observable contract of a whole run, through the public subpaths.

import {
	buildToolSet,
	createCalculatorTool,
	createCurrencyConvertTool,
	createCurrentTimeTool,
	createWeatherTool,
	createWebSearchTool,
} from "@platform/ai-core/aci";
import {
	type AgentRunSummary,
	createGuardedAgent,
	type GuardedAgent,
	type LoopLimits,
} from "@platform/ai-core/agents";
import {
	createFixtureHttpFetcher,
	createFixtureWebSearch,
	createScenarioModel,
	defineScenario,
	type FixtureSet,
	loadFixtureSet,
	M1_2_SCENARIOS,
} from "@platform/ai-core/mock";
import { createFakeClock } from "@platform/ai-core/testing";
import { beforeAll, describe, expect, it } from "vitest";

const LIMITS: LoopLimits = {
	maxSteps: 10,
	maxTotalTokens: 50_000,
	maxDurationMs: 120_000,
	toolTimeoutMs: 15_000,
};

/** A run that calls two tools in order, the second of which fails recoverably. */
const CALCULATE_THEN_UNKNOWN_CITY = defineScenario({
	id: "eval/regression/calculate-then-unknown-city",
	turns: [
		{
			match: { purpose: "chat", lastUserTextIncludes: "火星", stepIndex: 0 },
			respond: { toolCalls: [{ toolName: "calculator", input: { expression: "(1 + 2) * 3" } }] },
		},
		{
			match: { purpose: "chat", stepIndex: 1, toolResultFor: "calculator" },
			respond: { toolCalls: [{ toolName: "weather", input: { city: "火星" } }] },
		},
		{
			match: { purpose: "chat", stepIndex: 2, toolResultFor: "weather" },
			respond: { text: "計算結果は 9 です。火星の天気は調べられませんでした。" },
		},
	],
});

interface AgentRun {
	readonly summary: AgentRunSummary;
	/** Tool results in the order the stream delivered them (the Outcome each tool returned). */
	readonly toolOutputs: readonly { readonly toolName: string; readonly output: unknown }[];
	readonly finalText: string;
}

let fixtures: FixtureSet;

beforeAll(async () => {
	fixtures = await loadFixtureSet();
});

/** Builds the M1 tool agent the way the tool-agent route will: guarded agent + buildToolSet. */
function createToolAgent(limits: LoopLimits = LIMITS): GuardedAgent {
	const clock = createFakeClock(Date.UTC(2026, 0, 1));
	const { tools } = buildToolSet(
		[
			createCalculatorTool(),
			createCurrencyConvertTool(),
			createCurrentTimeTool(clock),
			createWeatherTool(createFixtureHttpFetcher(fixtures.http)),
			createWebSearchTool(createFixtureWebSearch(fixtures.webSearch)),
		],
		{ "web-search": true },
		{ clock, toolTimeoutMs: limits.toolTimeoutMs },
	);
	return createGuardedAgent({
		model: createScenarioModel({
			purpose: "chat",
			scenarios: [...M1_2_SCENARIOS, CALCULATE_THEN_UNKNOWN_CITY],
		}),
		instructions: "あなたはツールを使って質問に答えるアシスタントです。",
		tools,
		limits,
		clock,
		signal: new AbortController().signal,
	});
}

async function runToEnd(guarded: GuardedAgent, prompt: string): Promise<AgentRun> {
	const result = await guarded.agent.stream({ prompt, abortSignal: guarded.abortSignal });
	const toolOutputs: { toolName: string; output: unknown }[] = [];
	let finalText = "";
	for await (const part of result.fullStream) {
		if (part.type === "tool-result") {
			toolOutputs.push({ toolName: part.toolName, output: part.output });
		}
		if (part.type === "start-step") finalText = "";
		if (part.type === "text-delta") finalText += part.text;
	}
	return { summary: await guarded.done, toolOutputs, finalText };
}

describe("tool agent run (regression)", () => {
	it("answers the M1-2 weather scenario with one weather call and a successful Outcome", async () => {
		const run = await runToEnd(createToolAgent(), "東京の天気を教えて");

		expect(run.summary).toMatchObject({
			stopReason: "completed",
			steps: 2,
			toolsCalled: ["weather"],
			error: undefined,
		});
		expect(run.toolOutputs).toEqual([
			{
				toolName: "weather",
				output: {
					ok: true,
					data: {
						city: "Tokyo",
						cityLabel: "東京",
						latitude: 35.6762,
						longitude: 139.6503,
						temperatureC: 22,
						weatherCode: 0,
						condition: "晴れ",
					},
				},
			},
		]);
		expect(run.finalText).toBe("東京は晴れ、気温は22°Cです。");
	});

	it("keeps the tool-call order and turns a tool failure into a recoverable Outcome", async () => {
		const run = await runToEnd(createToolAgent(), "(1 + 2) * 3 と火星の天気を教えて");

		expect(run.summary).toMatchObject({
			stopReason: "completed",
			steps: 3,
			toolsCalled: ["calculator", "weather"],
			error: undefined,
		});
		expect(run.toolOutputs.map(({ toolName }) => toolName)).toEqual(["calculator", "weather"]);
		expect(run.toolOutputs[0]?.output).toEqual({
			ok: true,
			data: { expression: "(1 + 2) * 3", result: 9 },
		});
		expect(run.toolOutputs[1]?.output).toEqual({
			ok: false,
			failure: {
				kind: "recoverable",
				summary: "都市「火星」の座標が登録されていません。",
				nextAction: expect.stringContaining("Tokyo（東京）"),
			},
		});
		expect(run.finalText).toBe("計算結果は 9 です。火星の天気は調べられませんでした。");
	});

	it("stops at the step limit after the tool call and gives no final answer", async () => {
		const run = await runToEnd(createToolAgent({ ...LIMITS, maxSteps: 1 }), "東京の天気を教えて");

		expect(run.summary).toMatchObject({
			stopReason: "step-limit",
			steps: 1,
			toolsCalled: ["weather"],
			error: undefined,
		});
		expect(run.toolOutputs.map(({ toolName }) => toolName)).toEqual(["weather"]);
		expect(run.finalText).toBe("");
	});
});
