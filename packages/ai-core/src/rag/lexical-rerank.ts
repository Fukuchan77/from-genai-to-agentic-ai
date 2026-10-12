import { PlatformError } from "../errors";
import type { RerankCandidate, RerankProvider, RerankScore } from "../ports/rerank";
import { toSearchText } from "./ingest/search-text";

/** Marks results as coming from the offline stand-in, not from a hosted rerank model. */
export const LEXICAL_RERANK_MODEL_ID = "mock:lexical-overlap";

function wordsOf(text: string): Set<string> {
	const searchText = toSearchText(text);
	return new Set(searchText === "" ? [] : searchText.split(" "));
}

function compareIds(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * A deterministic stand-in for a hosted rerank model (plan C2). The question and each candidate are
 * cut into words with the full-text index's segmentation, and a candidate scores the fraction of
 * the question's distinct words it contains. Needs no key and no network; ties go to the smaller id.
 */
export function createLexicalRerank(): RerankProvider {
	return {
		modelId: LEXICAL_RERANK_MODEL_ID,
		async rerank(query, candidates: readonly RerankCandidate[], { topN, signal }) {
			if (!Number.isInteger(topN) || topN < 1) {
				throw new PlatformError("invalid-request", "topN は 1 以上の整数で指定してください。");
			}
			if (signal?.aborted) throw signal.reason;

			const queryWords = wordsOf(query);
			const scored: RerankScore[] = candidates.map((candidate) => {
				if (queryWords.size === 0) return { id: candidate.id, score: 0 };
				const candidateWords = wordsOf(candidate.text);
				let shared = 0;
				for (const word of queryWords) if (candidateWords.has(word)) shared += 1;
				return { id: candidate.id, score: shared / queryWords.size };
			});
			return scored
				.sort((left, right) => right.score - left.score || compareIds(left.id, right.id))
				.slice(0, topN);
		},
	};
}
