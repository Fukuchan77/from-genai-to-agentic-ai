import { buildToolSet, createThinkTool, FatalLatch } from "@platform/ai-core/aci";
import { createGuardedAgent } from "@platform/ai-core/agents";
import { DEFAULT_TOOLS } from "@platform/ai-core/config";
import { PlatformError } from "@platform/ai-core/errors";
import {
	MCP_CHAT_INSTRUCTIONS,
	type McpChatRequest,
	type McpServerStatus,
	mcpChatRequestSchema,
	publicMcpStatus,
} from "@platform/ai-core/mcp";
import { ollamaRuntimeOptions } from "@platform/ai-core/models";
import { createAgentUIStreamResponse, type UIMessage, validateUIMessages } from "ai";
import { GuardError, toErrorResponse, toStreamErrorText } from "@/lib/server/errors";
import { createConversationPolicy, guardRequest } from "@/lib/server/guard";
import { getMcpRegistry, getPlatform } from "@/lib/server/platform";

// POST /api/mcp/chat (plan C13, Req 1.3, 1.8, 1.14, 1.15, 1.17): guard -> check the requested
// allow-list -> load the allowed read-only MCP tools (and the think tool) -> one GuardedAgent for this
// request with a fatal-error latch -> UI message stream whose `finish` carries `{ run, mcp }`.

export const dynamic = "force-dynamic";

const INVALID_MESSAGES_MESSAGE = "メッセージの形式が正しくありません。";
const AGENT_ID = "mcp-chat";

const POLICY = createConversationPolicy<McpChatRequest>(mcpChatRequestSchema);

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

function invalidAllow(message: string): PlatformError {
	return new PlatformError("invalid-request", message);
}

/**
 * The allow-list may only name servers and tools that exist, and only read-only ones: a write or
 * destructive tool is refused here, whatever the configured allow-list says (Req 1.17). Names the
 * configuration does not allow are refused by the registry (Req 1.8).
 */
function checkRequestedAllow(
	status: readonly McpServerStatus[],
	allow: McpChatRequest["allow"],
): void {
	if (allow === undefined) return;
	for (const [serverId, names] of Object.entries(allow)) {
		const server = status.find((candidate) => candidate.id === serverId);
		if (server === undefined) {
			throw invalidAllow(`MCP サーバー「${serverId}」は設定されていません。`);
		}
		for (const name of names) {
			const tool = server.tools.find((candidate) => candidate.name === name);
			if (tool === undefined) {
				throw invalidAllow(`サーバー「${serverId}」にツール「${name}」はありません。`);
			}
			if (tool.risk !== "read-only") {
				throw invalidAllow(
					`ツール「${name}」のリスク区分は ${tool.risk} です。承認ゲートが実装されるまで、読み取り専用のツールだけを指定できます。`,
				);
			}
		}
	}
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

		const registry = await getMcpRegistry();
		checkRequestedAllow(registry.status(), body.allow);

		// The think tool takes one of the agent's 20 tool slots (Req 1.15).
		const think = createThinkTool({ enabled: body.think ?? DEFAULT_TOOLS.thinkEnabled });
		const mcpTools = registry.toolsFor(AGENT_ID, {
			...(body.allow ? { allow: body.allow } : {}),
			reservedTools: think ? 1 : 0,
		});

		const { model, entry } = await platform.gateway.resolve({
			purpose: "chat",
			...(body.modelId ? { modelId: body.modelId } : {}),
			require: ["tools"],
		});

		// One latch per request: a fatal tool error (a path outside the allowed root, a rejected token)
		// ends this run with stop reason `error` and the learner's message in `finish`.
		const { tools } = buildToolSet(
			think ? [...mcpTools, think] : mcpTools,
			// Availability comes from the server's own configuration, never from the request.
			{},
			{ ...platform.toolRuntime, fatal: new FatalLatch() },
		);

		const agent = createGuardedAgent({
			model,
			instructions: MCP_CHAT_INSTRUCTIONS,
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

		return await createAgentUIStreamResponse({
			agent: agent.agent,
			uiMessages: validated,
			abortSignal: agent.abortSignal,
			messageMetadata: ({ part }) => {
				if (part.type !== "finish") return undefined;
				// The guarded agent finalises its summary here. The servers' state is read now, so a
				// server that disconnected during the run shows as unavailable (Req 1.10).
				const { run } = agent.messageMetadata({ part }) ?? {};
				return run ? { run, mcp: registry.status().map(publicMcpStatus) } : undefined;
			},
			onError: (error) => toStreamError(error, agent.onError(error)),
		});
	} catch (error) {
		return toErrorResponse(error);
	}
}
