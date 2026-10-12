import {
	adaptHistoryForModel,
	buildResponseMetadata,
	chatRequestSchema,
	getPersona,
} from "@platform/ai-core/chat";
import { PlatformError } from "@platform/ai-core/errors";
import { convertToModelMessages, streamText, type UIMessage, validateUIMessages } from "ai";
import { GuardError, toErrorResponse, toStreamErrorText } from "@/lib/server/errors";
import { createConversationPolicy, guardRequest, isImageMediaType } from "@/lib/server/guard";
import { getPlatform } from "@/lib/server/platform";

// POST /api/chat (plan C15, Req 3.1-3.11): guard -> resolve model -> adapt history -> stream.

export const dynamic = "force-dynamic";

const PROVIDER_FAILURE_MESSAGE =
	"モデルの呼び出しに失敗しました。しばらくしてからもう一度お試しください。";

/** Whether the newest message carries an image, which only an image-capable model may receive. */
function newestMessageHasImage(messages: readonly UIMessage[]): boolean {
	const newest = messages.at(-1);
	return (
		newest?.role === "user" &&
		newest.parts.some((part) => part.type === "file" && isImageMediaType(part.mediaType))
	);
}

/**
 * Anything that is not already a platform or guard error came from the provider or the SDK. Its
 * message may hold request content or credentials, so only a fixed Japanese message is sent.
 */
function toProviderError(error: unknown): unknown {
	if (error instanceof PlatformError || error instanceof GuardError) return error;
	return new PlatformError("provider-unavailable", PROVIDER_FAILURE_MESSAGE);
}

async function validateMessages(messages: readonly unknown[]): Promise<UIMessage[]> {
	try {
		return await validateUIMessages<UIMessage>({ messages });
	} catch {
		// The SDK's message echoes part content; the client gets a fixed message instead.
		throw new PlatformError("invalid-request", "メッセージの形式が正しくありません。");
	}
}

export async function POST(request: Request): Promise<Response> {
	try {
		const platform = await getPlatform();
		const guarded = await guardRequest(request, createConversationPolicy(chatRequestSchema), {
			limiter: platform.limiter,
			mode: platform.mode,
		});
		if (!guarded.ok) return guarded.response;
		const { body } = guarded;

		const messages = await validateMessages(body.messages);
		const persona = getPersona(body.personaId);
		const { model, entry } = await platform.gateway.resolve({
			purpose: "chat",
			modelId: body.modelId,
			...(newestMessageHasImage(messages) ? { require: ["imageInput"] as const } : {}),
		});

		const modelMessages = await convertToModelMessages(adaptHistoryForModel(messages, entry));
		const result = streamText({
			model,
			instructions: persona.render({
				modelName: entry.displayName,
				today: new Date(platform.clock.now()).toISOString().slice(0, 10),
			}),
			messages: modelMessages,
			abortSignal: request.signal,
			// The SDK's default logs the raw error; failures are reported through the stream instead.
			onError: () => {},
		});

		return result.toUIMessageStreamResponse({
			sendReasoning: true,
			messageMetadata: ({ part }) => {
				if (part.type === "start") return buildResponseMetadata({ entry, persona });
				if (part.type === "finish") {
					return buildResponseMetadata({ entry, persona, usage: part.totalUsage });
				}
				return undefined;
			},
			onError: (error) => toStreamErrorText(toProviderError(error)),
		});
	} catch (error) {
		return toErrorResponse(error);
	}
}
