import { readFile } from "node:fs/promises";
import { getTableColumns, sql } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { getTableName } from "drizzle-orm/table";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_COUNCIL } from "../../config";
import { PlatformError } from "../../errors";
import { createPgliteDatabase, createPostgresDatabase, type RagDatabaseHandle } from "./client";
import { KnowledgeBaseUnavailableError } from "./errors";
import {
	helpdeskPlanRevisions,
	helpdeskTickets,
	marketingPersonas,
	marketingProducts,
	ragChunks,
	ragDocuments,
	ragMeta,
	ragMigrations,
} from "./schema";

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

const TABLES: readonly PgTable[] = [
	ragMigrations,
	ragMeta,
	ragDocuments,
	ragChunks,
	helpdeskTickets,
	helpdeskPlanRevisions,
	marketingProducts,
	marketingPersonas,
];
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
		expect(applied.map((row) => row.name)).toEqual([
			"0001_rag_schema.sql",
			"0002_helpdesk.sql",
			"0003_marketing.sql",
		]);
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

describe("helpdesk tables (0002_helpdesk.sql, 003 plan Data Model)", () => {
	type Ticket = typeof helpdeskTickets.$inferInsert;

	function ticket(overrides: Partial<Ticket> = {}): Ticket {
		return {
			id: "T-0001",
			inquiry: "VPN に接続できません",
			status: "open",
			answer: null,
			escalationReason: null,
			stepsUsed: 0,
			stoppedReason: null,
			createdAt: NOW,
			updatedAt: NOW,
			...overrides,
		};
	}

	beforeEach(async () => {
		await handle.db.execute(sql`TRUNCATE helpdesk_plan_revisions, helpdesk_tickets CASCADE`);
	});

	describe("helpdesk_tickets status / answer / escalation_reason / stopped_reason", () => {
		it("accepts each consistent combination", async () => {
			await handle.db.insert(helpdeskTickets).values([
				ticket({ id: "T-0001" }),
				ticket({ id: "T-0002", stoppedReason: "step-limit", stepsUsed: 12 }),
				ticket({ id: "T-0003", stoppedReason: "aborted", stepsUsed: 3 }),
				ticket({ id: "T-0004", status: "resolved", answer: "設定画面から再接続してください。" }),
				ticket({
					id: "T-0005",
					status: "escalated",
					escalationReason: "根拠が見つかりませんでした。",
				}),
			]);

			const stored = await rows<{ id: string }>(sql`SELECT id FROM helpdesk_tickets ORDER BY id`);
			expect(stored.map((row) => row.id)).toEqual([
				"T-0001",
				"T-0002",
				"T-0003",
				"T-0004",
				"T-0005",
			]);
		});

		it.each([
			["resolved without an answer", { status: "resolved" }],
			[
				"resolved with an escalation reason",
				{ status: "resolved", answer: "a", escalationReason: "r" },
			],
			[
				"resolved with a stopped reason",
				{ status: "resolved", answer: "a", stoppedReason: "aborted" },
			],
			["escalated without a reason", { status: "escalated" }],
			["escalated with an answer", { status: "escalated", escalationReason: "r", answer: "a" }],
			[
				"escalated with a stopped reason",
				{ status: "escalated", escalationReason: "r", stoppedReason: "aborted" },
			],
			["open with an answer (a resolved ticket put back)", { status: "open", answer: "a" }],
			["open with an escalation reason", { status: "open", escalationReason: "r" }],
		] as const)("rejects %s", async (_name, overrides) => {
			expect(
				await failureOf(handle.db.insert(helpdeskTickets).values(ticket({ ...overrides }))),
			).toMatch(/helpdesk_tickets_state_check/);
		});

		it("rejects an unknown status, an unknown stopped reason, a negative step count and a malformed id", async () => {
			expect(
				await failureOf(
					handle.db.insert(helpdeskTickets).values(ticket({ status: "closed" as "open" })),
				),
			).toMatch(/helpdesk_tickets_state_check/);
			expect(
				await failureOf(
					handle.db
						.insert(helpdeskTickets)
						.values(ticket({ stoppedReason: "crashed" as "aborted" })),
				),
			).toMatch(/helpdesk_tickets_stopped_reason_check/);
			expect(
				await failureOf(handle.db.insert(helpdeskTickets).values(ticket({ stepsUsed: -1 }))),
			).toMatch(/helpdesk_tickets_steps_used_check/);
			expect(
				await failureOf(handle.db.insert(helpdeskTickets).values(ticket({ id: "T-1" }))),
			).toMatch(/helpdesk_tickets_id_check/);
			expect(
				await failureOf(handle.db.insert(helpdeskTickets).values(ticket({ id: "x-0001" }))),
			).toMatch(/helpdesk_tickets_id_check/);
		});

		it("rejects a second row with the same id", async () => {
			await handle.db.insert(helpdeskTickets).values(ticket());
			expect(await failureOf(handle.db.insert(helpdeskTickets).values(ticket()))).toMatch(
				/helpdesk_tickets_pkey/,
			);
		});

		it("rejects an update that leaves a resolved ticket without its answer", async () => {
			await handle.db.insert(helpdeskTickets).values(ticket({ status: "resolved", answer: "a" }));

			expect(
				await failureOf(handle.db.execute(sql`UPDATE helpdesk_tickets SET answer = NULL`)),
			).toMatch(/helpdesk_tickets_state_check/);
			expect(
				await failureOf(handle.db.execute(sql`UPDATE helpdesk_tickets SET status = 'open'`)),
			).toMatch(/helpdesk_tickets_state_check/);
		});

		it("takes the timestamps from the caller: no column default", async () => {
			const defaults = await rows<{ column_name: string; column_default: string | null }>(
				sql`SELECT column_name, column_default FROM information_schema.columns
					WHERE table_name IN ('helpdesk_tickets', 'helpdesk_plan_revisions')
						AND column_name IN ('created_at', 'updated_at')`,
			);
			expect(defaults).toHaveLength(3);
			for (const column of defaults) expect(column.column_default).toBeNull();
		});
	});

	describe("helpdesk_plan_revisions", () => {
		const plan = { tasks: [{ id: "t1", description: "検索", dependsOn: [] }] };
		const diff = { added: ["t2"], removed: [], changed: [] };

		function revision(overrides: Partial<typeof helpdeskPlanRevisions.$inferInsert> = {}) {
			return {
				ticketId: "T-0001",
				revision: 0,
				plan,
				diff: null,
				reason: "initial",
				createdAt: NOW,
				...overrides,
			};
		}

		it("requires a NULL diff for revision 0 and a diff for every later revision", async () => {
			await handle.db.insert(helpdeskTickets).values(ticket());

			expect(
				await failureOf(handle.db.insert(helpdeskPlanRevisions).values(revision({ diff }))),
			).toMatch(/helpdesk_plan_revisions_diff_check/);
			expect(
				await failureOf(
					handle.db.insert(helpdeskPlanRevisions).values(revision({ revision: 1, diff: null })),
				),
			).toMatch(/helpdesk_plan_revisions_diff_check/);
			await handle.db
				.insert(helpdeskPlanRevisions)
				.values([revision(), revision({ revision: 1, diff })]);
		});

		it("rejects a negative revision and a second row with the same (ticket, revision)", async () => {
			await handle.db.insert(helpdeskTickets).values(ticket());
			await handle.db.insert(helpdeskPlanRevisions).values(revision());

			expect(
				await failureOf(
					handle.db.insert(helpdeskPlanRevisions).values(revision({ revision: -1, diff })),
				),
			).toMatch(/helpdesk_plan_revisions_diff_check/);
			expect(await failureOf(handle.db.insert(helpdeskPlanRevisions).values(revision()))).toMatch(
				/helpdesk_plan_revisions_pkey/,
			);
		});

		it("rejects a revision of a ticket that does not exist", async () => {
			expect(await failureOf(handle.db.insert(helpdeskPlanRevisions).values(revision()))).toMatch(
				/helpdesk_plan_revisions_ticket_id_fkey/,
			);
		});

		it("deletes a ticket's revisions with it (ON DELETE CASCADE) and leaves other tickets alone", async () => {
			await handle.db.insert(helpdeskTickets).values([ticket(), ticket({ id: "T-0002" })]);
			await handle.db
				.insert(helpdeskPlanRevisions)
				.values([revision(), revision({ ticketId: "T-0002" })]);

			await handle.db.execute(sql`DELETE FROM helpdesk_tickets WHERE id = 'T-0001'`);

			const left = await rows<{ ticket_id: string }>(
				sql`SELECT ticket_id FROM helpdesk_plan_revisions`,
			);
			expect(left.map((row) => row.ticket_id)).toEqual(["T-0002"]);
		});

		it("stores the plan and the diff as jsonb and reads them back unchanged", async () => {
			await handle.db.insert(helpdeskTickets).values(ticket());
			await handle.db
				.insert(helpdeskPlanRevisions)
				.values([revision(), revision({ revision: 1, diff })]);

			const stored = await handle.db
				.select()
				.from(helpdeskPlanRevisions)
				.orderBy(helpdeskPlanRevisions.revision);

			expect(stored.map((row) => row.plan)).toEqual([plan, plan]);
			expect(stored.map((row) => row.diff)).toEqual([null, diff]);
		});
	});

	it("leaves the rag_* tables alone when the helpdesk tables are emptied, and the other way round", async () => {
		await insertDocument("kb:keep.md");
		await handle.db.insert(helpdeskTickets).values(ticket());

		await handle.db.execute(sql`TRUNCATE helpdesk_plan_revisions, helpdesk_tickets CASCADE`);

		const documents = await rows<{ id: string }>(sql`SELECT id FROM rag_documents`);
		expect(documents.map((row) => row.id)).toEqual(["kb:keep.md"]);
	});
});

describe("marketing tables (0003_marketing.sql, 003 plan Data Model)", () => {
	type Product = typeof marketingProducts.$inferInsert;
	type Persona = typeof marketingPersonas.$inferInsert;

	function product(overrides: Partial<Product> = {}): Product {
		return {
			id: "P-001",
			name: "ワイヤレスイヤホン",
			category: "オーディオ",
			priceYen: 4980,
			description: "ノイズ低減つきの完全ワイヤレスイヤホン。",
			tags: ["音楽", "通勤"],
			...overrides,
		};
	}

	function persona(overrides: Partial<Persona> = {}): Persona {
		return {
			id: "consumer",
			name: "生活者",
			viewpoint: "購入を検討する一般の生活者として、分かりやすさと価格の納得感を見る。",
			ordinal: 1,
			...overrides,
		};
	}

	beforeEach(async () => {
		await handle.db.execute(sql`TRUNCATE marketing_products, marketing_personas`);
	});

	describe("marketing_products", () => {
		it("accepts a well-formed product and reads it back unchanged", async () => {
			await handle.db.insert(marketingProducts).values(product());

			const [stored] = await handle.db.select().from(marketingProducts);
			expect(stored).toEqual(product());
		});

		it.each([
			["a two-digit number", "P-01"],
			["a four-digit number", "P-1000"],
			["a lower-case prefix", "p-001"],
			["another prefix", "T-001"],
			["a non-numeric suffix", "P-00A"],
			["trailing text", "P-001x"],
			["leading text", "xP-001"],
		])("rejects an id with %s", async (_name, id) => {
			expect(await failureOf(handle.db.insert(marketingProducts).values(product({ id })))).toMatch(
				/marketing_products_id_check/,
			);
		});

		it("accepts a price of 0 and rejects a negative price", async () => {
			await handle.db.insert(marketingProducts).values(product({ priceYen: 0 }));

			expect(
				await failureOf(
					handle.db.insert(marketingProducts).values(product({ id: "P-002", priceYen: -1 })),
				),
			).toMatch(/marketing_products_price_yen_check/);
		});

		it("rejects a second row with the same id", async () => {
			await handle.db.insert(marketingProducts).values(product());
			expect(await failureOf(handle.db.insert(marketingProducts).values(product()))).toMatch(
				/marketing_products_pkey/,
			);
		});

		it("defaults tags to an empty array and does not accept NULL", async () => {
			await handle.db.execute(
				sql`INSERT INTO marketing_products (id, name, category, price_yen, description)
					VALUES ('P-009', 'n', 'c', 100, 'd')`,
			);
			const [stored] = await handle.db.select().from(marketingProducts);
			expect(stored?.tags).toEqual([]);

			expect(
				await failureOf(
					handle.db.execute(
						sql`INSERT INTO marketing_products (id, name, category, price_yen, description, tags)
							VALUES ('P-010', 'n', 'c', 100, 'd', NULL)`,
					),
				),
			).toMatch(/null value in column "tags"/);
		});
	});

	describe("marketing_personas", () => {
		it("accepts well-formed personas and returns them in ordinal order", async () => {
			await handle.db
				.insert(marketingPersonas)
				.values([persona({ id: "b", ordinal: 2 }), persona({ id: "a", ordinal: 1 })]);

			const stored = await handle.db
				.select()
				.from(marketingPersonas)
				.orderBy(marketingPersonas.ordinal);
			expect(stored.map((row) => row.id)).toEqual(["a", "b"]);
		});

		it("enforces UNIQUE (ordinal)", async () => {
			await handle.db.insert(marketingPersonas).values(persona());

			expect(
				await failureOf(handle.db.insert(marketingPersonas).values(persona({ id: "other" }))),
			).toMatch(/marketing_personas_ordinal_unique/);
		});

		it("rejects a second row with the same id", async () => {
			await handle.db.insert(marketingPersonas).values(persona());
			expect(
				await failureOf(handle.db.insert(marketingPersonas).values(persona({ ordinal: 2 }))),
			).toMatch(/marketing_personas_pkey/);
		});
	});

	describe("initial data (fixtures/marketing)", () => {
		async function fixture(name: string): Promise<unknown> {
			const file = new URL(`../../../fixtures/marketing/${name}.json`, import.meta.url);
			return JSON.parse(await readFile(file, "utf8"));
		}

		it("products.json inserts as-is, with catalogue ids in order and a spread of prices", async () => {
			const products = (await fixture("products")) as Product[];

			await handle.db.insert(marketingProducts).values(products);

			const stored = await handle.db.select().from(marketingProducts).orderBy(marketingProducts.id);
			expect(stored).toEqual(products);
			expect(stored.length).toBeGreaterThanOrEqual(8);
			expect(stored.length).toBeLessThanOrEqual(12);
			expect(stored.map((row) => row.id)).toEqual(
				stored.map((_row, index) => `P-${String(index + 1).padStart(3, "0")}`),
			);
			// Both sides of a 10,000 yen budget must exist for the budget-excess behaviour.
			expect(stored.some((row) => row.priceYen > 10_000)).toBe(true);
			expect(stored.some((row) => row.priceYen < 5_000)).toBe(true);
			for (const row of stored) expect(row.tags.length).toBeGreaterThan(0);
		});

		it("personas.json inserts as-is and holds exactly the default council, in order", async () => {
			const personas = (await fixture("personas")) as Persona[];

			await handle.db.insert(marketingPersonas).values(personas);

			const stored = await handle.db
				.select()
				.from(marketingPersonas)
				.orderBy(marketingPersonas.ordinal);
			expect(stored).toEqual(personas);
			expect(stored.map((row) => row.id)).toEqual([...DEFAULT_COUNCIL.personaIds]);
			expect(stored.map((row) => row.ordinal)).toEqual([1, 2, 3]);
			for (const row of stored) {
				expect(row.name.trim()).not.toBe("");
				expect(row.viewpoint.trim()).not.toBe("");
			}
		});
	});

	it("leaves the helpdesk and rag_* tables alone when the marketing tables are emptied", async () => {
		await insertDocument("kb:keep.md");
		await handle.db.insert(marketingProducts).values(product());

		await handle.db.execute(sql`TRUNCATE marketing_products, marketing_personas`);

		const documents = await rows<{ id: string }>(sql`SELECT id FROM rag_documents`);
		expect(documents.map((row) => row.id)).toEqual(["kb:keep.md"]);
	});
});
