import { getTableColumns, sql } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { getTableName } from "drizzle-orm/table";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PlatformError } from "../../errors";
import { createPgliteDatabase, createPostgresDatabase, type RagDatabaseHandle } from "./client";
import { KnowledgeBaseUnavailableError } from "./errors";
import { ragChunks, ragDocuments, ragMeta, ragMigrations } from "./schema";

// postgres.js would retry a blocked socket until its connect timeout; a fake client keeps the
// connection-failure path deterministic. The real driver is exercised by client.pg.test.ts.
const fakePostgres = vi.hoisted(() => ({
	end: vi.fn(async () => undefined),
	unsafe: vi.fn(),
}));
vi.mock("postgres", () => ({
	default: vi.fn(() => ({
		options: { parsers: {}, serializers: {} },
		unsafe: fakePostgres.unsafe,
		end: fakePostgres.end,
	})),
}));

const TABLES: readonly PgTable[] = [ragMigrations, ragMeta, ragDocuments, ragChunks];
const NOW = new Date("2026-10-12T00:00:00.000Z");

let handle: RagDatabaseHandle;

function unitVector(axis: number, dimensions = 768): number[] {
	return Array.from({ length: dimensions }, (_, index) => (index === axis ? 1 : 0));
}

function vectorLiteral(values: readonly number[]): string {
	return `[${values.join(",")}]`;
}

async function rows<T>(query: ReturnType<typeof sql>): Promise<T[]> {
	const result = (await handle.db.execute(query)) as unknown as { rows: T[] };
	return result.rows;
}

/** Drizzle wraps driver failures; the constraint name lives on the cause. */
async function failureOf(promise: Promise<unknown>): Promise<string> {
	try {
		await promise;
	} catch (error) {
		const cause = error instanceof Error ? error.cause : undefined;
		return `${error instanceof Error ? error.message : String(error)} ${
			cause instanceof Error ? cause.message : ""
		}`;
	}
	throw new Error("expected the statement to be rejected, but it succeeded");
}

async function insertDocument(id: string, sourceType: "markdown" | "pdf" = "markdown") {
	await handle.db.insert(ragDocuments).values({
		id,
		title: id,
		sourceType,
		tags: [],
		chunkCount: 0,
		ingestedAt: NOW,
	});
}

function chunkRow(overrides: Partial<typeof ragChunks.$inferInsert> = {}) {
	return {
		id: "chunk-1",
		documentId: "kb:a.md",
		ordinal: 0,
		headingPath: ["見出し"],
		page: null,
		body: "本文",
		searchText: "本文",
		embedding: unitVector(0),
		...overrides,
	};
}

/** Normalizes `information_schema` types to the SQL type Drizzle reports for the column. */
function informationSchemaType(dataType: string, udtName: string): string {
	if (dataType === "ARRAY") return `${udtName.replace(/^_/, "")}[]`;
	if (dataType === "USER-DEFINED") return udtName;
	return dataType;
}

function drizzleType(column: AnyPgColumn): string {
	return column.getSQLType().replace(/\(\d+\)$/, "");
}

beforeAll(async () => {
	handle = await createPgliteDatabase();
});

afterAll(async () => {
	await handle.close();
});

beforeEach(async () => {
	await handle.db.execute(sql`TRUNCATE rag_chunks, rag_documents, rag_meta CASCADE`);
});

describe("createPgliteDatabase", () => {
	it("returns a PGlite handle with the migrations applied", async () => {
		expect(handle.kind).toBe("pglite");
		const applied = await rows<{ name: string }>(sql`SELECT name FROM rag_migrations`);
		expect(applied.map((row) => row.name)).toEqual(["0001_rag_schema.sql"]);
	});

	it("creates an independent in-memory database per call", async () => {
		await insertDocument("kb:isolated.md");
		const other = await createPgliteDatabase();
		try {
			const result = (await other.db.execute(
				sql`SELECT count(*)::int AS count FROM rag_documents`,
			)) as unknown as { rows: { count: number }[] };
			expect(result.rows[0]?.count).toBe(0);
		} finally {
			await other.close();
		}
		// Starting a second PGlite takes seconds when the gate runs every workspace at once.
	}, 30_000);
});

describe("createPostgresDatabase", () => {
	const config = {
		host: "127.0.0.1",
		port: 5432,
		user: "postgres",
		password: "changeme",
		database: "agentic_ai",
	};

	beforeEach(() => {
		fakePostgres.end.mockClear();
		fakePostgres.unsafe.mockReset();
	});

	it("turns an unreachable server into KnowledgeBaseUnavailableError with start-up guidance", async () => {
		fakePostgres.unsafe.mockRejectedValue(
			new Error("connect ECONNREFUSED 127.0.0.1:5432 password=changeme"),
		);

		const failure = await createPostgresDatabase(config).catch((error: unknown) => error);

		expect(failure).toBeInstanceOf(KnowledgeBaseUnavailableError);
		expect(failure).toMatchObject({ code: "provider-unavailable" });
		expect((failure as Error).message).toMatch(/mise run services:up:db/);
		expect((failure as Error).message).not.toMatch(/changeme|ECONNREFUSED/);
	});

	it("closes the connection pool when the server cannot be reached", async () => {
		fakePostgres.unsafe.mockRejectedValue(new Error("connection refused"));

		await createPostgresDatabase(config).catch(() => undefined);

		expect(fakePostgres.end).toHaveBeenCalledTimes(1);
	});
});

describe("KnowledgeBaseUnavailableError", () => {
	it("is a provider-unavailable PlatformError", () => {
		const error = new KnowledgeBaseUnavailableError();
		expect(error).toBeInstanceOf(PlatformError);
		expect(error.code).toBe("provider-unavailable");
		expect(error.name).toBe("KnowledgeBaseUnavailableError");
	});
});

describe("schema.ts matches the migrated database", () => {
	for (const table of TABLES) {
		it(`${getTableName(table)}: column names, types and nullability agree`, async () => {
			const actual = await rows<{
				column_name: string;
				data_type: string;
				udt_name: string;
				is_nullable: string;
			}>(
				sql`SELECT column_name, data_type, udt_name, is_nullable
					FROM information_schema.columns
					WHERE table_schema = 'public' AND table_name = ${getTableName(table)}`,
			);
			const fromDatabase = Object.fromEntries(
				actual.map((column) => [
					column.column_name,
					{
						type: informationSchemaType(column.data_type, column.udt_name),
						notNull: column.is_nullable === "NO",
					},
				]),
			);
			const fromSchema = Object.fromEntries(
				Object.values(getTableColumns(table)).map((column) => [
					column.name,
					{ type: drizzleType(column), notNull: column.notNull },
				]),
			);

			expect(fromDatabase).toEqual(fromSchema);
			expect(Object.keys(fromSchema).length).toBeGreaterThan(1);
		});
	}

	it("embedding is vector(768) in the database", async () => {
		const [column] = await rows<{ type: string }>(
			sql`SELECT format_type(atttypid, atttypmod) AS type
				FROM pg_attribute
				WHERE attrelid = 'rag_chunks'::regclass AND attname = 'embedding'`,
		);
		expect(column?.type).toBe("vector(768)");
	});
});

describe("constraints", () => {
	it("rejects a page below 1 and accepts page 1 and NULL", async () => {
		await insertDocument("kb:a.md", "pdf");

		expect(await failureOf(handle.db.insert(ragChunks).values(chunkRow({ page: 0 })))).toMatch(
			/rag_chunks_page_check/,
		);
		await handle.db.insert(ragChunks).values(chunkRow({ id: "p1", ordinal: 1, page: 1 }));
		await handle.db.insert(ragChunks).values(chunkRow({ id: "pn", ordinal: 2, page: null }));
		const stored = await rows<{ id: string }>(sql`SELECT id FROM rag_chunks ORDER BY ordinal`);
		expect(stored.map((row) => row.id)).toEqual(["p1", "pn"]);
	});

	it("rejects a source_type other than markdown and pdf", async () => {
		const failure = failureOf(
			handle.db.insert(ragDocuments).values({
				id: "kb:a.docx",
				title: "a",
				sourceType: "docx" as "pdf",
				tags: [],
				chunkCount: 0,
				ingestedAt: NOW,
			}),
		);
		expect(await failure).toMatch(/rag_documents_source_type_check/);
	});

	it("rejects a chunk whose document does not exist", async () => {
		expect(await failureOf(handle.db.insert(ragChunks).values(chunkRow()))).toMatch(
			/rag_chunks_document_id_fkey/,
		);
	});

	it("deletes a document's chunks with it (ON DELETE CASCADE) and leaves other documents alone", async () => {
		await insertDocument("kb:a.md");
		await insertDocument("kb:b.md");
		await handle.db
			.insert(ragChunks)
			.values([
				chunkRow({ id: "a0", documentId: "kb:a.md", ordinal: 0 }),
				chunkRow({ id: "a1", documentId: "kb:a.md", ordinal: 1 }),
				chunkRow({ id: "b0", documentId: "kb:b.md", ordinal: 0 }),
			]);

		await handle.db.execute(sql`DELETE FROM rag_documents WHERE id = 'kb:a.md'`);

		const left = await rows<{ id: string }>(sql`SELECT id FROM rag_chunks ORDER BY id`);
		expect(left.map((row) => row.id)).toEqual(["b0"]);
	});

	it("enforces UNIQUE (document_id, ordinal) per document only", async () => {
		await insertDocument("kb:a.md");
		await insertDocument("kb:b.md");
		await handle.db.insert(ragChunks).values(chunkRow({ id: "a0", documentId: "kb:a.md" }));

		expect(
			await failureOf(
				handle.db.insert(ragChunks).values(chunkRow({ id: "a0-dup", documentId: "kb:a.md" })),
			),
		).toMatch(/rag_chunks_document_ordinal_unique/);
		await handle.db.insert(ragChunks).values(chunkRow({ id: "b0", documentId: "kb:b.md" }));
	});

	it("rejects an embedding that is not 768-dimensional", async () => {
		await insertDocument("kb:a.md");
		const failure = await failureOf(
			handle.db.insert(ragChunks).values(chunkRow({ embedding: unitVector(0, 3) })),
		);
		expect(failure).toMatch(/expected 768 dimensions, not 3/);
	});

	it("allows only the single rag_meta row 'kb' with 768 dimensions", async () => {
		const meta = { embeddingModelId: "mock:embedding-v1", dimensions: 768, createdAt: NOW };

		expect(await failureOf(handle.db.insert(ragMeta).values({ id: "other", ...meta }))).toMatch(
			/rag_meta_id_check/,
		);
		expect(
			await failureOf(handle.db.insert(ragMeta).values({ id: "kb", ...meta, dimensions: 1536 })),
		).toMatch(/rag_meta_dimensions_check/);
		await handle.db.insert(ragMeta).values({ id: "kb", ...meta });
		expect(await failureOf(handle.db.insert(ragMeta).values({ id: "kb", ...meta }))).toMatch(
			/rag_meta_pkey/,
		);
	});

	it("defaults tags and heading_path to empty arrays", async () => {
		await handle.db.execute(
			sql`INSERT INTO rag_documents (id, title, source_type, chunk_count, ingested_at)
				VALUES ('kb:d.md', 'd', 'markdown', 0, ${NOW.toISOString()})`,
		);
		const [document] = await handle.db.select().from(ragDocuments);
		expect(document?.tags).toEqual([]);
	});
});

describe("indexes", () => {
	it("creates an HNSW index with cosine operators on the embedding and a GIN index on tsv", async () => {
		const indexes = await rows<{ indexname: string; indexdef: string }>(
			sql`SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'rag_chunks'`,
		);
		const byName = Object.fromEntries(indexes.map((index) => [index.indexname, index.indexdef]));

		expect(byName.rag_chunks_embedding_hnsw).toMatch(/USING hnsw \(embedding vector_cosine_ops\)/);
		expect(byName.rag_chunks_tsv_gin).toMatch(/USING gin \(tsv\)/);
	});
});

describe("generated column tsv", () => {
	it("is built from search_text with the simple configuration", async () => {
		await insertDocument("kb:a.md");
		await handle.db.insert(ragChunks).values(chunkRow({ searchText: "全文 検索 pgvector" }));

		const hit = await rows<{ matched: boolean }>(
			sql`SELECT tsv @@ to_tsquery('simple', '検索 & pgvector') AS matched FROM rag_chunks`,
		);
		const miss = await rows<{ matched: boolean }>(
			sql`SELECT tsv @@ to_tsquery('simple', 'ベクトル') AS matched FROM rag_chunks`,
		);

		expect(hit[0]?.matched).toBe(true);
		expect(miss[0]?.matched).toBe(false);
	});

	it("follows later changes to search_text and is not writable directly", async () => {
		await insertDocument("kb:a.md");
		await handle.db.insert(ragChunks).values(chunkRow({ searchText: "旧 語" }));

		await handle.db.execute(sql`UPDATE rag_chunks SET search_text = '新 語'`);
		const after = await rows<{ old: boolean; fresh: boolean }>(
			sql`SELECT tsv @@ to_tsquery('simple', '旧') AS old, tsv @@ to_tsquery('simple', '新') AS fresh
				FROM rag_chunks`,
		);

		expect(after[0]).toEqual({ old: false, fresh: true });
		expect(
			await failureOf(
				handle.db.execute(sql`UPDATE rag_chunks SET tsv = to_tsvector('simple', 'x')`),
			),
		).toMatch(/can only be updated to DEFAULT/);
	});
});

describe("Drizzle queries over the migrated schema", () => {
	it("round-trips a chunk with its embedding and orders neighbours by cosine distance", async () => {
		await insertDocument("kb:a.md");
		await handle.db
			.insert(ragChunks)
			.values([
				chunkRow({ id: "near", ordinal: 0, embedding: unitVector(0) }),
				chunkRow({ id: "far", ordinal: 1, embedding: unitVector(1) }),
			]);

		const nearest = await rows<{ id: string; distance: number }>(
			sql`SELECT id, embedding <=> ${vectorLiteral(unitVector(0))}::vector AS distance
				FROM rag_chunks ORDER BY distance`,
		);
		const [stored] = await handle.db.select().from(ragChunks).where(sql`id = 'near'`);

		expect(nearest.map((row) => row.id)).toEqual(["near", "far"]);
		expect(nearest[0]?.distance).toBeCloseTo(0, 6);
		expect(nearest[1]?.distance).toBeCloseTo(1, 6);
		expect(stored?.embedding).toEqual(unitVector(0));
		expect(stored?.headingPath).toEqual(["見出し"]);
	});
});
