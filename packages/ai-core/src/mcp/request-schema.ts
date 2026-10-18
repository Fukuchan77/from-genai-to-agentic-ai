import { z } from "zod";
import { agentRequestSchema } from "../chat/request-schema";

export const MCP_REQUEST_LIMITS = Object.freeze({
	serverIdMaxLength: 32,
	toolNameMaxLength: 64,
	maxServers: 8,
	maxToolsPerServer: 20,
});

/** The tasks `POST /api/mcp/compare` can run. A closed vocabulary that starts with one (plan "HTTP API"). */
export const MCP_COMPARE_TASK_IDS = ["list-and-read"] as const;
export type McpCompareTaskId = (typeof MCP_COMPARE_TASK_IDS)[number];

// Reused from the conversation schema so a message, an ID and a model are checked the same way as
// in M1: `messages` keeps every part's fields, `modelId` must be in the catalog.
const { id, messages, modelId, trigger, messageId } = agentRequestSchema.shape;

const serverIdSchema = z.string().min(1).max(MCP_REQUEST_LIMITS.serverIdMaxLength);
const toolNameSchema = z.string().min(1).max(MCP_REQUEST_LIMITS.toolNameMaxLength);

/**
 * Server ID → the tool names the chat loads from it. It can only narrow the configured allow-list;
 * the route checks the names against it and rejects the rest (Req 1.8, 1.17).
 */
const allowSchema = z
	.record(serverIdSchema, z.array(toolNameSchema).max(MCP_REQUEST_LIMITS.maxToolsPerServer))
	.refine((allow) => Object.keys(allow).length <= MCP_REQUEST_LIMITS.maxServers, {
		error: `許可リストに指定できるサーバーは ${MCP_REQUEST_LIMITS.maxServers} 個までです。`,
	});

/**
 * The body of `POST /api/mcp/chat`. There is no persona: the server's own instructions are the only
 * system prompt. `modelId` is optional (the gateway picks the chat default).
 */
export const mcpChatRequestSchema = z.strictObject({
	id,
	messages,
	modelId: modelId.optional(),
	allow: allowSchema.optional(),
	think: z.boolean().optional(),
	trigger,
	messageId,
});

/** The body of `POST /api/mcp/compare`. */
export const mcpCompareRequestSchema = z.strictObject({
	modelId: modelId.optional(),
	task: z.enum(MCP_COMPARE_TASK_IDS, {
		error: `task は ${MCP_COMPARE_TASK_IDS.join(" / ")} のいずれかを指定してください。`,
	}),
});

export type McpChatRequest = z.infer<typeof mcpChatRequestSchema>;
export type McpCompareRequest = z.infer<typeof mcpCompareRequestSchema>;
