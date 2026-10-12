import { extractText, extractTextItems } from "unpdf";
import { describe, expect, it } from "vitest";
import * as testing from "./index";
import { buildTextPdf } from "./pdf-builder";

async function readBack(bytes: Uint8Array): Promise<{ totalPages: number; pages: string[] }> {
	const { totalPages, text } = await extractText(bytes.slice(), { mergePages: false });
	return { totalPages, pages: text.map((page) => page.trim()) };
}

describe("buildTextPdf", () => {
	it("builds bytes that start with the PDF header and end with the EOF marker", () => {
		const bytes = buildTextPdf(["hello"]);

		expect(bytes).toBeInstanceOf(Uint8Array);
		expect(new TextDecoder().decode(bytes.slice(0, 8))).toMatch(/^%PDF-1\.\d/);
		expect(new TextDecoder().decode(bytes.slice(-6))).toBe("%%EOF\n");
	});

	it("reads back as one page with the same text", async () => {
		const { totalPages, pages } = await readBack(buildTextPdf(["Hello PDF world"]));

		expect(totalPages).toBe(1);
		expect(pages).toEqual(["Hello PDF world"]);
	});

	it("reads back several pages in order with their own text", async () => {
		const { totalPages, pages } = await readBack(
			buildTextPdf(["First page body", "Second page body", "Third page body"]),
		);

		expect(totalPages).toBe(3);
		expect(pages).toEqual(["First page body", "Second page body", "Third page body"]);
	});

	it("keeps an empty page as a page with no text", async () => {
		const { totalPages, pages } = await readBack(buildTextPdf(["before", "", "after"]));

		expect(totalPages).toBe(3);
		expect(pages).toEqual(["before", "", "after"]);
	});

	it("builds a PDF made only of empty pages", async () => {
		const { totalPages, pages } = await readBack(buildTextPdf(["", ""]));

		expect(totalPages).toBe(2);
		expect(pages).toEqual(["", ""]);
	});

	it("escapes parentheses and backslashes in the text", async () => {
		const { pages } = await readBack(buildTextPdf(["call f(x) with a\\b path"]));

		expect(pages).toEqual(["call f(x) with a\\b path"]);
	});

	it("puts each line of a multi-line page at its own vertical position", async () => {
		const { items } = await extractTextItems(buildTextPdf(["line one\nline two"]).slice());

		const first = items[0]?.find((item) => item.str.includes("line one"));
		const second = items[0]?.find((item) => item.str.includes("line two"));
		expect(first).toBeDefined();
		expect(second).toBeDefined();
		expect(second?.y).toBeLessThan(first?.y ?? Number.NEGATIVE_INFINITY);
	});

	it("is deterministic for the same input", () => {
		expect(buildTextPdf(["a", "b"])).toEqual(buildTextPdf(["a", "b"]));
	});

	it("rejects an empty page list because a PDF needs at least one page", () => {
		expect(() => buildTextPdf([])).toThrow(RangeError);
	});

	it("rejects text outside printable ASCII", () => {
		expect(() => buildTextPdf(["日本語"])).toThrow(RangeError);
		expect(() => buildTextPdf(["tab\there"])).toThrow(RangeError);
	});

	it("is re-exported from the testing entry point", () => {
		expect(testing.buildTextPdf).toBe(buildTextPdf);
	});
});
