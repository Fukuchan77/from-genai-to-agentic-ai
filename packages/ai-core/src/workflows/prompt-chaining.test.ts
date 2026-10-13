import { describe, expect, it, vi } from "vitest";
import { type ChainStep, runPromptChain } from "./prompt-chaining";

function step(name: string, run: ChainStep["run"], validate?: ChainStep["validate"]): ChainStep {
	return validate ? { name, run, validate } : { name, run };
}

describe("runPromptChain", () => {
	it("runs every step and passes each output to the next step", async () => {
		const outline = vi.fn(async (input: unknown) => `outline(${String(input)})`);
		const body = vi.fn(async (input: unknown) => `body(${String(input)})`);

		const result = await runPromptChain({
			input: "topic",
			steps: [step("outline", outline), step("body", body)],
		});

		expect(outline).toHaveBeenCalledWith("topic", undefined);
		expect(body).toHaveBeenCalledWith("outline(topic)", undefined);
		expect(result).toEqual({
			status: "completed",
			output: "body(outline(topic))",
			steps: [
				{ name: "outline", output: "outline(topic)", errors: [] },
				{ name: "body", output: "body(outline(topic))", errors: [] },
			],
		});
	});

	it("does not run later steps when a validation fails, and reports the failed step and errors", async () => {
		const later = vi.fn(async () => "never");

		const result = await runPromptChain({
			input: "topic",
			steps: [
				step(
					"outline",
					async () => "short",
					(output) => (String(output).length < 10 ? ["見出しが少なすぎます。"] : []),
				),
				step("body", later),
			],
		});

		expect(later).not.toHaveBeenCalled();
		expect(result).toEqual({
			status: "failed",
			failedStep: "outline",
			errors: ["見出しが少なすぎます。"],
			steps: [{ name: "outline", output: "short", errors: ["見出しが少なすぎます。"] }],
		});
	});

	it("reports the first failing step when a later step would also fail", async () => {
		const result = await runPromptChain({
			input: 1,
			steps: [
				step(
					"a",
					async () => "a",
					() => ["a-problem"],
				),
				step(
					"b",
					async () => "b",
					() => ["b-problem"],
				),
			],
		});

		expect(result).toMatchObject({ status: "failed", failedStep: "a", errors: ["a-problem"] });
	});

	it("validates only the step's own output, with the failing middle step reported by name", async () => {
		const validateFirst = vi.fn(() => [] as string[]);

		const result = await runPromptChain({
			input: 1,
			steps: [
				step("first", async () => "x", validateFirst),
				step(
					"second",
					async () => "y",
					() => ["bad"],
				),
				step("third", async () => "z"),
			],
		});

		expect(validateFirst).toHaveBeenCalledWith("x");
		expect(result).toMatchObject({ status: "failed", failedStep: "second" });
		expect(result.steps).toHaveLength(2);
	});

	it("runs a step without a validate function as always valid", async () => {
		const result = await runPromptChain({ input: 1, steps: [step("only", async () => 42)] });

		expect(result).toEqual({
			status: "completed",
			output: 42,
			steps: [{ name: "only", output: 42, errors: [] }],
		});
	});

	it("completes with the input as the output when there are no steps", async () => {
		const result = await runPromptChain({ input: "same", steps: [] });

		expect(result).toEqual({ status: "completed", output: "same", steps: [] });
	});

	it("passes the signal to each step", async () => {
		const controller = new AbortController();
		const run = vi.fn(async () => "ok");

		await runPromptChain({ input: 1, steps: [step("s", run)], signal: controller.signal });

		expect(run).toHaveBeenCalledWith(1, controller.signal);
	});

	it("does not start the next step after an abort and rethrows the abort reason", async () => {
		const controller = new AbortController();
		const second = vi.fn(async () => "never");
		const reason = new Error("stopped by user");

		const result = runPromptChain({
			input: 1,
			signal: controller.signal,
			steps: [
				step("first", async () => {
					controller.abort(reason);
					return "x";
				}),
				step("second", second),
			],
		});

		await expect(result).rejects.toBe(reason);
		expect(second).not.toHaveBeenCalled();
	});

	it("lets an error thrown by a step propagate unchanged", async () => {
		const failure = new Error("provider down");

		await expect(
			runPromptChain({
				input: 1,
				steps: [
					step("a", async () => {
						throw failure;
					}),
				],
			}),
		).rejects.toBe(failure);
	});
});
