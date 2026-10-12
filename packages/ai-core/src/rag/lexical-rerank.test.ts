import { describe, expect, it } from "vitest";
import { PlatformError } from "../errors";
import { createLexicalRerank } from "./lexical-rerank";

const rerank = createLexicalRerank();

function ids(rows: readonly { readonly id: string }[]): string[] {
	return rows.map((row) => row.id);
}

describe("createLexicalRerank", () => {
	it("names itself as a mock implementation", () => {
		expect(rerank.modelId).toMatch(/mock/i);
	});

	it("ranks the candidate that shares more of the question's words first", () => {
		const scores = rerank.rerank(
			"vector search latency budget",
			[
				{ id: "none", text: "Quarterly holiday calendar" },
				{ id: "some", text: "The vector index is rebuilt nightly" },
				{ id: "most", text: "Latency budget for vector search is 200 ms" },
			],
			{ topN: 3 },
		);

		return expect(scores.then(ids)).resolves.toEqual(["most", "some", "none"]);
	});

	it("scores by the fraction of the question's distinct words found in the candidate", async () => {
		const scores = await rerank.rerank(
			"alpha beta gamma delta",
			[
				{ id: "half", text: "alpha beta" },
				{ id: "all", text: "delta gamma beta alpha extra words" },
				{ id: "none", text: "unrelated" },
			],
			{ topN: 3 },
		);

		expect(scores).toEqual([
			{ id: "all", score: 1 },
			{ id: "half", score: 0.5 },
			{ id: "none", score: 0 },
		]);
	});

	it("does not reward a repeated word in the question or in the candidate", async () => {
		const scores = await rerank.rerank(
			"alpha alpha beta",
			[{ id: "a", text: "alpha alpha alpha alpha" }],
			{ topN: 1 },
		);

		expect(scores).toEqual([{ id: "a", score: 0.5 }]);
	});

	it("matches words ignoring case and full-width forms", async () => {
		const scores = await rerank.rerank("ＲＡＧ Pipeline", [{ id: "a", text: "rag pipeline" }], {
			topN: 1,
		});

		expect(scores).toEqual([{ id: "a", score: 1 }]);
	});

	it("matches Japanese text through the same word segmentation as the full-text index", async () => {
		const scores = await rerank.rerank(
			"検索精度の評価",
			[
				{ id: "match", text: "検索精度を評価する方法" },
				{ id: "miss", text: "天気予報の更新時刻" },
			],
			{ topN: 2 },
		);

		expect(ids(scores)).toEqual(["match", "miss"]);
		expect(scores[0]?.score).toBeGreaterThan(0);
		expect(scores[1]?.score).toBe(0);
	});

	it("returns the same order for the same input every time", async () => {
		const candidates = [
			{ id: "c", text: "alpha" },
			{ id: "a", text: "beta" },
			{ id: "b", text: "alpha beta" },
		];
		const first = await rerank.rerank("alpha beta", candidates, { topN: 3 });
		const second = await rerank.rerank("alpha beta", candidates, { topN: 3 });

		expect(second).toEqual(first);
	});

	it("breaks score ties by id, whatever the input order", async () => {
		const forward = await rerank.rerank(
			"alpha",
			[
				{ id: "b", text: "alpha" },
				{ id: "a", text: "alpha" },
				{ id: "c", text: "alpha" },
			],
			{ topN: 3 },
		);
		const backward = await rerank.rerank(
			"alpha",
			[
				{ id: "c", text: "alpha" },
				{ id: "a", text: "alpha" },
				{ id: "b", text: "alpha" },
			],
			{ topN: 3 },
		);

		expect(ids(forward)).toEqual(["a", "b", "c"]);
		expect(ids(backward)).toEqual(["a", "b", "c"]);
	});

	it("keeps only the topN best candidates", async () => {
		const scores = await rerank.rerank(
			"alpha beta gamma",
			[
				{ id: "one", text: "alpha" },
				{ id: "three", text: "alpha beta gamma" },
				{ id: "two", text: "alpha beta" },
			],
			{ topN: 2 },
		);

		expect(ids(scores)).toEqual(["three", "two"]);
	});

	it("returns every candidate when topN exceeds their number", async () => {
		const scores = await rerank.rerank("alpha", [{ id: "a", text: "alpha" }], { topN: 10 });

		expect(scores).toHaveLength(1);
	});

	it("returns an empty list for no candidates", async () => {
		await expect(rerank.rerank("alpha", [], { topN: 3 })).resolves.toEqual([]);
	});

	it("scores 0 for every candidate when the question has no usable words", async () => {
		const scores = await rerank.rerank(
			"？！",
			[
				{ id: "b", text: "alpha" },
				{ id: "a", text: "beta" },
			],
			{ topN: 2 },
		);

		expect(scores).toEqual([
			{ id: "a", score: 0 },
			{ id: "b", score: 0 },
		]);
	});

	it("scores 0 for a candidate with no words", async () => {
		const scores = await rerank.rerank("alpha", [{ id: "a", text: "" }], { topN: 1 });

		expect(scores).toEqual([{ id: "a", score: 0 }]);
	});

	it.each([0, -1, 1.5, Number.NaN])("rejects topN = %s", async (topN) => {
		await expect(rerank.rerank("alpha", [{ id: "a", text: "alpha" }], { topN })).rejects.toThrow(
			PlatformError,
		);
	});

	it("throws the signal's reason when it is already aborted", async () => {
		const reason = new DOMException("Stopped", "AbortError");

		await expect(
			rerank.rerank("alpha", [{ id: "a", text: "alpha" }], {
				topN: 1,
				signal: AbortSignal.abort(reason),
			}),
		).rejects.toBe(reason);
	});
});
