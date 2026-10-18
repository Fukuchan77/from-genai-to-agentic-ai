import { z } from "zod";
import { agentRequestSchema } from "../chat/request-schema";
import { DEFAULT_HELPDESK } from "../config";

export const HELPDESK_REQUEST_LIMITS = Object.freeze({
	inquiryMaxCharacters: DEFAULT_HELPDESK.maxInquiryCharacters,
	maxStepsMin: 1,
	maxStepsMax: 30,
});

// Reused from the conversation schema so a model is checked the same way as in M1: it must be in
// the catalog.
const { modelId } = agentRequestSchema.shape;

// The length counts characters (code points), and a blank inquiry is no inquiry.
const inquirySchema = z
	.string()
	.min(1)
	.refine((inquiry) => [...inquiry].length <= HELPDESK_REQUEST_LIMITS.inquiryMaxCharacters, {
		error: `問い合わせは ${HELPDESK_REQUEST_LIMITS.inquiryMaxCharacters} 文字までです。`,
	})
	.refine((inquiry) => inquiry.trim() !== "", { error: "問い合わせを入力してください。" });

/**
 * The body of `POST /api/helpdesk` (plan "HTTP API"). `maxSteps` is the step limit of the run
 * (CL-14); without it the run uses `DEFAULT_HELPDESK.maxSteps`.
 */
export const helpdeskRequestSchema = z.strictObject({
	inquiry: inquirySchema,
	modelId: modelId.optional(),
	maxSteps: z
		.number()
		.int()
		.min(HELPDESK_REQUEST_LIMITS.maxStepsMin)
		.max(HELPDESK_REQUEST_LIMITS.maxStepsMax)
		.optional(),
});

export type HelpdeskRequest = z.infer<typeof helpdeskRequestSchema>;
