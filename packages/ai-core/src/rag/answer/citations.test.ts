import { describe, expect, it } from "vitest";
import type { KnowledgeChunk, ScoredChunk } from "../store";
import { CITATION_EXCERPT_CHARACTERS, resolveCitations } from "./citations";

function scored(
	ordinal: number,
	overrides: Partial<KnowledgeChunk> = {},
	similarity?: number,
): ScoredChunk {
	const chunk: KnowledgeChunk = {
		id: `doc-a#${ordinal}`,
		documentId: "doc-a",
		documentTitle: "RAG overview",
		ordinal,
		headingPath: ["RAG", `Section ${ordinal}`],
		page: null,
		body: `Body of chunk ${ordinal}.`,
		...overrides,
	};
	return similarity === undefined
		? { chunk, score: 1 / ordinal }
		: { chunk, score: 1 / ordinal, similarity };
}

const THREE = [scored(0), scored(1), scored(2)];

function citedFlags(answer: string, chunks = THREE): boolean[] {
	return resolveCitations(answer, chunks).citations.map((citation) => citation.cited);
}

describe("resolveCitations: in-range footnotes", () => {
	it("keeps the answer and marks the cited chunks", () => {
		const result = resolveCitations("RRF fuses rankings [1]. Hybrid search helps [3].", THREE);

		expect(result.answer).toBe("RRF fuses rankings [1]. Hybrid search helps [3].");
		expect(result.removedCitations).toEqual([]);
		expect(result.citations.map((c) => [c.label, c.cited])).toEqual([
			[1, true],
			[2, false],
			[3, true],
		]);
	});

	it("returns every retrieved chunk in order, labelled from 1", () => {
		const { citations } = resolveCitations("x [2]", THREE);

		expect(citations.map((c) => c.chunkId)).toEqual(["doc-a#0", "doc-a#1", "doc-a#2"]);
		expect(citations.map((c) => c.label)).toEqual([1, 2, 3]);
	});

	it("collapses duplicate footnotes into one cited citation and keeps the text", () => {
		const answer = "A [2] and again [2], also [2].";
		const result = resolveCitations(answer, THREE);

		expect(result.answer).toBe(answer);
		expect(result.citations).toHaveLength(3);
		expect(result.citations.filter((c) => c.cited).map((c) => c.label)).toEqual([2]);
	});

	it("handles adjacent footnotes", () => {
		expect(citedFlags("Both agree [1][3].")).toEqual([true, false, true]);
	});

	it("treats the first and last ordinals as in range", () => {
		const result = resolveCitations("first [1] last [3]", THREE);

		expect(result.removedCitations).toEqual([]);
		expect(result.citations.map((c) => c.cited)).toEqual([true, false, true]);
	});
});

describe("resolveCitations: out-of-range footnotes (Req 1.11)", () => {
	it("removes [7] from the answer and records it, keeping the valid footnotes", () => {
		const result = resolveCitations("Alpha [1]. Beta [7]. Gamma [3].", THREE);

		expect(result.answer).toBe("Alpha [1]. Beta. Gamma [3].");
		expect(result.answer).not.toContain("[7]");
		expect(result.removedCitations).toEqual([7]);
		expect(result.citations.map((c) => c.cited)).toEqual([true, false, true]);
	});

	it("removes one past the last ordinal but keeps the last one", () => {
		const result = resolveCitations("ok [3] bad [4]", THREE);

		expect(result.answer).toBe("ok [3] bad");
		expect(result.removedCitations).toEqual([4]);
	});

	it("removes [0] because ordinals start at 1", () => {
		const result = resolveCitations("zero [0] one [1]", THREE);

		expect(result.answer).toBe("zero one [1]");
		expect(result.removedCitations).toEqual([0]);
		expect(result.citations.map((c) => c.cited)).toEqual([true, false, false]);
	});

	it("records each removed ordinal once, in order of first appearance, but removes every occurrence", () => {
		const result = resolveCitations("a [9] b [5] c [9] d [5].", THREE);

		expect(result.answer).toBe("a b c d.");
		expect(result.removedCitations).toEqual([9, 5]);
	});

	it("does not mark any chunk as cited when every footnote is out of range", () => {
		const result = resolveCitations("Only bad ones [8][9].", THREE);

		expect(result.answer).toBe("Only bad ones.");
		expect(result.removedCitations).toEqual([8, 9]);
		expect(result.citations.every((c) => !c.cited)).toBe(true);
	});

	it("removes every footnote when there are no chunks", () => {
		const result = resolveCitations("Nothing was retrieved [1], yet cited [2].", []);

		expect(result.answer).toBe("Nothing was retrieved, yet cited.");
		expect(result.removedCitations).toEqual([1, 2]);
		expect(result.citations).toEqual([]);
	});

	it("keeps the space between words when the footnote sits inside a sentence", () => {
		expect(resolveCitations("before [7] after", THREE).answer).toBe("before after");
		expect(resolveCitations("before[7]after", THREE).answer).toBe("beforeafter");
	});

	it("removes a footnote at the start of the answer", () => {
		expect(resolveCitations("[7] leads the line", THREE).answer).toBe("leads the line");
	});

	it("removes the footnote and the space before it at a line end", () => {
		expect(resolveCitations("line one [7]\nline two [1]", THREE).answer).toBe(
			"line one\nline two [1]",
		);
	});
});

describe("resolveCitations: full-width brackets", () => {
	it("recognises ［1］ as a citation, marks the chunk and writes it as [1]", () => {
		const result = resolveCitations("検索を組み合わせる［1］。", THREE);

		expect(result.answer).toBe("検索を組み合わせる[1]。");
		expect(result.citations.map((c) => c.cited)).toEqual([true, false, false]);
	});

	it("removes an out-of-range full-width footnote and records its number", () => {
		const result = resolveCitations("根拠なし［7］。根拠あり［2］。", THREE);

		expect(result.answer).toBe("根拠なし。根拠あり[2]。");
		expect(result.removedCitations).toEqual([7]);
		expect(result.citations.map((c) => c.cited)).toEqual([false, true, false]);
	});

	it("recognises full-width digits", () => {
		const result = resolveCitations("全角［２］と［９］", THREE);

		expect(result.answer).toBe("全角[2]と");
		expect(result.removedCitations).toEqual([9]);
		expect(result.citations.map((c) => c.cited)).toEqual([false, true, false]);
	});

	it("treats a footnote counted as the same ordinal in both widths as one citation", () => {
		const result = resolveCitations("a [1] b ［1］", THREE);

		expect(result.citations.filter((c) => c.cited)).toHaveLength(1);
	});
});

describe("resolveCitations: code is not a citation", () => {
	it("ignores [n] inside a fenced code block", () => {
		const answer = "Use an array:\n```ts\nconst a = items[7];\nconst b = [1];\n```\nDone.";
		const result = resolveCitations(answer, THREE);

		expect(result.answer).toBe(answer);
		expect(result.removedCitations).toEqual([]);
		expect(result.citations.every((c) => !c.cited)).toBe(true);
	});

	it("ignores [n] inside a tilde fence and keeps the text after the closing fence", () => {
		const answer = "~~~\n[9] and [1]\n~~~\nAfter [2] and [8].";
		const result = resolveCitations(answer, THREE);

		expect(result.answer).toBe("~~~\n[9] and [1]\n~~~\nAfter [2] and.");
		expect(result.removedCitations).toEqual([8]);
		expect(result.citations.map((c) => c.cited)).toEqual([false, true, false]);
	});

	it("treats an unterminated fence as code to the end of the text", () => {
		const answer = "Intro [1]\n```\n[8] never closed [2]";
		const result = resolveCitations(answer, THREE);

		expect(result.answer).toBe(answer);
		expect(result.removedCitations).toEqual([]);
		expect(result.citations.map((c) => c.cited)).toEqual([true, false, false]);
	});

	it("does not close a backtick fence with a shorter or different fence", () => {
		const answer = "````\n```\n[7]\n~~~\n````\ntext [8]";
		const result = resolveCitations(answer, THREE);

		expect(result.answer).toBe("````\n```\n[7]\n~~~\n````\ntext");
		expect(result.removedCitations).toEqual([8]);
	});

	it("ignores [n] inside inline code", () => {
		const result = resolveCitations("Index with `xs[7]` and cite [2].", THREE);

		expect(result.answer).toBe("Index with `xs[7]` and cite [2].");
		expect(result.removedCitations).toEqual([]);
		expect(result.citations.map((c) => c.cited)).toEqual([false, true, false]);
	});

	it("matches inline code by backtick run length", () => {
		const result = resolveCitations("Write ``a ` [7] b`` then [8].", THREE);

		expect(result.answer).toBe("Write ``a ` [7] b`` then.");
		expect(result.removedCitations).toEqual([8]);
	});

	it("treats an unmatched backtick as plain text", () => {
		const result = resolveCitations("It's a ` mark [7] only.", THREE);

		expect(result.answer).toBe("It's a ` mark only.");
		expect(result.removedCitations).toEqual([7]);
	});

	it("counts a footnote after the code as a citation", () => {
		expect(citedFlags("```\ncode\n```\nthen [3]")).toEqual([false, false, true]);
	});
});

describe("resolveCitations: not a footnote", () => {
	it("leaves markdown links and non-numeric brackets alone", () => {
		const answer = "See [1](https://example.test), [note], [1a], [], [ 2 ] and [-1].";
		const result = resolveCitations(answer, THREE);

		expect(result.answer).toBe(answer);
		expect(result.removedCitations).toEqual([]);
		expect(result.citations.every((c) => !c.cited)).toBe(true);
	});

	it("does not treat a number with a decimal point as a footnote", () => {
		const result = resolveCitations("Version [1.5] is out.", THREE);

		expect(result.answer).toBe("Version [1.5] is out.");
		expect(result.removedCitations).toEqual([]);
	});
});

describe("resolveCitations: no footnotes or no chunks", () => {
	it("returns every chunk with cited: false when the answer has no footnote", () => {
		const result = resolveCitations("An answer without any footnote.", THREE);

		expect(result.answer).toBe("An answer without any footnote.");
		expect(result.removedCitations).toEqual([]);
		expect(result.citations).toHaveLength(3);
		expect(result.citations.every((c) => c.cited === false)).toBe(true);
	});

	it("returns nothing for zero chunks and an answer without footnotes", () => {
		expect(resolveCitations("Plain.", [])).toEqual({
			answer: "Plain.",
			citations: [],
			removedCitations: [],
		});
	});

	it("handles an empty answer", () => {
		const result = resolveCitations("", THREE);

		expect(result.answer).toBe("");
		expect(result.citations.every((c) => !c.cited)).toBe(true);
	});
});

describe("resolveCitations: excerpt", () => {
	it("uses the whole body when it is short", () => {
		const { citations } = resolveCitations("", [scored(0, { body: "short body" })]);

		expect(citations[0]?.excerpt).toBe("short body");
	});

	it("cuts the body to the first 200 characters", () => {
		expect(CITATION_EXCERPT_CHARACTERS).toBe(200);
		const body = `${"a".repeat(200)}TAIL`;
		const { citations } = resolveCitations("", [scored(0, { body })]);

		expect(citations[0]?.excerpt).toBe("a".repeat(200));
		expect(citations[0]?.excerpt).toHaveLength(200);
	});

	it("keeps a body of exactly 200 characters whole", () => {
		const body = "b".repeat(200);

		expect(resolveCitations("", [scored(0, { body })]).citations[0]?.excerpt).toBe(body);
	});

	it("counts code points, so an emoji or kanji is one character and no pair is split", () => {
		const body = `${"😀".repeat(199)}あ😀tail`;
		const excerpt = resolveCitations("", [scored(0, { body })]).citations[0]?.excerpt ?? "";

		expect([...excerpt]).toHaveLength(200);
		expect(excerpt).toBe(`${"😀".repeat(199)}あ`);
	});
});

describe("resolveCitations: citation fields", () => {
	it("describes a PDF chunk with a page locator", () => {
		const { citations } = resolveCitations("", [
			scored(4, {
				id: "paper#4",
				documentId: "paper",
				documentTitle: "Paper",
				page: 12,
				headingPath: [],
			}),
		]);

		expect(citations[0]).toEqual({
			chunkId: "paper#4",
			label: 1,
			documentId: "paper",
			documentTitle: "Paper",
			locator: { kind: "page", page: 12 },
			excerpt: "Body of chunk 4.",
			cited: false,
		});
	});

	it("describes a Markdown chunk with its heading path", () => {
		const { citations } = resolveCitations("", [
			scored(1, { headingPath: ["Guide", "Retrieval", "RRF"] }),
		]);

		expect(citations[0]?.locator).toEqual({ kind: "heading", path: ["Guide", "Retrieval", "RRF"] });
	});

	it("prefers the page when a chunk has both a page and a heading path", () => {
		const { citations } = resolveCitations("", [scored(1, { page: 3, headingPath: ["H"] })]);

		expect(citations[0]?.locator).toEqual({ kind: "page", page: 3 });
	});

	it("copies the heading path so later changes to the input do not leak", () => {
		const path = ["A", "B"];
		const { citations } = resolveCitations("", [scored(1, { headingPath: path })]);
		path.push("C");

		expect(citations[0]?.locator).toEqual({ kind: "heading", path: ["A", "B"] });
	});

	it("carries the similarity when the chunk has one and omits the key when it does not", () => {
		const { citations } = resolveCitations("", [scored(0, {}, 0.83), scored(1), scored(2, {}, 0)]);

		expect(citations[0]?.similarity).toBe(0.83);
		expect(citations[1]).not.toHaveProperty("similarity");
		expect(citations[2]?.similarity).toBe(0);
	});

	it("does not change the input chunks", () => {
		const chunks = [scored(0), scored(1)];
		const snapshot = structuredClone(chunks);

		resolveCitations("x [1] [9]", chunks);

		expect(chunks).toEqual(snapshot);
	});
});

describe("resolveCitations: grouped footnotes (review F-1)", () => {
	it("keeps the in-range numbers of '[1, 7]' and removes only the out-of-range one", () => {
		const result = resolveCitations("A [1, 7].", THREE);
		expect(result.answer).toBe("A [1].");
		expect(result.removedCitations).toEqual([7]);
		expect(result.citations.map((citation) => citation.cited)).toEqual([true, false, false]);
	});

	it("handles '[1,2]' without spaces, and marks both chunks cited", () => {
		const result = resolveCitations("A [1,2].", THREE);
		expect(result.answer).toBe("A [1][2].");
		expect(result.removedCitations).toEqual([]);
		expect(result.citations.map((citation) => citation.cited)).toEqual([true, true, false]);
	});

	it("expands a range '[1-3]'", () => {
		const result = resolveCitations("A [1-3].", THREE);
		expect(result.answer).toBe("A [1][2][3].");
		expect(result.citations.every((citation) => citation.cited)).toBe(true);
	});

	it("removes the part of a range that is out of range and records it", () => {
		const result = resolveCitations("A [2-5].", THREE);
		expect(result.answer).toBe("A [2][3].");
		expect(result.removedCitations).toEqual([4, 5]);
	});

	it("removes a group whose numbers are all out of range, with the gap before the full stop", () => {
		const result = resolveCitations("A [8, 9].", THREE);
		expect(result.answer).toBe("A.");
		expect(result.removedCitations).toEqual([8, 9]);
	});

	it("reads full-width groups too", () => {
		const result = resolveCitations("A ［１、９］。", THREE);
		expect(result.answer).toBe("A [1]。");
		expect(result.removedCitations).toEqual([9]);
	});

	it("does not treat a group inside code as a citation", () => {
		const result = resolveCitations("`xs[1, 9]` and [2]", THREE);
		expect(result.answer).toBe("`xs[1, 9]` and [2]");
		expect(result.removedCitations).toEqual([]);
	});

	it("leaves a reversed or huge range alone (it is not a footnote)", () => {
		expect(resolveCitations("A [3-1].", THREE).answer).toBe("A [3-1].");
		expect(resolveCitations("A [1-99999].", THREE).answer).toBe("A [1-99999].");
		expect(resolveCitations("A [3-1].", THREE).removedCitations).toEqual([]);
	});

	it("leaves lists with a non-number alone", () => {
		expect(resolveCitations("A [1, a].", THREE).answer).toBe("A [1, a].");
		expect(resolveCitations("A [1,].", THREE).answer).toBe("A [1,].");
	});
});
