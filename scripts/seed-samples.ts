// `mise run seed:samples`: seeds the sample data the M3 modules use (003 Req 2.9, C16).
//
//   node --env-file-if-exists=.env.local scripts/seed-samples.ts [--reset]
//
// Node strips the types and starts this file directly (CL-3: no `tsx`). The package sources import
// each other without file extensions, which Node does not resolve, so a resolve hook that tries
// `.ts` and `/index.ts` is registered first and the sources are imported afterwards.
//
// `local` / `live` seed the Compose Postgres (`mise run services:up:db` first). `mock` seeds an
// in-memory database that goes away with this process, so it only shows what a run would do.
// `--reset` empties the help-desk and marketing tables first; the knowledge documents are never removed.
import { registerHooks } from "node:module";
import { parseArgs } from "node:util";

registerHooks({
	resolve(specifier, context, nextResolve) {
		try {
			return nextResolve(specifier, context);
		} catch (error) {
			const code = (error as { code?: string }).code;
			if (code !== "ERR_MODULE_NOT_FOUND" && code !== "ERR_UNSUPPORTED_DIR_IMPORT") throw error;
			if (!specifier.startsWith(".")) throw error;
			for (const suffix of [".ts", "/index.ts"]) {
				try {
					return nextResolve(`${specifier}${suffix}`, context);
				} catch {
					// Try the next candidate; the original error is rethrown below.
				}
			}
			throw error;
		}
	},
});

const { values } = parseArgs({ options: { reset: { type: "boolean", default: false } } });

const { loadPlatformConfig } = await import("../packages/ai-core/src/config/index.ts");
const { seedHelpdesk } = await import("../packages/ai-core/src/helpdesk/seed.ts");
const { seedMarketing } = await import("../packages/ai-core/src/marketing/seed.ts");
const { createModelGateway } = await import("../packages/ai-core/src/models/index.ts");
const { createPgliteDatabase, createPostgresDatabase } = await import(
	"../packages/ai-core/src/rag/db/index.ts"
);
const { systemClock } = await import("../packages/ai-core/src/ports/clock.ts");

const { PlatformError } = await import("../packages/ai-core/src/errors.ts");

/** A setup mistake is reported with its own sentence; anything else only by its name (no secrets). */
function describe(error: unknown): string {
	if (error instanceof PlatformError) return error.message;
	if (error instanceof Error && error.name === "ConfigError") return error.message;
	return `予期しないエラーが起きました（${error instanceof Error ? error.name : typeof error}）。`;
}

async function main(): Promise<void> {
	const config = loadPlatformConfig(process.env);
	const gateway = createModelGateway({ config, clock: systemClock });
	const handle =
		config.mode === "mock"
			? await createPgliteDatabase()
			: await createPostgresDatabase(config.database);
	try {
		if (config.mode === "mock") {
			console.log(
				"mock モードです。データベースはこのプロセスの中だけにあり、終了すると消えます。",
			);
		}
		const embedding = await gateway.resolveEmbedding();
		const result = await seedHelpdesk({
			db: handle.db,
			knowledge: { embedding },
			reset: values.reset,
			clock: systemClock,
		});
		console.log(
			`ヘルプデスクの FAQ: ${result.faq.ingested.length} 件を取り込みました（${result.faq.skipped.length} 件はスキップ）。`,
		);
		for (const skipped of result.faq.skipped) {
			console.log(`  スキップ: ${skipped.file}（${skipped.reason}）`);
		}
		console.log(
			`ヘルプデスクのチケット: ${result.tickets.inserted} 件を追加、${result.tickets.existing} 件は既にありました。`,
		);
		const marketing = await seedMarketing({ db: handle.db, reset: values.reset });
		console.log(
			`マーケティングの商品: ${marketing.products.inserted} 件を追加、合計 ${marketing.products.total} 件です。`,
		);
		console.log(
			`マーケティングのペルソナ: ${marketing.personas.inserted} 件を追加、合計 ${marketing.personas.total} 件です。`,
		);
	} finally {
		await handle.close();
	}
}

try {
	await main();
} catch (error) {
	console.error(`seed:samples に失敗しました。${describe(error)}`);
	process.exitCode = 1;
}
