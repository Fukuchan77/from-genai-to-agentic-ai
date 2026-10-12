import { PlatformError } from "../../errors";

// Retrieval accuracy arithmetic (plan C10, Req 2.9). Pure functions over chunk IDs, so the
// definitions stay independent of how a retrieval method produced the list.

/** The part of an `EvalQuestion` that scoring needs. */
export interface ScorableQuestion {
	readonly id: string;
	readonly goldChunkIds: readonly string[];
}

function assertValidK(k: number): void {
	if (!Number.isInteger(k) || k < 0) {
		throw new PlatformError("invalid-request", "k は 0 以上の整数で指定してください。");
	}
}

/** The first `k` distinct IDs: a repeated ID is one chunk, so it never uses up a second slot. */
function topKDistinct(retrievedIds: readonly string[], k: number): Set<string> {
	const top = new Set<string>();
	for (const id of retrievedIds) {
		if (top.size >= k) break;
		top.add(id);
	}
	return top;
}

/**
 * Recall at k: gold chunks found among the top `k` distinct retrieved IDs, divided by the number
 * of distinct gold chunks. Returns 0 when there is no gold chunk (nothing can be recalled);
 * `loadEvalSet` rejects such questions before they reach scoring.
 */
export function recallAtK(
	retrievedIds: readonly string[],
	goldIds: readonly string[],
	k: number,
): number {
	assertValidK(k);
	const gold = new Set(goldIds);
	if (gold.size === 0) return 0;
	const top = topKDistinct(retrievedIds, k);
	let found = 0;
	for (const id of gold) {
		if (top.has(id)) found += 1;
	}
	return found / gold.size;
}

/** 1 when at least one gold chunk is in the top `k`, otherwise 0. */
export function hitRateAtK(
	retrievedIds: readonly string[],
	goldIds: readonly string[],
	k: number,
): 0 | 1 {
	assertValidK(k);
	const gold = new Set(goldIds);
	for (const id of topKDistinct(retrievedIds, k)) {
		if (gold.has(id)) return 1;
	}
	return 0;
}

/** Mean of the per-question recalls; 0 for no results. */
export function meanRecallAtK(results: readonly { readonly recall: number }[]): number {
	if (results.length === 0) return 0;
	let total = 0;
	for (const result of results) total += result.recall;
	return total / results.length;
}

/** One combination of retrieval methods to compare, e.g. vector search with rerank. */
export interface MethodCombination<M> {
	readonly label: string;
	readonly methods: M;
}

export interface QuestionRetrievalResult {
	readonly questionId: string;
	readonly retrievedIds: readonly string[];
	readonly recall: number;
	readonly hit: boolean;
}

export interface CombinationResult<M> {
	readonly label: string;
	readonly methods: M;
	readonly meanRecall: number;
	/** Share of questions with at least one gold chunk in the top k. */
	readonly hitRate: number;
	readonly perQuestion: readonly QuestionRetrievalResult[];
}

export interface MethodComparison<M> {
	readonly k: number;
	readonly combinations: readonly CombinationResult<M>[];
}

export interface CompareMethodsOptions<M> {
	readonly combinations: readonly MethodCombination<M>[];
	readonly k: number;
	readonly signal?: AbortSignal;
}

/**
 * Runs every question of the same dataset through every method combination and scores the top
 * `k`. Retrievals run one at a time in dataset order, so a comparison is reproducible.
 */
export async function compareMethods<M, Q extends ScorableQuestion>(
	dataset: readonly Q[],
	retrieveFor: (question: Q, methods: M) => Promise<readonly string[]>,
	options: CompareMethodsOptions<M>,
): Promise<MethodComparison<M>> {
	const { combinations, k, signal } = options;
	assertValidK(k);
	if (dataset.length === 0) {
		throw new PlatformError("invalid-request", "比較する質問が 1 件もありません。");
	}
	if (combinations.length === 0) {
		throw new PlatformError("invalid-request", "比較する手法の組み合わせが 1 件もありません。");
	}
	if (new Set(combinations.map((entry) => entry.label)).size !== combinations.length) {
		throw new PlatformError("invalid-request", "手法の組み合わせの名前が重複しています。");
	}

	const results: CombinationResult<M>[] = [];
	for (const combination of combinations) {
		const perQuestion: QuestionRetrievalResult[] = [];
		for (const item of dataset) {
			if (signal?.aborted) throw signal.reason;
			const retrievedIds = await retrieveFor(item, combination.methods);
			perQuestion.push({
				questionId: item.id,
				retrievedIds,
				recall: recallAtK(retrievedIds, item.goldChunkIds, k),
				hit: hitRateAtK(retrievedIds, item.goldChunkIds, k) === 1,
			});
		}
		results.push({
			label: combination.label,
			methods: combination.methods,
			meanRecall: meanRecallAtK(perQuestion),
			hitRate: perQuestion.filter((entry) => entry.hit).length / perQuestion.length,
			perQuestion,
		});
	}
	return { k, combinations: results };
}
