import { z } from "zod";
import { agentRequestSchema } from "../chat/request-schema";

export const RESEARCH_REQUEST_LIMITS = Object.freeze({
	themeMaxCharacters: 500,
	maxSubagentCallsMin: 1,
	maxSubagentCallsMax: 20,
});

// Reused from the conversation schema so a model is checked the same way as in M1: it must be in
// the catalog.
const { modelId } = agentRequestSchema.shape;

// The length counts characters (code points), and a blank theme is no theme.
const themeSchema = z
	.string()
	.min(1)
	.refine((theme) => [...theme].length <= RESEARCH_REQUEST_LIMITS.themeMaxCharacters, {
		error: `テーマは ${RESEARCH_REQUEST_LIMITS.themeMaxCharacters} 文字までです。`,
	})
	.refine((theme) => theme.trim() !== "", { error: "リサーチのテーマを入力してください。" });

/**
 * The body of `POST /api/research` (plan "HTTP API"). `maxSubagentCalls` is the limit on the
 * Supervisor's sub-agent calls (Req 4.8); without it the run uses `DEFAULT_RESEARCH`.
 */
export const researchRequestSchema = z.strictObject({
	theme: themeSchema,
	modelId: modelId.optional(),
	maxSubagentCalls: z
		.number()
		.int()
		.min(RESEARCH_REQUEST_LIMITS.maxSubagentCallsMin)
		.max(RESEARCH_REQUEST_LIMITS.maxSubagentCallsMax)
		.optional(),
});

export type ResearchRequest = z.infer<typeof researchRequestSchema>;
