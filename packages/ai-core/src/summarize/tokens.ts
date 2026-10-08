import { countTokens } from "gpt-tokenizer";

/**
 * Local estimates use the o200k tokenizer for every provider (Ollama has no token-count API), so
 * they are multiplied by a safety factor to cover tokenizer differences (ADR-9).
 */
export const TOKEN_SAFETY_FACTOR = 1.2;

/** Raw gpt-tokenizer count, without the safety factor. */
export function countTextTokens(text: string): number {
	return countTokens(text);
}

/** Applies the safety factor to a raw count, rounding up. */
export function estimateFromCount(rawTokens: number): number {
	return Math.ceil(rawTokens * TOKEN_SAFETY_FACTOR);
}

export function estimateTokens(text: string): number {
	return estimateFromCount(countTextTokens(text));
}
