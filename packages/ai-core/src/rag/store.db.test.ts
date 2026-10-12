import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MODEL_DEFAULTS } from "../models";
import { createFakeClock, type FakeClock } from "../ports/clock";
import {
	createPgliteDatabase,
	type RagDatabaseHandle,
	ragChunks,
	ragDocuments,
	ragMeta,
} from "./db";
import type { KnowledgeBaseMeta } from "./embedding";
import { buildFullTextQuery, toSearchText } from "./ingest/search-text";
import {
	type ChunkInput,
	createKnowledgeStore,
	type DocumentInput,
	type KnowledgeStore,
} from "./store";

const META: KnowledgeBaseMeta = { embeddingModelId: "mock:embedding-v1", dimensions: 768 };
const START = Date.parse("2026-10-12T00:00:00.000Z");

let handle: RagDatabaseHandle;
let clock: FakeClock;
let store: KnowledgeStore;

function axis(index: number): number[] {
	return Array.from({ length: 768 }, (_, position) => (position === index ? 1 : 0));
}

function document(id: string, overrides: Partial<DocumentInput> = {}): DocumentInput {
	return { id, title: `title of ${id}`, sourceType: "markdown", tags: [], ...overrides };
}

function chunk(id: string, ordinal: number, overrides: Partial<ChunkInput> = {}): ChunkInput {
	return {
		id,
		ordinal,
		headingPath: ["章", "節"],
		page: null,
		body: `body ${id}`,
		searchText: `body ${id}`,
		...overrides,
	};
}

const TABLES = { rag_chunks: ragChunks, rag_documents: ragDocuments, rag_meta: ragMeta } as const;

function count(table: keyof typeof TABLES): Promise<number> {
	return handle.db.$count(TABLES[table]);
}

beforeAll(async () => {
	handle = await createPgliteDatabase();
});

afterAll(async () => {
	await handle.close();
});

beforeEach(async () => {
	await handle.db.execute(sql`TRUNCATE rag_chunks, rag_documents, rag_meta CASCADE`);
	clock = createFakeClock(START);
	store = createKnowledgeStore(handle.db, { clock });
});

describe("replaceDocument", () => {
	it("stores the document, its chunks with source metadata, and their embeddings", async () => {
		await store.replaceDocument(
			document("kb:a.md", { title: "文書 A", tags: ["rag"] }),
			[
				chunk("c0", 0, {
					headingPath: ["RAG", "概要"],
					body: "概要の本文",
					searchText: "概要 本文",
				}),
				chunk("c1", 1, { headingPath: [], page: 3, body: "三ページ目", searchText: "三 ページ" }),
			],
			[axis(0), axis(1)],
			META,
		);

		const chunks = await store.getChunks(["c0", "c1"]);
		expect(chunks).toEqual([
			{
				id: "c0",
				documentId: "kb:a.md",
				documentTitle: "文書 A",
				ordinal: 0,
				headingPath: ["RAG", "概要"],
				page: null,
				body: "概要の本文",
			},
			{
				id: "c1",
				documentId: "kb:a.md",
				documentTitle: "文書 A",
				ordinal: 1,
				headingPath: [],
				page: 3,
				body: "三ページ目",
			},
		]);
		const stored = await handle.db.select().from(ragChunks).orderBy(ragChunks.ordinal);
		expect(stored.map((row) => row.embedding)).toEqual([axis(0), axis(1)]);
		expect(stored.map((row) => row.searchText)).toEqual(["概要 本文", "三 ページ"]);
	});

	it("sets ingestedAt from the injected clock, not from the database", async () => {
		await store.replaceDocument(document("kb:a.md"), [chunk("c0", 0)], [axis(0)], META);
		clock.advanceBy(60_000);
		await store.replaceDocument(document("kb:b.md"), [chunk("c1", 0)], [axis(1)], META);

		const documents = await store.listDocuments();

		expect(documents.map((doc) => [doc.id, doc.ingestedAt])).toEqual([
			["kb:a.md", "2026-10-12T00:00:00.000Z"],
			["kb:b.md", "2026-10-12T00:01:00.000Z"],
		]);
	});

	it("lists documents with chunk counts, ordered by id", async () => {
		await store.replaceDocument(
			document("kb:b.md", { sourceType: "pdf" }),
			[chunk("b0", 0, { headingPath: [], page: 1 })],
			[axis(1)],
			META,
		);
		await store.replaceDocument(
			document("kb:a.md"),
			[chunk("a0", 0), chunk("a1", 1)],
			[axis(2), axis(3)],
			META,
		);

		const documents = await store.listDocuments();

		expect(documents.map((doc) => [doc.id, doc.sourceType, doc.chunkCount])).toEqual([
			["kb:a.md", "markdown", 2],
			["kb:b.md", "pdf", 1],
		]);
	});

	it("replaces a re-ingested document instead of duplicating it", async () => {
		await store.replaceDocument(
			document("kb:a.md", { title: "旧" }),
			[chunk("old0", 0), chunk("old1", 1), chunk("old2", 2)],
			[axis(0), axis(1), axis(2)],
			META,
		);
		await store.replaceDocument(
			document("kb:a.md", { title: "新" }),
			[chunk("new0", 0)],
			[axis(3)],
			META,
		);

		expect(await count("rag_documents")).toBe(1);
		expect(await count("rag_chunks")).toBe(1);
		expect(await store.getChunks(["old0", "new0"])).toMatchObject([
			{ id: "new0", documentTitle: "新" },
		]);
		expect((await store.listDocuments())[0]?.chunkCount).toBe(1);
	});

	it("leaves other documents untouched when one is replaced", async () => {
		await store.replaceDocument(document("kb:a.md"), [chunk("a0", 0)], [axis(0)], META);
		await store.replaceDocument(document("kb:b.md"), [chunk("b0", 0)], [axis(1)], META);

		await store.replaceDocument(document("kb:a.md"), [chunk("a1", 0)], [axis(2)], META);

		expect((await store.getChunks(["a0", "a1", "b0"])).map((row) => row.id)).toEqual(["a1", "b0"]);
	});

	it("keeps the existing chunks when the insert fails midway (rollback)", async () => {
		await store.replaceDocument(
			document("kb:a.md", { title: "旧" }),
			[chunk("keep0", 0), chunk("keep1", 1)],
			[axis(0), axis(1)],
			META,
		);

		// The repeated chunk id violates the primary key after the old rows were deleted.
		await expect(
			store.replaceDocument(
				document("kb:a.md", { title: "新" }),
				[chunk("dup", 0), chunk("dup", 1)],
				[axis(2), axis(3)],
				META,
			),
		).rejects.toThrow();

		expect((await store.getChunks(["keep0", "keep1"])).map((row) => row.id)).toEqual([
			"keep0",
			"keep1",
		]);
		expect((await store.listDocuments())[0]?.title).toBe("旧");
	});

	it("stores tags as a set (duplicates removed, first occurrence kept)", async () => {
		await store.replaceDocument(
			document("kb:a.md", { tags: ["rag", "faq", "rag", "検索"] }),
			[chunk("a0", 0)],
			[axis(0)],
			META,
		);

		expect((await store.listDocuments())[0]?.tags).toEqual(["rag", "faq", "検索"]);
	});

	it("records the embedding model on first write and accepts the same model afterwards", async () => {
		expect(await store.getMeta()).toBeUndefined();

		await store.replaceDocument(document("kb:a.md"), [chunk("a0", 0)], [axis(0)], META);
		await store.replaceDocument(document("kb:b.md"), [chunk("b0", 0)], [axis(1)], META);

		expect(await store.getMeta()).toEqual(META);
		expect(await count("rag_meta")).toBe(1);
	});

	it("rejects another embedding model and writes nothing", async () => {
		await store.replaceDocument(document("kb:a.md"), [chunk("a0", 0)], [axis(0)], META);

		const failure = await store
			.replaceDocument(document("kb:b.md"), [chunk("b0", 0)], [axis(1)], {
				embeddingModelId: MODEL_DEFAULTS.local.ollama.embedding,
				dimensions: 768,
			})
			.catch((error: unknown) => error);

		expect(failure).toMatchObject({
			code: "invalid-request",
			details: { reason: "embedding-model-changed" },
		});
		expect(await count("rag_documents")).toBe(1);
		expect(await store.getMeta()).toEqual(META);
	});

	it("rejects chunks and embeddings of different lengths before touching the database", async () => {
		await expect(
			store.replaceDocument(document("kb:a.md"), [chunk("a0", 0), chunk("a1", 1)], [axis(0)], META),
		).rejects.toMatchObject({ code: "output-invalid" });
		expect(await count("rag_documents")).toBe(0);
		expect(await count("rag_meta")).toBe(0);
	});

	it("rejects an embedding that is not 768-dimensional and keeps the existing chunks", async () => {
		await store.replaceDocument(document("kb:a.md"), [chunk("keep", 0)], [axis(0)], META);

		await expect(
			store.replaceDocument(document("kb:a.md"), [chunk("new", 0)], [[1, 2, 3]], META),
		).rejects.toMatchObject({ code: "output-invalid" });

		expect((await store.getChunks(["keep"])).map((row) => row.id)).toEqual(["keep"]);
	});

	it("stores a document with no chunks (empty replacement)", async () => {
		await store.replaceDocument(document("kb:a.md"), [chunk("a0", 0)], [axis(0)], META);

		await store.replaceDocument(document("kb:a.md"), [], [], META);

		expect((await store.listDocuments())[0]?.chunkCount).toBe(0);
		expect(await count("rag_chunks")).toBe(0);
	});
});

describe("getChunks", () => {
	it("returns chunks in the requested order and omits unknown ids", async () => {
		const ids = ["a0", "a1", "a2", "a3", "a4"];
		await store.replaceDocument(
			document("kb:a.md"),
			ids.map((id, ordinal) => chunk(id, ordinal)),
			ids.map((_, index) => axis(index)),
			META,
		);

		const found = await store.getChunks(["a4", "missing", "a1", "a3", "a0"]);

		expect(found.map((row) => row.id)).toEqual(["a4", "a1", "a3", "a0"]);
	});

	it("returns an empty list for no ids without querying", async () => {
		expect(await store.getChunks([])).toEqual([]);
	});
});

describe("reset", () => {
	it("removes every document, chunk and the embedding record", async () => {
		await store.replaceDocument(document("kb:a.md"), [chunk("a0", 0)], [axis(0)], META);
		await store.replaceDocument(document("eval:b.md"), [chunk("b0", 0)], [axis(1)], META);

		await store.reset();

		expect(await count("rag_documents")).toBe(0);
		expect(await count("rag_chunks")).toBe(0);
		expect(await store.getMeta()).toBeUndefined();
	});

	it("lets a different embedding model start a new knowledge base afterwards", async () => {
		await store.replaceDocument(document("kb:a.md"), [chunk("a0", 0)], [axis(0)], META);
		await store.reset();
		const other = { embeddingModelId: MODEL_DEFAULTS.local.ollama.embedding, dimensions: 768 };

		await store.replaceDocument(document("kb:a.md"), [chunk("a0", 0)], [axis(0)], other);

		expect(await store.getMeta()).toEqual(other);
	});
});

function mix(first: number, second: number): number[] {
	const vector = new Array<number>(768).fill(0);
	vector[first] = Math.SQRT1_2;
	vector[second] = Math.SQRT1_2;
	return vector;
}

function negated(vector: readonly number[]): number[] {
	return vector.map((value) => (value === 0 ? 0 : -value));
}

describe("searchByVector", () => {
	// With the query axis(0): a0 = 1, a1 = 1/sqrt(2), b0 = 0 (orthogonal), b1 = -1 (opposite).
	beforeEach(async () => {
		await store.replaceDocument(
			document("kb:a.md", { tags: ["rag"] }),
			[chunk("a0", 0), chunk("a1", 1)],
			[axis(0), mix(0, 1)],
			META,
		);
		await store.replaceDocument(
			document("kb:b.md", { tags: ["faq", "rag-extra"] }),
			[chunk("b0", 0), chunk("b1", 1)],
			[axis(1), negated(axis(0))],
			META,
		);
	});

	const everything = { minSimilarity: -1, limit: 10 } as const;

	it("orders by cosine distance and reports the cosine similarity as score and similarity", async () => {
		const found = await store.searchByVector({ embedding: axis(0), ...everything });

		expect(found.map((hit) => hit.chunk.id)).toEqual(["a0", "a1", "b0", "b1"]);
		const similarities = found.map((hit) => hit.similarity);
		expect(similarities[0]).toBeCloseTo(1, 6);
		expect(similarities[1]).toBeCloseTo(Math.SQRT1_2, 6);
		expect(similarities[2]).toBeCloseTo(0, 6);
		expect(similarities[3]).toBeCloseTo(-1, 6);
		expect(found.map((hit) => hit.score)).toEqual(similarities);
	});

	it("returns the chunk with its source metadata", async () => {
		const [top] = await store.searchByVector({ embedding: axis(0), ...everything, limit: 1 });

		expect(top?.chunk).toEqual({
			id: "a0",
			documentId: "kb:a.md",
			documentTitle: "title of kb:a.md",
			ordinal: 0,
			headingPath: ["章", "節"],
			page: null,
			body: "body a0",
		});
	});

	it("includes a candidate whose similarity equals the threshold exactly", async () => {
		const atZero = await store.searchByVector({ embedding: axis(0), minSimilarity: 0, limit: 10 });
		const atOne = await store.searchByVector({ embedding: axis(0), minSimilarity: 1, limit: 10 });

		expect(atZero.map((hit) => hit.chunk.id)).toEqual(["a0", "a1", "b0"]);
		expect(atOne.map((hit) => hit.chunk.id)).toEqual(["a0"]);
	});

	it("drops a candidate just below the threshold", async () => {
		const found = await store.searchByVector({
			embedding: axis(0),
			minSimilarity: 0.000_001,
			limit: 10,
		});

		expect(found.map((hit) => hit.chunk.id)).toEqual(["a0", "a1"]);
	});

	it("returns nothing when no candidate reaches the threshold", async () => {
		const found = await store.searchByVector({ embedding: axis(5), minSimilarity: 0.5, limit: 10 });

		expect(found).toEqual([]);
	});

	it("caps the result at limit, keeping the nearest", async () => {
		const found = await store.searchByVector({ embedding: axis(0), ...everything, limit: 2 });

		expect(found.map((hit) => hit.chunk.id)).toEqual(["a0", "a1"]);
	});

	it("keeps only chunks that have at least one of the requested tags", async () => {
		const faq = await store.searchByVector({
			embedding: axis(0),
			...everything,
			filter: { tags: ["faq"] },
		});
		const either = await store.searchByVector({
			embedding: axis(0),
			...everything,
			filter: { tags: ["rag", "faq"] },
		});
		const none = await store.searchByVector({
			embedding: axis(0),
			...everything,
			filter: { tags: ["unknown"] },
		});

		expect(faq.map((hit) => hit.chunk.id)).toEqual(["b0", "b1"]);
		expect(either).toHaveLength(4);
		expect(none).toEqual([]);
	});

	it("does not treat a tag as a prefix match (rag does not match rag-extra)", async () => {
		const found = await store.searchByVector({
			embedding: axis(0),
			...everything,
			filter: { tags: ["rag"] },
		});

		expect(found.map((hit) => hit.chunk.documentId)).toEqual(["kb:a.md", "kb:a.md"]);
	});

	it("restricts the search to the requested documents", async () => {
		const found = await store.searchByVector({
			embedding: axis(0),
			...everything,
			filter: { documentIds: ["kb:b.md"] },
		});

		expect(found.map((hit) => hit.chunk.id)).toEqual(["b0", "b1"]);
	});

	it("applies the document filter and the tag filter together", async () => {
		const found = await store.searchByVector({
			embedding: axis(0),
			...everything,
			filter: { documentIds: ["kb:a.md", "kb:b.md"], tags: ["faq"] },
		});

		expect(found.map((hit) => hit.chunk.id)).toEqual(["b0", "b1"]);
	});

	it("treats empty filter lists as no filter", async () => {
		const found = await store.searchByVector({
			embedding: axis(0),
			...everything,
			filter: { documentIds: [], tags: [] },
		});

		expect(found).toHaveLength(4);
	});

	it.each([0, -1, 1.5, Number.NaN])("rejects limit %s", async (limit) => {
		await expect(
			store.searchByVector({ embedding: axis(0), minSimilarity: -1, limit }),
		).rejects.toMatchObject({ code: "invalid-request" });
		await expect(store.searchByFullText({ query: "a", limit })).rejects.toMatchObject({
			code: "invalid-request",
		});
	});

	it("rejects a query embedding that is not 768-dimensional", async () => {
		await expect(
			store.searchByVector({ embedding: [1, 0, 0], ...everything }),
		).rejects.toMatchObject({ code: "output-invalid" });
	});
});

describe("searchByFullText", () => {
	beforeEach(async () => {
		const bodies: [string, string][] = [
			["t0", "全文検索とベクトル検索を比較する"],
			["t1", "検索の精度を評価する"],
			["t2", "ハイブリッド検索では RRF で順位を統合する"],
			["t3", "まったく関係のない文章です"],
		];
		await store.replaceDocument(
			document("kb:a.md", { tags: ["rag"] }),
			bodies
				.slice(0, 2)
				.map(([id, body], ordinal) => chunk(id, ordinal, { body, searchText: toSearchText(body) })),
			[axis(0), axis(1)],
			META,
		);
		await store.replaceDocument(
			document("kb:b.md", { tags: ["faq"] }),
			bodies
				.slice(2)
				.map(([id, body], ordinal) => chunk(id, ordinal, { body, searchText: toSearchText(body) })),
			[axis(2), axis(3)],
			META,
		);
	});

	it("finds Japanese text through word segmentation and ranks more matches higher", async () => {
		const found = await store.searchByFullText({
			query: buildFullTextQuery("全文検索") ?? undefined,
			limit: 10,
		});

		expect(found.map((hit) => hit.chunk.id)).toEqual(["t0", "t1", "t2"]);
		expect(found[0]?.score).toBeGreaterThan(found[1]?.score ?? Number.POSITIVE_INFINITY);
		expect(found.every((hit) => hit.similarity === undefined)).toBe(true);
	});

	it("matches a Latin term case-insensitively", async () => {
		const found = await store.searchByFullText({
			query: buildFullTextQuery("rrf") ?? undefined,
			limit: 10,
		});

		expect(found.map((hit) => hit.chunk.id)).toEqual(["t2"]);
	});

	it("does not search when there is no query (undefined)", async () => {
		expect(await store.searchByFullText({ query: undefined, limit: 10 })).toEqual([]);
		expect(buildFullTextQuery("は の が")).toBeUndefined();
	});

	it("returns nothing for words that appear in no chunk", async () => {
		const found = await store.searchByFullText({
			query: buildFullTextQuery("量子コンピュータ") ?? undefined,
			limit: 10,
		});

		expect(found).toEqual([]);
	});

	it("caps the result at limit", async () => {
		const found = await store.searchByFullText({
			query: buildFullTextQuery("検索") ?? undefined,
			limit: 2,
		});

		expect(found).toHaveLength(2);
	});

	it("applies the tag and document filters", async () => {
		const query = buildFullTextQuery("検索") ?? undefined;

		const byTag = await store.searchByFullText({ query, limit: 10, filter: { tags: ["faq"] } });
		const byDocument = await store.searchByFullText({
			query,
			limit: 10,
			filter: { documentIds: ["kb:a.md"] },
		});

		expect(byTag.map((hit) => hit.chunk.id)).toEqual(["t2"]);
		expect(byDocument.map((hit) => hit.chunk.id).sort()).toEqual(["t0", "t1"]);
	});

	it("rejects a query that is not a plain OR of words instead of passing it to to_tsquery", async () => {
		for (const query of ["a & b", "!a", "a:*", "a | ", "'quoted'", "a b", ""]) {
			await expect(store.searchByFullText({ query, limit: 10 })).rejects.toMatchObject({
				code: "invalid-request",
			});
		}
	});
});
