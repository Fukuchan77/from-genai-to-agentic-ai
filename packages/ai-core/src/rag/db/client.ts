import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { sql } from "drizzle-orm";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { PlatformConfig } from "../../config";
import { KnowledgeBaseUnavailableError } from "./errors";
import { type RagDatabase, runMigrations } from "./migrate";

export type { RagDatabase } from "./migrate";

export interface RagDatabaseHandle {
	readonly db: RagDatabase;
	readonly kind: "pglite" | "postgres";
	close(): Promise<void>;
}

// `packages/ai-core/drizzle`, relative to this file (`src/rag/db/`). Not
// `new URL("../../../drizzle", import.meta.url)`: Turbopack treats that form as a file asset
// reference and fails the build because the target is a directory.
const MIGRATIONS_DIRECTORY = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"..",
	"drizzle",
);

const CONNECT_TIMEOUT_SECONDS = 5;
const MAX_CONNECTIONS = 5;

/** In-memory PGlite for `mock` mode and the quality gate; each call is an independent database. */
export async function createPgliteDatabase(): Promise<RagDatabaseHandle> {
	const client = await PGlite.create({ extensions: { vector } });
	const db = drizzlePglite(client);
	try {
		await runMigrations(db, MIGRATIONS_DIRECTORY);
	} catch (error) {
		await client.close();
		throw error;
	}
	return { db, kind: "pglite", close: () => client.close() };
}

/** Compose Postgres (`local` / `live`). An unreachable server is `provider-unavailable`. */
export async function createPostgresDatabase(
	config: PlatformConfig["database"],
): Promise<RagDatabaseHandle> {
	const client = postgres({
		host: config.host,
		port: config.port,
		user: config.user,
		password: config.password,
		database: config.database,
		max: MAX_CONNECTIONS,
		connect_timeout: CONNECT_TIMEOUT_SECONDS,
		onnotice: () => undefined,
	});
	const db = drizzlePostgres(client);
	try {
		await db.execute(sql`SELECT 1`);
	} catch {
		// The driver error can echo connection details; only the guidance goes to the caller.
		await client.end({ timeout: 0 });
		throw new KnowledgeBaseUnavailableError();
	}
	try {
		await runMigrations(db, MIGRATIONS_DIRECTORY);
	} catch (error) {
		await client.end({ timeout: 0 });
		throw error;
	}
	return { db, kind: "postgres", close: () => client.end() };
}
