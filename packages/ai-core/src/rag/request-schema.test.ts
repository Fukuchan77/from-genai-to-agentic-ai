import { describe, expect, it } from "vitest";
import { DEFAULT_RAG } from "../config";
import { MODEL_CATALOG } from "../models/catalog";
import { INGEST_SOURCES } from "./ingest/ingest";
import {
	INGEST_REQUEST_LIMITS,
	ingestRequestSchema,
	QUERY_REQUEST_LIMITS,
	queryRequestSchema,
} from "./request-schema";

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

const CATALOG_MODEL_ID = Object.keys(MODEL_CATALOG)[0] ?? "";

function parseQuery(body: unknown) {
	return queryRequestSchema.safeParse(body);
}

function withSettings(settings: unknown) {
	return parseQuery({ id: "q1", question: "What is RRF?", settings });
}

const NAIVE_METHODS = { hyde: false, multiQuery: false, hybrid: false, rerank: false };

describe("queryRequestSchema", () => {
	it("applies DEFAULT_RAG and all methods off when only id and question are given", () => {
		const result = parseQuery({ id: "q1", question: "What is RRF?" });

		expect(result.success).toBe(true);
		expect(result.data).toEqual({
			id: "q1",
			question: "What is RRF?",
			settings: {
				topK: DEFAULT_RAG.topK,
				minSimilarity: DEFAULT_RAG.minSimilarity,
				filter: {},
				methods: NAIVE_METHODS,
			},
		});
		expect(DEFAULT_RAG.topK).toBe(5);
		expect(DEFAULT_RAG.minSimilarity).toBe(0.5);
	});

	it("fills the defaults of the settings that are left out", () => {
		const result = withSettings({ topK: 8, methods: { hybrid: true } });

		expect(result.data?.settings).toEqual({
			topK: 8,
			minSimilarity: DEFAULT_RAG.minSimilarity,
			filter: {},
			methods: { ...NAIVE_METHODS, hybrid: true },
		});
	});

	it("accepts a full body", () => {
		const body = {
			id: "q-123",
			question: "ハイブリッド検索とは？",
			modelId: CATALOG_MODEL_ID,
			settings: {
				topK: 10,
				minSimilarity: 0.2,
				filter: { documentIds: ["doc-a", "doc-b"], tags: ["rag"] },
				methods: { hyde: true, multiQuery: true, hybrid: true, rerank: true },
			},
		};

		expect(parseQuery(body).data).toEqual(body);
	});

	it("rejects unknown fields at every level", () => {
		const base = { id: "q1", question: "q" };

		expect(parseQuery({ ...base, source: "knowledge" }).success).toBe(false);
		expect(parseQuery({ ...base, settings: { pool: 50 } }).success).toBe(false);
		expect(parseQuery({ ...base, settings: { filter: { page: 1 } } }).success).toBe(false);
		expect(parseQuery({ ...base, settings: { methods: { graph: true } } }).success).toBe(false);
	});

	it("rejects a body that is not an object and a missing id or question", () => {
		for (const body of [null, "q", [], 1]) expect(parseQuery(body).success).toBe(false);
		expect(parseQuery({ question: "q" }).success).toBe(false);
		expect(parseQuery({ id: "q1" }).success).toBe(false);
	});

	describe("id", () => {
		it("accepts 1 to 200 characters", () => {
			expect(QUERY_REQUEST_LIMITS.idMaxLength).toBe(200);
			expect(parseQuery({ id: "x", question: "q" }).success).toBe(true);
			expect(parseQuery({ id: "x".repeat(200), question: "q" }).success).toBe(true);
		});

		it.each(["", "x".repeat(201), 1, null])("rejects id %j", (id) => {
			expect(parseQuery({ id, question: "q" }).success).toBe(false);
		});
	});

	describe("question", () => {
		it("accepts 1 and 2000 characters and rejects empty and 2001", () => {
			expect(QUERY_REQUEST_LIMITS.questionMaxLength).toBe(DEFAULT_RAG.maxQuestionCharacters);
			expect(QUERY_REQUEST_LIMITS.questionMaxLength).toBe(2000);
			expect(parseQuery({ id: "q", question: "a" }).success).toBe(true);
			expect(parseQuery({ id: "q", question: "a".repeat(2000) }).success).toBe(true);
			expect(parseQuery({ id: "q", question: "" }).success).toBe(false);
			expect(parseQuery({ id: "q", question: "a".repeat(2001) }).success).toBe(false);
		});

		it("counts characters, not UTF-16 units", () => {
			expect(parseQuery({ id: "q", question: "あ".repeat(2000) }).success).toBe(true);
			expect(parseQuery({ id: "q", question: "😀".repeat(2000) }).success).toBe(true);
			expect(parseQuery({ id: "q", question: "😀".repeat(2001) }).success).toBe(false);
		});

		it("rejects a blank question and a non-string", () => {
			expect(parseQuery({ id: "q", question: "  \n\t " }).success).toBe(false);
			expect(parseQuery({ id: "q", question: 1 }).success).toBe(false);
		});
	});

	describe("modelId", () => {
		it("accepts a catalog model and rejects anything else", () => {
			expect(parseQuery({ id: "q", question: "q", modelId: CATALOG_MODEL_ID }).success).toBe(true);
			expect(parseQuery({ id: "q", question: "q", modelId: "not-in-the-catalog" }).success).toBe(
				false,
			);
			expect(parseQuery({ id: "q", question: "q", modelId: "" }).success).toBe(false);
		});
	});

	describe("settings.topK", () => {
		it("accepts the boundaries 1 and 20", () => {
			expect(withSettings({ topK: 1 }).data?.settings.topK).toBe(1);
			expect(withSettings({ topK: 20 }).data?.settings.topK).toBe(20);
		});

		it.each([0, 21, -1, 2.5, "5", null])("rejects topK %j", (topK) => {
			expect(withSettings({ topK }).success).toBe(false);
		});
	});

	describe("settings.minSimilarity", () => {
		it("accepts the boundaries -1, 0 and 1", () => {
			expect(withSettings({ minSimilarity: -1 }).data?.settings.minSimilarity).toBe(-1);
			expect(withSettings({ minSimilarity: 0 }).data?.settings.minSimilarity).toBe(0);
			expect(withSettings({ minSimilarity: 1 }).data?.settings.minSimilarity).toBe(1);
		});

		it.each([-1.01, 1.01, 2, "0.5", null, Number.NaN])("rejects minSimilarity %j", (value) => {
			expect(withSettings({ minSimilarity: value }).success).toBe(false);
		});
	});

	describe("settings.filter", () => {
		it("allows 20 document IDs and rejects 21", () => {
			const ids = (count: number) => Array.from({ length: count }, (_, i) => `doc-${i}`);

			expect(withSettings({ filter: { documentIds: ids(20) } }).success).toBe(true);
			expect(withSettings({ filter: { documentIds: ids(21) } }).success).toBe(false);
		});

		it("allows 10 tags and rejects 11", () => {
			const tags = (count: number) => Array.from({ length: count }, (_, i) => `t${i}`);

			expect(withSettings({ filter: { tags: tags(10) } }).success).toBe(true);
			expect(withSettings({ filter: { tags: tags(11) } }).success).toBe(false);
		});

		it("applies the tag rules of ingest: 1 to 40 characters, counted as characters", () => {
			expect(withSettings({ filter: { tags: ["😀".repeat(40)] } }).success).toBe(true);
			expect(withSettings({ filter: { tags: ["😀".repeat(41)] } }).success).toBe(false);
			expect(withSettings({ filter: { tags: [""] } }).success).toBe(false);
		});

		it("rejects empty and non-string document IDs", () => {
			expect(withSettings({ filter: { documentIds: [""] } }).success).toBe(false);
			expect(withSettings({ filter: { documentIds: [1] } }).success).toBe(false);
			expect(withSettings({ filter: { documentIds: "doc-a" } }).success).toBe(false);
		});

		it("accepts empty lists (no restriction)", () => {
			expect(withSettings({ filter: { documentIds: [], tags: [] } }).success).toBe(true);
		});
	});

	describe("settings.methods", () => {
		it.each(["hyde", "multiQuery", "hybrid", "rerank"] as const)(
			"turns %s on without touching the others",
			(method) => {
				const result = withSettings({ methods: { [method]: true } });

				expect(result.data?.settings.methods).toEqual({ ...NAIVE_METHODS, [method]: true });
			},
		);

		it("accepts only booleans", () => {
			expect(withSettings({ methods: { hyde: "true" } }).success).toBe(false);
			expect(withSettings({ methods: { rerank: 1 } }).success).toBe(false);
		});

		it("treats an empty methods object as the naive pipeline", () => {
			expect(withSettings({ methods: {} }).data?.settings.methods).toEqual(NAIVE_METHODS);
		});
	});
});
