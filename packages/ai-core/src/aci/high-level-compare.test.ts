import { describe, expect, it } from "vitest";
import { compareApproaches } from "./high-level-compare";

describe("compareApproaches", () => {
	it("returns how many steps and tokens the high-level tool saved, and the token ratio", () => {
		const result = compareApproaches({
			highLevel: { steps: 2, tokens: 1_000 },
			lowLevel: { steps: 6, tokens: 4_000 },
		});

		expect(result).toEqual({ steps: 4, tokens: 3_000, ratio: 0.25 });
	});

	it("reports a negative saving when the low-level approach is cheaper", () => {
		const result = compareApproaches({
			highLevel: { steps: 4, tokens: 2_000 },
			lowLevel: { steps: 2, tokens: 500 },
		});

		expect(result).toEqual({ steps: -2, tokens: -1_500, ratio: 4 });
	});

	it("does not divide by zero when the low-level run used no tokens", () => {
		const result = compareApproaches({
			highLevel: { steps: 1, tokens: 100 },
			lowLevel: { steps: 0, tokens: 0 },
		});

		expect(result).toEqual({ steps: -1, tokens: -100, ratio: undefined });
	});

	it.each([
		["high-level", { steps: 1, tokens: 1, failed: true }, { steps: 2, tokens: 2 }],
		["low-level", { steps: 1, tokens: 1 }, { steps: 2, tokens: 2, failed: true }],
	])("computes no ratio when the %s run failed", (_side, highLevel, lowLevel) => {
		expect(compareApproaches({ highLevel, lowLevel }).ratio).toBeUndefined();
	});

	it("treats failed: false like an omitted flag", () => {
		const result = compareApproaches({
			highLevel: { steps: 1, tokens: 50, failed: false },
			lowLevel: { steps: 3, tokens: 100, failed: false },
		});

		expect(result.ratio).toBe(0.5);
	});

	it("rejects negative or non-finite measurements", () => {
		const ok = { steps: 1, tokens: 1 };
		for (const bad of [
			{ ...ok, steps: -1 },
			{ ...ok, tokens: Number.NaN },
			{ ...ok, tokens: Infinity },
		]) {
			expect(() => compareApproaches({ highLevel: bad, lowLevel: ok })).toThrow(RangeError);
			expect(() => compareApproaches({ highLevel: ok, lowLevel: bad })).toThrow(RangeError);
		}
	});
});
