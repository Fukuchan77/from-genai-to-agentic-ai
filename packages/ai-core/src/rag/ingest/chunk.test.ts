import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DEFAULT_RAG } from "../../config/defaults";
import { PlatformError } from "../../errors";
import { type Chunk, chunkDocument, type LoadedDocument } from "./chunk";
import type { MarkdownSection } from "./markdown";

const DOC_ID = "kb:guide.md";

function markdownDoc(sections: MarkdownSection[]): LoadedDocument {
	return { file: "guide.md", title: "Guide", sourceType: "markdown", tags: [], sections };
}

function pdfDoc(pages: string[]): LoadedDocument {
	return { file: "guide.pdf", title: "Guide", sourceType: "pdf", tags: [], pages };
}

function section(headingPath: string[], body: string): MarkdownSection {
	return { headingPath, body };
}

function expectedId(documentId: string, headingPath: string[], body: string): string {
	return createHash("sha256")
		.update(`${documentId}\n${headingPath.join(" > ")}\n${body}`)
		.digest("hex")
		.slice(0, 16);
}

function codePoints(text: string): number {
	return [...text].length;
}

function bodies(chunks: Chunk[]): string[] {
	return chunks.map((chunk) => chunk.body);
}

describe("chunkDocument: sections", () => {
	it("emits one chunk per short section with its heading path", () => {
		const chunks = chunkDocument(
			markdownDoc([section(["A"], "alpha"), section(["A", "B"], "beta")]),
			{ documentId: DOC_ID },
		);

		expect(chunks.map((c) => [c.headingPath, c.body])).toEqual([
			[["A"], "alpha"],
			[["A", "B"], "beta"],
		]);
		expect(chunks.every((c) => c.page === undefined)).toBe(true);
	});

	it("skips sections whose body is empty or whitespace", () => {
		const chunks = chunkDocument(
			markdownDoc([section(["Parent"], ""), section(["Parent", "Child"], "text")]),
			{ documentId: DOC_ID },
		);

		expect(bodies(chunks)).toEqual(["text"]);
	});

	it("returns no chunks for a document without sections", () => {
		expect(chunkDocument(markdownDoc([]), { documentId: DOC_ID })).toEqual([]);
	});

	it("rejects a non-positive or fractional chunk size", () => {
		for (const maxCharacters of [0, -5, 1.5, Number.NaN]) {
			expect(() =>
				chunkDocument(markdownDoc([section(["A"], "x")]), { documentId: DOC_ID, maxCharacters }),
			).toThrow(PlatformError);
		}
		expect(() =>
			chunkDocument(markdownDoc([section(["A"], "x")]), { documentId: DOC_ID, maxCharacters: 0 }),
		).toThrow(expect.objectContaining({ code: "invalid-request" }));
	});
});

describe("chunkDocument: size limit in code points", () => {
	it("defaults the limit to DEFAULT_RAG.chunkMaxCharacters", () => {
		const limit = DEFAULT_RAG.chunkMaxCharacters;
		const fits = chunkDocument(markdownDoc([section(["A"], "あ".repeat(limit))]), {
			documentId: DOC_ID,
		});
		const over = chunkDocument(markdownDoc([section(["A"], "あ".repeat(limit + 1))]), {
			documentId: DOC_ID,
		});

		expect(fits).toHaveLength(1);
		expect(over.length).toBeGreaterThan(1);
		expect(over.every((c) => codePoints(c.body) <= limit)).toBe(true);
	});

	it("counts a surrogate pair as one character", () => {
		const emoji = "😀".repeat(4);
		expect(emoji.length).toBe(8);

		const chunks = chunkDocument(markdownDoc([section(["A"], emoji)]), {
			documentId: DOC_ID,
			maxCharacters: 4,
		});

		expect(bodies(chunks)).toEqual([emoji]);
	});

	it("keeps text in one chunk when only its UTF-16 length exceeds the limit", () => {
		const text = "😀😀😀。😀😀😀。";
		expect(codePoints(text)).toBe(8);
		expect(text.length).toBe(14);

		const chunks = chunkDocument(markdownDoc([section(["A"], text)]), {
			documentId: DOC_ID,
			maxCharacters: 8,
		});

		expect(bodies(chunks)).toEqual([text]);
	});

	it("applies the default limit in code points too", () => {
		const text = "😀".repeat(DEFAULT_RAG.chunkMaxCharacters);

		const chunks = chunkDocument(markdownDoc([section(["A"], text)]), { documentId: DOC_ID });

		expect(bodies(chunks)).toEqual([text]);
	});

	it("hard-splits an over-long run without cutting a surrogate pair", () => {
		const chunks = chunkDocument(markdownDoc([section(["A"], "😀".repeat(10))]), {
			documentId: DOC_ID,
			maxCharacters: 4,
		});

		expect(bodies(chunks)).toEqual(["😀".repeat(4), "😀".repeat(4), "😀".repeat(2)]);
		expect(chunks.every((c) => c.body.isWellFormed())).toBe(true);
	});

	it("never exceeds the limit when the text mixes ASCII, kana and emoji", () => {
		const text = `${"ab😀かな".repeat(40)}。${"cd😀".repeat(30)}`;
		const chunks = chunkDocument(markdownDoc([section(["A"], text)]), {
			documentId: DOC_ID,
			maxCharacters: 25,
		});

		expect(chunks.length).toBeGreaterThan(1);
		expect(chunks.every((c) => codePoints(c.body) <= 25)).toBe(true);
	});
});

describe("chunkDocument: paragraph then sentence splitting", () => {
	it("splits at paragraph boundaries first and packs paragraphs that fit together", () => {
		const p1 = "a".repeat(30);
		const p2 = "b".repeat(30);
		const p3 = "c".repeat(30);

		const chunks = chunkDocument(markdownDoc([section(["A"], `${p1}\n\n${p2}\n\n${p3}`)]), {
			documentId: DOC_ID,
			maxCharacters: 70,
		});

		expect(bodies(chunks)).toEqual([`${p1}\n\n${p2}`, p3]);
	});

	it("starts a new chunk at a paragraph boundary instead of cutting a paragraph that fits", () => {
		const p1 = "短い段落です。";
		const p2 = "二つ目の段落もそれほど長くありません。";

		const chunks = chunkDocument(markdownDoc([section(["A"], `${p1}\n\n${p2}`)]), {
			documentId: DOC_ID,
			maxCharacters: 20,
		});

		expect(bodies(chunks)).toEqual([p1, p2]);
	});

	it("splits an over-long paragraph at sentence boundaries", () => {
		const s1 = "あいうえおかきくけ。";
		const s2 = "さしすせそたちつて。";
		const s3 = "なにぬねのはひふへ。";

		const chunks = chunkDocument(markdownDoc([section(["A"], `${s1}${s2}${s3}`)]), {
			documentId: DOC_ID,
			maxCharacters: 25,
		});

		expect(bodies(chunks)).toEqual([`${s1}${s2}`, s3]);
	});

	it("splits English sentences on terminators followed by whitespace", () => {
		const text = "First sentence here. Second sentence here! Third one? Fourth and last.";

		const chunks = chunkDocument(markdownDoc([section(["A"], text)]), {
			documentId: DOC_ID,
			maxCharacters: 45,
		});

		expect(bodies(chunks)).toEqual([
			"First sentence here. Second sentence here!",
			"Third one? Fourth and last.",
		]);
	});

	it("splits sentences inside the paragraph only when the paragraph does not fit", () => {
		const short = "短い段落。";
		const long = `${"あ".repeat(14)}。${"い".repeat(14)}。`;

		const chunks = chunkDocument(markdownDoc([section(["A"], `${short}\n\n${long}`)]), {
			documentId: DOC_ID,
			maxCharacters: 20,
		});

		expect(bodies(chunks)).toEqual([short, `${"あ".repeat(14)}。`, `${"い".repeat(14)}。`]);
	});

	it("falls back to a hard split for a sentence longer than the limit", () => {
		const chunks = chunkDocument(markdownDoc([section(["A"], "x".repeat(25))]), {
			documentId: DOC_ID,
			maxCharacters: 10,
		});

		expect(bodies(chunks)).toEqual(["x".repeat(10), "x".repeat(10), "x".repeat(5)]);
	});

	it("does not split decimal numbers as sentence boundaries", () => {
		const text = `${"a".repeat(12)} costs 3.14 dollars. ${"b".repeat(12)}.`;

		const chunks = chunkDocument(markdownDoc([section(["A"], text)]), {
			documentId: DOC_ID,
			maxCharacters: 36,
		});

		expect(bodies(chunks)).toEqual([`${"a".repeat(12)} costs 3.14 dollars.`, `${"b".repeat(12)}.`]);
	});
});

describe("chunkDocument: chunk IDs", () => {
	it("hashes documentId, heading path and body into 16 hex characters", () => {
		const [chunk] = chunkDocument(markdownDoc([section(["A", "B"], "body text")]), {
			documentId: DOC_ID,
		});

		expect(chunk?.id).toMatch(/^[0-9a-f]{16}$/);
		expect(chunk?.id).toBe(expectedId(DOC_ID, ["A", "B"], "body text"));
	});

	it("gives the same IDs for the same input", () => {
		const doc = markdownDoc([section(["A"], "one"), section(["B"], "two")]);

		const first = chunkDocument(doc, { documentId: DOC_ID }).map((c) => c.id);
		const second = chunkDocument(doc, { documentId: DOC_ID }).map((c) => c.id);

		expect(second).toEqual(first);
	});

	it("changes the ID when the body, the heading path or the document ID changes", () => {
		const base = chunkDocument(markdownDoc([section(["A"], "one")]), { documentId: DOC_ID })[0];
		const body = chunkDocument(markdownDoc([section(["A"], "one!")]), { documentId: DOC_ID })[0];
		const heading = chunkDocument(markdownDoc([section(["B"], "one")]), { documentId: DOC_ID })[0];
		const other = chunkDocument(markdownDoc([section(["A"], "one")]), {
			documentId: "eval:g.md",
		})[0];

		const ids = new Set([base?.id, body?.id, heading?.id, other?.id]);
		expect(ids.size).toBe(4);
	});

	it("does not depend on the section's position in the document", () => {
		const target = section(["Target"], "stable text");
		const alone = chunkDocument(markdownDoc([target]), { documentId: DOC_ID });
		const shifted = chunkDocument(
			markdownDoc([section(["Intro"], "new intro"), section(["More"], "more"), target]),
			{ documentId: DOC_ID },
		);

		expect(shifted.at(-1)?.id).toBe(alone[0]?.id);
	});

	it("leaves other chunk IDs unchanged when one body is edited", () => {
		const before = chunkDocument(markdownDoc([section(["A"], "a"), section(["B"], "b")]), {
			documentId: DOC_ID,
		});
		const after = chunkDocument(markdownDoc([section(["A"], "a2"), section(["B"], "b")]), {
			documentId: DOC_ID,
		});

		expect(after[1]?.id).toBe(before[1]?.id);
		expect(after[0]?.id).not.toBe(before[0]?.id);
	});

	it("appends -2, -3 in order of appearance to duplicate IDs within one document", () => {
		const chunks = chunkDocument(
			markdownDoc([section(["A"], "same"), section(["A"], "same"), section(["A"], "same")]),
			{ documentId: DOC_ID },
		);
		const base = expectedId(DOC_ID, ["A"], "same");

		expect(chunks.map((c) => c.id)).toEqual([base, `${base}-2`, `${base}-3`]);
	});

	it("does not suffix equal bodies under different headings", () => {
		const chunks = chunkDocument(markdownDoc([section(["A"], "same"), section(["B"], "same")]), {
			documentId: DOC_ID,
		});

		expect(chunks.every((c) => /^[0-9a-f]{16}$/.test(c.id))).toBe(true);
	});

	it("carries no duplicate counter from one call to the next", () => {
		const doc = markdownDoc([section(["A"], "same"), section(["A"], "same")]);

		const first = chunkDocument(doc, { documentId: "kb:one.md" });
		const second = chunkDocument(doc, { documentId: "kb:one.md" });

		expect(second.map((c) => c.id)).toEqual(first.map((c) => c.id));
		expect(first[1]?.id.endsWith("-2")).toBe(true);
	});
});

describe("chunkDocument: PDF pages", () => {
	it("makes each page its own boundary, carrying a 1-based page and no heading path", () => {
		const chunks = chunkDocument(pdfDoc(["first page", "second page"]), { documentId: "kb:g.pdf" });

		expect(chunks.map((c) => [c.page, c.headingPath, c.body])).toEqual([
			[1, [], "first page"],
			[2, [], "second page"],
		]);
	});

	it("skips empty pages but keeps the original page numbers", () => {
		const chunks = chunkDocument(pdfDoc(["one", "  \n", "three"]), { documentId: "kb:g.pdf" });

		expect(chunks.map((c) => c.page)).toEqual([1, 3]);
	});

	it("splits an over-long page into several chunks that all keep its page number", () => {
		const page = `${"あ".repeat(15)}。${"い".repeat(15)}。`;

		const chunks = chunkDocument(pdfDoc(["short", page]), {
			documentId: "kb:g.pdf",
			maxCharacters: 20,
		});

		expect(chunks.map((c) => c.page)).toEqual([1, 2, 2]);
	});

	it("never merges text from two pages into one chunk", () => {
		const chunks = chunkDocument(pdfDoc(["a", "b"]), {
			documentId: "kb:g.pdf",
			maxCharacters: 800,
		});

		expect(bodies(chunks)).toEqual(["a", "b"]);
	});

	it("suffixes identical pages in the same PDF", () => {
		const chunks = chunkDocument(pdfDoc(["same", "same"]), { documentId: "kb:g.pdf" });

		expect(chunks[1]?.id).toBe(`${chunks[0]?.id}-2`);
	});
});

describe("chunkDocument: chunks never cross a heading section (property)", () => {
	function mulberry32(seed: number): () => number {
		let state = seed;
		return () => {
			state = (state + 0x6d2b79f5) | 0;
			let t = Math.imul(state ^ (state >>> 15), 1 | state);
			t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
	}

	const ALPHABET = [
		"あ",
		"い",
		"漢",
		"字",
		"a",
		"b",
		"😀",
		" ",
		"。",
		"。",
		"\n\n",
		"\n",
		"! ",
		". ",
	];

	function randomText(random: () => number, length: number): string {
		let text = "";
		for (let i = 0; i < length; i++) text += ALPHABET[Math.floor(random() * ALPHABET.length)];
		return text.trim();
	}

	it("keeps each chunk inside its own section, within the limit, losing no characters", () => {
		const random = mulberry32(20260412);
		for (let round = 0; round < 60; round++) {
			const maxCharacters = 5 + Math.floor(random() * 60);
			const sections: MarkdownSection[] = [];
			const sectionCount = 1 + Math.floor(random() * 5);
			for (let i = 0; i < sectionCount; i++) {
				sections.push(
					section([`H${i}`, `S${round}-${i}`], randomText(random, Math.floor(random() * 200))),
				);
			}

			const chunks = chunkDocument(markdownDoc(sections), { documentId: DOC_ID, maxCharacters });

			for (const chunk of chunks) {
				const owner = sections.find((s) => s.headingPath.join() === chunk.headingPath.join());
				expect(owner, `round ${round}`).toBeDefined();
				expect(
					owner?.body.includes(chunk.body),
					`round ${round}: chunk is a slice of its section`,
				).toBe(true);
				expect(codePoints(chunk.body), `round ${round}`).toBeLessThanOrEqual(maxCharacters);
				expect(chunk.body.isWellFormed()).toBe(true);
			}
			for (const s of sections) {
				const joined = chunks
					.filter((c) => c.headingPath.join() === s.headingPath.join())
					.map((c) => c.body)
					.join("");
				expect(joined.replace(/\s/g, ""), `round ${round}`).toBe(s.body.replace(/\s/g, ""));
			}
		}
	});
});
