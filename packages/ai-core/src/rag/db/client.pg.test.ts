import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadPlatformConfig } from "../../config";
import { createPostgresDatabase, type RagDatabaseHandle } from "./client";
import { KnowledgeBaseUnavailableError } from "./errors";
import { helpdeskTickets, marketingProducts, ragChunks, ragDocuments } from "./schema";

// Runs only through `mise run test:db` (Compose `db` profile, PostgreSQL 17 + pgvector).
// Everything happens in a scratch database, so the learner's `agentic_ai` data is never touched.
const base = loadPlatformConfig(process.env).database;
const scratchName = `rag_pg_test_${randomBytes(4).toString("hex")}`;
const scratchConfig = { ...base, database: scratchName };

let admin: postgres.Sql;
const handles: RagDatabaseHandle[] = [];

async function open(): Promise<RagDatabaseHandle> {
	const handle = await createPostgresDatabase(scratchConfig);
	handles.push(handle);
	return handle;
}

/** postgres.js returns the rows themselves as an array. */
async function rows<T>(handle: RagDatabaseHandle, query: ReturnType<typeof sql>): Promise<T[]> {
	const result = await handle.db.execute(query);
	if (!Array.isArray(result)) throw new Error("expected postgres.js to return a row array");
	return result as T[];
}

function unitVector(axis: number): number[] {
	return Array.from({ length: 768 }, (_, index) => (index === axis ? 1 : 0));
}

beforeAll(async () => {
	admin = postgres({ ...base, max: 1, onnotice: () => undefined });
	await admin`CREATE DATABASE ${admin(scratchName)}`;
});

afterAll(async () => {
	await Promise.all(handles.map((handle) => handle.close()));
	await admin`DROP DATABASE IF EXISTS ${admin(scratchName)} WITH (FORCE)`;
	await admin.end();
});

describe("Compose Postgres", () => {
	it("has the vector extension enabled by the init SQL in the configured database", async () => {
		const extensions = await admin`SELECT extname FROM pg_extension WHERE extname = 'vector'`;

		expect(extensions.map((row) => row.extname)).toEqual(["vector"]);
	});

	it("connects, enables vector on a blank database and applies the migrations", async () => {
		const handle = await open();

		expect(handle.kind).toBe("postgres");
		const applied = await rows<{ name: string }>(handle, sql`SELECT name FROM rag_migrations`);
		expect(applied.map((row) => row.name)).toEqual([
			"0001_rag_schema.sql",
			"0002_helpdesk.sql",
			"0003_marketing.sql",
		]);
		const [version] = await rows<{ extversion: string }>(
			handle,
			sql`SELECT extversion FROM pg_extension WHERE extname = 'vector'`,
		);
		const [major = 0, minor = 0] = String(version?.extversion).split(".").map(Number);
		// HNSW needs pgvector 0.5.0 or newer.
		expect(major > 0 || minor >= 5).toBe(true);
	});

	it("applies 0002_helpdesk.sql with runMigrations and enforces its constraints", async () => {
		const handle = await open();

		const tables = await rows<{ table_name: string }>(
			handle,
			sql`SELECT table_name FROM information_schema.tables
				WHERE table_schema = 'public' AND table_name LIKE 'helpdesk_%' ORDER BY table_name`,
		);
		expect(tables.map((row) => row.table_name)).toEqual([
			"helpdesk_plan_revisions",
			"helpdesk_tickets",
		]);
		const now = new Date("2026-10-18T00:00:00.000Z");
		const contradiction = handle.db.insert(helpdeskTickets).values({
			id: "T-0001",
			inquiry: "q",
			status: "resolved",
			answer: null,
			escalationReason: null,
			stepsUsed: 1,
			stoppedReason: null,
			createdAt: now,
			updatedAt: now,
		});
		await expect(contradiction).rejects.toThrow();
		const [count] = await rows<{ count: number }>(
			handle,
			sql`SELECT count(*)::int AS count FROM helpdesk_tickets`,
		);
		expect(count?.count).toBe(0);
	});

	it("applies 0003_marketing.sql with runMigrations and enforces its constraints", async () => {
		const handle = await open();

		const tables = await rows<{ table_name: string }>(
			handle,
			sql`SELECT table_name FROM information_schema.tables
				WHERE table_schema = 'public' AND table_name LIKE 'marketing_%' ORDER BY table_name`,
		);
		expect(tables.map((row) => row.table_name)).toEqual([
			"marketing_personas",
			"marketing_products",
		]);
		const product = {
			id: "P-001",
			name: "n",
			category: "c",
			priceYen: 100,
			description: "d",
			tags: ["t"],
		};
		await expect(
			handle.db.insert(marketingProducts).values({ ...product, priceYen: -1 }),
		).rejects.toThrow();
		await expect(
			handle.db.insert(marketingProducts).values({ ...product, id: "P-01" }),
		).rejects.toThrow();
		const [count] = await rows<{ count: number }>(
			handle,
			sql`SELECT count(*)::int AS count FROM marketing_products`,
		);
		expect(count?.count).toBe(0);
	});

	it("creates the HNSW and GIN indexes", async () => {
		const handle = await open();

		const indexes = await rows<{ indexname: string }>(
			handle,
			sql`SELECT indexname FROM pg_indexes WHERE tablename = 'rag_chunks' ORDER BY indexname`,
		);
		expect(indexes.map((row) => row.indexname)).toEqual(
			expect.arrayContaining(["rag_chunks_embedding_hnsw", "rag_chunks_tsv_gin"]),
		);
	});

	it("does not apply a migration twice when connecting again", async () => {
		await open();
		const second = await open();

		const [applied] = await rows<{ count: number }>(
			second,
			sql`SELECT count(*)::int AS count FROM rag_migrations`,
		);
		expect(applied?.count).toBe(3);
	});

	it("stores a chunk through postgres.js and orders neighbours by cosine distance", async () => {
		const handle = await open();
		await handle.db.insert(ragDocuments).values({
			id: "kb:pg.md",
			title: "pg",
			sourceType: "markdown",
			tags: ["pg"],
			chunkCount: 2,
			ingestedAt: new Date("2026-10-12T00:00:00.000Z"),
		});
		const chunk = { documentId: "kb:pg.md", headingPath: [], body: "本文", searchText: "本文" };
		await handle.db.insert(ragChunks).values([
			{ ...chunk, id: "near", ordinal: 0, embedding: unitVector(0) },
			{ ...chunk, id: "far", ordinal: 1, embedding: unitVector(1) },
		]);

		const nearest = await rows<{ id: string }>(
			handle,
			sql`SELECT id FROM rag_chunks ORDER BY embedding <=> ${`[${unitVector(0).join(",")}]`}::vector`,
		);

		expect(nearest.map((row) => row.id)).toEqual(["near", "far"]);
	});

	it("rolls back a failed transaction", async () => {
		const handle = await open();

		await expect(
			handle.db.transaction(async (tx) => {
				await tx.insert(ragDocuments).values({
					id: "kb:rollback.md",
					title: "rollback",
					sourceType: "markdown",
					tags: [],
					chunkCount: 0,
					ingestedAt: new Date("2026-10-12T00:00:00.000Z"),
				});
				throw new Error("abort");
			}),
		).rejects.toThrow("abort");

		const left = await rows<{ id: string }>(
			handle,
			sql`SELECT id FROM rag_documents WHERE id = 'kb:rollback.md'`,
		);
		expect(left).toHaveLength(0);
	});

	it("reports a server that rejects the credentials as KnowledgeBaseUnavailableError", async () => {
		const failure = await createPostgresDatabase({
			...scratchConfig,
			password: "wrong-password",
		}).catch((error: unknown) => error);

		expect(failure).toBeInstanceOf(KnowledgeBaseUnavailableError);
		expect((failure as Error).message).not.toContain("wrong-password");
	});
});
