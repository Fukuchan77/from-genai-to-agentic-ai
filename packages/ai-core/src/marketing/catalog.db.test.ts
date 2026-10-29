import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
	createPgliteDatabase,
	marketingPersonas,
	marketingProducts,
	type RagDatabaseHandle,
} from "../rag/db";
import { createCatalogRepo } from "./catalog";

let handle: RagDatabaseHandle;

beforeAll(async () => {
	handle = await createPgliteDatabase();
});

afterAll(async () => {
	await handle.close();
});

beforeEach(async () => {
	await handle.db.execute(sql`TRUNCATE marketing_products, marketing_personas`);
});

const product = (id: string, priceYen = 1000) => ({
	id,
	name: `name ${id.split("").reverse().join("")}`,
	category: "cat",
	priceYen,
	description: `description ${id}`,
	tags: ["a", "b"],
});

describe("createCatalogRepo when nothing is seeded", () => {
	it("returns empty lists and reports isSeeded() false", async () => {
		const repo = createCatalogRepo(handle.db);

		expect(await repo.listProducts()).toEqual([]);
		expect(await repo.listPersonas()).toEqual([]);
		expect(await repo.has("P-001")).toBe(false);
		expect(await repo.isSeeded()).toBe(false);
	});

	it("is not seeded while only one of the two tables has rows", async () => {
		const repo = createCatalogRepo(handle.db);
		await handle.db.insert(marketingProducts).values(product("P-001"));
		expect(await repo.isSeeded()).toBe(false);

		await handle.db.delete(marketingProducts);
		await handle.db
			.insert(marketingPersonas)
			.values({ id: "x", name: "X", viewpoint: "v", ordinal: 1 });
		expect(await repo.isSeeded()).toBe(false);
	});
});

describe("createCatalogRepo with rows", () => {
	beforeEach(async () => {
		await handle.db
			.insert(marketingProducts)
			.values([product("P-010", 300), product("P-002", 200), product("P-001", 100)]);
		await handle.db.insert(marketingPersonas).values([
			{ id: "third", name: "Third", viewpoint: "v3", ordinal: 3 },
			{ id: "first", name: "First", viewpoint: "v1", ordinal: 1 },
			{ id: "second", name: "Second", viewpoint: "v2", ordinal: 2 },
		]);
	});

	it("lists products ordered by id with every field mapped", async () => {
		const products = await createCatalogRepo(handle.db).listProducts();

		expect(products.map((p) => p.id)).toEqual(["P-001", "P-002", "P-010"]);
		expect(products[0]).toEqual(product("P-001", 100));
	});

	it("lists personas ordered by ordinal and keeps the viewpoint", async () => {
		const personas = await createCatalogRepo(handle.db).listPersonas();

		expect(personas).toEqual([
			{ id: "first", name: "First", viewpoint: "v1", ordinal: 1 },
			{ id: "second", name: "Second", viewpoint: "v2", ordinal: 2 },
			{ id: "third", name: "Third", viewpoint: "v3", ordinal: 3 },
		]);
	});

	it("has() is true only for an exact product id", async () => {
		const repo = createCatalogRepo(handle.db);

		expect(await repo.has("P-001")).toBe(true);
		expect(await repo.has("P-999")).toBe(false);
		expect(await repo.has("p-001")).toBe(false);
		expect(await repo.has("P-00")).toBe(false);
		expect(await repo.has("P-%")).toBe(false);
		expect(await repo.has("P-00_")).toBe(false);
		expect(await repo.has("")).toBe(false);
		expect(await repo.has("P-001' OR '1'='1")).toBe(false);
	});

	it("does not treat a persona id as a product", async () => {
		expect(await createCatalogRepo(handle.db).has("first")).toBe(false);
	});

	it("isSeeded() is true when both tables have rows", async () => {
		expect(await createCatalogRepo(handle.db).isSeeded()).toBe(true);
	});
});
