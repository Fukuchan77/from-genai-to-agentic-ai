import { PlatformError } from "../../errors";

export interface FusedRank {
	readonly id: string;
	readonly score: number;
}

function compareIds(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Reciprocal Rank Fusion (plan C7): each ranking gives an id `1 / (k + rank)` with a 1-based
 * rank, and the contributions are summed per id. An id appears once in the result, and an id
 * repeated inside one ranking counts at its first position only. Results are ordered by score,
 * ties by id in code unit order, so the output does not depend on the order of the rankings:
 * the contributions of an id are added in ascending order, which fixes the floating-point sum.
 */
export function reciprocalRankFusion(
	rankings: readonly (readonly string[])[],
	k: number,
): FusedRank[] {
	if (!Number.isFinite(k) || k < 0) {
		throw new PlatformError(
			"invalid-request",
			"RRF の定数 k は 0 以上の有限の数で指定してください。",
			{
				k,
			},
		);
	}

	const contributions = new Map<string, number[]>();
	for (const ranking of rankings) {
		const seen = new Set<string>();
		ranking.forEach((id, index) => {
			if (seen.has(id)) return;
			seen.add(id);
			const list = contributions.get(id) ?? [];
			list.push(1 / (k + index + 1));
			contributions.set(id, list);
		});
	}

	return [...contributions]
		.map(([id, list]) => ({
			id,
			score: list.sort((left, right) => left - right).reduce((sum, value) => sum + value, 0),
		}))
		.sort((left, right) => right.score - left.score || compareIds(left.id, right.id));
}
