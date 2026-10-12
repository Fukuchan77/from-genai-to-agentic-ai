import { DEFAULT_INPUT_LIMITS } from "@platform/ai-core/config";
import {
	createKnowledgeStore,
	type QueryRequest,
	queryRequestSchema,
	streamRagQuery,
} from "@platform/ai-core/rag";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { toErrorResponse } from "@/lib/server/errors";
import { type GuardPolicy, guardRequest } from "@/lib/server/guard";
import { getKnowledgeBase, getPlatform, resolveKnowledgeEmbedding } from "@/lib/server/platform";
import { toRagStreamError, writeRagEvents } from "@/lib/server/rag-stream";

// POST /api/rag/query (plan C13, Req 1.4, 1.5, 1.7, 2.6, 2.8, 2.11): guard -> resolve the models
// -> open the knowledge base -> stream the stage, trace, answer and result parts. Every rejection
// that does not need the stream happens before any model call.

export const dynamic = "force-dynamic";

const QUERY_POLICY: GuardPolicy<QueryRequest> = {
	schema: queryRequestSchema,
	limits: DEFAULT_INPUT_LIMITS,
	// The question length, the filters and the method switches are part of the schema.
	inspect: () => undefined,
};

export async function POST(request: Request): Promise<Response> {
	try {
		const platform = await getPlatform();
		const guarded = await guardRequest(request, QUERY_POLICY, {
			limiter: platform.limiter,
			mode: platform.mode,
		});
		if (!guarded.ok) return guarded.response;
		const { body } = guarded;
		const { methods } = body.settings;

		const chat = await platform.gateway.resolve({
			purpose: "chat",
			...(body.modelId ? { modelId: body.modelId } : {}),
		});
		// HyDE and Multi-Query both need structured output: refuse before any model call (Req 2.1, 2.2).
		const structured =
			methods.hyde || methods.multiQuery
				? await platform.gateway.resolve({
						purpose: "structured",
						...(body.modelId ? { modelId: body.modelId } : {}),
						require: ["structuredOutput"],
					})
				: chat;
		const embedding = await resolveKnowledgeEmbedding(platform);
		const { db } = await getKnowledgeBase();

		const deps = {
			store: createKnowledgeStore(db, { clock: platform.clock }),
			embedding,
			structuredModel: structured.model,
			chatModel: chat.model,
			rerank: platform.ports.rerank,
			clock: platform.clock,
		};
		const stream = createUIMessageStream({
			execute: async ({ writer }) => {
				await writeRagEvents(streamRagQuery(deps, body, request.signal), writer);
			},
			onError: toRagStreamError,
		});
		return createUIMessageStreamResponse({ stream });
	} catch (error) {
		return toErrorResponse(error);
	}
}
