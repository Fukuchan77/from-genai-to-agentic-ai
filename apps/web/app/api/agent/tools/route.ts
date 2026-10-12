import {
	buildToolSet,
	createCalculatorTool,
	createCurrencyConvertTool,
	createCurrentTimeTool,
	createWeatherTool,
	createWebSearchTool,
	toolAvailabilityFromConfig,
} from "@platform/ai-core/aci";
import { createGuardedAgent } from "@platform/ai-core/agents";
import {
	adaptHistoryForModel,
	agentRequestSchema,
	buildResponseMetadata,
	getPersona,
} from "@platform/ai-core/chat";
import { PlatformError } from "@platform/ai-core/errors";
import { ollamaRuntimeOptions } from "@platform/ai-core/models";
import { createAgentUIStreamResponse, type UIMessage, validateUIMessages } from "ai";
import { GuardError, toErrorResponse, toStreamErrorText } from "@/lib/server/errors";
import { createConversationPolicy, guardRequest, isImageMediaType } from "@/lib/server/guard";
import { getPlatform } from "@/lib/server/platform";

// POST /api/agent/tools (plan C16, Req 5.1, 5.4-5.6, 6.2-6.4): guard -> resolve a tool-capable
// model -> build the guarded tool set -> one GuardedAgent for this request -> UI message stream.

export const dynamic = "force-dynamic";

const INVALID_MESSAGES_MESSAGE = "メッセージの形式が正しくありません。";

function newestMessageHasImage(messages: readonly { role: string; parts: readonly unknown[] }[]) {
	const newest = messages.at(-1);
	return (
		newest?.role === "user" &&
		newest.parts.some((part) => {
			const { type, mediaType } = part as { type?: unknown; mediaType?: unknown };
			return type === "file" && typeof mediaType === "string" && isImageMediaType(mediaType);
		})
	);
}

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

export async function POST(request: Request): Promise<Response> {
	try {
		const platform = await getPlatform();
		const guarded = await guardRequest(request, createConversationPolicy(agentRequestSchema), {
			limiter: platform.limiter,
			mode: platform.mode,
		});
		if (!guarded.ok) return guarded.response;
		const { body } = guarded;

		const persona = getPersona(body.personaId);
		const { model, entry } = await platform.gateway.resolve({
			purpose: "chat",
			modelId: body.modelId,
			require: newestMessageHasImage(body.messages) ? ["tools", "imageInput"] : ["tools"],
		});

		const { tools, disabled } = buildToolSet(
			[
				createCurrentTimeTool(platform.clock),
				createCalculatorTool(),
				createCurrencyConvertTool(),
				createWeatherTool(platform.ports.http),
				createWebSearchTool(platform.ports.webSearch),
			],
			// Availability comes from the server's own configuration, never from the request.
			toolAvailabilityFromConfig(platform.config),
			platform.toolRuntime,
		);

		// ADR-6: one GuardedAgent per request. It owns the start time, the stop record and the totals.
		const agent = createGuardedAgent({
			model,
			instructions: persona.render({
				modelName: entry.displayName,
				today: new Date(platform.clock.now()).toISOString().slice(0, 10),
			}),
			tools,
			limits: platform.config.agent,
			clock: platform.clock,
			signal: request.signal,
			// Same `num_ctx` as chat and summaries, so Ollama never reloads the model (plan C8).
			...ollamaRuntimeOptions(entry),
		});

		// Only the SDK's validation of the history is reported as invalid-request (its message echoes
		// part content, so a fixed text is sent); any other failure keeps its own handling.
		let validated: UIMessage[];
		try {
			validated = await validateUIMessages<UIMessage>({
				messages: body.messages,
				tools: tools as never,
			});
		} catch {
			throw new PlatformError("invalid-request", INVALID_MESSAGES_MESSAGE);
		}

		return await createAgentUIStreamResponse({
			agent: agent.agent,
			uiMessages: adaptHistoryForModel(validated, entry),
			abortSignal: agent.abortSignal,
			sendReasoning: true,
			messageMetadata: ({ part }) => {
				if (part.type === "start") {
					return buildResponseMetadata({ entry, persona, disabledTools: disabled });
				}
				if (part.type === "finish") {
					// The guarded agent finalises its summary here, before the metadata is built.
					return buildResponseMetadata({
						entry,
						persona,
						usage: part.totalUsage,
						disabledTools: disabled,
						...agent.messageMetadata({ part }),
					});
				}
				return undefined;
			},
			onError: (error) => toStreamError(error, agent.onError(error)),
		});
	} catch (error) {
		return toErrorResponse(error);
	}
}
