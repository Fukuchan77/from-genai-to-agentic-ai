import { embed, embedMany } from "ai";
import { PlatformError } from "../errors";
import type { ResolvedEmbeddingModel } from "../models";
import { EMBEDDING_DIMENSIONS } from "./db/schema";

/** Every knowledge-base vector has this many dimensions (ADR-4). */
export const KNOWLEDGE_BASE_DIMENSIONS = EMBEDDING_DIMENSIONS;

/** The embedding model and dimensions a knowledge base was created with (`rag_meta`). */
export interface KnowledgeBaseMeta {
	readonly embeddingModelId: string;
	readonly dimensions: number;
}

type EmbeddingTarget = Pick<ResolvedEmbeddingModel, "model" | "entry">;
type EmbeddingProviderOptions = NonNullable<Parameters<typeof embedMany>[0]["providerOptions"]>;

// OpenAI and Google embed at their own default sizes; both can shorten the vector. Local and
// mock models already produce 768 dimensions, and any other size is caught by the length check.
function providerOptionsFor(provider: string): EmbeddingProviderOptions | undefined {
	switch (provider) {
		case "openai":
			return { openai: { dimensions: KNOWLEDGE_BASE_DIMENSIONS } };
		case "google":
			return { google: { outputDimensionality: KNOWLEDGE_BASE_DIMENSIONS } };
		default:
			return undefined;
	}
}

function assertDimensions(vectors: readonly (readonly number[])[], target: EmbeddingTarget): void {
	for (const vector of vectors) {
		if (vector.length !== KNOWLEDGE_BASE_DIMENSIONS) {
			throw new PlatformError(
				"output-invalid",
				`埋め込みの次元が ${KNOWLEDGE_BASE_DIMENSIONS} ではありません（${vector.length}）。ナレッジベースは変更していません。`,
				{
					expected: KNOWLEDGE_BASE_DIMENSIONS,
					actual: vector.length,
					modelId: target.entry.id,
				},
			);
		}
	}
}

export async function embedTexts(params: {
	readonly resolved: EmbeddingTarget;
	readonly values: readonly string[];
	readonly signal?: AbortSignal;
}): Promise<number[][]> {
	params.signal?.throwIfAborted();
	const providerOptions = providerOptionsFor(params.resolved.entry.provider);
	const { embeddings } = await embedMany({
		model: params.resolved.model,
		values: [...params.values],
		...(params.signal ? { abortSignal: params.signal } : {}),
		...(providerOptions ? { providerOptions } : {}),
	});
	assertDimensions(embeddings, params.resolved);
	return embeddings;
}

export async function embedQuery(params: {
	readonly resolved: EmbeddingTarget;
	readonly value: string;
	readonly signal?: AbortSignal;
}): Promise<number[]> {
	params.signal?.throwIfAborted();
	const providerOptions = providerOptionsFor(params.resolved.entry.provider);
	const { embedding } = await embed({
		model: params.resolved.model,
		value: params.value,
		...(params.signal ? { abortSignal: params.signal } : {}),
		...(providerOptions ? { providerOptions } : {}),
	});
	assertDimensions([embedding], params.resolved);
	return embedding;
}

/** Rejects ingest and search with another embedding model than the one that built the base. */
export function assertKnowledgeBaseCompatible(
	meta: KnowledgeBaseMeta | undefined,
	resolved: { readonly entry: { readonly id: string } },
): void {
	if (!meta) return;
	if (
		meta.embeddingModelId === resolved.entry.id &&
		meta.dimensions === KNOWLEDGE_BASE_DIMENSIONS
	) {
		return;
	}
	throw new PlatformError(
		"invalid-request",
		`ナレッジベースは埋め込みモデル ${meta.embeddingModelId}（${meta.dimensions} 次元）で作成されています。現在のモデル ${resolved.entry.id} では使えません。reset: true で取り込み直すと、ナレッジベースを作り直せます。`,
		{
			reason: "embedding-model-changed",
			knowledgeBaseModelId: meta.embeddingModelId,
			currentModelId: resolved.entry.id,
		},
	);
}
