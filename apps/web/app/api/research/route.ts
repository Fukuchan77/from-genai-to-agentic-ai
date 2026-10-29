import { DEFAULT_INPUT_LIMITS } from "@platform/ai-core/config";
import {
	type ResearchRequest,
	researchRequestSchema,
	runResearch,
} from "@platform/ai-core/research";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import {
	createResearchStreamer,
	writeResearchResult,
	writeResearchUsage,
} from "@/lib/server/domain-stream";
import { toErrorResponse, toStreamErrorText } from "@/lib/server/errors";
import { type GuardPolicy, guardRequest } from "@/lib/server/guard";
import { getArxivClient, getPlatform } from "@/lib/server/platform";

// POST /api/research (plan C13, Req 4.2, 4.6, 4.8-4.10): guard -> resolve a model that can call
// tools -> stream the Agent Inspector events and the token usage while `runResearch` calls the
// sub-agents, then the checked report. A refusal that needs no stream happens before any model call.
// arXiv being unreachable is not a refusal: the search becomes a gap in the report (Req 4.7).

export const dynamic = "force-dynamic";

const POLICY: GuardPolicy<ResearchRequest> = {
	schema: researchRequestSchema,
	limits: DEFAULT_INPUT_LIMITS,
	// The theme length and the call limit are part of the schema.
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

		// The supervisor and the sub-agents call tools: refuse a model without them before any LLM call.
		const { model } = await platform.gateway.resolve({
			purpose: "chat",
			...(body.modelId ? { modelId: body.modelId } : {}),
			require: ["tools"],
		});
		const arxiv = await getArxivClient();

		const stream = createUIMessageStream({
			execute: async ({ writer }) => {
				const result = await runResearch({
					theme: body.theme,
					model,
					arxiv,
					clock: platform.clock,
					signal: request.signal,
					...(body.maxSubagentCalls === undefined
						? {}
						: { limits: { maxSubagentCalls: body.maxSubagentCalls } }),
					onEvent: createResearchStreamer(writer),
					onUsage: (usage) => writeResearchUsage(writer, usage),
				});
				// A run that was stopped throws before this line, so it never sends a result.
				writeResearchResult(writer, result);
			},
			onError: toStreamErrorText,
		});
		return createUIMessageStreamResponse({ stream });
	} catch (error) {
		return toErrorResponse(error);
	}
}
