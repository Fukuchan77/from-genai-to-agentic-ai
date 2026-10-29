import { z } from "zod";

export const MESSAGES_REQUEST_LIMITS = Object.freeze({
	answersMin: 1,
	answersMax: 10,
	textMaxCharacters: 2000,
	questionIdMaxCharacters: 64,
});

// The length counts characters (code points), and a blank answer is no answer.
const textSchema = z
	.string()
	.min(1)
	.refine((text) => [...text].length <= MESSAGES_REQUEST_LIMITS.textMaxCharacters, {
		error: `回答は ${MESSAGES_REQUEST_LIMITS.textMaxCharacters} 文字までです。`,
	})
	.refine((text) => text.trim() !== "", { error: "回答を入力してください。" });

const answerSchema = z.strictObject({
	questionId: z.string().min(1).max(MESSAGES_REQUEST_LIMITS.questionIdMaxCharacters),
	text: textSchema,
});

/**
 * The body of `POST /api/requirements/sessions/[id]/messages` (plan "HTTP API"): 1 to 10 answers,
 * each to a different question. Whether a `questionId` exists is the route's check, since it needs
 * the session. The text is kept as written (the extraction reads it verbatim).
 */
export const requirementsMessagesRequestSchema = z.strictObject({
	answers: z
		.array(answerSchema)
		.min(MESSAGES_REQUEST_LIMITS.answersMin)
		.max(MESSAGES_REQUEST_LIMITS.answersMax)
		.refine((answers) => new Set(answers.map((a) => a.questionId)).size === answers.length, {
			error: "同じ質問に複数の回答は送れません。",
		}),
});

export type RequirementsMessagesRequest = z.infer<typeof requirementsMessagesRequestSchema>;
