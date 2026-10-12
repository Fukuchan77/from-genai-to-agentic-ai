import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { PlatformError } from "../../errors";

/** Both drivers (PGlite, postgres.js) satisfy this shape; queries never see the driver. */
export type RagDatabase = PgDatabase<PgQueryResultHKT>;

export interface MigrationResult {
	readonly applied: readonly string[];
	readonly skipped: readonly string[];
}

const MIGRATION_FILE = /^\d{4}_.+\.sql$/;
const STATEMENT_BREAKPOINT = /^\s*-->\s*statement-breakpoint\s*$/m;

// The only place raw SQL text is executed (the `no-sql-raw` allow-list): migration files are
// reviewed, committed DDL, never built from request data.
async function execStatement(db: RagDatabase, statement: string): Promise<void> {
	await db.execute(sql.raw(statement));
}

/**
 * Applies `NNNN_*.sql` files in name order. Each file runs in one transaction together with
 * its bookkeeping row, so a failure leaves that file entirely unapplied and stops the run.
 */
export async function runMigrations(db: RagDatabase, directory: string): Promise<MigrationResult> {
	const names = (await readdir(directory)).filter((name) => MIGRATION_FILE.test(name)).sort();
	if (names.length === 0) {
		throw new PlatformError("source-unavailable", "マイグレーションのファイルが見つかりません。", {
			directory: path.basename(directory),
		});
	}

	await execStatement(
		db,
		"CREATE TABLE IF NOT EXISTS rag_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
	);
	const recorded = await db.execute(sql`SELECT name FROM rag_migrations`);
	const done = new Set(rowsOf<{ name: string }>(recorded).map((row) => row.name));

	const applied: string[] = [];
	const skipped: string[] = [];
	for (const name of names) {
		if (done.has(name)) {
			skipped.push(name);
			continue;
		}
		const statements = (await readFile(path.join(directory, name), "utf8"))
			.split(STATEMENT_BREAKPOINT)
			.map((statement) => statement.trim())
			.filter((statement) => statement.length > 0);
		try {
			await db.transaction(async (tx) => {
				for (const statement of statements) {
					await execStatement(tx, statement);
				}
				await tx.execute(sql`INSERT INTO rag_migrations (name) VALUES (${name})`);
			});
		} catch (error) {
			throw new PlatformError(
				"source-unavailable",
				`マイグレーション ${name} の適用に失敗しました。このファイルの変更は取り消されました。`,
				{ migration: name, cause: error instanceof Error ? error.name : "unknown" },
			);
		}
		applied.push(name);
	}
	return { applied, skipped };
}

// `execute` returns `{ rows }` on PGlite and a row array on postgres.js; the shapes only
// differ at this raw-SQL boundary.
function rowsOf<T>(result: unknown): T[] {
	if (Array.isArray(result)) return result as T[];
	if (typeof result === "object" && result !== null && "rows" in result) {
		return (result as { rows: T[] }).rows;
	}
	return [];
}
