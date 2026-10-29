import { z } from "zod";
import { agentRequestSchema } from "../chat/request-schema";

export const COUNCIL_REQUEST_LIMITS = Object.freeze({
	draftMaxCharacters: 2000,
	maxRoundsMin: 1,
	maxRoundsMax: 6,
	personaIdsMin: 2,
	personaIdsMax: 5,
});

// Reused from the conversation schema so a model is checked the same way as in M1.
const { modelId } = agentRequestSchema.shape;

// The length counts characters (code points), and a blank draft is no draft.
const draftSchema = z
	.string()
	.min(1)
	.refine((draft) => [...draft].length <= COUNCIL_REQUEST_LIMITS.draftMaxCharacters, {
		error: `文案は ${COUNCIL_REQUEST_LIMITS.draftMaxCharacters} 文字までです。`,
	})
	.refine((draft) => draft.trim() !== "", { error: "文案を入力してください。" });

/**
 * The body of `POST /api/marketing/council` (plan "HTTP API"). Whether each persona id exists is
 * the route's check (it needs the catalog); without `personaIds` the route uses the default three.
 */
export const councilRequestSchema = z.strictObject({
	draft: draftSchema,
	modelId: modelId.optional(),
	maxRounds: z
		.number()
		.int()
		.min(COUNCIL_REQUEST_LIMITS.maxRoundsMin)
		.max(COUNCIL_REQUEST_LIMITS.maxRoundsMax)
		.optional(),
	personaIds: z
		.array(z.string().min(1).max(100))
		.min(COUNCIL_REQUEST_LIMITS.personaIdsMin)
		.max(COUNCIL_REQUEST_LIMITS.personaIdsMax)
		.refine((ids) => new Set(ids).size === ids.length, {
			error: "ペルソナの ID は重複させないでください。",
		})
		.optional(),
});

export type CouncilRequest = z.infer<typeof councilRequestSchema>;
