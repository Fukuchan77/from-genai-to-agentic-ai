import { createHash } from "node:crypto";
import type { EmbeddingModel } from "ai";

type EmbeddingModelV4 = Extract<EmbeddingModel, { readonly specificationVersion: "v4" }>;

const UINT32_RANGE = 0x1_0000_0000;

function rotateLeft(value: number, shift: number): number {
	return ((value << shift) | (value >>> (32 - shift))) >>> 0;
}

function createPrng(seed: Buffer): () => number {
	const state: [number, number, number, number] = [
		seed.readUInt32LE(0),
		seed.readUInt32LE(4),
		seed.readUInt32LE(8),
		seed.readUInt32LE(12),
	];

	return () => {
		const result = Math.imul(rotateLeft(Math.imul(state[1], 5), 7), 9) >>> 0;
		const temporary = (state[1] << 9) >>> 0;

		state[2] = (state[2] ^ state[0]) >>> 0;
		state[3] = (state[3] ^ state[1]) >>> 0;
		state[1] = (state[1] ^ state[2]) >>> 0;
		state[0] = (state[0] ^ state[3]) >>> 0;
		state[2] = (state[2] ^ temporary) >>> 0;
		state[3] = rotateLeft(state[3], 11);

		return result;
	};
}

function embed(value: string, dimensions: number): number[] {
	const seed = createHash("sha256").update(value, "utf8").digest();
	const next = createPrng(seed);
	const vector = Array.from({ length: dimensions }, () => (next() + 0.5) / (UINT32_RANGE / 2) - 1);
	const norm = Math.sqrt(vector.reduce((sum, component) => sum + component * component, 0));

	return vector.map((component) => component / norm);
}

export function createDeterministicEmbeddingModel(options: {
	dimensions: number;
}): EmbeddingModelV4 {
	if (!Number.isInteger(options.dimensions) || options.dimensions <= 0) {
		throw new RangeError("dimensions must be a positive integer");
	}

	return {
		specificationVersion: "v4",
		provider: "mock",
		modelId: "deterministic",
		maxEmbeddingsPerCall: Number.POSITIVE_INFINITY,
		supportsParallelCalls: true,
		async doEmbed({ values }) {
			return {
				embeddings: values.map((value) => embed(value, options.dimensions)),
				warnings: [],
			};
		},
	};
}
