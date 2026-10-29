import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { marketingPersonas, marketingProducts, type RagDatabase } from "../rag/db";
import type { CatalogPersona, Product } from "./catalog";

// `packages/ai-core/fixtures/marketing`, relative to this file (`src/marketing/`). Not
// `new URL("../../fixtures/...", import.meta.url)`: Turbopack treats that form as an asset reference.
const FIXTURES_DIRECTORY = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"fixtures",
	"marketing",
);
const PRODUCTS_FILE = path.join(FIXTURES_DIRECTORY, "products.json");
const PERSONAS_FILE = path.join(FIXTURES_DIRECTORY, "personas.json");

export const SampleProductSchema = z.strictObject({
	id: z.string().regex(/^P-\d{3}$/),
	name: z.string().min(1),
	category: z.string().min(1),
	priceYen: z.number().int().min(0),
	description: z.string().min(1),
	tags: z.array(z.string().min(1)),
});

export const SamplePersonaSchema = z.strictObject({
	id: z.string().min(1),
	name: z.string().min(1),
	viewpoint: z.string().min(1),
	ordinal: z.number().int().min(1),
});

/** The committed catalog (`fixtures/marketing/products.json`), validated. */
export async function loadSampleProducts(): Promise<readonly Product[]> {
	return z.array(SampleProductSchema).parse(JSON.parse(await readFile(PRODUCTS_FILE, "utf8")));
}

/** The committed council personas (`fixtures/marketing/personas.json`), validated. */
export async function loadSamplePersonas(): Promise<readonly CatalogPersona[]> {
	return z.array(SamplePersonaSchema).parse(JSON.parse(await readFile(PERSONAS_FILE, "utf8")));
}

export interface SeedMarketingParams {
	readonly db: RagDatabase;
	/** Empties the `marketing_*` tables first. No other table is touched. */
	readonly reset?: boolean;
}

export interface SeedMarketingResult {
	/** `inserted`: rows that did not exist before; `total`: rows in the table afterwards. */
	readonly products: { readonly inserted: number; readonly total: number };
	readonly personas: { readonly inserted: number; readonly total: number };
}

/**
 * Seeds the product catalog and the council personas (Req 6.6). Each fixture row is upserted by id,
 * so the fixtures stay the source of truth and running it again adds no rows. Rows that are not in
 * the fixtures are kept unless `reset` is set, which empties only the `marketing_*` tables.
 */
export async function seedMarketing(params: SeedMarketingParams): Promise<SeedMarketingResult> {
	const products = await loadSampleProducts();
	const personas = await loadSamplePersonas();

	return params.db.transaction(async (tx) => {
		if (params.reset) {
			await tx.delete(marketingProducts);
			await tx.delete(marketingPersonas);
		}
		const productsBefore = await tx.$count(marketingProducts);
		const personasBefore = await tx.$count(marketingPersonas);

		await tx
			.insert(marketingProducts)
			.values(products.map((product) => ({ ...product, tags: [...product.tags] })))
			.onConflictDoUpdate({
				target: marketingProducts.id,
				set: {
					name: sql`excluded.name`,
					category: sql`excluded.category`,
					priceYen: sql`excluded.price_yen`,
					description: sql`excluded.description`,
					tags: sql`excluded.tags`,
				},
			});
		await tx
			.insert(marketingPersonas)
			.values([...personas])
			.onConflictDoUpdate({
				target: marketingPersonas.id,
				set: {
					name: sql`excluded.name`,
					viewpoint: sql`excluded.viewpoint`,
					ordinal: sql`excluded.ordinal`,
				},
			});

		const productsAfter = await tx.$count(marketingProducts);
		const personasAfter = await tx.$count(marketingPersonas);
		return {
			products: { inserted: productsAfter - productsBefore, total: productsAfter },
			personas: { inserted: personasAfter - personasBefore, total: personasAfter },
		};
	});
}
