import { z } from "zod";
import { agentRequestSchema } from "../chat/request-schema";
import { DEFAULT_INTERVIEW } from "../config/defaults";
import { MAX_OVERVIEW_CHARACTERS, MAX_PERSONA_COUNT, MIN_PERSONA_COUNT } from "./personas";

export const REQUIREMENTS_REQUEST_LIMITS = Object.freeze({
	overviewMaxCharacters: MAX_OVERVIEW_CHARACTERS,
	personaCountMin: MIN_PERSONA_COUNT,
	personaCountMax: MAX_PERSONA_COUNT,
	maxRoundsMin: 1,
	maxRoundsMax: 10,
});

// Reused from the conversation schema so a model is checked the same way as in M1: it must be in
// the catalog.
const { modelId } = agentRequestSchema.shape;

// The length counts characters (code points), and a blank overview is no overview.
const overviewSchema = z
	.string()
	.min(1)
	.refine((overview) => [...overview].length <= REQUIREMENTS_REQUEST_LIMITS.overviewMaxCharacters, {
		error: `プロダクトの概要は ${REQUIREMENTS_REQUEST_LIMITS.overviewMaxCharacters} 文字までです。`,
	})
	.refine((overview) => overview.trim() !== "", {
		error: "プロダクトの概要を入力してください。",
	});

/**
 * The body of `POST /api/requirements/sessions` (plan "HTTP API"). Without `personaCount` and
 * `maxRounds` the route uses `DEFAULT_INTERVIEW`.
 */
export const requirementsSessionRequestSchema = z.strictObject({
	overview: overviewSchema,
	modelId: modelId.optional(),
	personaCount: z
		.number()
		.int()
		.min(REQUIREMENTS_REQUEST_LIMITS.personaCountMin)
		.max(REQUIREMENTS_REQUEST_LIMITS.personaCountMax)
		.optional(),
	maxRounds: z
		.number()
		.int()
		.min(REQUIREMENTS_REQUEST_LIMITS.maxRoundsMin)
		.max(REQUIREMENTS_REQUEST_LIMITS.maxRoundsMax)
		.optional(),
});

export type RequirementsSessionRequest = z.infer<typeof requirementsSessionRequestSchema>;

/** The defaults the route applies; exported so tests and docs name the same numbers. */
export const REQUIREMENTS_REQUEST_DEFAULTS = Object.freeze({
	personaCount: DEFAULT_INTERVIEW.personaCount,
	maxRounds: DEFAULT_INTERVIEW.maxRounds,
});
