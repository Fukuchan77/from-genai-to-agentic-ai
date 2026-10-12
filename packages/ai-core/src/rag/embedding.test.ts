import { describe, expect, it } from "vitest";
import { createDeterministicEmbeddingModel } from "../mock/deterministic-embedding";
import type { ResolvedEmbeddingModel } from "../models";
import { MODEL_DEFAULTS } from "../models";
import {
	assertKnowledgeBaseCompatible,
	embedQuery,
	embedTexts,
	KNOWLEDGE_BASE_DIMENSIONS,
} from "./embedding";

type FakeModel = ResolvedEmbeddingModel["model"];

interface RecordedCall {
	readonly values: readonly string[];
	readonly providerOptions: unknown;
	readonly aborted: boolean | undefined;
}

function recordingModel(options: { dimensions?: number; maxPerCall?: number } = {}): {
	model: FakeModel;
	calls: RecordedCall[];
} {
	const calls: RecordedCall[] = [];
	const dimensions = options.dimensions ?? KNOWLEDGE_BASE_DIMENSIONS;
	const model: FakeModel = {
		specificationVersion: "v4",
		provider: "fake",
		modelId: "fake-embedding",
		maxEmbeddingsPerCall: options.maxPerCall ?? 100,
		supportsParallelCalls: false,
		async doEmbed({ values, providerOptions, abortSignal }) {
			calls.push({ values: [...values], providerOptions, aborted: abortSignal?.aborted });
			return {
				embeddings: values.map((_, index) => Array.from({ length: dimensions }, () => index)),
				warnings: [],
			};
		},
	};
	return { model, calls };
}

function resolvedFor(
	provider: string,
	model: FakeModel,
	id = "fake-embedding",
): ResolvedEmbeddingModel {
	return {
		model,
		entry: { id, provider } as ResolvedEmbeddingModel["entry"],
		mode: "mock",
	};
}

describe("embedTexts", () => {
	it("asks OpenAI for 768 dimensions through providerOptions.openai.dimensions", async () => {
		const { model, calls } = recordingModel();

		await embedTexts({ resolved: resolvedFor("openai", model), values: ["a"] });

		expect(calls[0]?.providerOptions).toEqual({ openai: { dimensions: 768 } });
	});

	it("asks Google for 768 dimensions through providerOptions.google.outputDimensionality", async () => {
		const { model, calls } = recordingModel();

		await embedTexts({ resolved: resolvedFor("google", model), values: ["a"] });

		expect(calls[0]?.providerOptions).toEqual({ google: { outputDimensionality: 768 } });
	});

	it.each(["ollama", "mock"])("sends no provider options to %s", async (provider) => {
		const { model, calls } = recordingModel();

		await embedTexts({ resolved: resolvedFor(provider, model), values: ["a"] });

		expect(calls[0]?.providerOptions).toBeUndefined();
	});

	it("returns one 768-dimensional vector per value, in order, across several calls", async () => {
		const { model, calls } = recordingModel({ maxPerCall: 2 });

		const vectors = await embedTexts({
			resolved: resolvedFor("ollama", model),
			values: ["a", "b", "c"],
		});

		expect(calls.map((call) => call.values)).toEqual([["a", "b"], ["c"]]);
		expect(vectors).toHaveLength(3);
		expect(vectors.map((vector) => vector.length)).toEqual([768, 768, 768]);
		expect(vectors.map((vector) => vector[0])).toEqual([0, 1, 0]);
	});

	it("returns an empty list without calling the model for no values", async () => {
		const { model, calls } = recordingModel();

		const vectors = await embedTexts({ resolved: resolvedFor("ollama", model), values: [] });

		expect(vectors).toEqual([]);
		expect(calls).toHaveLength(0);
	});

	it.each([
		[767, "shorter"],
		[1536, "longer"],
	])("rejects a %i-dimensional result (%s than 768) as output-invalid", async (dimensions) => {
		const { model } = recordingModel({ dimensions });

		const failure = await embedTexts({
			resolved: resolvedFor("openai", model, MODEL_DEFAULTS.live.openai.embedding),
			values: ["a"],
		}).catch((error: unknown) => error);

		expect(failure).toMatchObject({ code: "output-invalid" });
		expect(failure).toMatchObject({
			details: { expected: 768, actual: dimensions, modelId: MODEL_DEFAULTS.live.openai.embedding },
		});
	});

	it("rejects when one vector of several has the wrong length", async () => {
		const { model } = recordingModel();
		const wrongSecond: FakeModel = {
			...model,
			async doEmbed({ values }) {
				return {
					embeddings: values.map((_, index) => new Array(index === 1 ? 10 : 768).fill(0)),
					warnings: [],
				};
			},
		};

		await expect(
			embedTexts({ resolved: resolvedFor("ollama", wrongSecond), values: ["a", "b", "c"] }),
		).rejects.toMatchObject({ code: "output-invalid", details: { actual: 10 } });
	});

	it("does not call the model when the signal is already aborted", async () => {
		const { model, calls } = recordingModel();
		const controller = new AbortController();
		controller.abort(new DOMException("stop", "AbortError"));

		await expect(
			embedTexts({
				resolved: resolvedFor("ollama", model),
				values: ["a"],
				signal: controller.signal,
			}),
		).rejects.toMatchObject({ name: "AbortError" });
		expect(calls).toHaveLength(0);
	});

	it("passes the abort signal to the model", async () => {
		const { model, calls } = recordingModel();
		const controller = new AbortController();

		await embedTexts({
			resolved: resolvedFor("ollama", model),
			values: ["a"],
			signal: controller.signal,
		});

		expect(calls[0]?.aborted).toBe(false);
	});

	it("works with the deterministic mock embedding at 768 dimensions", async () => {
		const model = createDeterministicEmbeddingModel({ dimensions: 768 });

		const [first, second] = await embedTexts({
			resolved: resolvedFor("mock", model, "mock:embedding-v1"),
			values: ["検索", "検索"],
		});

		expect(first).toHaveLength(768);
		expect(first).toEqual(second);
	});
});

describe("embedQuery", () => {
	it("embeds one value with the same provider options and dimension check", async () => {
		const { model, calls } = recordingModel();

		const vector = await embedQuery({ resolved: resolvedFor("google", model), value: "質問" });

		expect(vector).toHaveLength(768);
		expect(calls[0]?.values).toEqual(["質問"]);
		expect(calls[0]?.providerOptions).toEqual({ google: { outputDimensionality: 768 } });
	});

	it("rejects a wrong-sized query vector as output-invalid", async () => {
		const { model } = recordingModel({ dimensions: 3 });

		await expect(
			embedQuery({ resolved: resolvedFor("ollama", model), value: "質問" }),
		).rejects.toMatchObject({ code: "output-invalid" });
	});
});

describe("assertKnowledgeBaseCompatible", () => {
	const { model } = recordingModel();

	it("allows an empty knowledge base (no rag_meta row)", () => {
		expect(() =>
			assertKnowledgeBaseCompatible(undefined, resolvedFor("mock", model, "mock:embedding-v1")),
		).not.toThrow();
	});

	it("allows the same model and 768 dimensions", () => {
		expect(() =>
			assertKnowledgeBaseCompatible(
				{ embeddingModelId: "mock:embedding-v1", dimensions: 768 },
				resolvedFor("mock", model, "mock:embedding-v1"),
			),
		).not.toThrow();
	});

	it("rejects another embedding model with reason embedding-model-changed and the reset hint", () => {
		let failure: unknown;
		try {
			assertKnowledgeBaseCompatible(
				{ embeddingModelId: "mock:embedding-v1", dimensions: 768 },
				resolvedFor("ollama", model, MODEL_DEFAULTS.local.ollama.embedding),
			);
		} catch (error) {
			failure = error;
		}

		expect(failure).toMatchObject({
			code: "invalid-request",
			details: {
				reason: "embedding-model-changed",
				knowledgeBaseModelId: "mock:embedding-v1",
				currentModelId: MODEL_DEFAULTS.local.ollama.embedding,
			},
		});
		expect((failure as Error).message).toContain("reset");
	});

	it("rejects a knowledge base recorded with another dimension", () => {
		expect(() =>
			assertKnowledgeBaseCompatible(
				{ embeddingModelId: "mock:embedding-v1", dimensions: 1536 },
				resolvedFor("mock", model, "mock:embedding-v1"),
			),
		).toThrow(/次元|ナレッジベース/);
	});
});
