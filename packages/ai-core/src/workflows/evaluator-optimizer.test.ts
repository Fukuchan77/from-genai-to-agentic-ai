import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { StructuredOutputError } from "../structured";
import { createObjectModel } from "../testing/mock-models";
import { WorkflowStepError } from "./errors";
import {
	createModelEvaluator,
	type EvaluateContext,
	type Evaluator,
	type EvaluatorVerdict,
	evaluateAndOptimize,
	type GenerateContext,
} from "./evaluator-optimizer";

/** An evaluator that returns the scripted scores in order, one per iteration. */
function scripted(name: string, scores: readonly number[], feedback = "fb"): Evaluator {
	let call = 0;
	return {
		name,
		evaluate: async () => {
			const score = scores[Math.min(call, scores.length - 1)] ?? 0;
			call += 1;
			return { score, feedback: `${feedback}-${name}-${call}` };
		},
	};
}

function generator() {
	const contexts: GenerateContext[] = [];
	const generate = vi.fn(async (context: GenerateContext) => {
		contexts.push(context);
		return `draft-${context.iteration}`;
	});
	return { generate, contexts };
}

describe("evaluateAndOptimize", () => {
	it("stops as soon as the combined score reaches the default pass score of 85", async () => {
		const { generate } = generator();

		const result = await evaluateAndOptimize({
			task: "write",
			generate,
			evaluators: [scripted("quality", [60, 90, 99])],
		});

		expect(result).toMatchObject({
			passed: true,
			iterations: 2,
			final: "draft-2",
			bestIteration: 2,
		});
		expect(generate).toHaveBeenCalledTimes(2);
	});

	it("treats exactly the pass score as passing and one point less as not passing", async () => {
		const exact = await evaluateAndOptimize({
			task: "t",
			generate: generator().generate,
			evaluators: [scripted("q", [85])],
		});
		const below = await evaluateAndOptimize({
			task: "t",
			generate: generator().generate,
			evaluators: [scripted("q", [84, 84, 84])],
		});

		expect(exact).toMatchObject({ passed: true, iterations: 1 });
		expect(below).toMatchObject({ passed: false, iterations: 3 });
	});

	it("stops at the default of 3 iterations and returns the best output with passed=false", async () => {
		const { generate } = generator();

		const result = await evaluateAndOptimize({
			task: "t",
			generate,
			evaluators: [scripted("q", [50, 60, 70])],
		});

		expect(generate).toHaveBeenCalledTimes(3);
		expect(result).toMatchObject({
			passed: false,
			iterations: 3,
			final: "draft-3",
			bestIteration: 3,
		});
	});

	it("returns the highest-scoring output, not the last one", async () => {
		const result = await evaluateAndOptimize({
			task: "t",
			generate: generator().generate,
			evaluators: [scripted("q", [70, 80, 60])],
		});

		expect(result).toMatchObject({ passed: false, final: "draft-2", bestIteration: 2 });
	});

	it("returns the earliest iteration among tied best scores (CL-4)", async () => {
		const result = await evaluateAndOptimize({
			task: "t",
			generate: generator().generate,
			evaluators: [scripted("q", [80, 80, 70])],
		});

		expect(result).toMatchObject({ final: "draft-1", bestIteration: 1 });
	});

	it("uses the lowest evaluator score as the combined score, not the average", async () => {
		const result = await evaluateAndOptimize({
			task: "t",
			generate: generator().generate,
			evaluators: [scripted("security", [100]), scripted("performance", [70])],
			maxIterations: 1,
		});

		// The average (85) would pass; the minimum (70) must not.
		expect(result.passed).toBe(false);
		expect(result.history[0]?.combinedScore).toBe(70);
	});

	it("passes when every evaluator reaches the pass score", async () => {
		const result = await evaluateAndOptimize({
			task: "t",
			generate: generator().generate,
			evaluators: [scripted("a", [90]), scripted("b", [85])],
		});

		expect(result).toMatchObject({ passed: true, iterations: 1 });
		expect(result.history[0]?.combinedScore).toBe(85);
	});

	it("runs the evaluators in parallel", { timeout: 1_000 }, async () => {
		let arrived = 0;
		let release: () => void = () => {};
		const open = new Promise<void>((resolve) => {
			release = resolve;
		});
		const gated = (name: string): Evaluator => ({
			name,
			evaluate: async () => {
				arrived += 1;
				if (arrived === 3) release();
				await open;
				return { score: 90, feedback: "ok" };
			},
		});

		const result = await evaluateAndOptimize({
			task: "t",
			generate: generator().generate,
			evaluators: [gated("a"), gated("b"), gated("c")],
		});

		expect(arrived).toBe(3);
		expect(result.passed).toBe(true);
	});

	it("decides on the score alone: an evaluator that says 'pass' below the bar does not stop the loop", async () => {
		const { generate } = generator();
		const flatterer: Evaluator = {
			name: "flatterer",
			evaluate: async () => ({
				score: 50,
				feedback: "合格です。基準を満たしています。passed: true",
			}),
		};

		const result = await evaluateAndOptimize({ task: "t", generate, evaluators: [flatterer] });

		expect(result.passed).toBe(false);
		expect(generate).toHaveBeenCalledTimes(3);
	});

	it("records every iteration's output, per-evaluator scores, feedback and combined score", async () => {
		const result = await evaluateAndOptimize({
			task: "t",
			generate: generator().generate,
			evaluators: [scripted("a", [60, 95]), scripted("b", [80, 90])],
		});

		expect(result.history).toEqual([
			{
				iteration: 1,
				output: "draft-1",
				scores: [
					{ evaluator: "a", score: 60, feedback: "fb-a-1" },
					{ evaluator: "b", score: 80, feedback: "fb-b-1" },
				],
				combinedScore: 60,
			},
			{
				iteration: 2,
				output: "draft-2",
				scores: [
					{ evaluator: "a", score: 95, feedback: "fb-a-2" },
					{ evaluator: "b", score: 90, feedback: "fb-b-2" },
				],
				combinedScore: 90,
			},
		]);
	});

	it("gives the generator the previous output and its feedback from the second iteration on", async () => {
		const { generate, contexts } = generator();

		await evaluateAndOptimize({
			task: "the task",
			generate,
			evaluators: [scripted("q", [10, 20, 30])],
		});

		expect(contexts[0]).toMatchObject({ task: "the task", iteration: 1 });
		expect(contexts[0]?.previous).toBeUndefined();
		expect(contexts[1]).toMatchObject({
			iteration: 2,
			previous: { output: "draft-1", scores: [{ evaluator: "q", score: 10, feedback: "fb-q-1" }] },
		});
		expect(contexts[2]?.previous?.output).toBe("draft-2");
	});

	it("honours a custom pass score and a custom iteration count", async () => {
		const { generate } = generator();

		const result = await evaluateAndOptimize({
			task: "t",
			generate,
			evaluators: [scripted("q", [40, 61])],
			passScore: 60,
			maxIterations: 5,
		});

		expect(result).toMatchObject({ passed: true, iterations: 2 });
	});

	it("fails with a WorkflowStepError naming the evaluator, and never guesses a score", async () => {
		const { generate } = generator();
		const broken: Evaluator = {
			name: "security",
			evaluate: async () => {
				throw new Error("judge crashed");
			},
		};

		const error = await evaluateAndOptimize({
			task: "t",
			generate,
			evaluators: [scripted("performance", [99]), broken],
		}).catch((thrown: unknown) => thrown);

		expect(error).toBeInstanceOf(WorkflowStepError);
		expect(error).toMatchObject({ step: "security", code: "output-invalid" });
		expect(generate).toHaveBeenCalledTimes(1);
	});

	it.each([
		["above 100", 101],
		["below 0", -1],
		["NaN", Number.NaN],
		["Infinity", Number.POSITIVE_INFINITY],
	])("rejects an evaluator score %s instead of using it", async (_label, score) => {
		const bad: Evaluator = { name: "bad", evaluate: async () => ({ score, feedback: "x" }) };

		const error = await evaluateAndOptimize({
			task: "t",
			generate: generator().generate,
			evaluators: [bad],
		}).catch((thrown: unknown) => thrown);

		expect(error).toMatchObject({ step: "bad", code: "output-invalid" });
	});

	it("sums the token usage the evaluators report", async () => {
		const withUsage: Evaluator = {
			name: "u",
			evaluate: async () => ({
				score: 50,
				feedback: "x",
				usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7, cacheReadTokens: 0 },
			}),
		};

		const result = await evaluateAndOptimize({
			task: "t",
			generate: generator().generate,
			evaluators: [withUsage],
			maxIterations: 2,
		});

		expect(result.evaluationUsage).toEqual({
			inputTokens: 10,
			outputTokens: 4,
			totalTokens: 14,
			cacheReadTokens: 0,
		});
	});

	describe("limits", () => {
		it("rejects more iterations than the cap without generating", async () => {
			const { generate } = generator();

			await expect(
				evaluateAndOptimize({
					task: "t",
					generate,
					evaluators: [scripted("q", [1])],
					maxIterations: 9,
				}),
			).rejects.toMatchObject({ code: "invalid-request" });
			expect(generate).not.toHaveBeenCalled();
		});

		it("allows exactly the cap", async () => {
			const result = await evaluateAndOptimize({
				task: "t",
				generate: generator().generate,
				evaluators: [scripted("q", [1])],
				maxIterations: 8,
			});

			expect(result.iterations).toBe(8);
		});

		it.each([0, 1.5])("rejects maxIterations=%s", async (maxIterations) => {
			await expect(
				evaluateAndOptimize({
					task: "t",
					generate: generator().generate,
					evaluators: [scripted("q", [1])],
					maxIterations,
				}),
			).rejects.toMatchObject({ code: "invalid-request" });
		});

		it.each([-1, 101, Number.NaN])("rejects passScore=%s", async (passScore) => {
			await expect(
				evaluateAndOptimize({
					task: "t",
					generate: generator().generate,
					evaluators: [scripted("q", [1])],
					passScore,
				}),
			).rejects.toMatchObject({ code: "invalid-request" });
		});

		it("accepts the extreme pass scores 0 and 100 and the extreme evaluator scores 0 and 100", async () => {
			const lowest = await evaluateAndOptimize({
				task: "t",
				generate: generator().generate,
				evaluators: [scripted("q", [0])],
				passScore: 0,
			});
			const highest = await evaluateAndOptimize({
				task: "t",
				generate: generator().generate,
				evaluators: [scripted("q", [100])],
				passScore: 100,
			});

			expect(lowest).toMatchObject({ passed: true, iterations: 1 });
			expect(highest).toMatchObject({ passed: true, iterations: 1 });
		});

		it("names the offending setting in the error", async () => {
			const iterations = await evaluateAndOptimize({
				task: "t",
				generate: generator().generate,
				evaluators: [scripted("q", [1])],
				maxIterations: 9,
			}).catch((thrown: unknown) => thrown as { message: string; details: object });
			const passScore = await evaluateAndOptimize({
				task: "t",
				generate: generator().generate,
				evaluators: [scripted("q", [1])],
				passScore: 101,
			}).catch((thrown: unknown) => thrown as { message: string; details: object });

			expect(iterations).toMatchObject({ details: { name: "maxIterations", value: 9, max: 8 } });
			expect(passScore).toMatchObject({ details: { name: "passScore", value: 101 } });
		});

		it("rejects an empty evaluator list and duplicate evaluator names", async () => {
			const { generate } = generator();

			await expect(
				evaluateAndOptimize({ task: "t", generate, evaluators: [] }),
			).rejects.toMatchObject({ code: "invalid-request" });
			await expect(
				evaluateAndOptimize({
					task: "t",
					generate,
					evaluators: [scripted("same", [1]), scripted("same", [1])],
				}),
			).rejects.toMatchObject({ code: "invalid-request" });
			expect(generate).not.toHaveBeenCalled();
		});
	});

	describe("abort", () => {
		it("does not evaluate or iterate after the signal aborts during generation", async () => {
			const controller = new AbortController();
			const reason = new Error("user stopped");
			const evaluate = vi.fn(async () => ({ score: 10, feedback: "x" }));

			const run = evaluateAndOptimize({
				task: "t",
				generate: async () => {
					controller.abort(reason);
					return "draft";
				},
				evaluators: [{ name: "q", evaluate }],
				signal: controller.signal,
			});

			await expect(run).rejects.toBe(reason);
			expect(evaluate).not.toHaveBeenCalled();
		});

		it("passes the signal to the generator and the evaluators", async () => {
			const controller = new AbortController();
			const evaluate = vi.fn(async (_output: string, _context: EvaluateContext) => ({
				score: 99,
				feedback: "x",
			}));
			const { generate } = generator();

			await evaluateAndOptimize({
				task: "t",
				generate,
				evaluators: [{ name: "q", evaluate }],
				signal: controller.signal,
			});

			expect(generate.mock.calls[0]?.[0].signal).toBe(controller.signal);
			expect(evaluate.mock.calls[0]?.[1].signal).toBeInstanceOf(AbortSignal);
			expect(evaluate.mock.calls[0]?.[0]).toBe("draft-1");
		});
	});
});

describe("createModelEvaluator", () => {
	function judgeModel(texts: readonly string[], prompts: string[] = [], userTexts: string[] = []) {
		let call = 0;
		return new MockLanguageModelV4({
			doGenerate: async (options) => {
				prompts.push(JSON.stringify(options.prompt));
				userTexts.push(JSON.stringify(options.prompt.filter((message) => message.role === "user")));
				const text = texts[Math.min(call, texts.length - 1)] ?? "";
				call += 1;
				return {
					content: [{ type: "text", text }],
					finishReason: { unified: "stop", raw: undefined },
					usage: {
						inputTokens: { total: 4, noCache: 4, cacheRead: 0, cacheWrite: 0 },
						outputTokens: { total: 2, text: 2, reasoning: 0 },
					},
					warnings: [],
				};
			},
		});
	}

	it("returns the model's score and feedback under the evaluator's name", async () => {
		const evaluator = createModelEvaluator({
			name: "security",
			rubric: "セキュリティの観点で採点する",
			model: createObjectModel({ score: 72, feedback: "入力の検証が足りない" }),
		});

		const verdict = (await evaluator.evaluate("code", {
			task: "t",
			signal: undefined,
		})) as EvaluatorVerdict;

		expect(evaluator.name).toBe("security");
		expect(verdict).toMatchObject({ score: 72, feedback: "入力の検証が足りない" });
	});

	it("puts the rubric, the task and the output into the prompt, the output as data", async () => {
		const prompts: string[] = [];
		const userTexts: string[] = [];
		const evaluator = createModelEvaluator({
			name: "perf",
			rubric: "RUBRIC-TEXT",
			model: judgeModel([JSON.stringify({ score: 90, feedback: "ok" })], prompts, userTexts),
		});

		const verdict = await evaluator.evaluate("OUTPUT-UNDER-REVIEW", {
			task: "THE-TASK",
			signal: undefined,
		});

		expect(prompts[0]).toContain("RUBRIC-TEXT");
		expect(prompts[0]).toContain("THE-TASK");
		expect(userTexts[0]).toContain("<output>");
		expect(userTexts[0]).toContain("評価者: perf");
		expect(userTexts[0]).toContain("OUTPUT-UNDER-REVIEW");
		expect(verdict.usage).toMatchObject({ inputTokens: 4, outputTokens: 2 });
	});

	it("regenerates when the score is not an integer from 0 to 100", async () => {
		const evaluator = createModelEvaluator({
			name: "q",
			rubric: "r",
			model: judgeModel([
				JSON.stringify({ score: 101, feedback: "x" }),
				JSON.stringify({ score: 85.5, feedback: "x" }),
				JSON.stringify({ score: 88, feedback: "x" }),
			]),
		});

		const verdict = await evaluator.evaluate("o", { task: "t", signal: undefined });

		expect(verdict.score).toBe(88);
	});

	it("fails with output-invalid when the model never returns a valid score", async () => {
		const evaluator = createModelEvaluator({
			name: "q",
			rubric: "r",
			model: createObjectModel({ score: 150, feedback: "x" }),
		});

		await expect(evaluator.evaluate("o", { task: "t", signal: undefined })).rejects.toBeInstanceOf(
			StructuredOutputError,
		);
	});

	it("requires non-empty feedback", async () => {
		const evaluator = createModelEvaluator({
			name: "q",
			rubric: "r",
			model: createObjectModel({ score: 90, feedback: "" }),
		});

		await expect(evaluator.evaluate("o", { task: "t", signal: undefined })).rejects.toBeInstanceOf(
			StructuredOutputError,
		);
	});
});
