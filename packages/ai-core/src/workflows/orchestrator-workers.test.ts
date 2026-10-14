import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { PlatformError } from "../errors";
import { StructuredOutputError } from "../structured";
import { createObjectModel } from "../testing/mock-models";
import { WorkflowStepError } from "./errors";
import { type OrchestrateParams, orchestrate, type Subtask } from "./orchestrator-workers";

type PlanJson = { subtasks: { title: string; instruction: string }[] };

function plan(count: number): PlanJson {
	return {
		subtasks: Array.from({ length: count }, (_, index) => ({
			title: `sub-${index + 1}`,
			instruction: `do part ${index + 1}`,
		})),
	};
}

function textModel(pick: (prompt: string, call: number) => string): MockLanguageModelV4 {
	let call = 0;
	return new MockLanguageModelV4({
		doGenerate: async (options) => {
			const text = pick(JSON.stringify(options.prompt), call);
			call += 1;
			return {
				content: [{ type: "text", text }],
				finishReason: { unified: "stop", raw: undefined },
				usage: {
					inputTokens: { total: 2, noCache: 2, cacheRead: 0, cacheWrite: 0 },
					outputTokens: { total: 1, text: 1, reasoning: 0 },
				},
				warnings: [],
			};
		},
	});
}

function params(overrides: Partial<OrchestrateParams<string>> = {}): OrchestrateParams<string> {
	return {
		task: "write the report",
		planner: { model: createObjectModel(plan(2)) },
		worker: async (subtask) => `output of ${subtask.title}`,
		synthesize: async ({ results }) =>
			results
				.filter((result) => result.status === "completed")
				.map((result) => result.output)
				.join(" + "),
		...overrides,
	};
}

describe("orchestrate", () => {
	it("plans, delegates every subtask to a worker and synthesizes the outputs", async () => {
		const result = await orchestrate(params());

		expect(result.subtasks).toEqual(plan(2).subtasks);
		expect(result.results).toEqual([
			{ subtask: plan(2).subtasks[0], status: "completed", output: "output of sub-1" },
			{ subtask: plan(2).subtasks[1], status: "completed", output: "output of sub-2" },
		]);
		expect(result.synthesis).toBe("output of sub-1 + output of sub-2");
	});

	it("decides the subtasks at run time from the task", async () => {
		const planner = {
			model: textModel((prompt) =>
				JSON.stringify(prompt.includes("TASK-SMALL") ? plan(1) : plan(4)),
			),
		};

		const small = await orchestrate(params({ task: "TASK-SMALL", planner }));
		const large = await orchestrate(params({ task: "TASK-LARGE", planner }));

		expect(small.subtasks).toHaveLength(1);
		expect(large.subtasks).toHaveLength(4);
	});

	it("gives the planner the task as data and the subtask limit", async () => {
		const users: string[] = [];
		const model = new MockLanguageModelV4({
			doGenerate: async (options) => {
				users.push(JSON.stringify(options.prompt.filter((message) => message.role === "user")));
				return {
					content: [{ type: "text", text: JSON.stringify(plan(1)) }],
					finishReason: { unified: "stop", raw: undefined },
					usage: {
						inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
						outputTokens: { total: 0, text: 0, reasoning: 0 },
					},
					warnings: [],
				};
			},
		});

		await orchestrate(params({ task: "THE-TASK", planner: { model } }));

		expect(users[0]).toContain("<task>");
		expect(users[0]).toContain("THE-TASK");
		expect(users[0]).toContain("6");
	});

	it("starts every worker before any finishes", { timeout: 1_000 }, async () => {
		let arrived = 0;
		let release: () => void = () => {};
		const open = new Promise<void>((resolve) => {
			release = resolve;
		});

		const result = await orchestrate(
			params({
				planner: { model: createObjectModel(plan(3)) },
				worker: async (subtask) => {
					arrived += 1;
					if (arrived === 3) release();
					await open;
					return subtask.title;
				},
			}),
		);

		expect(arrived).toBe(3);
		expect(result.results.map((entry) => entry.output)).toEqual(["sub-1", "sub-2", "sub-3"]);
	});

	it("still synthesizes from the remaining workers when some fail, and records the failure", async () => {
		const synthesize = vi.fn(async (_args: { task: string }) => "partial synthesis");

		const result = await orchestrate(
			params({
				planner: { model: createObjectModel(plan(3)) },
				worker: async (subtask) => {
					if (subtask.title === "sub-2") throw new Error("worker crashed");
					return `ok ${subtask.title}`;
				},
				synthesize,
			}),
		);

		expect(result.results.map((entry) => entry.status)).toEqual([
			"completed",
			"failed",
			"completed",
		]);
		expect(result.results[1]).not.toHaveProperty("output");
		expect(result.synthesis).toBe("partial synthesis");
		expect(synthesize).toHaveBeenCalledTimes(1);
		expect(synthesize.mock.calls[0]?.[0]).toMatchObject({ task: "write the report" });
	});

	it("fails with a WorkflowStepError and skips synthesis when every worker fails", async () => {
		const synthesize = vi.fn(async () => "never");

		const error = await orchestrate(
			params({
				worker: async () => {
					throw new Error("down");
				},
				synthesize,
			}),
		).catch((thrown: unknown) => thrown);

		expect(error).toBeInstanceOf(WorkflowStepError);
		expect(error).toMatchObject({ step: "workers", code: "output-invalid" });
		expect(synthesize).not.toHaveBeenCalled();
	});

	it("surfaces an environment error from the workers unwrapped when all of them fail", async () => {
		const unavailable = new PlatformError("provider-unavailable", "down");

		const error = await orchestrate(
			params({
				worker: async () => {
					throw unavailable;
				},
			}),
		).catch((thrown: unknown) => thrown);

		expect(error).toBe(unavailable);
	});

	it("regenerates the plan when it has more subtasks than the limit", async () => {
		const planner = {
			model: textModel((_prompt, call) => JSON.stringify(call === 0 ? plan(7) : plan(3))),
		};

		const result = await orchestrate(params({ planner }));

		expect(result.subtasks).toHaveLength(3);
		expect(result.planAttempts).toBe(2);
	});

	it("honours a lower custom subtask limit", async () => {
		const error = await orchestrate(
			params({ planner: { model: createObjectModel(plan(3)) }, limits: { maxSubtasks: 2 } }),
		).catch((thrown: unknown) => thrown);

		expect(error).toBeInstanceOf(StructuredOutputError);
	});

	it("rejects an empty plan", async () => {
		const error = await orchestrate(
			params({ planner: { model: createObjectModel({ subtasks: [] }) } }),
		).catch((thrown: unknown) => thrown);

		expect(error).toBeInstanceOf(StructuredOutputError);
	});

	it("reports the planner's token usage", async () => {
		const result = await orchestrate(
			params({ planner: { model: textModel(() => JSON.stringify(plan(2))) } }),
		);

		expect(result.planUsage).toMatchObject({ inputTokens: 2, outputTokens: 1 });
	});

	it("hands the task and each subtask to the workers, and the signal to every call", async () => {
		const controller = new AbortController();
		const worker = vi.fn(async (_subtask: Subtask, _context: unknown) => "w");

		await orchestrate(params({ worker, signal: controller.signal }));

		expect(worker).toHaveBeenCalledTimes(2);
		expect(worker.mock.calls[0]).toEqual([
			plan(2).subtasks[0],
			{ task: "write the report", signal: controller.signal },
		]);
	});

	it("hands the caller's signal to the planner's model call", async () => {
		const controller = new AbortController();
		const seen: (AbortSignal | undefined)[] = [];
		const model = new MockLanguageModelV4({
			doGenerate: async (options) => {
				seen.push(options.abortSignal);
				return {
					content: [{ type: "text", text: JSON.stringify(plan(1)) }],
					finishReason: { unified: "stop", raw: undefined },
					usage: {
						inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
						outputTokens: { total: 0, text: 0, reasoning: 0 },
					},
					warnings: [],
				};
			},
		});

		await orchestrate(params({ planner: { model }, signal: controller.signal }));
		controller.abort();

		expect(seen[0]).toBeDefined();
		expect(seen[0]?.aborted).toBe(true);
	});

	it("does not start the workers or the synthesis after an abort during planning", async () => {
		const controller = new AbortController();
		const reason = new Error("user stopped");
		const worker = vi.fn(async () => "w");
		const planner = {
			model: textModel(() => {
				controller.abort(reason);
				return JSON.stringify(plan(2));
			}),
		};

		await expect(orchestrate(params({ planner, worker, signal: controller.signal }))).rejects.toBe(
			reason,
		);
		expect(worker).not.toHaveBeenCalled();
	});

	it("rethrows the abort reason when the signal aborts while workers run", async () => {
		const controller = new AbortController();
		const reason = new Error("user stopped");
		const synthesize = vi.fn(async () => "never");

		const run = orchestrate(
			params({
				worker: async () => {
					controller.abort(reason);
					throw new Error("aborted worker");
				},
				synthesize,
				signal: controller.signal,
			}),
		);

		await expect(run).rejects.toBe(reason);
		expect(synthesize).not.toHaveBeenCalled();
	});
});
