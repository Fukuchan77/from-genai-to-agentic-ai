import { DEFAULT_INPUT_LIMITS } from "@platform/ai-core/config";
import {
	EMPTY_PROFILE,
	extractProfile,
	NO_MATCH_REASON,
	type Profile,
	type RecommendRequest,
	type RecommendResult,
	recommend,
	recommendRequestSchema,
} from "@platform/ai-core/marketing";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { writeMarketingProfile, writeMarketingRecommendation } from "@/lib/server/domain-stream";
import { toErrorResponse, toStreamErrorText } from "@/lib/server/errors";
import { createConversationPolicy, guardRequest } from "@/lib/server/guard";
import { getCatalogRepo, getPlatform } from "@/lib/server/platform";

// POST /api/marketing/recommend (plan C13, Req 6.4, 6.5): guard -> catalog is seeded (503 if not)
// -> resolve a model that returns structured output -> per conversation turn, update the profile
// (`extractProfile`) and recommend from the catalog (`recommend`). Both are workflow steps: one
// structured-output call each, no agent loop. Every refusal that needs no stream happens before the
// first model call.

export const dynamic = "force-dynamic";

const POLICY = createConversationPolicy(recommendRequestSchema, DEFAULT_INPUT_LIMITS);

/**
 * The text of a message (its text parts, in order). An assistant message may also carry the
 * `data-*` and `step-start` parts this route streamed; they are not text and never reach a model.
 */
function textOfMessage(message: RecommendRequest["messages"][number]): string {
	return message.parts
		.flatMap((part) => (part.type === "text" && typeof part.text === "string" ? [part.text] : []))
		.join("\n");
}

/** The fixed reply text: built by code from the result, never the model's free text. */
function summaryOf(result: RecommendResult): string {
	return result.items.length > 0
		? `${result.items.length} 件をおすすめします。`
		: (result.reason ?? NO_MATCH_REASON);
}

export async function POST(request: Request): Promise<Response> {
	try {
		const platform = await getPlatform();
		const guarded = await guardRequest(request, POLICY, {
			limiter: platform.limiter,
			mode: platform.mode,
		});
		if (!guarded.ok) return guarded.response;
		const { body } = guarded;

		// An unseeded catalog is a 503 with the command to run, before any model is resolved or called.
		const catalog = await getCatalogRepo();
		const { model } = await platform.gateway.resolve({
			purpose: "chat",
			...(body.modelId ? { modelId: body.modelId } : {}),
			require: ["structuredOutput"],
		});

		const conversation = body.messages.map((message) => ({
			role: message.role,
			content: textOfMessage(message),
		}));
		// The schema guarantees the newest message is the shopper's.
		const latest = conversation.at(-1)?.content ?? "";
		const previous: Profile = body.profile ?? EMPTY_PROFILE;

		const stream = createUIMessageStream({
			execute: async ({ writer }) => {
				const profile = await extractProfile({
					model,
					messages: conversation,
					previous,
					signal: request.signal,
				});
				// `extractProfile` returns `previous` itself when it learned nothing: the screen keeps
				// what it shows, and the recommendation uses the profile the client already holds.
				if (profile !== previous) writeMarketingProfile(writer, profile);
				const result = await recommend({
					model,
					profile,
					catalog,
					message: latest,
					signal: request.signal,
				});
				writeMarketingRecommendation(writer, result);
				const textId = "summary";
				writer.write({ type: "text-start", id: textId });
				writer.write({ type: "text-delta", id: textId, delta: summaryOf(result) });
				writer.write({ type: "text-end", id: textId });
			},
			onError: toStreamErrorText,
		});
		return createUIMessageStreamResponse({ stream });
	} catch (error) {
		return toErrorResponse(error);
	}
}
