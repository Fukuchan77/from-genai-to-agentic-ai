import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_COUNCIL } from "../config/defaults";
import {
	createPgliteDatabase,
	helpdeskTickets,
	marketingPersonas,
	marketingProducts,
	type RagDatabaseHandle,
	ragDocuments,
} from "../rag/db";
import { createCatalogRepo } from "./catalog";
import { loadSamplePersonas, loadSampleProducts, SamplePersonaSchema, seedMarketing } from "./seed";

let handle: RagDatabaseHandle;

beforeAll(async () => {
	handle = await createPgliteDatabase();
});

afterAll(async () => {
	await handle.close();
});

beforeEach(async () => {
	await handle.db.execute(sql`TRUNCATE marketing_products, marketing_personas`);
	await handle.db.execute(sql`TRUNCATE helpdesk_plan_revisions, helpdesk_tickets CASCADE`);
	await handle.db.execute(sql`TRUNCATE rag_chunks, rag_documents, rag_meta CASCADE`);
});

const rowCounts = async () => ({
	products: await handle.db.$count(marketingProducts),
	personas: await handle.db.$count(marketingPersonas),
});

describe("the committed fixtures", () => {
	it("load, validate and match the council defaults", async () => {
		const products = await loadSampleProducts();
		const personas = await loadSamplePersonas();

		expect(products.length).toBeGreaterThanOrEqual(5);
		expect(new Set(products.map((p) => p.id)).size).toBe(products.length);
		expect(personas.map((p) => p.id)).toEqual([...DEFAULT_COUNCIL.personaIds]);
		expect(personas.map((p) => p.ordinal)).toEqual(personas.map((_, i) => i + 1));
	});
});

describe("SamplePersonaSchema", () => {
	it("rejects an empty viewpoint, a zero ordinal and unknown keys", () => {
		const valid = { id: "a", name: "A", viewpoint: "v", ordinal: 1 };

		expect(SamplePersonaSchema.safeParse(valid).success).toBe(true);
		expect(SamplePersonaSchema.safeParse({ ...valid, viewpoint: "" }).success).toBe(false);
		expect(SamplePersonaSchema.safeParse({ ...valid, ordinal: 0 }).success).toBe(false);
		expect(SamplePersonaSchema.safeParse({ ...valid, extra: 1 }).success).toBe(false);
	});
});

describe("seedMarketing", () => {
	it("inserts the fixtures and reports counts", async () => {
		const products = await loadSampleProducts();
		const personas = await loadSamplePersonas();

		const result = await seedMarketing({ db: handle.db });

		expect(result).toEqual({
			products: { inserted: products.length, total: products.length },
			personas: { inserted: personas.length, total: personas.length },
		});
		expect(await rowCounts()).toEqual({ products: products.length, personas: personas.length });
		expect(await createCatalogRepo(handle.db).isSeeded()).toBe(true);
	});

	it("is idempotent: a second run adds no rows and reports none inserted", async () => {
		await seedMarketing({ db: handle.db });
		const before = await rowCounts();

		const second = await seedMarketing({ db: handle.db });

		expect(await rowCounts()).toEqual(before);
		expect(second.products.inserted).toBe(0);
		expect(second.personas.inserted).toBe(0);
		expect(second.products.total).toBe(before.products);
		expect(second.personas.total).toBe(before.personas);
	});

	it("restores an edited fixture row so the fixtures stay the source of truth", async () => {
		await seedMarketing({ db: handle.db });
		await handle.db
			.update(marketingProducts)
			.set({ name: "edited", priceYen: 1, tags: [] })
			.where(eq(marketingProducts.id, "P-001"));
		await handle.db
			.update(marketingPersonas)
			.set({ viewpoint: "edited", name: "edited", ordinal: 99 })
			.where(eq(marketingPersonas.id, "consumer"));

		await seedMarketing({ db: handle.db });

		const [first] = await loadSampleProducts();
		const repoProducts = await createCatalogRepo(handle.db).listProducts();
		expect(repoProducts.find((p) => p.id === "P-001")).toEqual(first);
		const consumer = (await createCatalogRepo(handle.db).listPersonas()).find(
			(p) => p.id === "consumer",
		);
		expect(consumer).toEqual((await loadSamplePersonas()).find((p) => p.id === "consumer"));
	});

	it("keeps rows that are not in the fixtures when reset is off", async () => {
		await seedMarketing({ db: handle.db });
		await handle.db.insert(marketingProducts).values({
			id: "P-900",
			name: "own",
			category: "c",
			priceYen: 1,
			description: "d",
			tags: [],
		});

		await seedMarketing({ db: handle.db });

		expect(await createCatalogRepo(handle.db).has("P-900")).toBe(true);
	});

	it("lists personas in the fixture order (ordinal)", async () => {
		await seedMarketing({ db: handle.db });

		const personas = await createCatalogRepo(handle.db).listPersonas();

		expect(personas.map((p) => p.id)).toEqual([...DEFAULT_COUNCIL.personaIds]);
	});

	it("reset removes extra marketing rows and reseeds, leaving other tables alone", async () => {
		await seedMarketing({ db: handle.db });
		await handle.db.insert(marketingProducts).values({
			id: "P-900",
			name: "own",
			category: "c",
			priceYen: 1,
			description: "d",
			tags: [],
		});
		await handle.db
			.insert(marketingPersonas)
			.values({ id: "own", name: "own", viewpoint: "v", ordinal: 99 });
		await handle.db.insert(ragDocuments).values({
			id: "doc-1",
			title: "t",
			sourceType: "markdown",
			chunkCount: 0,
			ingestedAt: new Date(0),
		});
		await handle.db.insert(helpdeskTickets).values({
			id: "T-9999",
			inquiry: "q",
			status: "open",
			stepsUsed: 0,
			createdAt: new Date(0),
			updatedAt: new Date(0),
		});

		const result = await seedMarketing({ db: handle.db, reset: true });

		const products = await loadSampleProducts();
		expect(await createCatalogRepo(handle.db).has("P-900")).toBe(false);
		expect((await createCatalogRepo(handle.db).listPersonas()).map((p) => p.id)).toEqual([
			...DEFAULT_COUNCIL.personaIds,
		]);
		expect(result.products).toEqual({ inserted: products.length, total: products.length });
		expect(await handle.db.$count(ragDocuments)).toBe(1);
		expect(await handle.db.$count(helpdeskTickets)).toBe(1);
	});
});
