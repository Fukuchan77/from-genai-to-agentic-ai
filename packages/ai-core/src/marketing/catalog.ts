import { asc, count, eq } from "drizzle-orm";
import { marketingPersonas, marketingProducts, type RagDatabase } from "../rag/db";

/** A catalog product (`marketing_products`). The id (`P-001`) is the key recommendations are checked against. */
export interface Product {
	readonly id: string;
	readonly name: string;
	readonly category: string;
	readonly priceYen: number;
	readonly description: string;
	readonly tags: readonly string[];
}

/** A council persona (`marketing_personas`). `viewpoint` is the stance the persona speaks from. */
export interface CatalogPersona {
	readonly id: string;
	readonly name: string;
	readonly viewpoint: string;
	/** Round-robin order of the council, ascending. */
	readonly ordinal: number;
}

export interface CatalogRepo {
	/** Every product, ordered by id. Empty when nothing is seeded. */
	listProducts(): Promise<readonly Product[]>;
	/** Every persona, ordered by `ordinal`. Empty when nothing is seeded. */
	listPersonas(): Promise<readonly CatalogPersona[]>;
	/** Whether a product with exactly this id exists (CL-15). */
	has(productId: string): Promise<boolean>;
	/** True when both tables hold rows; routes answer 503 otherwise. */
	isSeeded(): Promise<boolean>;
}

/** Read access to the marketing catalog and personas (plan C12). */
export function createCatalogRepo(db: RagDatabase): CatalogRepo {
	return {
		async listProducts() {
			const rows = await db.select().from(marketingProducts).orderBy(asc(marketingProducts.id));
			return rows.map((row) => ({ ...row }));
		},
		async listPersonas() {
			const rows = await db
				.select()
				.from(marketingPersonas)
				.orderBy(asc(marketingPersonas.ordinal));
			return rows.map((row) => ({ ...row }));
		},
		async has(productId) {
			const rows = await db
				.select({ id: marketingProducts.id })
				.from(marketingProducts)
				.where(eq(marketingProducts.id, productId))
				.limit(1);
			return rows.length > 0;
		},
		async isSeeded() {
			const [products] = await db.select({ n: count() }).from(marketingProducts);
			const [personas] = await db.select({ n: count() }).from(marketingPersonas);
			return (products?.n ?? 0) > 0 && (personas?.n ?? 0) > 0;
		},
	};
}
