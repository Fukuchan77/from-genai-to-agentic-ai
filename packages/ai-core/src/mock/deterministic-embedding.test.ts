import { describe, expect, it } from "vitest";
import { createDeterministicEmbeddingModel } from "./deterministic-embedding";

async function embeddingsFor(values: string[], dimensions = 8): Promise<number[][]> {
	const model = createDeterministicEmbeddingModel({ dimensions });
	const result = await model.doEmbed({ values });
	return result.embeddings;
}

function l2Norm(vector: readonly number[]): number {
	return Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
}

describe("createDeterministicEmbeddingModel", () => {
	it("returns the same embeddings for the same inputs", async () => {
		const values = ["alpha", "beta", "alpha"];

		const first = await embeddingsFor(values);
		const second = await embeddingsFor(values);

		expect(first).toEqual(second);
		expect(first[0]).toEqual(first[2]);
		expect(first[0]).not.toEqual(first[1]);
	});

	it.each([1, 7, 32])("returns exactly %i dimensions", async (dimensions) => {
		const embeddings = await embeddingsFor(["dimension check", "second value"], dimensions);

		expect(embeddings).toHaveLength(2);
		for (const embedding of embeddings) {
			expect(embedding).toHaveLength(dimensions);
		}
	});

	it("L2-normalizes every embedding", async () => {
		const embeddings = await embeddingsFor(["normalization", "another input"], 64);

		for (const embedding of embeddings) {
			expect(l2Norm(embedding)).toBeCloseTo(1, 12);
		}
	});
});
