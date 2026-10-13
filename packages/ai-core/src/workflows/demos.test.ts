import { APICallError, generateText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { M2_3_SAMPLE_TASKS } from "../../fixtures/scenarios/m2-3";
import { loadPlatformConfig } from "../config";
import { PlatformError } from "../errors";
import { createModelGateway, type ModelGateway } from "../models";
import {
	createUsageLedger,
	runWorkflowDemo,
	WORKFLOW_DEMO_NAMES,
	workflowDemoMaxCalls,
} from "./demos";

const gateway = createModelGateway({ config: loadPlatformConfig({ VITEST: "true" }) });
const deps = { gateway };

function spyOnGateway(): { gateway: ModelGateway; resolve: ReturnType<typeof vi.fn> } {
	const resolve = vi.fn(gateway.resolve.bind(gateway));
	return {
		gateway: {
			resolve,
			resolveEmbedding: gateway.resolveEmbedding.bind(gateway),
			availableModels: gateway.availableModels.bind(gateway),
		},
		resolve,
	};
}

describe("runWorkflowDemo: prompt-chaining", () => {
	it("completes the outline and the body when the body keeps every outline heading", async () => {
		const run = await runWorkflowDemo("prompt-chaining", deps, {
			task: M2_3_SAMPLE_TASKS.promptChain.ok,
		});

		expect(run.name).toBe("prompt-chaining");
		expect(run.result).toMatchObject({ status: "completed" });
		expect((run.result as { steps: unknown[] }).steps).toHaveLength(2);
		expect(run.usage.llmCalls).toBe(2);
		expect(run.usage.totalTokens).toBeGreaterThan(0);
	});

	it("stops with the failed step and its errors when the body lacks an outline heading", async () => {
		const run = await runWorkflowDemo("prompt-chaining", deps, {
			task: M2_3_SAMPLE_TASKS.promptChain.bodyFails,
		});

		expect(run.result).toMatchObject({ status: "failed", failedStep: "body" });
		expect((run.result as { errors: string[] }).errors.join("\n")).toContain("まとめ");
	});
});

describe("runWorkflowDemo: routing", () => {
	it("runs the handler of the classified category", async () => {
		const run = await runWorkflowDemo("routing", deps, {
			task: M2_3_SAMPLE_TASKS.routing.technical,
		});

		expect(run.result).toMatchObject({ category: "technical", matched: true });
		expect((run.result as { reason: string }).reason.length).toBeGreaterThan(0);
		expect(run.usage.llmCalls).toBe(2);
	});

	it("runs the fallback with matched=false when the input fits no predefined category", async () => {
		const run = await runWorkflowDemo("routing", deps, {
			task: M2_3_SAMPLE_TASKS.routing.outOfScope,
		});

		expect(run.result).toMatchObject({ category: "unknown", matched: false });
		expect((run.result as { output: string }).output).toContain("対象外");
	});
});

describe("runWorkflowDemo: model-routing", () => {
	it("answers an easy question with the light tier and reports the model and the tokens", async () => {
		const run = await runWorkflowDemo("model-routing", deps, {
			task: M2_3_SAMPLE_TASKS.modelRouting.easy,
		});

		expect(run.result).toMatchObject({
			difficulty: "easy",
			tier: "light",
			distinct: false,
			output: "1 週間は 7 日です。",
		});
		const { modelId, displayName } = run.result as { modelId: string; displayName: string };
		expect(modelId.length).toBeGreaterThan(0);
		expect(displayName.length).toBeGreaterThan(0);
		expect(run.usage.llmCalls).toBe(2);
		expect(run.usage.totalTokens).toBeGreaterThan(0);
	});

	it("answers a hard question with the capable tier", async () => {
		const run = await runWorkflowDemo("model-routing", deps, {
			task: M2_3_SAMPLE_TASKS.modelRouting.hard,
		});

		expect(run.result).toMatchObject({ difficulty: "hard", tier: "capable" });
	});
});

describe("runWorkflowDemo: parallel-sectioning", () => {
	it("runs every aspect and merges the answers in aspect order", async () => {
		const run = await runWorkflowDemo("parallel-sectioning", deps, {
			task: M2_3_SAMPLE_TASKS.sectioning,
		});

		const result = run.result as { sections: { aspect: string; output: string }[]; merged: string };
		expect(result.sections.map((section) => section.aspect)).toEqual(["技術", "費用", "リスク"]);
		for (const section of result.sections) expect(result.merged).toContain(section.output);
		expect(result.merged.indexOf("技術")).toBeLessThan(result.merged.indexOf("費用"));
		expect(run.usage.llmCalls).toBe(3);
	});

	it("rejects more aspects than the section limit", async () => {
		const aspects = Array.from({ length: 9 }, (_, index) => `観点${index}`);

		await expect(
			runWorkflowDemo("parallel-sectioning", deps, {
				task: M2_3_SAMPLE_TASKS.sectioning,
				options: { aspects },
			}),
		).rejects.toMatchObject({ code: "invalid-request" });
	});
});

describe("runWorkflowDemo: parallel-voting", () => {
	it("returns the majority conclusion and every ballot with three votes", async () => {
		const run = await runWorkflowDemo("parallel-voting", deps, { task: M2_3_SAMPLE_TASKS.voting });

		expect(run.result).toMatchObject({ outcome: "majority", conclusion: "賛成" });
		expect((run.result as { ballots: unknown[] }).ballots).toHaveLength(3);
		expect(run.usage.llmCalls).toBe(3);
	});

	it("returns a tie without a conclusion when two votes disagree", async () => {
		const run = await runWorkflowDemo("parallel-voting", deps, {
			task: M2_3_SAMPLE_TASKS.voting,
			options: { votes: 2 },
		});

		expect(run.result).toMatchObject({ outcome: "tie", tiedLabels: ["賛成", "反対"] });
		expect(run.result).not.toHaveProperty("conclusion");
	});

	it("rejects more votes than the limit", async () => {
		await expect(
			runWorkflowDemo("parallel-voting", deps, {
				task: M2_3_SAMPLE_TASKS.voting,
				options: { votes: 10 },
			}),
		).rejects.toMatchObject({ code: "invalid-request" });
	});
});

describe("runWorkflowDemo: orchestrator-workers", () => {
	it("decides the number of subtasks from the task", async () => {
		const three = await runWorkflowDemo("orchestrator-workers", deps, {
			task: M2_3_SAMPLE_TASKS.orchestrator.three,
		});
		const two = await runWorkflowDemo("orchestrator-workers", deps, {
			task: M2_3_SAMPLE_TASKS.orchestrator.two,
		});

		expect((three.result as { subtasks: unknown[] }).subtasks).toHaveLength(3);
		expect((two.result as { subtasks: unknown[] }).subtasks).toHaveLength(2);
		expect(three.result).toMatchObject({ synthesis: expect.stringContaining("導入計画書") });
		expect(three.usage.llmCalls).toBe(5);
		expect(two.usage.llmCalls).toBe(4);
	});

	it("passes the subtask limit on to the planner, which regenerates an oversized plan", async () => {
		const error = await runWorkflowDemo("orchestrator-workers", deps, {
			task: M2_3_SAMPLE_TASKS.orchestrator.three,
			options: { maxSubtasks: 2 },
		}).catch((thrown: unknown) => thrown);

		expect(error).toMatchObject({ code: "output-invalid" });
	});

	it("lists every subtask with its worker result", async () => {
		const run = await runWorkflowDemo("orchestrator-workers", deps, {
			task: M2_3_SAMPLE_TASKS.orchestrator.three,
		});

		const results = (run.result as { results: { status: string; output?: string }[] }).results;
		expect(results.map((entry) => entry.status)).toEqual(["completed", "completed", "completed"]);
		expect(results.every((entry) => (entry.output ?? "").length > 0)).toBe(true);
	});
});

describe("runWorkflowDemo: evaluator-optimizer", () => {
	it("improves a failing draft until it passes", async () => {
		const run = await runWorkflowDemo("evaluator-optimizer", deps, {
			task: M2_3_SAMPLE_TASKS.evaluator.improves,
		});

		expect(run.result).toMatchObject({ passed: true, iterations: 2, bestIteration: 2 });
		const history = (run.result as { history: { combinedScore: number }[] }).history;
		expect(history.map((entry) => entry.combinedScore)).toEqual([60, 88]);
		expect((run.result as { final: string }).final).toContain("版 A2");
		// 2 drafts + 2 evaluators x 2 iterations
		expect(run.usage.llmCalls).toBe(6);
	});

	it("returns the best draft, earliest on a tie, when no draft reaches the pass score", async () => {
		const run = await runWorkflowDemo("evaluator-optimizer", deps, {
			task: M2_3_SAMPLE_TASKS.evaluator.stalls,
		});

		expect(run.result).toMatchObject({ passed: false, iterations: 3, bestIteration: 1 });
		const history = (run.result as { history: { combinedScore: number }[] }).history;
		expect(history.map((entry) => entry.combinedScore)).toEqual([62, 62, 58]);
		expect((run.result as { final: string }).final).toContain("版 B1");
		expect(run.usage.llmCalls).toBe(9);
	});

	it("passes the pass score and the iteration limit on to the pattern", async () => {
		const lenient = await runWorkflowDemo("evaluator-optimizer", deps, {
			task: M2_3_SAMPLE_TASKS.evaluator.improves,
			options: { passScore: 60 },
		});
		const single = await runWorkflowDemo("evaluator-optimizer", deps, {
			task: M2_3_SAMPLE_TASKS.evaluator.stalls,
			options: { maxIterations: 1 },
		});

		expect(lenient.result).toMatchObject({ passed: true, iterations: 1 });
		expect(single.result).toMatchObject({ passed: false, iterations: 1 });
		expect(single.usage.llmCalls).toBe(3);
	});

	it("rejects options above the limits before any model call", async () => {
		const spy = spyOnGateway();

		await expect(
			runWorkflowDemo(
				"evaluator-optimizer",
				{ gateway: spy.gateway },
				{ task: M2_3_SAMPLE_TASKS.evaluator.improves, options: { maxIterations: 9 } },
			),
		).rejects.toMatchObject({ code: "invalid-request" });
		expect(spy.resolve).not.toHaveBeenCalled();
	});
});

describe("runWorkflowDemo: input checks", () => {
	it("rejects a name outside the closed vocabulary", async () => {
		await expect(runWorkflowDemo("graph-of-thoughts", deps, { task: "x" })).rejects.toMatchObject({
			code: "invalid-request",
		});
	});

	it("rejects an empty task", async () => {
		await expect(runWorkflowDemo("routing", deps, { task: "" })).rejects.toMatchObject({
			code: "invalid-request",
		});
	});

	it("rejects an option the demo does not define, without echoing it", async () => {
		const error = await runWorkflowDemo("routing", deps, {
			task: M2_3_SAMPLE_TASKS.routing.technical,
			options: { "SECRET-KEY": "SECRET-VALUE" },
		}).catch((thrown: unknown) => thrown);

		expect(error).toBeInstanceOf(PlatformError);
		expect(error).toMatchObject({ code: "invalid-request" });
		const shown = JSON.stringify([(error as Error).message, (error as PlatformError).details]);
		expect(shown).not.toContain("SECRET-VALUE");
		expect(shown).not.toContain("SECRET-KEY");
	});

	it("rejects a wrongly typed option value", async () => {
		await expect(
			runWorkflowDemo("parallel-voting", deps, {
				task: M2_3_SAMPLE_TASKS.voting,
				options: { votes: "three" },
			}),
		).rejects.toMatchObject({ code: "invalid-request" });
	});

	it("does not call any model when the signal is already aborted", async () => {
		const controller = new AbortController();
		controller.abort(new Error("stop"));
		const spy = spyOnGateway();

		await expect(
			runWorkflowDemo(
				"prompt-chaining",
				{ gateway: spy.gateway, signal: controller.signal },
				{ task: M2_3_SAMPLE_TASKS.promptChain.ok },
			),
		).rejects.toThrow("stop");
		expect(spy.resolve).not.toHaveBeenCalled();
	});
});

describe("workflowDemoMaxCalls", () => {
	it("is the product of the limits for every demo (a structured call may take 3 attempts)", () => {
		expect(workflowDemoMaxCalls("prompt-chaining")).toBe(2);
		expect(workflowDemoMaxCalls("routing")).toBe(4);
		expect(workflowDemoMaxCalls("model-routing")).toBe(4);
		expect(workflowDemoMaxCalls("parallel-sectioning")).toBe(3);
		expect(
			workflowDemoMaxCalls("parallel-sectioning", { aspects: ["a", "b", "c", "d", "e"] }),
		).toBe(5);
		expect(workflowDemoMaxCalls("parallel-voting")).toBe(3);
		expect(workflowDemoMaxCalls("parallel-voting", { votes: 9 })).toBe(9);
		expect(workflowDemoMaxCalls("orchestrator-workers")).toBe(3 + 6 + 1);
		expect(workflowDemoMaxCalls("orchestrator-workers", { maxSubtasks: 2 })).toBe(3 + 2 + 1);
		expect(workflowDemoMaxCalls("evaluator-optimizer")).toBe(3 * (1 + 2 * 3));
		expect(workflowDemoMaxCalls("evaluator-optimizer", { maxIterations: 8 })).toBe(8 * (1 + 2 * 3));
	});

	it("bounds the calls of every demo run in mock mode", async () => {
		const tasks: Record<(typeof WORKFLOW_DEMO_NAMES)[number], string> = {
			"prompt-chaining": M2_3_SAMPLE_TASKS.promptChain.ok,
			routing: M2_3_SAMPLE_TASKS.routing.technical,
			"model-routing": M2_3_SAMPLE_TASKS.modelRouting.easy,
			"parallel-sectioning": M2_3_SAMPLE_TASKS.sectioning,
			"parallel-voting": M2_3_SAMPLE_TASKS.voting,
			"orchestrator-workers": M2_3_SAMPLE_TASKS.orchestrator.three,
			"evaluator-optimizer": M2_3_SAMPLE_TASKS.evaluator.stalls,
		};
		for (const name of WORKFLOW_DEMO_NAMES) {
			const run = await runWorkflowDemo(name, deps, { task: tasks[name] });
			expect(run.usage.llmCalls, name).toBeLessThanOrEqual(workflowDemoMaxCalls(name));
		}
	});

	it("rejects options that exceed a limit, as the demo itself does", () => {
		expect(() => workflowDemoMaxCalls("parallel-voting", { votes: 10 })).toThrow(PlatformError);
		expect(() => workflowDemoMaxCalls("nope")).toThrow(PlatformError);
	});
});

describe("createUsageLedger (cache reads)", () => {
	it("sums cache-read tokens too", async () => {
		const ledger = createUsageLedger();
		const model = new MockLanguageModelV4({
			doGenerate: {
				content: [{ type: "text", text: "x" }],
				finishReason: { unified: "stop", raw: undefined },
				usage: {
					inputTokens: { total: 10, noCache: 5, cacheRead: 5, cacheWrite: 0 },
					outputTokens: { total: 2, text: 2, reasoning: 0 },
				},
				warnings: [],
			},
		});

		await generateText({ model: ledger.wrap(model), prompt: "p" });

		expect(ledger.total()).toMatchObject({ cacheReadTokens: 5, llmCalls: 1 });
	});
});

describe("createUsageLedger", () => {
	it("counts the calls and sums the tokens of the models it wraps", async () => {
		const ledger = createUsageLedger();
		const resolved = await gateway.resolve({ purpose: "chat" });

		await generateText({ model: ledger.wrap(resolved.model), prompt: "[段: 投票 1/3]" });
		await generateText({ model: ledger.wrap(resolved.model), prompt: "[段: 投票 2/3]" });

		expect(ledger.total()).toEqual({
			inputTokens: 180,
			outputTokens: 6,
			totalTokens: 186,
			cacheReadTokens: 0,
			llmCalls: 2,
		});
	});
});

describe("createUsageLedger (attempts and the call cap)", () => {
	function failingModel() {
		return new MockLanguageModelV4({
			doGenerate: async () => {
				throw new Error("attempt failed");
			},
		});
	}

	it("counts an attempt that fails, because it was still a call to the provider", async () => {
		const ledger = createUsageLedger();

		await generateText({ model: ledger.wrap(failingModel()), prompt: "p", maxRetries: 0 }).catch(
			() => undefined,
		);

		expect(ledger.total().llmCalls).toBe(1);
	});

	it("refuses the call after the cap, before it reaches the provider", async () => {
		const ledger = createUsageLedger({ maxCalls: 2 });
		// A retryable provider error, so the SDK would retry up to maxRetries times.
		const doGenerate = vi.fn(async () => {
			throw new APICallError({
				message: "busy",
				url: "https://example.invalid",
				requestBodyValues: {},
				statusCode: 503,
				isRetryable: true,
				responseHeaders: { "retry-after-ms": "0" },
			});
		});
		const model = ledger.wrap(new MockLanguageModelV4({ doGenerate }));

		const error = await generateText({ model, prompt: "p", maxRetries: 5 }).catch(
			(thrown: unknown) => thrown,
		);

		expect(doGenerate).toHaveBeenCalledTimes(2);
		expect(ledger.total().llmCalls).toBe(2);
		expect(error).toBeDefined();
	});
});
