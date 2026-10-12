import { describe, expect, it } from "vitest";
import { DEFAULT_RAG } from "../../config/defaults";
import { PlatformError } from "../../errors";
import { reciprocalRankFusion } from "./rrf";

function ids(rows: readonly { readonly id: string }[]): string[] {
	return rows.map((row) => row.id);
}

function scoreOf(rows: readonly { readonly id: string; readonly score: number }[], id: string) {
	return rows.find((row) => row.id === id)?.score;
}

describe("reciprocalRankFusion: de-duplication", () => {
	it("returns an id that appears in several rankings exactly once", () => {
		const fused = reciprocalRankFusion(
			[
				["a", "b", "c"],
				["c", "a", "d"],
				["a", "c"],
			],
			60,
		);

		expect(ids(fused).filter((id) => id === "a")).toHaveLength(1);
		expect(ids(fused).filter((id) => id === "c")).toHaveLength(1);
		expect([...ids(fused)].sort()).toEqual(["a", "b", "c", "d"]);
	});

	it("counts an id repeated inside one ranking once, at its first position", () => {
		const fused = reciprocalRankFusion([["a", "b", "a"]], 60);

		expect(ids(fused)).toEqual(["a", "b"]);
		expect(scoreOf(fused, "a")).toBeCloseTo(1 / 61, 12);
		expect(scoreOf(fused, "b")).toBeCloseTo(1 / 62, 12);
	});
});

describe("reciprocalRankFusion: scores", () => {
	it("scores 1 / (k + rank) with 1-based ranks, summed over the rankings", () => {
		const fused = reciprocalRankFusion(
			[
				["a", "b"],
				["b", "c"],
			],
			60,
		);

		expect(scoreOf(fused, "a")).toBeCloseTo(1 / 61, 12);
		expect(scoreOf(fused, "b")).toBeCloseTo(1 / 62 + 1 / 61, 12);
		expect(scoreOf(fused, "c")).toBeCloseTo(1 / 62, 12);
		expect(ids(fused)).toEqual(["b", "a", "c"]);
	});

	it("orders by the fused score, so an id found by both rankings beats a single first place", () => {
		const fused = reciprocalRankFusion(
			[
				["solo", "both"],
				["both", "other"],
			],
			60,
		);

		expect(ids(fused)).toEqual(["both", "solo", "other"]);
	});

	it("uses the default constant of the project when called with it", () => {
		const fused = reciprocalRankFusion([["a"]], DEFAULT_RAG.rrfK);

		expect(scoreOf(fused, "a")).toBeCloseTo(1 / (DEFAULT_RAG.rrfK + 1), 12);
	});

	it("applies k to the scores: a small k widens the gap between ranks, a large k narrows it", () => {
		const gap = (k: number) => {
			const fused = reciprocalRankFusion([["a", "b"]], k);
			return (scoreOf(fused, "a") ?? 0) - (scoreOf(fused, "b") ?? 0);
		};

		expect(scoreOf(reciprocalRankFusion([["a"]], 0), "a")).toBeCloseTo(1, 12);
		expect(scoreOf(reciprocalRankFusion([["a"]], 1), "a")).toBeCloseTo(1 / 2, 12);
		expect(gap(1)).toBeGreaterThan(gap(60));
		expect(gap(60)).toBeGreaterThan(gap(1000));
	});

	it("lets k decide between one top rank and steady presence at a deep rank", () => {
		// "top" is 1st in one ranking; "deep" is 4th in all three.
		const rankings = [
			["top", "p1", "p2", "deep"],
			["q1", "q2", "q3", "deep"],
			["r1", "r2", "r3", "deep"],
		];
		const narrow = reciprocalRankFusion(rankings, 0);
		const wide = reciprocalRankFusion(rankings, 100);

		expect(scoreOf(narrow, "top") ?? 0).toBeGreaterThan(scoreOf(narrow, "deep") ?? 0);
		expect(scoreOf(wide, "deep") ?? 0).toBeGreaterThan(scoreOf(wide, "top") ?? 0);
		expect(ids(wide)[0]).toBe("deep");
	});
});

describe("reciprocalRankFusion: determinism", () => {
	it("breaks score ties by id in code unit order", () => {
		const fused = reciprocalRankFusion([["b"], ["a"], ["c"], ["B"]], 60);

		expect(ids(fused)).toEqual(["B", "a", "b", "c"]);
	});

	it("gives the same result when the rankings are given in any order (property)", () => {
		const universe = ["a", "b", "c", "d", "e", "f", "g"];
		let seed = 12_345;
		const next = () => {
			seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
			return seed / 2_147_483_648;
		};
		const shuffled = <T>(items: readonly T[]): T[] => {
			const copy = [...items];
			for (let index = copy.length - 1; index > 0; index -= 1) {
				const other = Math.floor(next() * (index + 1));
				[copy[index], copy[other]] = [copy[other] as T, copy[index] as T];
			}
			return copy;
		};

		for (let round = 0; round < 50; round += 1) {
			const rankings = Array.from({ length: 4 }, () =>
				shuffled(universe).slice(0, 1 + Math.floor(next() * universe.length)),
			);
			const expected = reciprocalRankFusion(rankings, 60);

			expect(reciprocalRankFusion(shuffled(rankings), 60)).toEqual(expected);
			expect(reciprocalRankFusion([...rankings].reverse(), 60)).toEqual(expected);
		}
	});

	it("does not mutate its input", () => {
		const rankings = [
			["a", "b"],
			["b", "a"],
		];
		const snapshot = structuredClone(rankings);

		reciprocalRankFusion(rankings, 60);

		expect(rankings).toEqual(snapshot);
	});
});

describe("reciprocalRankFusion: edge cases", () => {
	it("returns an empty list for no rankings and for empty rankings", () => {
		expect(reciprocalRankFusion([], 60)).toEqual([]);
		expect(reciprocalRankFusion([[], []], 60)).toEqual([]);
	});

	it("returns a single ranking in its own order", () => {
		expect(ids(reciprocalRankFusion([["c", "a", "b"]], 60))).toEqual(["c", "a", "b"]);
	});

	it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])("rejects k = %s", (k) => {
		expect(() => reciprocalRankFusion([["a"]], k)).toThrow(PlatformError);
	});
});
