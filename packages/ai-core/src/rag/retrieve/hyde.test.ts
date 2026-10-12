import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { PlatformError } from "../../errors";
import { createTextStreamModel } from "../../testing/mock-models";
import { generateHypotheticalAnswer } from "./hyde";

const QUESTION = "How does the nightly index rebuild affect search latency?";

/** A model that replies with `text` and counts tokens, so usage can be checked. */
function usageModel(text: string, inputTokens: number, outputTokens: number) {
	return new MockLanguageModelV4({
		doGenerate: {
			content: [{ type: "text", text }],
			finishReason: { unified: "stop", raw: undefined },
			usage: {
				inputTokens: { total: inputTokens, noCache: inputTokens, cacheRead: 0, cacheWrite: 0 },
				outputTokens: { total: outputTokens, text: outputTokens, reasoning: 0 },
			},
			warnings: [],
		},
	});
}

describe("generateHypotheticalAnswer", () => {
	it("returns the model's text as the hypothetical answer", async () => {
		const model = createTextStreamModel("The rebuild adds about 40 ms of latency.");

		const result = await generateHypotheticalAnswer({ model, question: QUESTION });

		expect(result.text).toBe("The rebuild adds about 40 ms of latency.");
	});

	it("puts the question into the prompt the model receives", async () => {
		const model = createTextStreamModel("An answer.");

		await generateHypotheticalAnswer({ model, question: QUESTION });

		expect(model.doGenerateCalls).toHaveLength(1);
		expect(JSON.stringify(model.doGenerateCalls[0]?.prompt)).toContain(QUESTION);
	});

	it("tells the model to write a passage that answers the question, not to refuse or ask back", async () => {
		const model = createTextStreamModel("An answer.");

		await generateHypotheticalAnswer({ model, question: QUESTION });

		const prompt = JSON.stringify(model.doGenerateCalls[0]?.prompt);
		expect(prompt).toMatch(/hypothetical/i);
		expect(prompt).toMatch(/same language/i);
	});

	it("limits the length of the generated passage", async () => {
		const model = createTextStreamModel("An answer.");

		await generateHypotheticalAnswer({ model, question: QUESTION });

		expect(model.doGenerateCalls[0]?.maxOutputTokens).toBeGreaterThan(0);
	});

	it("trims surrounding whitespace", async () => {
		const model = createTextStreamModel("\n  An answer.  \n");

		const result = await generateHypotheticalAnswer({ model, question: QUESTION });

		expect(result.text).toBe("An answer.");
	});

	it("reports the token usage of the call", async () => {
		const result = await generateHypotheticalAnswer({
			model: usageModel("An answer.", 30, 12),
			question: QUESTION,
		});

		expect(result.usage).toEqual({
			inputTokens: 30,
			outputTokens: 12,
			totalTokens: 42,
			cacheReadTokens: 0,
		});
	});

	it("fails with output-invalid when the model returns no text", async () => {
		const error = await generateHypotheticalAnswer({
			model: createTextStreamModel("  \n "),
			question: QUESTION,
		}).catch((thrown: unknown) => thrown);

		expect(error).toBeInstanceOf(PlatformError);
		expect(error).toMatchObject({ code: "output-invalid" });
	});

	it("rejects a blank question before calling the model", async () => {
		const model = createTextStreamModel("An answer.");

		const error = await generateHypotheticalAnswer({ model, question: "  " }).catch(
			(thrown: unknown) => thrown,
		);

		expect(error).toMatchObject({ code: "invalid-request" });
		expect(model.doGenerateCalls).toHaveLength(0);
	});

	it("throws the signal's reason without calling the model when it is already aborted", async () => {
		const model = createTextStreamModel("An answer.");
		const reason = new DOMException("Stopped", "AbortError");

		await expect(
			generateHypotheticalAnswer({
				model,
				question: QUESTION,
				abortSignal: AbortSignal.abort(reason),
			}),
		).rejects.toBe(reason);
		expect(model.doGenerateCalls).toHaveLength(0);
	});

	it("passes the abort signal on to the model call", async () => {
		const model = createTextStreamModel("An answer.");
		const controller = new AbortController();

		await generateHypotheticalAnswer({ model, question: QUESTION, abortSignal: controller.signal });

		expect(model.doGenerateCalls[0]?.abortSignal).toBeDefined();
	});

	it("rethrows a provider error unchanged", async () => {
		const failure = new Error("provider down");
		const model = new MockLanguageModelV4({
			doGenerate: async () => {
				throw failure;
			},
		});

		await expect(generateHypotheticalAnswer({ model, question: QUESTION })).rejects.toBe(failure);
	});
});
