import { z } from "zod";
import { type CatalogModelId, MODEL_CATALOG } from "../models/catalog";
import { PERSONA_IDS } from "./personas";

export const CHAT_REQUEST_LIMITS = Object.freeze({
	idMaxLength: 200,
});

const CATALOG_MODEL_IDS = Object.freeze(Object.keys(MODEL_CATALOG)) as readonly CatalogModelId[];

const idSchema = z.string().min(1).max(CHAT_REQUEST_LIMITS.idMaxLength);

const modelIdSchema = z.enum(CATALOG_MODEL_IDS, {
	error: "モデル ID がモデルカタログにありません。選択肢の中からモデルを選んでください。",
});

const personaIdSchema = z.enum(PERSONA_IDS, {
	error: `未知のペルソナ ID です。${PERSONA_IDS.join(", ")} のいずれかを指定してください。`,
});

/**
 * The envelope of one `UIMessage`. Parts are only checked for a `type` here and keep every field;
 * the route validates their content with the AI SDK's `validateUIMessages` before converting them.
 * `system` is not accepted: the server's persona is the only system prompt (Req 3.10).
 */
const uiMessageSchema = z.strictObject({
	id: idSchema,
	role: z.enum(["user", "assistant"]),
	metadata: z.unknown().optional(),
	parts: z.array(z.looseObject({ type: z.string().min(1) })),
});

/**
 * Shared shape of `POST /api/chat` and `POST /api/agent/tools` (plan "HTTP API"). Unknown fields
 * are rejected. `trigger` and `messageId` are the fields `DefaultChatTransport` adds to every
 * request; they are accepted so the default transport works, and the routes ignore them.
 */
function conversationRequestSchema() {
	return z.strictObject({
		id: idSchema,
		messages: z.array(uiMessageSchema).min(1),
		modelId: modelIdSchema,
		personaId: personaIdSchema,
		trigger: z.enum(["submit-message", "regenerate-message"]).optional(),
		messageId: idSchema.optional(),
	});
}

/** The body of `POST /api/chat`. */
export const chatRequestSchema = conversationRequestSchema();

/** The body of `POST /api/agent/tools`; the same shape as the chat body, kept separate to evolve. */
export const agentRequestSchema = conversationRequestSchema();

export type ChatRequest = z.infer<typeof chatRequestSchema>;
export type AgentRequest = z.infer<typeof agentRequestSchema>;
