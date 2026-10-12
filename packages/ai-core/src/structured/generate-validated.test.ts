import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { PlatformError } from "../errors";
import { createObjectModel } from "../testing/mock-models";
import { StructuredOutputError } from "./errors";
import { generateValidated } from "./index";

const schema = z.object({ answer: z.string().min(1), score: z.number().int().min(0).max(100) });

interface ScriptedStep {
	readonly text: string;
	readonly inputTokens?: number;
	readonly outputTokens?: number;
}

/** A model that replies with the scripted texts in order and records every prompt it received. */
function scriptedModel(steps: readonly ScriptedStep[]) {
	const prompts: string[] = [];
	let index = 0;
	const model = new MockLanguageModelV4({
		doGenerate: async (options) => {
			prompts.push(JSON.stringify(options.prompt));
			const step = steps[Math.min(index, steps.length - 1)];
			index += 1;
			if (!step) throw new Error("scripted model needs at least one step");
			const input = step.inputTokens ?? 0;
			const output = step.outputTokens ?? 0;
			return {
				content: [{ type: "text", text: step.text }],
				finishReason: { unified: "stop", raw: undefined },
				usage: {
					inputTokens: { total: input, noCache: input, cacheRead: 0, cacheWrite: 0 },
					outputTokens: { total: output, text: output, reasoning: 0 },
				},
				warnings: [],
			};
		},
	});
	return { model, prompts, calls: () => index };
}

const VALID = JSON.stringify({ answer: "ok", score: 80 });
const INVALID_SCHEMA = JSON.stringify({ answer: "", score: 101 });

describe("generateValidated", () => {
	it("returns the parsed value after one attempt when the first output is valid", async () => {
		const result = await generateValidated({
			model: createObjectModel({ answer: "ok", score: 80 }),
			schema,
			prompt: "Q",
		});

		expect(result).toMatchObject({ value: { answer: "ok", score: 80 }, attempts: 1 });
	});

	it("regenerates after a schema violation and succeeds on the second attempt", async () => {
		const { model, calls } = scriptedModel([{ text: INVALID_SCHEMA }, { text: VALID }]);

		const result = await generateValidated({ model, schema, prompt: "Q" });

		expect(result.value).toEqual({ answer: "ok", score: 80 });
		expect(result.attempts).toBe(2);
		expect(calls()).toBe(2);
	});

	it("regenerates when the output is not JSON at all", async () => {
		const { model } = scriptedModel([{ text: "not json" }, { text: VALID }]);

		await expect(generateValidated({ model, schema, prompt: "Q" })).resolves.toMatchObject({
			attempts: 2,
		});
	});

	it("puts the previous attempt's problems into the regeneration prompt, not the first prompt", async () => {
		const { model, prompts } = scriptedModel([{ text: INVALID_SCHEMA }, { text: VALID }]);

		await generateValidated({ model, schema, prompt: "ORIGINAL-QUESTION", system: "SYS" });

		expect(prompts[0]).toContain("ORIGINAL-QUESTION");
		expect(prompts[0]).not.toContain("score");
		expect(prompts[1]).toContain("ORIGINAL-QUESTION");
		expect(prompts[1]).toContain("SYS");
		expect(prompts[1]).toContain("score");
		expect(prompts[1]).toContain("answer");
	});

	it("throws StructuredOutputError after the third invalid attempt, listing every attempt's problems", async () => {
		const { model, calls } = scriptedModel([
			{ text: INVALID_SCHEMA },
			{ text: INVALID_SCHEMA },
			{ text: "not json" },
			{ text: VALID },
		]);

		const error = await generateValidated({ model, schema, prompt: "Q" }).catch(
			(thrown: unknown) => thrown,
		);

		expect(error).toBeInstanceOf(StructuredOutputError);
		expect(error).toBeInstanceOf(PlatformError);
		expect(error).toMatchObject({ code: "output-invalid", attempts: 3 });
		const { issuesByAttempt } = error as StructuredOutputError;
		expect(issuesByAttempt).toHaveLength(3);
		expect(issuesByAttempt[0]?.join("\n")).toContain("score");
		expect(issuesByAttempt[2]?.join("\n")).toContain("JSON");
		expect(calls()).toBe(3);
	});

	it("never puts the generated text into the error", async () => {
		const secretish = JSON.stringify({ answer: "", score: 101, leak: "PRIVATE-TEXT-123" });
		const { model } = scriptedModel([{ text: secretish }]);

		const error = (await generateValidated({ model, schema, prompt: "Q" }).catch(
			(thrown: unknown) => thrown,
		)) as StructuredOutputError;

		expect(JSON.stringify([error.message, error.details, error.issuesByAttempt])).not.toContain(
			"PRIVATE-TEXT-123",
		);
	});

	it("does not echo model-generated key names from a strict schema into the error", async () => {
		const strict = z.strictObject({ answer: z.string() });
		const { model } = scriptedModel([
			{ text: JSON.stringify({ answer: "ok", "PRIVATE-KEY-NAME": 1 }) },
		]);

		const error = (await generateValidated({ model, schema: strict, prompt: "Q" }).catch(
			(thrown: unknown) => thrown,
		)) as StructuredOutputError;

		expect(error).toBeInstanceOf(StructuredOutputError);
		expect(error.issues.length).toBeGreaterThan(0);
		expect(JSON.stringify([error.message, error.details])).not.toContain("PRIVATE-KEY-NAME");
	});

	it("treats a failed extra validation like a schema violation and reports its problems", async () => {
		const { model, prompts } = scriptedModel([
			{ text: JSON.stringify({ answer: "short", score: 10 }) },
			{ text: JSON.stringify({ answer: "long enough", score: 10 }) },
		]);

		const result = await generateValidated({
			model,
			schema,
			prompt: "Q",
			validate: (value) => (value.answer.length < 8 ? ["answer: 8 文字以上にしてください"] : []),
		});

		expect(result.attempts).toBe(2);
		expect(result.value.answer).toBe("long enough");
		expect(prompts[1]).toContain("8 文字以上にしてください");
	});

	it("fails with the extra validation's problems when it never passes", async () => {
		const { model } = scriptedModel([{ text: VALID }]);

		const error = (await generateValidated({
			model,
			schema,
			prompt: "Q",
			validate: () => ["always: 不合格"],
		}).catch((thrown: unknown) => thrown)) as StructuredOutputError;

		expect(error).toBeInstanceOf(StructuredOutputError);
		expect(error.attempts).toBe(3);
		expect(error.issues).toEqual(["always: 不合格"]);
	});

	it("does not regenerate when maxRegenerations is 0", async () => {
		const { model, calls } = scriptedModel([{ text: INVALID_SCHEMA }, { text: VALID }]);

		const error = await generateValidated({
			model,
			schema,
			prompt: "Q",
			maxRegenerations: 0,
		}).catch((thrown: unknown) => thrown);

		expect(error).toMatchObject({ code: "output-invalid", attempts: 1 });
		expect(calls()).toBe(1);
	});

	it("honors a larger maxRegenerations", async () => {
		const { model, calls } = scriptedModel([
			{ text: INVALID_SCHEMA },
			{ text: INVALID_SCHEMA },
			{ text: INVALID_SCHEMA },
			{ text: VALID },
		]);

		const result = await generateValidated({ model, schema, prompt: "Q", maxRegenerations: 3 });

		expect(result.attempts).toBe(4);
		expect(calls()).toBe(4);
	});

	it.each([-1, 1.5, Number.NaN])(
		"rejects maxRegenerations=%s as invalid-request",
		async (value) => {
			const { model, calls } = scriptedModel([{ text: VALID }]);

			await expect(
				generateValidated({ model, schema, prompt: "Q", maxRegenerations: value }),
			).rejects.toMatchObject({ code: "invalid-request" });
			expect(calls()).toBe(0);
		},
	);

	it("sums usage over every attempt", async () => {
		const { model } = scriptedModel([
			{ text: INVALID_SCHEMA, inputTokens: 100, outputTokens: 10 },
			{ text: INVALID_SCHEMA, inputTokens: 120, outputTokens: 12 },
			{ text: VALID, inputTokens: 140, outputTokens: 14 },
		]);

		const result = await generateValidated({ model, schema, prompt: "Q" });

		expect(result.usage).toMatchObject({
			inputTokens: 360,
			outputTokens: 36,
			totalTokens: 396,
		});
	});

	it("keeps the summed usage on the error when every attempt fails", async () => {
		const { model } = scriptedModel([{ text: INVALID_SCHEMA, inputTokens: 50, outputTokens: 5 }]);

		const error = (await generateValidated({ model, schema, prompt: "Q" }).catch(
			(thrown: unknown) => thrown,
		)) as StructuredOutputError;

		expect(error.usage).toMatchObject({ inputTokens: 150, outputTokens: 15, totalTokens: 165 });
	});

	it("does not start another attempt after the signal aborts, and throws the signal's reason", async () => {
		const controller = new AbortController();
		const { model, calls } = scriptedModel([{ text: INVALID_SCHEMA }, { text: VALID }]);
		const aborting = new MockLanguageModelV4({
			doGenerate: async (options) => {
				const result = await model.doGenerate(options);
				controller.abort(new DOMException("Stopped", "AbortError"));
				return result;
			},
		});

		const error = await generateValidated({
			model: aborting,
			schema,
			prompt: "Q",
			abortSignal: controller.signal,
		}).catch((thrown: unknown) => thrown);

		expect(error).toMatchObject({ name: "AbortError" });
		expect(error).not.toBeInstanceOf(StructuredOutputError);
		expect(calls()).toBe(1);
	});

	it("rethrows provider errors unchanged and does not retry them", async () => {
		const failure = new Error("provider down");
		let calls = 0;
		const model = new MockLanguageModelV4({
			doGenerate: async () => {
				calls += 1;
				throw failure;
			},
		});

		await expect(generateValidated({ model, schema, prompt: "Q" })).rejects.toBe(failure);
		expect(calls).toBe(1);
	});

	it("passes provider options through to the model", async () => {
		let received: unknown;
		const inner = scriptedModel([{ text: VALID }]).model;
		const model = new MockLanguageModelV4({
			doGenerate: async (options) => {
				received = options.providerOptions;
				return inner.doGenerate(options);
			},
		});

		await generateValidated({
			model,
			schema,
			prompt: "Q",
			providerOptions: { ollama: { options: { num_ctx: 4096 } } },
		});

		expect(received).toEqual({ ollama: { options: { num_ctx: 4096 } } });
	});
});
