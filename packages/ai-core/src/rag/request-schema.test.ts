import { describe, expect, it } from "vitest";
import { DEFAULT_RAG } from "../config";
import { INGEST_SOURCES } from "./ingest/ingest";
import { INGEST_REQUEST_LIMITS, ingestRequestSchema } from "./request-schema";

function parse(body: unknown) {
	return ingestRequestSchema.safeParse(body);
}

describe("ingestRequestSchema", () => {
	it("accepts a source alone and applies the defaults", () => {
		const result = parse({ source: "knowledge" });

		expect(result.success).toBe(true);
		expect(result.data).toEqual({ source: "knowledge", reset: false });
	});

	it("accepts a full body", () => {
		const body = {
			source: "eval-corpus",
			files: ["01-rag-overview.md", "paper.pdf"],
			tags: ["rag", "検索"],
			reset: true,
		};

		expect(parse(body).data).toEqual(body);
	});

	it.each(INGEST_SOURCES)("accepts source %s", (source) => {
		expect(parse({ source }).success).toBe(true);
	});

	it.each([undefined, "", "uploads", "Knowledge", 1, null])("rejects source %j", (source) => {
		expect(parse({ source }).success).toBe(false);
	});

	it("rejects unknown fields", () => {
		expect(parse({ source: "knowledge", root: "/etc" }).success).toBe(false);
		expect(parse({ source: "knowledge", modelId: "x" }).success).toBe(false);
	});

	it("rejects a body that is not an object", () => {
		for (const body of [null, "knowledge", [], 1]) expect(parse(body).success).toBe(false);
	});

	describe("files", () => {
		it("limits the list to the ingest limit", () => {
			const atLimit = Array.from({ length: DEFAULT_RAG.maxIngestFiles }, (_, i) => `f${i}.md`);

			expect(INGEST_REQUEST_LIMITS.maxFiles).toBe(DEFAULT_RAG.maxIngestFiles);
			expect(parse({ source: "knowledge", files: atLimit }).success).toBe(true);
			expect(parse({ source: "knowledge", files: [...atLimit, "extra.md"] }).success).toBe(false);
		});

		it("rejects an empty list (omit files to ingest the whole directory)", () => {
			expect(parse({ source: "knowledge", files: [] }).success).toBe(false);
		});

		it.each([
			"",
			"..",
			"../secret.md",
			"sub/doc.md",
			"/etc/passwd",
			"sub\\doc.md",
			".hidden.md",
			".",
			"nul\0.md",
		])("rejects the path-like name %j", (name) => {
			expect(parse({ source: "knowledge", files: ["ok.md", name] }).success).toBe(false);
		});

		it("rejects a name over the length limit and accepts one at the limit", () => {
			const max = INGEST_REQUEST_LIMITS.fileNameMaxLength;

			expect(parse({ source: "knowledge", files: [`${"a".repeat(max - 3)}.md`] }).success).toBe(
				true,
			);
			expect(parse({ source: "knowledge", files: [`${"a".repeat(max - 2)}.md`] }).success).toBe(
				false,
			);
		});

		it("rejects non-string entries", () => {
			expect(parse({ source: "knowledge", files: [1] }).success).toBe(false);
			expect(parse({ source: "knowledge", files: "a.md" }).success).toBe(false);
		});
	});

	describe("tags", () => {
		it("allows 10 tags of 40 characters", () => {
			const tags = Array.from({ length: 10 }, (_, i) => `${i}`.padEnd(40, "x"));

			expect(parse({ source: "knowledge", tags }).success).toBe(true);
		});

		it("rejects an 11th tag, a 41-character tag and an empty tag", () => {
			const eleven = Array.from({ length: 11 }, (_, i) => `t${i}`);

			expect(parse({ source: "knowledge", tags: eleven }).success).toBe(false);
			expect(parse({ source: "knowledge", tags: ["x".repeat(41)] }).success).toBe(false);
			expect(parse({ source: "knowledge", tags: [""] }).success).toBe(false);
		});

		it("counts characters, not UTF-16 units", () => {
			expect(parse({ source: "knowledge", tags: ["あ".repeat(40)] }).success).toBe(true);
			expect(parse({ source: "knowledge", tags: ["😀".repeat(40)] }).success).toBe(true);
			expect(parse({ source: "knowledge", tags: ["😀".repeat(41)] }).success).toBe(false);
		});
	});

	describe("reset", () => {
		it("accepts only a boolean", () => {
			expect(parse({ source: "knowledge", reset: false }).success).toBe(true);
			expect(parse({ source: "knowledge", reset: "true" }).success).toBe(false);
			expect(parse({ source: "knowledge", reset: 1 }).success).toBe(false);
		});
	});
});
