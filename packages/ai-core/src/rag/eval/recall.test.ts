import { describe, expect, it } from "vitest";
import { PlatformError } from "../../errors";
import type { EvalQuestion } from "./dataset";
import { compareMethods, hitRateAtK, meanRecallAtK, recallAtK } from "./recall";

function question(id: string, goldChunkIds: string[]): EvalQuestion {
	return { id, question: `question ${id}`, goldChunkIds, referenceAnswer: `answer ${id}` };
}

describe("recallAtK", () => {
	it("is the share of gold chunks found in the top k", () => {
		// gold {a, b, c, d}; top 3 = x, a, b -> 2 of 4.
		expect(recallAtK(["x", "a", "b", "c"], ["a", "b", "c", "d"], 3)).toBe(0.5);
	});

	it("is 1 when every gold chunk is in the top k and 0 when none is", () => {
		expect(recallAtK(["a", "b", "x"], ["a", "b"], 3)).toBe(1);
		expect(recallAtK(["x", "y", "a"], ["a"], 2)).toBe(0);
	});

	it("ignores gold chunks ranked below k", () => {
		expect(recallAtK(["x", "y", "a"], ["a"], 2)).toBe(0);
		expect(recallAtK(["x", "y", "a"], ["a"], 3)).toBe(1);
	});

	it("is 0 when k is 0", () => {
		expect(recallAtK(["a"], ["a"], 0)).toBe(0);
	});

	it("uses every candidate when k is larger than the candidate list", () => {
		expect(recallAtK(["a", "x"], ["a", "b"], 50)).toBe(0.5);
	});

	it("is 0 when there are no candidates", () => {
		expect(recallAtK([], ["a"], 5)).toBe(0);
	});

	it("is 0 when there is no gold chunk instead of dividing by zero", () => {
		expect(recallAtK(["a", "b"], [], 2)).toBe(0);
	});

	it("counts a gold chunk once when the retrieved list repeats it", () => {
		expect(recallAtK(["a", "a", "a"], ["a", "b"], 3)).toBe(0.5);
	});

	it("does not let repeated candidates use up the k slots", () => {
		// Distinct candidates in order: a, b. k = 2 therefore reaches b.
		expect(recallAtK(["a", "a", "b"], ["a", "b"], 2)).toBe(1);
	});

	it("counts a gold chunk once when the gold list repeats it", () => {
		expect(recallAtK(["a"], ["a", "a", "b"], 1)).toBe(0.5);
	});

	it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("rejects k = %s", (k) => {
		expect(() => recallAtK(["a"], ["a"], k)).toThrow(PlatformError);
		expect(() => recallAtK(["a"], ["a"], k)).toThrow(
			expect.objectContaining({ code: "invalid-request" }),
		);
	});
});

describe("hitRateAtK", () => {
	it("is 1 when any gold chunk is in the top k", () => {
		expect(hitRateAtK(["x", "a"], ["a", "b"], 2)).toBe(1);
	});

	it("is 0 when no gold chunk is in the top k", () => {
		expect(hitRateAtK(["x", "y", "a"], ["a"], 2)).toBe(0);
	});

	it("is 0 when k is 0 or the gold list is empty", () => {
		expect(hitRateAtK(["a"], ["a"], 0)).toBe(0);
		expect(hitRateAtK(["a"], [], 3)).toBe(0);
	});

	it("is 1 for a partial hit where recall is below 1", () => {
		expect(recallAtK(["a"], ["a", "b"], 1)).toBe(0.5);
		expect(hitRateAtK(["a"], ["a", "b"], 1)).toBe(1);
	});

	it("rejects an invalid k", () => {
		expect(() => hitRateAtK(["a"], ["a"], -1)).toThrow(PlatformError);
	});
});

describe("meanRecallAtK", () => {
	it("averages the per-question recalls", () => {
		expect(meanRecallAtK([{ recall: 1 }, { recall: 0.5 }, { recall: 0 }])).toBe(0.5);
	});

	it("is the single value for one question", () => {
		expect(meanRecallAtK([{ recall: 0.25 }])).toBe(0.25);
	});

	it("is 0 for no results", () => {
		expect(meanRecallAtK([])).toBe(0);
	});
});

describe("compareMethods", () => {
	const dataset = [question("q1", ["a", "b"]), question("q2", ["c"])];
	const combinations = [
		{ label: "vector", methods: { rerank: false } },
		{ label: "vector+rerank", methods: { rerank: true } },
	];

	const retrievalByMethod: Record<string, Record<string, string[]>> = {
		false: { q1: ["x", "a", "y"], q2: ["x", "y", "z"] },
		true: { q1: ["a", "b", "x"], q2: ["c", "x", "y"] },
	};

	async function run(k = 3) {
		return compareMethods(
			dataset,
			async (item, methods) => retrievalByMethod[String(methods.rerank)]?.[item.id] ?? [],
			{ combinations, k },
		);
	}

	it("reports the mean recall and per-question results for each combination", async () => {
		const result = await run();

		expect(result.k).toBe(3);
		expect(result.combinations.map((entry) => entry.label)).toEqual(["vector", "vector+rerank"]);
		const [plain, reranked] = result.combinations;
		expect(plain?.meanRecall).toBe(0.25); // (0.5 + 0) / 2
		expect(plain?.hitRate).toBe(0.5);
		expect(plain?.perQuestion).toEqual([
			{ questionId: "q1", retrievedIds: ["x", "a", "y"], recall: 0.5, hit: true },
			{ questionId: "q2", retrievedIds: ["x", "y", "z"], recall: 0, hit: false },
		]);
		expect(reranked?.meanRecall).toBe(1);
		expect(reranked?.hitRate).toBe(1);
	});

	it("passes the combination's methods to the retrieval function, in dataset order", async () => {
		const calls: string[] = [];
		await compareMethods(
			dataset,
			async (item, methods) => {
				calls.push(`${item.id}:${methods.rerank}`);
				return [];
			},
			{ combinations, k: 3 },
		);

		expect(calls).toEqual(["q1:false", "q2:false", "q1:true", "q2:true"]);
	});

	it("scores only the top k of what the retrieval function returns", async () => {
		const result = await run(1);

		expect(result.combinations[1]?.meanRecall).toBe(0.75); // q1: a only -> 0.5, q2: 1
	});

	it("rejects an empty dataset, no combinations, and duplicate labels", async () => {
		const retrieve = async () => [];
		await expect(compareMethods([], retrieve, { combinations, k: 3 })).rejects.toThrow(
			expect.objectContaining({ code: "invalid-request" }),
		);
		await expect(compareMethods(dataset, retrieve, { combinations: [], k: 3 })).rejects.toThrow(
			expect.objectContaining({ code: "invalid-request" }),
		);
		await expect(
			compareMethods(dataset, retrieve, {
				combinations: [combinations[0], combinations[0]].filter((entry) => entry !== undefined),
				k: 3,
			}),
		).rejects.toThrow(expect.objectContaining({ code: "invalid-request" }));
	});

	it("stops without running further retrievals once the signal is aborted", async () => {
		const controller = new AbortController();
		let calls = 0;
		const pending = compareMethods(
			dataset,
			async () => {
				calls += 1;
				controller.abort(new Error("stop"));
				return [];
			},
			{ combinations, k: 3, signal: controller.signal },
		);

		await expect(pending).rejects.toThrow("stop");
		expect(calls).toBe(1);
	});
});
