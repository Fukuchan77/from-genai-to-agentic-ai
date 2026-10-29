import { DEFAULT_INPUT_LIMITS } from "@platform/ai-core/config";
import {
	type HelpdeskRequest,
	helpdeskRequestSchema,
	runHelpdesk,
} from "@platform/ai-core/helpdesk";
import { createKnowledgeSearcher, createKnowledgeStore } from "@platform/ai-core/rag";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { createHelpdeskStreamer } from "@/lib/server/domain-stream";
import { toErrorResponse, toStreamErrorText } from "@/lib/server/errors";
import { type GuardPolicy, guardRequest } from "@/lib/server/guard";
import {
	getHelpdeskStore,
	getKnowledgeBase,
	getPlatform,
	resolveKnowledgeEmbedding,
} from "@/lib/server/platform";

// POST /api/helpdesk (plan C13, Req 2.1-2.8, 2.10): guard -> resolve the model (tools and structured
// output) -> open the database -> stream the plan, progress and result parts while `runHelpdesk`
// plans, runs the tasks and decides. Every rejection that needs no stream happens before any model
// call; the model, the database and the embedding are all checked first.

export const dynamic = "force-dynamic";

const POLICY: GuardPolicy<HelpdeskRequest> = {
	schema: helpdeskRequestSchema,
	limits: DEFAULT_INPUT_LIMITS,
	// The inquiry length and the step limit are part of the schema.
	inspect: () => undefined,
};

export async function POST(request: Request): Promise<Response> {
	try {
		const platform = await getPlatform();
		const guarded = await guardRequest(request, POLICY, {
			limiter: platform.limiter,
			mode: platform.mode,
		});
		if (!guarded.ok) return guarded.response;
		const { body } = guarded;

		// Planning and deciding need structured output, the tasks need tools: refuse a model that has
		// neither before any LLM call (Req 2.1).
		const { model } = await platform.gateway.resolve({
			purpose: "chat",
			...(body.modelId ? { modelId: body.modelId } : {}),
			require: ["tools", "structuredOutput"],
		});
		const embedding = await resolveKnowledgeEmbedding(platform);
		const { db } = await getKnowledgeBase();
		const store = await getHelpdeskStore();

		const knowledgeStore = createKnowledgeStore(db, { clock: platform.clock });
		const documentTitles = (await knowledgeStore.listDocuments()).map((document) => document.title);
		const search = createKnowledgeSearcher(
			{
				store: knowledgeStore,
				embedding,
				structuredModel: model,
				rerank: platform.ports.rerank,
				clock: platform.clock,
			},
			// `mock` embeddings are pseudo-random, so their similarity says nothing: the nearest few
			// chunks are returned instead of none.
			platform.mode === "mock" ? { minSimilarity: -1 } : {},
		);

		const stream = createUIMessageStream({
			execute: async ({ writer }) => {
				const outcome = await runHelpdesk({
					inquiry: body.inquiry,
					model,
					store,
					knowledge: { search, documentTitles },
					limits: platform.config.agent,
					clock: platform.clock,
					signal: request.signal,
					...(body.maxSteps === undefined ? {} : { maxSteps: body.maxSteps }),
					onEvent: createHelpdeskStreamer(writer),
				});
				writer.write({
					type: "message-metadata",
					messageMetadata: { ticketId: outcome.ticketId, status: outcome.status },
				});
			},
			onError: toStreamErrorText,
		});
		return createUIMessageStreamResponse({ stream });
	} catch (error) {
		return toErrorResponse(error);
	}
}
