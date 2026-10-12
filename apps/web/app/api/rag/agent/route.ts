import { buildToolSet, createSearchKnowledgeBaseTool } from "@platform/ai-core/aci";
import { createGuardedAgent } from "@platform/ai-core/agents";
import { type AgentRequest, agentRequestSchema } from "@platform/ai-core/chat";
import { PlatformError } from "@platform/ai-core/errors";
import { ollamaRuntimeOptions } from "@platform/ai-core/models";
import {
	AGENTIC_RAG_INSTRUCTIONS,
	createCitationRegistry,
	createKnowledgeSearcher,
	createKnowledgeStore,
	summarizeAgenticRun,
} from "@platform/ai-core/rag";
import { createAgentUIStreamResponse, type UIMessage, validateUIMessages } from "ai";
import { GuardError, toErrorResponse, toStreamErrorText } from "@/lib/server/errors";
import { createConversationPolicy, guardRequest } from "@/lib/server/guard";
import { getKnowledgeBase, getPlatform, resolveKnowledgeEmbedding } from "@/lib/server/platform";

// POST /api/rag/agent (plan C9, C13, Req 1.9-1.11): the same shape as /api/agent/tools, with one
// tool, `searchKnowledgeBase`. The agent decides whether, what and how often to search; "did it
// search" and the citations come from the run record, not from the agent's own account.

export const dynamic = "force-dynamic";

const INVALID_MESSAGES_MESSAGE = "メッセージの形式が正しくありません。";

/**
 * A platform or guard error keeps its code. Anything else came from the provider or the SDK and may
 * hold request content or credentials, so only the agent's own fixed Japanese text is sent.
 */
function toStreamError(error: unknown, fixedText: string): string {
	if (error instanceof PlatformError || error instanceof GuardError) {
		return toStreamErrorText(error);
	}
	return toStreamErrorText(new PlatformError("provider-unavailable", fixedText));
}

const AGENT_POLICY = createConversationPolicy<AgentRequest>(agentRequestSchema);

export async function POST(request: Request): Promise<Response> {
	try {
		const platform = await getPlatform();
		const guarded = await guardRequest(request, AGENT_POLICY, {
			limiter: platform.limiter,
			mode: platform.mode,
		});
		if (!guarded.ok) return guarded.response;
		const { body } = guarded;

		const { model, entry } = await platform.gateway.resolve({
			purpose: "chat",
			...(body.modelId ? { modelId: body.modelId } : {}),
			require: ["tools"],
		});
		const embedding = await resolveKnowledgeEmbedding(platform);
		const { db } = await getKnowledgeBase();

		// One registry per request: the footnote numbers are only meaningful inside this run.
		const registry = createCitationRegistry();
		const search = createKnowledgeSearcher({
			store: createKnowledgeStore(db, { clock: platform.clock }),
			embedding,
			// The agent's searches are plain vector searches: no query transform runs.
			structuredModel: model,
			rerank: platform.ports.rerank,
			clock: platform.clock,
		});
		const { tools } = buildToolSet(
			[createSearchKnowledgeBaseTool({ search, registry })],
			// Availability comes from the server's own configuration, never from the request.
			{},
			platform.toolRuntime,
		);

		const agent = createGuardedAgent({
			model,
			instructions: AGENTIC_RAG_INSTRUCTIONS,
			tools,
			limits: platform.config.agent,
			clock: platform.clock,
			signal: request.signal,
			...ollamaRuntimeOptions(entry),
		});

		let validated: UIMessage[];
		try {
			validated = await validateUIMessages<UIMessage>({
				messages: body.messages,
				tools: tools as never,
			});
		} catch {
			throw new PlatformError("invalid-request", INVALID_MESSAGES_MESSAGE);
		}

		// The text of the newest step is the answer; earlier steps only announce a search.
		let stepText = "";
		return await createAgentUIStreamResponse({
			agent: agent.agent,
			uiMessages: validated,
			abortSignal: agent.abortSignal,
			messageMetadata: ({ part }) => {
				if (part.type === "start-step") stepText = "";
				if (part.type === "text-delta") stepText += part.text;
				if (part.type !== "finish") return undefined;
				// The guarded agent finalises its summary here, before the RAG summary is built.
				const { run } = agent.messageMetadata({ part }) ?? {};
				return run ? { run, rag: summarizeAgenticRun(run, registry, stepText) } : undefined;
			},
			onError: (error) => toStreamError(error, agent.onError(error)),
		});
	} catch (error) {
		return toErrorResponse(error);
	}
}
