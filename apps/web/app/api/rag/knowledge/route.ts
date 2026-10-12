import { ModelSelectionError } from "@platform/ai-core/models";
import {
	createKnowledgeStore,
	KNOWLEDGE_BASE_DIMENSIONS,
	listIngestableFiles,
} from "@platform/ai-core/rag";
import { toErrorResponse } from "@/lib/server/errors";
import { getKnowledgeBase, getPlatform, type Platform } from "@/lib/server/platform";

// GET /api/rag/knowledge (plan C13, Req 1.1, 2.12): the state of the knowledge base, the
// embedding model, the files that can be ingested, and whether the Rerank stage can run. It calls
// no LLM, so there is no body to guard and no rate limit; the only failures are an unreachable
// Postgres or Ollama (503).

export const dynamic = "force-dynamic";

interface RerankAvailability {
	available: boolean;
	reason?: "api-key-missing";
}

// `mock` always has the lexical stand-in; `local` and `live` need a Cohere key (Req 2.6).
function rerankAvailability(platform: Platform): RerankAvailability {
	if (platform.mode === "mock" || platform.config.credentials.cohere) return { available: true };
	return { available: false, reason: "api-key-missing" };
}

/** `null` when the provider has no embedding model (e.g. the `live` Anthropic default). */
async function embeddingInfo(platform: Platform) {
	try {
		const { entry } = await platform.gateway.resolveEmbedding();
		return { modelId: entry.id, dimensions: KNOWLEDGE_BASE_DIMENSIONS };
	} catch (error) {
		if (error instanceof ModelSelectionError && error.reason === "no-default") return null;
		throw error;
	}
}

export async function GET(): Promise<Response> {
	try {
		const platform = await getPlatform();
		const embedding = await embeddingInfo(platform);
		const { db } = await getKnowledgeBase();
		const store = createKnowledgeStore(db, { clock: platform.clock });
		const [meta, documents, knowledge, evalCorpus] = await Promise.all([
			store.getMeta(),
			store.listDocuments(),
			listIngestableFiles(platform.knowledgeRoots.knowledge),
			listIngestableFiles(platform.knowledgeRoots.evalCorpus),
		]);
		return Response.json({
			embedding,
			knowledgeBase: { embeddingModelId: meta?.embeddingModelId ?? null, documents },
			available: { knowledge, evalCorpus },
			rerank: rerankAvailability(platform),
		});
	} catch (error) {
		return toErrorResponse(error);
	}
}
