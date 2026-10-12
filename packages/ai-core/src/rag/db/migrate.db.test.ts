import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type RagDatabase, runMigrations } from "./migrate";

// Directory listing order is filesystem-defined (APFS happens to sort); reversing it makes the
// migrator's own ordering the only thing that can produce numeric order.
vi.mock("node:fs/promises", async (importOriginal) => {
	const original = await importOriginal<typeof import("node:fs/promises")>();
	return {
		...original,
		readdir: (async (...args: Parameters<typeof original.readdir>) => {
			const entries = await original.readdir(...args);
			return [...entries].reverse();
		}) as typeof original.readdir,
	};
});

const REAL_MIGRATIONS = path.resolve(import.meta.dirname, "../../../drizzle");

let client: PGlite;
let db: RagDatabase;
let workDir: string;

async function writeMigration(name: string, content: string): Promise<void> {
	await writeFile(path.join(workDir, name), content);
}

async function appliedNames(): Promise<string[]> {
	const result = await client.query<{ name: string }>(
		"SELECT name FROM rag_migrations ORDER BY name",
	);
	return result.rows.map((row) => row.name);
}

async function tableExists(name: string): Promise<boolean> {
	const result = await client.query<{ present: boolean }>(
		"SELECT to_regclass($1) IS NOT NULL AS present",
		[`public.${name}`],
	);
	return result.rows[0]?.present === true;
}

beforeAll(async () => {
	client = await PGlite.create({ extensions: { vector } });
	db = drizzle(client);
});

afterAll(async () => {
	await client.close();
});

beforeEach(async () => {
	await client.exec(`
		DROP TABLE IF EXISTS rag_chunks, rag_documents, rag_meta, rag_migrations,
			t_first, t_second, t_third, order_log CASCADE;
	`);
	workDir = await mkdtemp(path.join(tmpdir(), "rag-migrate-"));
	return async () => {
		await rm(workDir, { recursive: true, force: true });
	};
});

describe("runMigrations", () => {
	it("applies NNNN_*.sql files in numeric order and records each name", async () => {
		await client.exec("CREATE TABLE order_log (seq serial PRIMARY KEY, file text NOT NULL)");
		// Written out of order on purpose: the order must come from the file names.
		await writeMigration("0002_second.sql", "INSERT INTO order_log (file) VALUES ('0002');");
		await writeMigration("0001_first.sql", "INSERT INTO order_log (file) VALUES ('0001');");
		await writeMigration("0010_tenth.sql", "INSERT INTO order_log (file) VALUES ('0010');");

		const result = await runMigrations(db, workDir);

		const log = await client.query<{ file: string }>("SELECT file FROM order_log ORDER BY seq");
		expect(log.rows.map((row) => row.file)).toEqual(["0001", "0002", "0010"]);
		expect(await appliedNames()).toEqual(["0001_first.sql", "0002_second.sql", "0010_tenth.sql"]);
		expect(result).toEqual({
			applied: ["0001_first.sql", "0002_second.sql", "0010_tenth.sql"],
			skipped: [],
		});
	});

	it("does not apply a migration twice when run again", async () => {
		await client.exec("CREATE TABLE order_log (seq serial PRIMARY KEY, file text NOT NULL)");
		await writeMigration("0001_first.sql", "INSERT INTO order_log (file) VALUES ('0001');");

		await runMigrations(db, workDir);
		await writeMigration("0002_second.sql", "INSERT INTO order_log (file) VALUES ('0002');");
		const second = await runMigrations(db, workDir);

		const log = await client.query<{ file: string }>("SELECT file FROM order_log ORDER BY seq");
		expect(log.rows.map((row) => row.file)).toEqual(["0001", "0002"]);
		expect(second).toEqual({ applied: ["0002_second.sql"], skipped: ["0001_first.sql"] });
	});

	it("ignores files that do not match NNNN_*.sql", async () => {
		await writeMigration("0001_first.sql", "CREATE TABLE t_first (id int);");
		await writeMigration("notes.sql", "CREATE TABLE t_second (id int);");
		await writeMigration("001_short.sql", "CREATE TABLE t_third (id int);");
		await writeMigration("0002_wrong.txt", "CREATE TABLE t_third (id int);");

		await runMigrations(db, workDir);

		expect(await appliedNames()).toEqual(["0001_first.sql"]);
		expect(await tableExists("t_first")).toBe(true);
		expect(await tableExists("t_second")).toBe(false);
		expect(await tableExists("t_third")).toBe(false);
	});

	it("splits a file into statements at --> statement-breakpoint lines", async () => {
		await writeMigration(
			"0001_two.sql",
			[
				"CREATE TABLE t_first (id int);",
				"--> statement-breakpoint",
				"CREATE TABLE t_second (id int);",
			].join("\n"),
		);

		await runMigrations(db, workDir);

		expect(await tableExists("t_first")).toBe(true);
		expect(await tableExists("t_second")).toBe(true);
	});

	it("rolls back the failing file entirely and leaves later files unapplied", async () => {
		await writeMigration("0001_ok.sql", "CREATE TABLE t_first (id int);");
		await writeMigration(
			"0002_broken.sql",
			[
				"CREATE TABLE t_second (id int);",
				"--> statement-breakpoint",
				"INSERT INTO table_that_does_not_exist VALUES (1);",
			].join("\n"),
		);
		await writeMigration("0003_after.sql", "CREATE TABLE t_third (id int);");

		await expect(runMigrations(db, workDir)).rejects.toThrow(/0002_broken\.sql/);

		expect(await tableExists("t_first")).toBe(true);
		expect(await tableExists("t_second")).toBe(false);
		expect(await tableExists("t_third")).toBe(false);
		expect(await appliedNames()).toEqual(["0001_ok.sql"]);
	});

	it("applies the pending files on a later run after the broken one is fixed", async () => {
		await writeMigration("0001_ok.sql", "CREATE TABLE t_first (id int);");
		await writeMigration("0002_broken.sql", "INSERT INTO table_that_does_not_exist VALUES (1);");
		await expect(runMigrations(db, workDir)).rejects.toThrow();

		await writeMigration("0002_broken.sql", "CREATE TABLE t_second (id int);");
		const result = await runMigrations(db, workDir);

		expect(result).toEqual({ applied: ["0002_broken.sql"], skipped: ["0001_ok.sql"] });
		expect(await tableExists("t_second")).toBe(true);
	});

	it("rejects a directory that contains no migration files", async () => {
		await mkdir(path.join(workDir, "nested"));
		await writeMigration("readme.md", "not a migration");

		await expect(runMigrations(db, workDir)).rejects.toThrow(/マイグレーション/);
	});

	it("creates the rag_migrations bookkeeping table itself on a blank database", async () => {
		await writeMigration("0001_first.sql", "CREATE TABLE t_first (id int);");

		await runMigrations(db, workDir);

		expect(await tableExists("rag_migrations")).toBe(true);
		const columns = await client.query<{ column_name: string }>(
			"SELECT column_name FROM information_schema.columns WHERE table_name = 'rag_migrations' ORDER BY column_name",
		);
		expect(columns.rows.map((row) => row.column_name)).toEqual(["applied_at", "name"]);
	});

	it("applies the real 0001_rag_schema migration and creates the four rag tables", async () => {
		const result = await runMigrations(db, REAL_MIGRATIONS);

		expect(result.applied).toContain("0001_rag_schema.sql");
		for (const table of ["rag_migrations", "rag_meta", "rag_documents", "rag_chunks"]) {
			expect(await tableExists(table)).toBe(true);
		}
		const extension = await client.query<{ extname: string }>(
			"SELECT extname FROM pg_extension WHERE extname = 'vector'",
		);
		expect(extension.rows).toHaveLength(1);
	});
});
