import { z } from "zod";
import { agentRequestSchema } from "../chat/request-schema";
import { MAX_PROFILE_ITEMS } from "./profile";

export const RECOMMEND_REQUEST_LIMITS = Object.freeze({
	idMaxLength: 200,
	/** Characters (code points) of one text part; the guard's per-message limit applies on top. */
	textMaxCharacters: 8_000,
	partsMax: 20,
	itemMaxCharacters: 100,
	budgetMaxYen: 1_000_000_000,
});

// Reused from the conversation schema so ids and models are checked as in M1.
const { id: idSchema, modelId, trigger, messageId } = agentRequestSchema.shape;

const codePoints = (value: string): number => [...value].length;

/**
 * One text part. Other fields (`state`, `providerMetadata`) are tolerated because the default chat
 * transport sends them; a part of any other type is refused, since this route reads text only.
 */
const textPartSchema = z.looseObject({
	type: z.literal("text"),
	text: z
		.string()
		.refine((text) => codePoints(text) <= RECOMMEND_REQUEST_LIMITS.textMaxCharacters, {
			error: `1 件のメッセージは ${RECOMMEND_REQUEST_LIMITS.textMaxCharacters} 文字までです。`,
		}),
});

/**
 * A part of an earlier assistant message that is not text: the `data-*` parts and the `step-start`
 * the route streamed, which `useChat` sends back with the history. Their content is never read.
 */
const echoedPartSchema = z.looseObject({
	type: z.union([z.literal("step-start"), z.string().regex(/^data-[\w-]+$/)]),
});

const messageFields = {
	id: idSchema,
	metadata: z.unknown().optional(),
};

// The shopper sends text only; the assistant's turn comes back as the route streamed it.
const messageSchema = z.discriminatedUnion("role", [
	z.strictObject({
		...messageFields,
		role: z.literal("user"),
		parts: z.array(textPartSchema).min(1).max(RECOMMEND_REQUEST_LIMITS.partsMax),
	}),
	z.strictObject({
		...messageFields,
		role: z.literal("assistant"),
		parts: z
			.array(z.union([textPartSchema, echoedPartSchema]))
			.min(1)
			.max(RECOMMEND_REQUEST_LIMITS.partsMax),
	}),
]);

/** The text of a message: its text parts, in order. Every other part type is ignored. */
function textOfRecommendMessage(message: {
	readonly parts: readonly { readonly type: string; readonly text?: unknown }[];
}): string {
	return message.parts
		.flatMap((part) => (part.type === "text" && typeof part.text === "string" ? [part.text] : []))
		.join("\n");
}

const itemSchema = z.string().max(RECOMMEND_REQUEST_LIMITS.itemMaxCharacters);

/** The profile the client holds from the previous turn (the shape of `Profile`). */
export const storedProfileSchema = z.strictObject({
	interests: z.array(itemSchema).max(MAX_PROFILE_ITEMS),
	budgetYen: z.number().int().nonnegative().max(RECOMMEND_REQUEST_LIMITS.budgetMaxYen).nullable(),
	concerns: z.array(itemSchema).max(MAX_PROFILE_ITEMS),
});

/**
 * The body of `POST /api/marketing/recommend` (plan "HTTP API"). `messages` is the whole
 * conversation in the `/api/chat` shape: the shopper's messages are text only, and an assistant message may also carry the `data-*` / `step-start` parts the route streamed (ignored); the newest must be the shopper's and not blank.
 * `trigger` and `messageId` are added by `DefaultChatTransport` and ignored.
 */
export const recommendRequestSchema = z
	.strictObject({
		id: idSchema,
		messages: z.array(messageSchema).min(1),
		modelId: modelId.optional(),
		profile: storedProfileSchema.optional(),
		trigger: trigger.optional(),
		messageId: messageId.optional(),
	})
	.superRefine((body, context) => {
		const newest = body.messages.at(-1);
		const text = newest ? textOfRecommendMessage(newest) : "";
		if (newest?.role !== "user" || text.trim() === "") {
			context.addIssue({
				code: "custom",
				path: ["messages"],
				message: "最後のメッセージは、空でない利用者の発言にしてください。",
			});
		}
	});

export type RecommendRequest = z.infer<typeof recommendRequestSchema>;
