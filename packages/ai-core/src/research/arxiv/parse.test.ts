import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PlatformError } from "../../errors";
import { parseArxivFeed } from "./parse";
import { ArxivFeedError, arxivPaperSchema } from "./types";

function fixture(name: string): string {
	return readFileSync(new URL(`../../../fixtures/arxiv/${name}.xml`, import.meta.url), "utf8");
}

interface EntryParts {
	readonly id?: string;
	readonly title?: string;
	readonly summary?: string;
	readonly published?: string;
	readonly authors?: readonly string[];
}

function feed(...entries: readonly EntryParts[]): string {
	const body = entries
		.map((entry) => {
			const authors = (entry.authors ?? ["A. Author"])
				.map((name) => `<author><name>${name}</name></author>`)
				.join("");
			return `<entry><id>${entry.id ?? "http://arxiv.org/abs/2401.00001v1"}</id><published>${
				entry.published ?? "2024-01-01T00:00:00Z"
			}</published><title>${entry.title ?? "T"}</title><summary>${
				entry.summary ?? "S"
			}</summary>${authors}</entry>`;
		})
		.join("");
	return `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">${body}</feed>`;
}

describe("parseArxivFeed", () => {
	describe("a feed with several entries", () => {
		const papers = parseArxivFeed(fixture("search-multi"));

		it("returns every entry in order", () => {
			expect(papers.map((paper) => paper.arxivId)).toEqual([
				"2401.01234",
				"2403.05678",
				"cs/0501001",
			]);
		});

		it("returns title, authors, publication date and summary of an entry", () => {
			expect(papers[0]).toMatchObject({
				arxivId: "2401.01234",
				title: "Hierarchical Agents & Tool Use in Practice",
				authors: ["Ann Example", "Bo Sample"],
				publishedAt: "2024-01-02T18:00:00.000Z",
				summary:
					"We study hierarchical agents that call sub-agents as tools. The supervisor only sees summaries, not transcripts.",
			});
		});

		it("keeps the links of an entry, with the pdf link marked by its title", () => {
			expect(papers[0]?.links).toContainEqual({
				href: "http://arxiv.org/pdf/2401.01234v2",
				rel: "related",
				title: "pdf",
			});
			expect(papers[0]?.links).toContainEqual({
				href: "http://arxiv.org/abs/2401.01234v2",
				rel: "alternate",
			});
		});

		it("returns values that satisfy the paper schema", () => {
			for (const paper of papers) expect(arxivPaperSchema.safeParse(paper).success).toBe(true);
		});

		it("returns a frozen list", () => {
			expect(Object.isFrozen(papers)).toBe(true);
		});
	});

	describe("identifiers", () => {
		it("drops the version suffix of a new-style identifier", () => {
			const papers = parseArxivFeed(
				feed(
					{ id: "http://arxiv.org/abs/2401.01234v2" },
					{ id: "https://arxiv.org/abs/2401.01235v10" },
					{ id: "http://arxiv.org/abs/2401.01236" },
				),
			);
			expect(papers.map((paper) => paper.arxivId)).toEqual([
				"2401.01234",
				"2401.01235",
				"2401.01236",
			]);
		});

		it("reads an old-style identifier with its archive prefix", () => {
			const papers = parseArxivFeed(
				feed(
					{ id: "http://arxiv.org/abs/cs/0501001v1" },
					{ id: "http://arxiv.org/abs/math.GT/0309136v2" },
				),
			);
			expect(papers.map((paper) => paper.arxivId)).toEqual(["cs/0501001", "math.GT/0309136"]);
		});

		it.each([
			["a path that is not an abstract page", "http://arxiv.org/foo/2401.01234v1"],
			["a malformed number", "http://arxiv.org/abs/24011234v1"],
			["an identifier followed by more path", "http://arxiv.org/abs/2401.01234v1/extra"],
			["a bare identifier without the abstract URL", "2401.01234v1"],
			["an empty identifier", ""],
		])("rejects the feed when an entry id is %s", (_name, id) => {
			expect(() => parseArxivFeed(feed({ id }))).toThrow(ArxivFeedError);
		});
	});

	describe("one entry and no entries", () => {
		it("returns a one-element list for a feed with a single entry", () => {
			const papers = parseArxivFeed(fixture("search-single"));
			expect(papers).toHaveLength(1);
			expect(papers[0]).toMatchObject({
				arxivId: "2405.00001",
				title: "The Only Matching Paper",
				authors: ["Solo Author"],
			});
			expect(papers[0]?.links).toHaveLength(1);
		});

		it("returns a one-element author list for an entry with a single author", () => {
			const [paper] = parseArxivFeed(feed({ authors: ["Only One"] }));
			expect(paper?.authors).toEqual(["Only One"]);
		});

		it("returns an empty list, not an error, for a feed without entries", () => {
			expect(parseArxivFeed(fixture("search-empty"))).toEqual([]);
		});
	});

	describe("an error feed", () => {
		it("fails with a source-unavailable error", () => {
			expect(() => parseArxivFeed(fixture("error"))).toThrow(ArxivFeedError);
			try {
				parseArxivFeed(fixture("error"));
			} catch (error) {
				expect(error).toBeInstanceOf(PlatformError);
				expect((error as PlatformError).code).toBe("source-unavailable");
				// The server's own wording is not echoed to the learner.
				expect((error as PlatformError).message).not.toContain("incorrect id format");
			}
		});

		it("treats an entry titled Error as an error even with a valid id", () => {
			expect(() => parseArxivFeed(feed({ title: "Error", summary: "boom" }))).toThrow(
				ArxivFeedError,
			);
		});
	});

	describe("a real response (recorded from export.arxiv.org on 2026-10-19)", () => {
		it("parses the feed, ignoring arxiv: extensions and the related pdf link", () => {
			const papers = parseArxivFeed(fixture("live-single"));
			expect(papers).toHaveLength(1);
			expect(papers[0]).toMatchObject({
				arxivId: "2105.02723",
				title:
					"Do You Even Need Attention? A Stack of Feed-Forward Layers Does Surprisingly Well on ImageNet",
				authors: ["Luke Melas-Kyriazi"],
				publishedAt: "2021-05-06T14:42:39.000Z",
			});
			expect(papers[0]?.links).toContainEqual({
				href: "https://arxiv.org/pdf/2105.02723v1",
				rel: "related",
				title: "pdf",
			});
			expect(papers[0]?.summary).toContain("74.9\\% top-1 accuracy");
		});
	});

	describe("the bodies arXiv's front end sends instead of a feed", () => {
		it.each([
			["429 (text)", "Rate exceeded."],
			[
				"503 (html)",
				"\n<!DOCTYPE html>\n<html><head><title>503</title></head><body>503</body></html>",
			],
			["an empty body", ""],
		])("fails with ArxivFeedError for %s", (_name, body) => {
			expect(() => parseArxivFeed(body)).toThrow(ArxivFeedError);
		});
	});

	describe("hostile input", () => {
		const billionLaughs = `<?xml version="1.0"?>
<!DOCTYPE lolz [
  <!ENTITY lol "lol">
  <!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
  <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
]>
<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>http://arxiv.org/abs/2401.00001v1</id><published>2024-01-01T00:00:00Z</published><title>&lol3;</title><summary>S</summary></entry></feed>`;

		it("refuses a feed that has a DOCTYPE", () => {
			expect(() => parseArxivFeed(billionLaughs)).toThrow(ArxivFeedError);
		});

		it("refuses a DOCTYPE written in lower case or after other markup", () => {
			expect(() => parseArxivFeed(`<!-- x --><!doctype feed>${feed({})}`)).toThrow(ArxivFeedError);
		});

		it("refuses an ENTITY declaration even without a DOCTYPE keyword match", () => {
			expect(() =>
				parseArxivFeed(
					`<?xml version="1.0"?><!ENTITY x "y">${feed({}).replace('<?xml version="1.0"?>', "")}`,
				),
			).toThrow(ArxivFeedError);
		});

		it("does not expand entities that are not the five predefined ones", () => {
			const [paper] = parseArxivFeed(feed({ title: "a &custom; b" }));
			expect(paper?.title).toBe("a &custom; b");
		});

		it("decodes one level only, so an encoded entity stays as text", () => {
			const [paper] = parseArxivFeed(feed({ title: "x &amp;lt; y" }));
			expect(paper?.title).toBe("x &lt; y");
		});
	});

	describe("text normalisation", () => {
		it("decodes the predefined and the numeric character references", () => {
			const [paper] = parseArxivFeed(
				feed({ title: "&lt;a&gt; &quot;b&quot; &apos;c&apos; &#65;&#x42; &amp;" }),
			);
			expect(paper?.title).toBe(`<a> "b" 'c' AB &`);
		});

		it("leaves an out-of-range numeric reference as text", () => {
			const [paper] = parseArxivFeed(feed({ title: "x &#99999999999; y" }));
			expect(paper?.title).toBe("x &#99999999999; y");
		});

		it("collapses newlines and runs of spaces in a title", () => {
			const [paper] = parseArxivFeed(feed({ title: "  One\n   two\t three  " }));
			expect(paper?.title).toBe("One two three");
		});

		it("keeps a number-like title as text", () => {
			const [paper] = parseArxivFeed(feed({ title: "2024", summary: "12345" }));
			expect(paper?.title).toBe("2024");
			expect(paper?.summary).toBe("12345");
		});

		it("reads a title that carries attributes", () => {
			const xml = feed({}).replace("<title>T</title>", '<title type="html">Typed</title>');
			expect(parseArxivFeed(xml)[0]?.title).toBe("Typed");
		});
	});

	describe("malformed feeds", () => {
		it.each([
			["an empty string", ""],
			["text that is not XML", "hello"],
			["an HTML page", "<html><body>Service Unavailable</body></html>"],
			["a feed that is cut off", feed({}).slice(0, 80)],
		])("fails for %s", (_name, xml) => {
			expect(() => parseArxivFeed(xml)).toThrow(ArxivFeedError);
		});

		it("fails when an entry has no title", () => {
			const xml = feed({}).replace("<title>T</title>", "");
			expect(() => parseArxivFeed(xml)).toThrow(ArxivFeedError);
		});

		it("fails when the publication date is not a date", () => {
			expect(() => parseArxivFeed(feed({ published: "yesterday" }))).toThrow(ArxivFeedError);
		});

		it("leaves out an author without a name and a link without an address", () => {
			const xml = feed({ authors: ["Real Name", " "] }).replace(
				"</entry>",
				'<author/><link rel="alternate"/><link href="http://x?a=1&amp;b=2"/></entry>',
			);
			const [paper] = parseArxivFeed(xml);
			expect(paper?.authors).toEqual(["Real Name"]);
			// An address is decoded like the text is.
			expect(paper?.links).toEqual([{ href: "http://x?a=1&b=2" }]);
		});

		it("accepts an entry with no summary and no author as empty values", () => {
			const xml = feed({})
				.replace("<summary>S</summary>", "")
				.replace(/<author>.*<\/author>/u, "");
			const [paper] = parseArxivFeed(xml);
			expect(paper?.summary).toBe("");
			expect(paper?.authors).toEqual([]);
		});

		it("does not put the parser's own message into the error", () => {
			try {
				parseArxivFeed("<feed><entry></feed>");
				expect.unreachable();
			} catch (error) {
				expect(error).toBeInstanceOf(ArxivFeedError);
				expect((error as Error).message).toBe("arXiv の応答を解析できませんでした。");
			}
		});
	});
});
