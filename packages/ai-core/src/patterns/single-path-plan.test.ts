import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { PlatformError } from "../errors";
import { createObjectModel } from "../testing/mock-models";
import { WorkflowStepError } from "../workflows";
import { type PlanStepContext, planSinglePath } from "./single-path-plan";

function steps(count: number): string[] {
	return Array.from({ length: count }, (_, index) => `step ${index + 1}`);
}

function scriptedPlans(plans: readonly unknown[]) {
	let call = 0;
	const users: string[] = [];
	const model = new MockLanguageModelV4({
		doGenerate: async (options) => {
			users.push(JSON.stringify(options.prompt.filter((message) => message.role === "user")));
			const plan = plans[Math.min(call, plans.length - 1)];
			call += 1;
			return {
				content: [{ type: "text", text: JSON.stringify(plan) }],
				finishReason: { unified: "stop", raw: undefined },
				usage: {
					inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
					outputTokens: { total: 0, text: 0, reasoning: 0 },
				},
				warnings: [],
			};
		},
	});
	return { model, calls: () => call, users };
}

describe("planSinglePath", () => {
	it("plans the steps, runs them and returns each step's result", async () => {
		const result = await planSinglePath({
			planner: { model: createObjectModel({ steps: steps(3) }) },
			executor: async (step) => `result of ${step}`,
			goal: "ship it",
		});

		expect(result).toEqual({
			steps: steps(3),
			results: steps(3).map((step) => ({ step, output: `result of ${step}` })),
		});
	});

	it("runs the steps one after another, never at the same time", async () => {
		let running = 0;
		let peak = 0;
		const order: string[] = [];

		await planSinglePath({
			planner: { model: createObjectModel({ steps: steps(3) }) },
			executor: async (step) => {
				running += 1;
				peak = Math.max(peak, running);
				order.push(`start ${step}`);
				await new Promise((resolve) => setTimeout(resolve, 5));
				order.push(`end ${step}`);
				running -= 1;
				return step;
			},
			goal: "g",
		});

		expect(peak).toBe(1);
		expect(order).toEqual([
			"start step 1",
			"end step 1",
			"start step 2",
			"end step 2",
			"start step 3",
			"end step 3",
		]);
	});

	it("hands each step the goal and the results so far", async () => {
		const contexts: PlanStepContext[] = [];

		await planSinglePath({
			planner: { model: createObjectModel({ steps: steps(3) }) },
			executor: async (step, context) => {
				contexts.push(context);
				return `out-${step}`;
			},
			goal: "THE-GOAL",
		});

		expect(contexts.map((context) => context.goal)).toEqual(["THE-GOAL", "THE-GOAL", "THE-GOAL"]);
		expect(contexts[0]?.previousResults).toEqual([]);
		expect(contexts[2]?.previousResults).toEqual([
			{ step: "step 1", output: "out-step 1" },
			{ step: "step 2", output: "out-step 2" },
		]);
	});

	it("regenerates a plan with more steps than the limit", async () => {
		const { model, calls } = scriptedPlans([{ steps: steps(9) }, { steps: steps(4) }]);

		const result = await planSinglePath({
			planner: { model },
			executor: async (step) => step,
			goal: "g",
		});

		expect(calls()).toBe(2);
		expect(result.steps).toHaveLength(4);
	});

	it("accepts exactly the step limit and honours a lower custom limit", async () => {
		const exact = await planSinglePath({
			planner: { model: createObjectModel({ steps: steps(8) }) },
			executor: async (step) => step,
			goal: "g",
		});
		const lowered = await planSinglePath({
			planner: { model: createObjectModel({ steps: steps(3) }) },
			executor: async (step) => step,
			goal: "g",
			limits: { maxPlanSteps: 2 },
		}).catch((thrown: unknown) => thrown);

		expect(exact.steps).toHaveLength(8);
		expect(lowered).toMatchObject({ code: "output-invalid" });
	});

	it("rejects an empty plan", async () => {
		await expect(
			planSinglePath({
				planner: { model: createObjectModel({ steps: [] }) },
				executor: async (step) => step,
				goal: "g",
			}),
		).rejects.toMatchObject({ code: "output-invalid" });
	});

	it("stops at a failing step, runs nothing after it and names it", async () => {
		const executor = vi.fn(async (step: string) => {
			if (step === "step 2") throw new Error("boom");
			return step;
		});

		const error = await planSinglePath({
			planner: { model: createObjectModel({ steps: steps(4) }) },
			executor,
			goal: "g",
		}).catch((thrown: unknown) => thrown);

		expect(error).toBeInstanceOf(WorkflowStepError);
		expect(error).toMatchObject({ step: "step-2" });
		expect(executor).toHaveBeenCalledTimes(2);
	});

	it("keeps an environment error unwrapped", async () => {
		const unavailable = new PlatformError("provider-unavailable", "down");

		await expect(
			planSinglePath({
				planner: { model: createObjectModel({ steps: steps(2) }) },
				executor: async () => {
					throw unavailable;
				},
				goal: "g",
			}),
		).rejects.toBe(unavailable);
	});

	it("does not start the next step after an abort", async () => {
		const controller = new AbortController();
		const reason = new Error("user stopped");
		const executor = vi.fn(async (step: string) => {
			controller.abort(reason);
			return step;
		});

		await expect(
			planSinglePath({
				planner: { model: createObjectModel({ steps: steps(3) }) },
				executor,
				goal: "g",
				signal: controller.signal,
			}),
		).rejects.toBe(reason);
		expect(executor).toHaveBeenCalledTimes(1);
	});

	it("surfaces the abort reason, not a step failure, when a step fails because of the abort", async () => {
		const controller = new AbortController();
		const reason = new Error("user stopped");

		await expect(
			planSinglePath({
				planner: { model: createObjectModel({ steps: steps(2) }) },
				executor: async () => {
					controller.abort(reason);
					throw new Error("request was aborted");
				},
				goal: "g",
				signal: controller.signal,
			}),
		).rejects.toBe(reason);
	});

	it("gives the planner the goal as data", async () => {
		const { model, users } = scriptedPlans([{ steps: steps(1) }]);

		await planSinglePath({ planner: { model }, executor: async (s) => s, goal: "THE-GOAL" });

		expect(users[0]).toContain("<goal>");
		expect(users[0]).toContain("THE-GOAL");
	});
});
