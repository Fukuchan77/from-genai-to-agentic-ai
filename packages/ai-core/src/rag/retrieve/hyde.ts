import { generateText, type LanguageModel } from "ai";
import { PlatformError } from "../../errors";
import type { StructuredUsage } from "../../structured";

/** A hypothetical answer is only a search key, so a short passage is enough (and embeddable). */
const HYDE_MAX_OUTPUT_TOKENS = 300;

const HYDE_INSTRUCTIONS = [
	"You write a short hypothetical passage that would answer the user's question, as it might appear in a knowledge base document.",
	"The passage is used only to search for real documents; it does not have to be true.",
	"Write in the same language as the question. Write plain prose without headings, lists, or preamble.",
	"Always write the passage, even if you are unsure: do not refuse and do not ask questions back.",
].join("\n");

export interface HypotheticalAnswerParams {
	readonly model: LanguageModel;
	readonly question: string;
	readonly abortSignal?: AbortSignal;
}

export interface HypotheticalAnswerResult {
	readonly text: string;
	readonly usage: StructuredUsage;
}

/**
 * HyDE (plan C7): asks the model for a passage that would answer the question. The caller embeds
 * the passage instead of the question, so the vector search compares answer-like text with
 * document text. Provider errors and aborts are rethrown unchanged.
 */
export async function generateHypotheticalAnswer(
	params: HypotheticalAnswerParams,
): Promise<HypotheticalAnswerResult> {
	const { model, question, abortSignal } = params;
	if (question.trim() === "") {
		throw new PlatformError("invalid-request", "質問が空です。");
	}
	if (abortSignal?.aborted) throw abortSignal.reason;

	const result = await generateText({
		model,
		instructions: HYDE_INSTRUCTIONS,
		prompt: question,
		maxOutputTokens: HYDE_MAX_OUTPUT_TOKENS,
		...(abortSignal ? { abortSignal } : {}),
	});

	const text = result.text.trim();
	if (text === "") {
		throw new PlatformError("output-invalid", "モデルが仮想回答を返しませんでした。");
	}
	const inputTokens = result.usage.inputTokens ?? 0;
	const outputTokens = result.usage.outputTokens ?? 0;
	return {
		text,
		usage: {
			inputTokens,
			outputTokens,
			totalTokens: result.usage.totalTokens ?? inputTokens + outputTokens,
			cacheReadTokens: result.usage.inputTokenDetails?.cacheReadTokens ?? 0,
		},
	};
}
