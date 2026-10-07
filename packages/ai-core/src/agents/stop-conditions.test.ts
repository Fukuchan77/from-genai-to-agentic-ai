import { generateText, type StopCondition, type ToolLoopAgentSettings, tool } from "ai";
import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { defineScenario } from "../mock/scenario";
import { createScenarioModel } from "../mock/scenario-model";
import { createFakeClock } from "../ports/clock";
import {
	createRunStopConditions,
	createStopConditionRecord,
	deadline,
	type GuardStopCondition,
	type RunStopConditions,
	type StepUsageView,
	stepLimit,
	tokenBudget,
} from "./stop-conditions";

function usageStep(inputTokens: number | undefined, outputTokens: number | undefined) {
	return { usage: { inputTokens, outputTokens } } satisfies StepUsageView;
}

function steps(count: number, inputTokens = 0, outputTokens = 0) {
	return Array.from({ length: count }, () => usageStep(inputTokens, outputTokens));
}

describe("stepLimit", () => {
	it("does not fire one step below the limit", async () => {
		const record = createStopConditionRecord();
		const condition = stepLimit(3, record);

		await expect(condition({ steps: steps(2) })).resolves.toBe(false);
		expect(record.fired()).toEqual([]);
	});

	it("fires exactly at the limit and records step-limit", async () => {
		const record = createStopConditionRecord();
		const condition = stepLimit(3, record);

		await expect(condition({ steps: steps(3) })).resolves.toBe(true);
		expect(record.fired()).toEqual(["step-limit"]);
		expect(record.has("step-limit")).toBe(true);
	});

	it("rejects a limit that is not a positive integer", () => {
		const record = createStopConditionRecord();
		for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(() => stepLimit(value, record)).toThrow(RangeError);
		}
	});
});

describe("tokenBudget", () => {
	it("does not fire one token below the budget", () => {
		const record = createStopConditionRecord();
		const condition = tokenBudget(100, record);

		expect(condition({ steps: [usageStep(40, 20), usageStep(30, 9)] })).toBe(false);
		expect(record.fired()).toEqual([]);
	});

	it("fires exactly at the budget, summing input and output over every step", () => {
		const record = createStopConditionRecord();
		const condition = tokenBudget(100, record);

		expect(condition({ steps: [usageStep(40, 20), usageStep(30, 10)] })).toBe(true);
		expect(record.fired()).toEqual(["token-budget"]);
	});

	it("treats undefined token counts as zero", () => {
		const record = createStopConditionRecord();
		const condition = tokenBudget(10, record);

		expect(condition({ steps: [usageStep(undefined, 9), usageStep(undefined, undefined)] })).toBe(
			false,
		);
		expect(condition({ steps: [usageStep(undefined, 9), usageStep(1, undefined)] })).toBe(true);
	});

	it("rejects a budget that is not a positive integer", () => {
		const record = createStopConditionRecord();
		for (const value of [0, -5, 2.5, Number.NaN]) {
			expect(() => tokenBudget(value, record)).toThrow(RangeError);
		}
	});
});

describe("deadline", () => {
	it("does not fire one millisecond before the deadline", () => {
		const clock = createFakeClock(1_000);
		const record = createStopConditionRecord();
		const condition = deadline(clock, 500, record);

		clock.advanceBy(499);
		expect(condition({ steps: steps(1) })).toBe(false);
		expect(record.fired()).toEqual([]);
	});

	it("fires exactly at the deadline and records timeout", () => {
		const clock = createFakeClock(1_000);
		const record = createStopConditionRecord();
		const condition = deadline(clock, 500, record);

		clock.advanceBy(500);
		expect(condition({ steps: steps(1) })).toBe(true);
		expect(record.fired()).toEqual(["timeout"]);
	});

	it("measures from an explicit run start time when one is given", () => {
		const clock = createFakeClock(1_000);
		const record = createStopConditionRecord();
		const condition = deadline(clock, 500, record, 800);

		clock.set(1_299);
		expect(condition({ steps: steps(1) })).toBe(false);
		clock.set(1_300);
		expect(condition({ steps: steps(1) })).toBe(true);
	});

	it("rejects a duration that is not a positive integer", () => {
		const clock = createFakeClock();
		const record = createStopConditionRecord();
		for (const value of [0, -1, 0.5, Number.NaN]) {
			expect(() => deadline(clock, value, record)).toThrow(RangeError);
		}
	});
});

describe("createStopConditionRecord", () => {
	it("lists fired conditions once each, in canonical order", async () => {
		const clock = createFakeClock();
		const record = createStopConditionRecord();
		const byTokens = tokenBudget(10, record);
		const bySteps = stepLimit(1, record);

		await byTokens({ steps: [usageStep(10, 0)] });
		await bySteps({ steps: steps(1) });
		await byTokens({ steps: [usageStep(10, 0)] });
		await deadline(clock, 1, record)({ steps: steps(1) });

		expect(record.fired()).toEqual(["step-limit", "token-budget"]);
		expect(record.has("timeout")).toBe(false);
	});

	it("returns a snapshot that later firings do not mutate", () => {
		const record = createStopConditionRecord();
		const snapshot = record.fired();
		tokenBudget(1, record)({ steps: [usageStep(1, 0)] });

		expect(snapshot).toEqual([]);
		expect(Object.isFrozen(record.fired())).toBe(true);
	});
});

describe("createRunStopConditions", () => {
	const limits = { maxSteps: 3, maxTotalTokens: 100, maxDurationMs: 1_000 };

	it("binds all three conditions to one fresh record per run", async () => {
		const clock = createFakeClock();
		const runA = createRunStopConditions({ limits, clock, startedAt: clock.now() });
		const runB = createRunStopConditions({ limits, clock, startedAt: clock.now() });

		expect(runA.stopWhen).toHaveLength(3);
		expect(runA.record).not.toBe(runB.record);

		const results = await Promise.all(
			runA.stopWhen.map((condition) => condition({ steps: steps(3, 50, 50) })),
		);
		expect(results).toEqual([true, true, false]);
		expect(runA.record.fired()).toEqual(["step-limit", "token-budget"]);
		expect(runB.record.fired()).toEqual([]);
	});

	it("fires timeout when the run start is older than the duration limit", async () => {
		const clock = createFakeClock(5_000);
		const run = createRunStopConditions({ limits, clock, startedAt: 4_000 });

		await Promise.all(run.stopWhen.map((condition) => condition({ steps: steps(1) })));
		expect(run.record.fired()).toEqual(["timeout"]);
	});

	it("is assignable to the stopWhen of a ToolLoopAgent with any tool set", () => {
		const tools = {
			echo: tool({ inputSchema: z.object({ text: z.string() }), execute: ({ text }) => text }),
		};
		type Tools = typeof tools;

		expectTypeOf<GuardStopCondition>().toExtend<StopCondition<Tools>>();
		expectTypeOf<RunStopConditions["stopWhen"]>().toExtend<
			NonNullable<ToolLoopAgentSettings<never, Tools>["stopWhen"]>
		>();
	});
});

describe("integration with the AI SDK tool loop", () => {
	const echoScenario = defineScenario({
		id: "agents/stop-conditions/echo-loop",
		turns: [
			{
				match: { purpose: "chat" },
				respond: {
					toolCalls: [{ toolName: "echo", input: { text: "again" } }],
					usage: { inputTokens: 30, outputTokens: 10 },
				},
			},
		],
	});
	const tools = {
		echo: tool({ inputSchema: z.object({ text: z.string() }), execute: ({ text }) => text }),
	};

	it("stops the loop once the token budget is reached and records why", async () => {
		const clock = createFakeClock();
		const { stopWhen, record } = createRunStopConditions({
			limits: { maxSteps: 10, maxTotalTokens: 100, maxDurationMs: 60_000 },
			clock,
			startedAt: clock.now(),
		});

		const result = await generateText({
			model: createScenarioModel({ purpose: "chat", scenarios: [echoScenario] }),
			prompt: "loop",
			tools,
			stopWhen,
		});

		// 40 tokens per step: 80 after step 2 (below 100), 120 after step 3 (stop).
		expect(result.steps).toHaveLength(3);
		expect(record.fired()).toEqual(["token-budget"]);
	});

	it("stops the loop at exactly maxSteps", async () => {
		const clock = createFakeClock();
		const { stopWhen, record } = createRunStopConditions({
			limits: { maxSteps: 2, maxTotalTokens: 50_000, maxDurationMs: 60_000 },
			clock,
			startedAt: clock.now(),
		});

		const result = await generateText({
			model: createScenarioModel({ purpose: "chat", scenarios: [echoScenario] }),
			prompt: "loop",
			tools,
			stopWhen,
		});

		expect(result.steps).toHaveLength(2);
		expect(record.fired()).toEqual(["step-limit"]);
	});
});
