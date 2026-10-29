import { describe, expect, it } from "vitest";
import { ShortIdIndex } from "./short-id";

interface Repo {
	readonly id: string;
	readonly name: string;
}

const UUID = "3f2b8c1e-9d4a-4b6f-8a1c-5e7d9f0a1b2c";
const items: readonly Repo[] = [
	{ id: UUID, name: "alpha" },
	{ id: "c0ffee00-0000-4000-8000-000000000001", name: "beta" },
	{ id: "c0ffee00-0000-4000-8000-000000000002", name: "gamma" },
];

function newIndex() {
	return new ShortIdIndex<Repo>((repo) => repo.name);
}

describe("ShortIdIndex", () => {
	it("assigns 0-based indexes with the item's label", () => {
		const index = newIndex();

		expect(index.assign(items)).toEqual([
			{ index: 0, label: "alpha" },
			{ index: 1, label: "beta" },
			{ index: 2, label: "gamma" },
		]);
	});

	it("resolves an assigned index back to the item", () => {
		const index = newIndex();
		index.assign(items);

		expect(index.resolve(1)).toBe(items[1]);
		expect(index.resolve(0)?.id).toBe(UUID);
	});

	it("returns undefined for an index out of range, negative, fractional or not a number", () => {
		const index = newIndex();
		index.assign(items);

		for (const bad of [3, 100, -1, 0.5, Number.NaN, Infinity]) {
			expect(index.resolve(bad), String(bad)).toBeUndefined();
		}
	});

	it("returns undefined for every index before anything is assigned", () => {
		expect(newIndex().resolve(0)).toBeUndefined();
	});

	it("replaces the previous assignment on the next assign()", () => {
		const index = newIndex();
		index.assign(items);
		index.assign([{ id: "x", name: "only" }]);

		expect(index.resolve(0)?.name).toBe("only");
		expect(index.resolve(1)).toBeUndefined();
	});

	it("never puts a UUID or an item id in the assignment shown to the model", () => {
		const index = newIndex();
		const shown = JSON.stringify(index.assign(items));

		expect(shown).not.toContain(UUID);
		expect(shown).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/u);
	});

	it("keeps duplicated labels apart by index", () => {
		const index = newIndex();
		const assigned = index.assign([
			{ id: "1", name: "same" },
			{ id: "2", name: "same" },
		]);

		expect(assigned.map((entry) => entry.index)).toEqual([0, 1]);
		expect(index.resolve(1)?.id).toBe("2");
	});
});
