// Regression (plan C16, Req 6.4, 6.5, CL-15): `recommend` against the seeded marketing catalog in a
// throwaway in-memory PGlite. The model answers with product ids; the code then checks each id with
// `catalog.has` before anything is shown. This pins the plumbing: only catalog ids come out, an id the
// catalog does not have is removed, and the number removed is recorded in `dropped`. It does not
// say anything about how well a real model chooses products (only a `local` run can).

import {
	type CatalogRepo,
	createCatalogRepo,
	EMPTY_PROFILE,
	MAX_RECOMMENDATIONS,
	NO_MATCH_REASON,
	NO_VALID_RECOMMENDATION_REASON,
	type Product,
	recommend,
	seedMarketing,
	UNSEEDED_CATALOG_REASON,
} from "@platform/ai-core/marketing";
import { createScenarioModel, defineScenario } from "@platform/ai-core/mock";
import { createPgliteDatabase, type RagDatabaseHandle } from "@platform/ai-core/rag";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** PGlite start-up plus the migrations: about 2 s alone, several times that on a loaded machine. */
const SETUP_TIMEOUT_MS = 90_000;

/** An id the committed catalog (`P-001` to `P-010`) does not have. */
const MISSING_ID = "P-999";

type Answer = readonly string[];

/** Ids the "model" returns for each shopper message; the reason is a fixed sentence. */
const ANSWERS = {
	mixed: [
		"P-001",
		MISSING_ID,
		"P-004",
		"P-001", // repeated: collapsed, not counted as dropped
		MISSING_ID, // repeated: counted once
		"p-002", // the catalog matches ids exactly
		"P-001'; DROP TABLE marketing_products; --", // text is data, never SQL
	],
	"all-missing": [MISSING_ID, "P-500"],
	none: [],
	"over-the-cap": [MISSING_ID, "P-001", "P-002", "P-003", "P-004", "P-005"],
	"removed-since-listing": ["P-001", "P-004"],
} as const satisfies Record<string, Answer>;

type CaseName = keyof typeof ANSWERS;

const messageOf = (name: CaseName) => `eval-regression-marketing-catalog:${name}`;

const scenario = defineScenario({
	id: "eval/regression/marketing-catalog",
	turns: (Object.keys(ANSWERS) as CaseName[]).map((name) => ({
		match: { purpose: "chat", lastUserTextIncludes: `<message>\n${messageOf(name)}\n</message>` },
		respond: {
			object: {
				recommendations: ANSWERS[name].map((productId) => ({
					productId,
					reason: `${productId} が合います。`,
				})),
			},
			usage: { inputTokens: 1_000, outputTokens: 100 },
		},
	})),
});

let handle: RagDatabaseHandle | undefined;
let catalog: CatalogRepo;
let products: readonly Product[];
let catalogIds: ReadonlySet<string>;

const model = () => createScenarioModel({ purpose: "chat", scenarios: [scenario] });

beforeAll(async () => {
	const created = await createPgliteDatabase();
	handle = created;
	await seedMarketing({ db: created.db, reset: true });
	catalog = createCatalogRepo(created.db);
	products = await catalog.listProducts();
	catalogIds = new Set(products.map((product) => product.id));
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
	await handle?.close();
});

function ask(name: CaseName, repo: CatalogRepo = catalog) {
	return recommend({
		model: model(),
		profile: EMPTY_PROFILE,
		catalog: repo,
		message: messageOf(name),
	});
}

describe("recommend against the seeded catalog (Req 6.5, CL-15)", () => {
	it("rests on a catalog that has the ids it should and not the one it must not", () => {
		// Guards the test data: the cases below are about P-001 to P-005 being present and the
		// invented ids being absent.
		expect(catalogIds.size).toBeGreaterThanOrEqual(5);
		for (const id of ["P-001", "P-002", "P-003", "P-004", "P-005"]) {
			expect(catalogIds.has(id), id).toBe(true);
		}
		expect(catalogIds.has(MISSING_ID)).toBe(false);
	});

	it("returns only product ids that exist in the catalog", async () => {
		const result = await ask("mixed");

		expect(result.items.map((item) => item.productId)).toEqual(["P-001", "P-004"]);
		for (const item of result.items)
			expect(catalogIds.has(item.productId), item.productId).toBe(true);
	});

	it("removes the ids the catalog does not have and records how many (a repeat counts once)", async () => {
		const result = await ask("mixed");

		// MISSING_ID (twice), "p-002" and the SQL-looking text: three distinct ids were removed.
		expect(result.dropped).toBe(3);
		expect(result.items).toHaveLength(2);
	});

	it("takes the name and the price from the catalog, never from the model", async () => {
		const result = await ask("mixed");

		for (const item of result.items) {
			const row = products.find((product) => product.id === item.productId);
			expect(item).toMatchObject({ name: row?.name, priceYen: row?.priceYen });
		}
	});

	it("leaves the catalog as it was (an id is data, not a query)", async () => {
		await ask("mixed");

		expect((await catalog.listProducts()).map((product) => product.id)).toEqual(
			products.map((product) => product.id),
		);
	});

	it("returns no items, says why and records the count when every id was removed", async () => {
		const result = await ask("all-missing");

		expect(result.items).toEqual([]);
		expect(result.dropped).toBe(2);
		expect(result.reason).toBe(NO_VALID_RECOMMENDATION_REASON);
	});

	it("records nothing removed when the model chose nothing", async () => {
		const result = await ask("none");

		expect(result.items).toEqual([]);
		expect(result.dropped).toBe(0);
		expect(result.reason).toBe(NO_MATCH_REASON);
	});

	it("applies the display cap after verification, so the cap is not part of the removed count", async () => {
		const result = await ask("over-the-cap");

		// The invented id comes first and is removed; five valid ids follow and three are shown.
		expect(result.dropped).toBe(1);
		expect(result.items.map((item) => item.productId)).toEqual(["P-001", "P-002", "P-003"]);
		expect(result.items).toHaveLength(MAX_RECOMMENDATIONS);
	});

	it("lets the catalog decide, not the listing: an id that is gone by the time it is checked is removed", async () => {
		// `has` is the authority (CL-15): P-004 is in the listing the model saw but not in the catalog
		// any more when the answer is checked.
		const shrinking: CatalogRepo = {
			...catalog,
			has: async (productId) => productId !== "P-004" && (await catalog.has(productId)),
		};

		const result = await ask("removed-since-listing", shrinking);

		expect(result.items.map((item) => item.productId)).toEqual(["P-001"]);
		expect(result.dropped).toBe(1);
	});

	it("never calls the model when the catalog is empty", async () => {
		const empty: CatalogRepo = { ...catalog, listProducts: async () => [] };
		const unusedModel = model();

		const result = await recommend({
			model: unusedModel,
			profile: EMPTY_PROFILE,
			catalog: empty,
			message: messageOf("mixed"),
		});

		expect(result).toEqual({ items: [], dropped: 0, reason: UNSEEDED_CATALOG_REASON });
		expect(unusedModel.doGenerateCalls).toHaveLength(0);
	});
});
