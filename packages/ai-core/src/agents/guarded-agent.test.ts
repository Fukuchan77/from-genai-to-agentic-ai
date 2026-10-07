import {
	APICallError,
	createAgentUIStream,
	type LanguageModel,
	simulateReadableStream,
	type ToolSet,
	tool,
	type UIMessageChunk,
} from "ai";
import { MockLanguageModelV4 } from "ai/test";
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	expectTypeOf,
	it,
	type MockInstance,
	vi,
} from "vitest";
import { z } from "zod";
import { M1_2_SCENARIOS } from "../../fixtures/scenarios/m1-2";
import { defineAciTool } from "../aci/define-tool";
import { buildToolSet } from "../aci/tool-set";
import { createCalculatorTool } from "../aci/tools/calculator";
import type { AnyAciTool, GuardedToolSet } from "../aci/types";
import { ConfigError } from "../config/load";
import { PlatformError } from "../errors";
import { defineScenario } from "../mock/scenario";
import { createScenarioModel } from "../mock/scenario-model";
import { createFakeClock, type FakeClock } from "../ports/clock";
import {
	AGENT_RUN_ERROR_MESSAGE,
	type AgentRunSummary,
	createGuardedAgent,
	type GuardedAgent,
	type GuardedAgentOptions,
	type LoopLimits,
	MAX_AGENT_TOOLS,
	type RunObserver,
} from "./guarded-agent";

const LIMITS: LoopLimits = {
	maxSteps: 10,
	maxTotalTokens: 50_000,
	maxDurationMs: 120_000,
	toolTimeoutMs: 15_000,
};

const CALCULATION_SCENARIO = defineScenario({
	id: "guarded/calculation-loop",
	turns: [
		{
			match: { purpose: "chat", lastUserTextIncludes: "計算", stepIndex: 0 },
			respond: {
				toolCalls: [{ toolName: "calculator", input: { expression: "1 + 2" } }],
				usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 40 },
			},
		},
		{
			match: { purpose: "chat", stepIndex: 1, toolResultFor: "calculator" },
			respond: {
				toolCalls: [{ toolName: "calculator", input: { expression: "3 * 4" } }],
				usage: { inputTokens: 120, outputTokens: 12, reasoningTokens: 5 },
			},
		},
		{
			match: { purpose: "chat", stepIndex: 2, toolResultFor: "calculator" },
			respond: {
				text: "1 + 2 = 3、3 * 4 = 12 です。",
				usage: { inputTokens: 150, outputTokens: 20 },
			},
		},
	],
});

const weatherTool = defineAciTool({
	name: "weather",
	description: "Returns fixed weather.",
	inputSchema: z.object({ city: z.string() }),
	risk: "read-only",
	execute: ({ city }) => ({ city, condition: "晴れ", temperatureC: 22 }),
});

function chatModel(): LanguageModel {
	return createScenarioModel({
		purpose: "chat",
		scenarios: [...M1_2_SCENARIOS, CALCULATION_SCENARIO],
	});
}

function guardedTools(clock: FakeClock, tools: readonly AnyAciTool[] = [createCalculatorTool()]) {
	return buildToolSet(tools, {}, { clock, toolTimeoutMs: LIMITS.toolTimeoutMs }).tools;
}

function options(
	overrides: Partial<GuardedAgentOptions<ToolSet>> & { clock: FakeClock },
): GuardedAgentOptions<ToolSet> {
	return {
		model: chatModel(),
		instructions: "You are a test agent.",
		tools: guardedTools(overrides.clock),
		limits: LIMITS,
		signal: new AbortController().signal,
		...overrides,
	};
}

/** Runs the agent the way the route does (createAgentUIStreamResponse) and collects the chunks. */
async function runToEnd(guarded: GuardedAgent, text: string): Promise<UIMessageChunk[]> {
	const stream = await createAgentUIStream({
		agent: guarded.agent,
		uiMessages: [{ id: "user-1", role: "user", parts: [{ type: "text", text }] }],
		abortSignal: guarded.abortSignal,
		messageMetadata: guarded.messageMetadata,
		onError: guarded.onError,
	});
	const chunks: UIMessageChunk[] = [];
	for await (const chunk of stream) chunks.push(chunk as UIMessageChunk);
	return chunks;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

/** A model whose stream never starts until its abort signal fires (an unresponsive LLM call). */
function hangingModel(): { model: MockLanguageModelV4; called: Promise<void> } {
	const called = deferred();
	const model = new MockLanguageModelV4({
		doStream: ({ abortSignal }) =>
			new Promise((_resolve, reject) => {
				called.resolve();
				abortSignal?.addEventListener("abort", () => reject(abortSignal.reason), { once: true });
			}),
	});
	return { model, called: called.promise };
}

const FAKE_SECRET = "sk-ant-SECRET123";

/** A model that streams some text and then an `error` part (e.g. a provider overload). */
function midStreamErrorModel(error: unknown): MockLanguageModelV4 {
	return new MockLanguageModelV4({
		doStream: async () => ({
			stream: simulateReadableStream({
				chunks: [
					{ type: "stream-start", warnings: [] },
					{ type: "text-start", id: "t1" },
					{ type: "text-delta", id: "t1", delta: "途中まで" },
					{ type: "error", error },
				],
				initialDelayInMs: null,
				chunkDelayInMs: null,
			}),
		}),
	});
}

function recordingObserver(): RunObserver & { readonly calls: AgentRunSummary[] } {
	const calls: AgentRunSummary[] = [];
	return { calls, onRunEnd: (summary) => calls.push(summary) };
}

describe("createGuardedAgent: run summary", () => {
	it("repeats tool calls until the model answers and sums the run", async () => {
		const clock = createFakeClock(1_000);
		const guarded = createGuardedAgent(options({ clock }));

		const chunks = await runToEnd(guarded, "計算してください");
		const summary = await guarded.done;

		expect(summary).toEqual({
			stopReason: "completed",
			steps: 3,
			totalTokens: { input: 370, output: 42, cacheRead: 40, reasoning: 5 },
			elapsedMs: 0,
			toolsCalled: ["calculator", "calculator"],
			error: undefined,
		});
		expect(guarded.summary()).toBe(summary);
		const outputs = chunks.filter((chunk) => chunk.type === "tool-output-available");
		expect(outputs.map((chunk) => chunk.output)).toEqual([
			{ ok: true, data: { expression: "1 + 2", result: 3 } },
			{ ok: true, data: { expression: "3 * 4", result: 12 } },
		]);
	});

	it("attaches the finalised summary as `run` metadata on the finish chunk", async () => {
		const clock = createFakeClock();
		const guarded = createGuardedAgent(options({ clock }));

		const chunks = await runToEnd(guarded, "計算してください");

		const finish = chunks.find((chunk) => chunk.type === "finish");
		expect(finish?.messageMetadata).toEqual({ run: guarded.summary() });
		const start = chunks.find((chunk) => chunk.type === "start");
		expect(start?.messageMetadata).toBeUndefined();
	});

	it("answers from knowledge without tools and leaves toolsCalled empty", async () => {
		const clock = createFakeClock();
		const guarded = createGuardedAgent(
			options({ clock, tools: guardedTools(clock, [createCalculatorTool(), weatherTool]) }),
		);

		await runToEnd(guarded, "こんにちは");

		expect(await guarded.done).toMatchObject({
			stopReason: "completed",
			steps: 1,
			toolsCalled: [],
		});
	});

	it("stops at the step limit and reports step-limit", async () => {
		const clock = createFakeClock();
		const guarded = createGuardedAgent(options({ clock, limits: { ...LIMITS, maxSteps: 2 } }));

		await runToEnd(guarded, "計算してください");

		expect(await guarded.done).toMatchObject({
			stopReason: "step-limit",
			steps: 2,
			toolsCalled: ["calculator", "calculator"],
		});
	});

	it("stops when the token budget is spent and reports token-budget", async () => {
		const clock = createFakeClock();
		const guarded = createGuardedAgent(
			options({ clock, limits: { ...LIMITS, maxTotalTokens: 110 } }),
		);

		await runToEnd(guarded, "計算してください");

		expect(await guarded.done).toMatchObject({ stopReason: "token-budget", steps: 1 });
	});

	it("measures elapsed time from creation with the injected clock", async () => {
		const clock = createFakeClock(5_000);
		const slowWeather = defineAciTool({
			name: "weather",
			description: "Takes three seconds.",
			inputSchema: z.object({ city: z.string() }),
			risk: "read-only",
			execute: ({ city }) => {
				clock.advanceBy(3_000);
				return { city };
			},
		});
		const guarded = createGuardedAgent(
			options({ clock, tools: guardedTools(clock, [slowWeather]) }),
		);
		clock.advanceBy(250);

		await runToEnd(guarded, "東京の天気は？");

		expect(await guarded.done).toMatchObject({
			stopReason: "completed",
			elapsedMs: 3_250,
			toolsCalled: ["weather"],
		});
	});

	it("keeps two concurrent runs apart", async () => {
		const clock = createFakeClock();
		const first = createGuardedAgent(options({ clock }));
		clock.advanceBy(1_000);
		const second = createGuardedAgent(
			options({ clock, tools: guardedTools(clock, [weatherTool]) }),
		);
		clock.advanceBy(500);

		await Promise.all([runToEnd(first, "計算してください"), runToEnd(second, "東京の天気は？")]);

		expect(await first.done).toMatchObject({
			stopReason: "completed",
			steps: 3,
			elapsedMs: 1_500,
			toolsCalled: ["calculator", "calculator"],
		});
		expect(await second.done).toMatchObject({
			stopReason: "completed",
			steps: 2,
			elapsedMs: 500,
			toolsCalled: ["weather"],
		});
	});

	it("rejects summary() before the run ends", () => {
		const clock = createFakeClock();
		const guarded = createGuardedAgent(options({ clock }));

		expect(() => guarded.summary()).toThrow(PlatformError);
	});
});

describe("createGuardedAgent: abort and error", () => {
	it("turns an unresponsive LLM call into timeout when maxDurationMs elapses", async () => {
		const clock = createFakeClock();
		const { model, called } = hangingModel();
		const guarded = createGuardedAgent(options({ clock, model }));

		const run = runToEnd(guarded, "計算してください");
		await called;
		clock.advanceBy(LIMITS.maxDurationMs);
		const chunks = await run;

		expect(guarded.abortSignal.aborted).toBe(true);
		expect(await guarded.done).toMatchObject({
			stopReason: "timeout",
			steps: 0,
			elapsedMs: LIMITS.maxDurationMs,
			error: undefined,
		});
		expect(chunks.some((chunk) => chunk.type === "finish")).toBe(false);
	});

	it("records aborted when the caller stops the run", async () => {
		const clock = createFakeClock();
		const caller = new AbortController();
		const { model, called } = hangingModel();
		const guarded = createGuardedAgent(options({ clock, model, signal: caller.signal }));

		const run = runToEnd(guarded, "計算してください");
		await called;
		caller.abort();
		await run;

		expect(await guarded.done).toMatchObject({ stopReason: "aborted", steps: 0 });
	});

	it("records aborted at once when the caller signal is already aborted", async () => {
		const clock = createFakeClock();
		const observer = recordingObserver();
		const guarded = createGuardedAgent(
			options({ clock, signal: AbortSignal.abort(), observers: [observer] }),
		);

		expect(guarded.abortSignal.aborted).toBe(true);
		expect(guarded.summary().stopReason).toBe("aborted");
		expect(observer.calls).toHaveLength(1);
	});

	it("records error with a closed code and a fixed message for a stream error", async () => {
		const clock = createFakeClock();
		const model = new MockLanguageModelV4({
			doStream: async () => {
				throw new TypeError("provider exploded");
			},
		});
		const guarded = createGuardedAgent(options({ clock, model }));

		const chunks = await runToEnd(guarded, "計算してください");

		expect(await guarded.done).toMatchObject({
			stopReason: "error",
			steps: 0,
			error: { code: "unexpected", message: AGENT_RUN_ERROR_MESSAGE },
		});
		const error = chunks.find((chunk) => chunk.type === "error");
		expect(error).toMatchObject({ errorText: "エージェントの実行中にエラーが発生しました。" });
		expect(JSON.stringify(chunks)).not.toContain("provider exploded");
	});

	it("keeps a raw mid-stream error message out of the summary and every UI chunk", async () => {
		const clock = createFakeClock();
		const model = midStreamErrorModel(new Error(`Invalid x-api-key ${FAKE_SECRET} for org acme`));
		const guarded = createGuardedAgent(options({ clock, model }));

		const chunks = await runToEnd(guarded, "計算してください");
		const summary = await guarded.done;

		expect(summary).toMatchObject({
			stopReason: "error",
			error: { code: "unexpected", message: AGENT_RUN_ERROR_MESSAGE },
		});
		// The finish chunk is still sent after a mid-stream error part and carries the summary.
		const finish = chunks.find((chunk) => chunk.type === "finish");
		expect(finish?.messageMetadata).toEqual({ run: summary });
		expect(JSON.stringify(chunks)).not.toContain(FAKE_SECRET);
		expect(JSON.stringify(summary)).not.toContain(FAKE_SECRET);
		expect(JSON.stringify(summary)).not.toContain("acme");
	});

	it.each([
		[
			"a PlatformError",
			new PlatformError("provider-unavailable", `秘密 ${FAKE_SECRET}`),
			"provider-unavailable",
		],
		[
			"an APICallError",
			new APICallError({
				message: `upstream rejected ${FAKE_SECRET}`,
				url: "https://api.example.test/v1",
				requestBodyValues: { prompt: FAKE_SECRET },
				statusCode: 529,
			}),
			"provider-unavailable",
		],
		["a non-Error throw value", `plain ${FAKE_SECRET}`, "unexpected"],
	] as const)("records %s under its closed code without the raw text", (_label, thrown, code) => {
		const clock = createFakeClock();
		const guarded = createGuardedAgent(options({ clock }));

		guarded.onError(thrown);

		expect(guarded.summary()).toMatchObject({
			stopReason: "error",
			error: { code, message: AGENT_RUN_ERROR_MESSAGE },
		});
		expect(JSON.stringify(guarded.summary())).not.toContain(FAKE_SECRET);
	});

	it("records the abort cause, not error, when the stream errors after an abort", () => {
		const clock = createFakeClock();
		const guarded = createGuardedAgent(options({ clock }));
		clock.advanceBy(LIMITS.maxDurationMs);

		expect(guarded.onError(new Error("late"))).toBe(
			"実行時間の上限に達したため、エージェントを停止しました。",
		);
		expect(guarded.summary()).toMatchObject({ stopReason: "timeout", error: undefined });
	});
});

describe("createGuardedAgent: error logging and direct agent use", () => {
	let consoleError: MockInstance<typeof console.error>;
	beforeEach(() => {
		consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
	});
	afterEach(() => {
		consoleError.mockRestore();
	});

	it.each([
		["a mid-stream error part", () => midStreamErrorModel(new Error(`bad key ${FAKE_SECRET}`))],
		[
			"a rejected model call",
			() =>
				new MockLanguageModelV4({
					doStream: async () => {
						throw new Error(`bad key ${FAKE_SECRET}`);
					},
				}),
		],
	])("never writes the raw error to console.error for %s", async (_label, makeModel) => {
		const clock = createFakeClock();
		const guarded = createGuardedAgent(options({ clock, model: makeModel() }));

		await runToEnd(guarded, "計算してください");

		expect((await guarded.done).stopReason).toBe("error");
		expect(consoleError).not.toHaveBeenCalled();
	});

	it("settles done with error when agent.stream() is consumed directly", async () => {
		const clock = createFakeClock();
		const model = midStreamErrorModel(new Error(`bad key ${FAKE_SECRET}`));
		const guarded = createGuardedAgent(options({ clock, model }));

		const result = await guarded.agent.stream({
			prompt: "計算してください",
			abortSignal: guarded.abortSignal,
		});
		for await (const _part of result.fullStream) {
			// drain
		}

		expect(guarded.summary()).toMatchObject({
			stopReason: "error",
			error: { code: "unexpected", message: AGENT_RUN_ERROR_MESSAGE },
		});
		expect(await guarded.done).toBe(guarded.summary());
		expect(consoleError).not.toHaveBeenCalled();
	});

	it("settles done with error and rethrows when agent.generate() throws", async () => {
		const clock = createFakeClock();
		const failure = new Error(`bad key ${FAKE_SECRET}`);
		const model = new MockLanguageModelV4({
			doGenerate: async () => {
				throw failure;
			},
		});
		const observer = recordingObserver();
		const guarded = createGuardedAgent(options({ clock, model, observers: [observer] }));

		await expect(
			guarded.agent.generate({ prompt: "計算してください", abortSignal: guarded.abortSignal }),
		).rejects.toBe(failure);

		expect(guarded.summary()).toMatchObject({ stopReason: "error", error: { code: "unexpected" } });
		expect(await guarded.done).toBe(guarded.summary());
		expect(observer.calls).toHaveLength(1);
	});

	it("settles done as completed when agent.generate() succeeds", async () => {
		const clock = createFakeClock();
		const guarded = createGuardedAgent(options({ clock }));

		await guarded.agent.generate({ prompt: "計算してください", abortSignal: guarded.abortSignal });

		expect(guarded.summary()).toMatchObject({ stopReason: "completed", steps: 3 });
	});
});

describe("createGuardedAgent: finalisation", () => {
	it("finalises once and calls every observer exactly once", async () => {
		const clock = createFakeClock();
		const caller = new AbortController();
		const first = recordingObserver();
		const second = recordingObserver();
		const guarded = createGuardedAgent(
			options({ clock, signal: caller.signal, observers: [first, second] }),
		);

		await runToEnd(guarded, "計算してください");
		const summary = guarded.summary();
		caller.abort();
		clock.advanceBy(LIMITS.maxDurationMs);
		guarded.onError(new Error("after the end"));

		expect(guarded.summary()).toBe(summary);
		expect(summary.stopReason).toBe("completed");
		expect(await guarded.done).toBe(summary);
		expect(first.calls).toEqual([summary]);
		expect(second.calls).toEqual([summary]);
		expect(Object.isFrozen(summary)).toBe(true);
		expect(Object.isFrozen(summary.toolsCalled)).toBe(true);
	});

	it("still notifies later observers and resolves done when an observer throws", async () => {
		const clock = createFakeClock();
		const later = recordingObserver();
		const guarded = createGuardedAgent(
			options({
				clock,
				observers: [
					{
						onRunEnd: () => {
							throw new Error("observer failed");
						},
					},
					later,
				],
			}),
		);

		await runToEnd(guarded, "計算してください");

		expect((await guarded.done).stopReason).toBe("completed");
		expect(later.calls).toHaveLength(1);
	});
});

describe("createGuardedAgent: validation", () => {
	function aciTools(count: number): AnyAciTool[] {
		return Array.from({ length: count }, (_, index) =>
			defineAciTool({
				name: `tool${index}`,
				description: `Tool ${index}.`,
				inputSchema: z.object({}),
				risk: "read-only",
				execute: () => index,
			}),
		);
	}

	it(`accepts ${MAX_AGENT_TOOLS} tools`, () => {
		const clock = createFakeClock();
		expect(() =>
			createGuardedAgent(options({ clock, tools: guardedTools(clock, aciTools(20)) })),
		).not.toThrow();
	});

	it("rejects 21 tools with ConfigError", () => {
		const clock = createFakeClock();
		expect(() =>
			createGuardedAgent(options({ clock, tools: guardedTools(clock, aciTools(21)) })),
		).toThrow(ConfigError);
	});

	it.each([
		["maxSteps", 0],
		["maxTotalTokens", -1],
		["maxDurationMs", 1.5],
		["toolTimeoutMs", Number.NaN],
	] as const)("rejects LoopLimits.%s = %s with ConfigError", (field, value) => {
		const clock = createFakeClock();
		expect(() =>
			createGuardedAgent(options({ clock, limits: { ...LIMITS, [field]: value } })),
		).toThrow(new RegExp(`LoopLimits\\.${field}`, "u"));
		expect(() =>
			createGuardedAgent(options({ clock, limits: { ...LIMITS, [field]: value } })),
		).toThrow(ConfigError);
	});

	it("accepts only a GuardedToolSet as tools", () => {
		const raw = {
			calculator: tool({
				description: "raw",
				inputSchema: z.object({}),
				execute: async () => 1,
			}),
		};
		const clock = createFakeClock();
		const make = () =>
			createGuardedAgent({
				model: chatModel(),
				instructions: "x",
				// @ts-expect-error a raw ToolSet skipped buildToolSet's risk check (constitution 6)
				tools: raw,
				limits: LIMITS,
				clock,
				signal: new AbortController().signal,
			});
		expectTypeOf(make).toBeFunction();
		expectTypeOf(guardedTools(clock)).toExtend<GuardedToolSet>();
	});
});
