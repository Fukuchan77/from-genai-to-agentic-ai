import { describe, expect, it } from "vitest";
import { PlatformError } from "../../errors";
import { buildTextPdf } from "../../testing/pdf-builder";
import { extractPdfPages, PdfParseError } from "./pdf";

describe("extractPdfPages", () => {
	it("returns the text of each page in order", async () => {
		const bytes = buildTextPdf(["First page body", "Second page body", "Third page body"]);

		const pages = await extractPdfPages(bytes);

		expect(pages).toHaveLength(3);
		expect(pages.map((page) => page.trim())).toEqual([
			"First page body",
			"Second page body",
			"Third page body",
		]);
	});

	it("returns the page array as is when every page is empty so the caller can detect no-text", async () => {
		const pages = await extractPdfPages(buildTextPdf(["", "", ""]));

		expect(pages).toHaveLength(3);
		expect(pages.every((page) => page.trim() === "")).toBe(true);
	});

	it("keeps an empty page in its position between pages with text", async () => {
		const pages = await extractPdfPages(buildTextPdf(["before", "", "after"]));

		expect(pages.map((page) => page.trim())).toEqual(["before", "", "after"]);
	});

	it("does not consume the caller's bytes", async () => {
		const bytes = buildTextPdf(["reusable"]);
		const copy = bytes.slice();

		await extractPdfPages(bytes);
		const again = await extractPdfPages(bytes);

		expect(bytes).toEqual(copy);
		expect(again.map((page) => page.trim())).toEqual(["reusable"]);
	});

	it("accepts a Node Buffer, which pdf.js itself rejects", async () => {
		const buffer = Buffer.from(buildTextPdf(["from a buffer"]));

		const pages = await extractPdfPages(buffer);

		expect(pages.map((page) => page.trim())).toEqual(["from a buffer"]);
	});

	it("fails with parse-failed for bytes that are not a PDF", async () => {
		const error = await extractPdfPages(new TextEncoder().encode("this is not a pdf")).catch(
			(caught: unknown) => caught,
		);

		expect(error).toBeInstanceOf(PdfParseError);
		expect(error).toBeInstanceOf(PlatformError);
		expect(error).toMatchObject({ code: "invalid-request", details: { reason: "parse-failed" } });
	});

	it("fails with parse-failed for an empty byte array", async () => {
		await expect(extractPdfPages(new Uint8Array())).rejects.toMatchObject({
			details: { reason: "parse-failed" },
		});
	});

	it("fails with parse-failed for a truncated PDF", async () => {
		const bytes = buildTextPdf(["truncated"]);

		await expect(extractPdfPages(bytes.slice(0, 40))).rejects.toBeInstanceOf(PdfParseError);
	});

	it("fails with parse-failed for a PDF header followed by garbage", async () => {
		const bytes = new TextEncoder().encode("%PDF-1.4\n\u0000\u0001garbage garbage\n%%EOF\n");

		await expect(extractPdfPages(bytes)).rejects.toBeInstanceOf(PdfParseError);
	});

	it("reports a fixed Japanese message instead of the parser's", async () => {
		const error = await extractPdfPages(new TextEncoder().encode("garbage")).catch(
			(caught: unknown) => caught,
		);

		expect(error).toMatchObject({ message: "PDF を解析できませんでした。" });
	});
});
