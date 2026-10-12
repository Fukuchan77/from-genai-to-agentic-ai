import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadPlatformConfig } from "../config";
import { MODEL_DEFAULTS } from "../models";
import { createFakeClock } from "../ports/clock";
import { createPostgresDatabase, type RagDatabaseHandle, ragChunks, ragDocuments } from "./db";
import type { KnowledgeBaseMeta } from "./embedding";
import { buildFullTextQuery, toSearchText } from "./ingest/search-text";
import {
	type ChunkInput,
	createKnowledgeStore,
	type DocumentInput,
	type KnowledgeStore,
} from "./store";

// Runs only through `mise run test:db`. The inputs and expectations mirror store.db.test.ts, so a
// difference between PGlite (PostgreSQL 18) and Compose (PostgreSQL 17 + pgvector) shows up here.
// A scratch database keeps the learner's `agentic_ai` data out of the TRUNCATE below.
const base = loadPlatformConfig(process.env).database;
const scratchName = `rag_pg_store_${randomBytes(4).toString("hex")}`;
const META: KnowledgeBaseMeta = { embeddingModelId: "mock:embedding-v1", dimensions: 768 };

let admin: postgres.Sql;
let handle: RagDatabaseHandle;
let store: KnowledgeStore;

function axis(index: number): number[] {
	return Array.from({ length: 768 }, (_, position) => (position === index ? 1 : 0));
}

function mix(first: number, second: number): number[] {
	const vector = new Array<number>(768).fill(0);
	vector[first] = Math.SQRT1_2;
	vector[second] = Math.SQRT1_2;
	return vector;
}

function negated(vector: readonly number[]): number[] {
	return vector.map((value) => (value === 0 ? 0 : -value));
}

function document(id: string, tags: string[] = []): DocumentInput {
	return { id, title: `title of ${id}`, sourceType: "markdown", tags };
}

function chunk(id: string, ordinal: number, body = `body ${id}`): ChunkInput {
	return {
		id,
		ordinal,
		headingPath: ["章", "節"],
		page: null,
		body,
		searchText: toSearchText(body),
	};
}

beforeAll(async () => {
	admin = postgres({ ...base, max: 1, onnotice: () => undefined });
	await admin`CREATE DATABASE ${admin(scratchName)}`;
	handle = await createPostgresDatabase({ ...base, database: scratchName });
});

afterAll(async () => {
	await handle.close();
	await admin`DROP DATABASE IF EXISTS ${admin(scratchName)} WITH (FORCE)`;
	await admin.end();
});

beforeEach(async () => {
	store = createKnowledgeStore(handle.db, {
		clock: createFakeClock(Date.parse("2026-10-12T00:00:00.000Z")),
	});
	await store.reset();
});

describe("write side on Postgres", () => {
	it("stores a document and replaces it on re-ingest without duplicating", async () => {
		await store.replaceDocument(
			document("kb:a.md", ["rag"]),
			[chunk("old0", 0), chunk("old1", 1)],
			[axis(0), axis(1)],
			META,
		);
		await store.replaceDocument(document("kb:a.md", ["rag"]), [chunk("new0", 0)], [axis(2)], META);

		expect(await handle.db.$count(ragDocuments)).toBe(1);
		expect(await handle.db.$count(ragChunks)).toBe(1);
		expect((await store.getChunks(["old0", "new0"])).map((row) => row.id)).toEqual(["new0"]);
		expect((await store.listDocuments())[0]).toMatchObject({
			chunkCount: 1,
			tags: ["rag"],
			ingestedAt: "2026-10-12T00:00:00.000Z",
		});
	});

	it("keeps the existing chunks when the insert fails midway (rollback)", async () => {
		await store.replaceDocument(document("kb:a.md"), [chunk("keep", 0)], [axis(0)], META);

		await expect(
			store.replaceDocument(
				document("kb:a.md"),
				[chunk("dup", 0), chunk("dup", 1)],
				[axis(1), axis(2)],
				META,
			),
		).rejects.toThrow();

		expect((await store.getChunks(["keep"])).map((row) => row.id)).toEqual(["keep"]);
	});

	it("rolls back every document of an outer transaction when a nested replace fails (savepoints)", async () => {
		await expect(
			handle.db.transaction(async (tx) => {
				const inner = createKnowledgeStore(tx);
				await inner.replaceDocument(document("kb:a.md"), [chunk("a0", 0)], [axis(0)], META);
				await inner.replaceDocument(
					document("kb:b.md"),
					[chunk("dup", 0), chunk("dup", 1)],
					[axis(1), axis(2)],
					META,
				);
			}),
		).rejects.toThrow();

		expect(await store.listDocuments()).toEqual([]);
		expect(await store.getMeta()).toBeUndefined();
	});

	it("records the embedding model and rejects another one", async () => {
		await store.replaceDocument(document("kb:a.md"), [chunk("a0", 0)], [axis(0)], META);

		expect(await store.getMeta()).toEqual(META);
		await expect(
			store.replaceDocument(document("kb:b.md"), [chunk("b0", 0)], [axis(1)], {
				embeddingModelId: MODEL_DEFAULTS.local.ollama.embedding,
				dimensions: 768,
			}),
		).rejects.toMatchObject({ details: { reason: "embedding-model-changed" } });
	});
});

describe("searchByVector on Postgres", () => {
	beforeEach(async () => {
		await store.replaceDocument(
			document("kb:a.md", ["rag"]),
			[chunk("a0", 0), chunk("a1", 1)],
			[axis(0), mix(0, 1)],
			META,
		);
		await store.replaceDocument(
			document("kb:b.md", ["faq", "rag-extra"]),
			[chunk("b0", 0), chunk("b1", 1)],
			[axis(1), negated(axis(0))],
			META,
		);
	});

	it("orders by cosine distance with the same similarities as PGlite", async () => {
		const found = await store.searchByVector({ embedding: axis(0), minSimilarity: -1, limit: 10 });

		expect(found.map((hit) => hit.chunk.id)).toEqual(["a0", "a1", "b0", "b1"]);
		const similarities = found.map((hit) => hit.similarity);
		expect(similarities[0]).toBeCloseTo(1, 6);
		expect(similarities[1]).toBeCloseTo(Math.SQRT1_2, 6);
		expect(similarities[2]).toBeCloseTo(0, 6);
		expect(similarities[3]).toBeCloseTo(-1, 6);
	});

	it("includes a candidate exactly at the threshold and drops one just below it", async () => {
		const atZero = await store.searchByVector({ embedding: axis(0), minSimilarity: 0, limit: 10 });
		const above = await store.searchByVector({
			embedding: axis(0),
			minSimilarity: 0.000_001,
			limit: 10,
		});

		expect(atZero.map((hit) => hit.chunk.id)).toEqual(["a0", "a1", "b0"]);
		expect(above.map((hit) => hit.chunk.id)).toEqual(["a0", "a1"]);
	});

	it("filters by tags (no prefix match) and by document, through the array parameter", async () => {
		const search = { embedding: axis(0), minSimilarity: -1, limit: 10 } as const;

		const rag = await store.searchByVector({ ...search, filter: { tags: ["rag"] } });
		const either = await store.searchByVector({ ...search, filter: { tags: ["rag", "faq"] } });
		const document_ = await store.searchByVector({
			...search,
			filter: { documentIds: ["kb:b.md"] },
		});

		expect(rag.map((hit) => hit.chunk.documentId)).toEqual(["kb:a.md", "kb:a.md"]);
		expect(either).toHaveLength(4);
		expect(document_.map((hit) => hit.chunk.id)).toEqual(["b0", "b1"]);
	});
});

describe("searchByFullText on Postgres", () => {
	beforeEach(async () => {
		const bodies: [string, string][] = [
			["t0", "全文検索とベクトル検索を比較する"],
			["t1", "検索の精度を評価する"],
			["t2", "ハイブリッド検索では RRF で順位を統合する"],
			["t3", "まったく関係のない文章です"],
		];
		await store.replaceDocument(
			document("kb:a.md", ["rag"]),
			bodies.slice(0, 2).map(([id, body], ordinal) => chunk(id, ordinal, body)),
			[axis(0), axis(1)],
			META,
		);
		await store.replaceDocument(
			document("kb:b.md", ["faq"]),
			bodies.slice(2).map(([id, body], ordinal) => chunk(id, ordinal, body)),
			[axis(2), axis(3)],
			META,
		);
	});

	it("finds Japanese text through word segmentation and ranks more matches higher", async () => {
		const found = await store.searchByFullText({
			query: buildFullTextQuery("全文検索"),
			limit: 10,
		});

		expect(found.map((hit) => hit.chunk.id)).toEqual(["t0", "t1", "t2"]);
		expect(found[0]?.score).toBeGreaterThan(found[1]?.score ?? Number.POSITIVE_INFINITY);
	});

	it("applies the tag filter and searches nothing without a query", async () => {
		const byTag = await store.searchByFullText({
			query: buildFullTextQuery("検索"),
			limit: 10,
			filter: { tags: ["faq"] },
		});

		expect(byTag.map((hit) => hit.chunk.id)).toEqual(["t2"]);
		expect(await store.searchByFullText({ query: undefined, limit: 10 })).toEqual([]);
	});
});
