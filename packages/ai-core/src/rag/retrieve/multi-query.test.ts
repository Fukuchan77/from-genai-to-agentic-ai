import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { DEFAULT_RAG } from "../../config/defaults";
import { PlatformError } from "../../errors";
import { StructuredOutputError } from "../../structured";
import { expandQuery } from "./multi-query";

const QUESTION = "How does the nightly index rebuild affect search latency?";

interface ScriptedStep {
	readonly queries: readonly string[] | string;
	readonly inputTokens?: number;
	readonly outputTokens?: number;
}

/** A model that replies with the scripted sub-query lists in order and records every prompt. */
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
			const text =
				typeof step.queries === "string" ? step.queries : JSON.stringify({ queries: step.queries });
			return {
				content: [{ type: "text", text }],
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

const THREE = ["rebuild schedule", "latency during indexing", "index size growth"];

describe("expandQuery", () => {
	it("returns the configured number of sub-queries when the first output is valid", async () => {
		const { model, calls } = scriptedModel([{ queries: THREE }]);

		const result = await expandQuery({ model, question: QUESTION });

		expect(DEFAULT_RAG.subQueryCount).toBe(3);
		expect(result.subQueries).toEqual(THREE);
		expect(result.attempts).toBe(1);
		expect(calls()).toBe(1);
	});

	it("puts the question and the requested count into the prompt", async () => {
		const { model, prompts } = scriptedModel([{ queries: THREE }]);

		await expandQuery({ model, question: QUESTION });

		expect(prompts[0]).toContain(QUESTION);
		expect(prompts[0]).toContain(String(DEFAULT_RAG.subQueryCount));
	});

	it("asks for another number of sub-queries when count is given", async () => {
		const { model, prompts } = scriptedModel([{ queries: ["one", "two"] }]);

		const result = await expandQuery({ model, question: QUESTION, count: 2 });

		expect(result.subQueries).toEqual(["one", "two"]);
		expect(prompts[0]).toContain("2 different search queries");
		expect(prompts[0]).toContain("exactly 2 queries");
		expect(prompts[0]).not.toContain("3");
	});

	it("trims the sub-queries", async () => {
		const { model } = scriptedModel([{ queries: ["  a  ", "b\n", "\tc"] }]);

		const result = await expandQuery({ model, question: QUESTION });

		expect(result.subQueries).toEqual(["a", "b", "c"]);
	});

	it("regenerates when two sub-queries are the same, and says so in the retry prompt", async () => {
		const { model, prompts, calls } = scriptedModel([
			{ queries: ["alpha", "beta", "alpha"] },
			{ queries: THREE },
		]);

		const result = await expandQuery({ model, question: QUESTION });

		expect(result.subQueries).toEqual(THREE);
		expect(result.attempts).toBe(2);
		expect(calls()).toBe(2);
		expect(prompts[0]).not.toContain("重複");
		expect(prompts[1]).toContain("重複");
	});

	it("treats sub-queries that differ only in case, spacing or width as duplicates", async () => {
		const { model, calls } = scriptedModel([
			{ queries: ["Index  Rebuild", "index rebuild", "other"] },
			{ queries: ["ＲＡＧ", "rag ", "x"] },
			{ queries: THREE },
		]);

		const result = await expandQuery({ model, question: QUESTION });

		expect(result.attempts).toBe(3);
		expect(calls()).toBe(3);
	});

	it.each([
		["too few", ["a", "b"]],
		["too many", ["a", "b", "c", "d"]],
		["none", []],
	])("regenerates when the output has %s sub-queries", async (_name, queries) => {
		const { model, prompts } = scriptedModel([{ queries }, { queries: THREE }]);

		const result = await expandQuery({ model, question: QUESTION });

		expect(result.attempts).toBe(2);
		expect(result.subQueries).toEqual(THREE);
		expect(prompts[1]).toContain(String(queries.length));
	});

	it("regenerates when a sub-query is blank", async () => {
		const { model } = scriptedModel([{ queries: ["a", "  ", "c"] }, { queries: THREE }]);

		const result = await expandQuery({ model, question: QUESTION });

		expect(result.attempts).toBe(2);
	});

	it("regenerates when the output does not match the schema", async () => {
		const { model } = scriptedModel([{ queries: '{"queries": "a, b, c"}' }, { queries: THREE }]);

		const result = await expandQuery({ model, question: QUESTION });

		expect(result.attempts).toBe(2);
	});

	it("throws StructuredOutputError (output-invalid) after three invalid attempts", async () => {
		const { model, calls } = scriptedModel([{ queries: ["same", "same", "same"] }]);

		const error = await expandQuery({ model, question: QUESTION }).catch(
			(thrown: unknown) => thrown,
		);

		expect(error).toBeInstanceOf(StructuredOutputError);
		expect(error).toBeInstanceOf(PlatformError);
		expect(error).toMatchObject({ code: "output-invalid", attempts: 3 });
		expect(calls()).toBe(3);
	});

	it("does not copy the generated sub-queries into the error", async () => {
		const { model } = scriptedModel([{ queries: ["SECRET-QUERY", "SECRET-QUERY", "other"] }]);

		const error = (await expandQuery({ model, question: QUESTION }).catch(
			(thrown: unknown) => thrown,
		)) as StructuredOutputError;

		expect(JSON.stringify(error.issuesByAttempt)).not.toContain("SECRET-QUERY");
	});

	it("sums the token usage over every attempt", async () => {
		const { model } = scriptedModel([
			{ queries: ["a", "a", "b"], inputTokens: 20, outputTokens: 4 },
			{ queries: THREE, inputTokens: 30, outputTokens: 6 },
		]);

		const result = await expandQuery({ model, question: QUESTION });

		expect(result.usage).toMatchObject({ inputTokens: 50, outputTokens: 10, totalTokens: 60 });
	});

	it("throws the signal's reason without calling the model when it is already aborted", async () => {
		const { model, calls } = scriptedModel([{ queries: THREE }]);
		const reason = new DOMException("Stopped", "AbortError");

		await expect(
			expandQuery({ model, question: QUESTION, abortSignal: AbortSignal.abort(reason) }),
		).rejects.toBe(reason);
		expect(calls()).toBe(0);
	});

	it("does not start another attempt after the signal aborts", async () => {
		const controller = new AbortController();
		const { model, calls } = scriptedModel([{ queries: ["a", "a", "b"] }, { queries: THREE }]);
		const aborting = new MockLanguageModelV4({
			doGenerate: async (options) => {
				const result = await model.doGenerate(options);
				controller.abort(new DOMException("Stopped", "AbortError"));
				return result;
			},
		});

		const error = await expandQuery({
			model: aborting,
			question: QUESTION,
			abortSignal: controller.signal,
		}).catch((thrown: unknown) => thrown);

		expect(error).toMatchObject({ name: "AbortError" });
		expect(error).not.toBeInstanceOf(StructuredOutputError);
		expect(calls()).toBe(1);
	});

	it("rejects a blank question before calling the model", async () => {
		const { model, calls } = scriptedModel([{ queries: THREE }]);

		const error = await expandQuery({ model, question: " " }).catch((thrown: unknown) => thrown);

		expect(error).toMatchObject({ code: "invalid-request" });
		expect(calls()).toBe(0);
	});

	it.each([0, -1, 2.5, Number.NaN])("rejects count = %s", async (count) => {
		const { model, calls } = scriptedModel([{ queries: THREE }]);

		const error = await expandQuery({ model, question: QUESTION, count }).catch(
			(thrown: unknown) => thrown,
		);

		expect(error).toMatchObject({ code: "invalid-request" });
		expect(calls()).toBe(0);
	});
});
