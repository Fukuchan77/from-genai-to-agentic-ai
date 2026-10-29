import { describe, expect, it } from "vitest";
import { riskFromAnnotations } from "./risk";

describe("riskFromAnnotations (ADR-7: annotations are hints from outside the trust boundary)", () => {
	it("treats a tool without annotations as destructive", () => {
		expect(riskFromAnnotations(undefined)).toBe("destructive");
		expect(riskFromAnnotations(null)).toBe("destructive");
		expect(riskFromAnnotations({})).toBe("destructive");
	});

	it("is read-only only when readOnlyHint is exactly true", () => {
		expect(riskFromAnnotations({ readOnlyHint: true })).toBe("read-only");
		expect(riskFromAnnotations({ readOnlyHint: true, title: "x", idempotentHint: true })).toBe(
			"read-only",
		);
	});

	it("treats destructiveHint alone as destructive", () => {
		expect(riskFromAnnotations({ destructiveHint: true })).toBe("destructive");
		expect(riskFromAnnotations({ destructiveHint: false })).toBe("destructive");
	});

	it("treats readOnlyHint false as destructive", () => {
		expect(riskFromAnnotations({ readOnlyHint: false })).toBe("destructive");
		expect(riskFromAnnotations({ readOnlyHint: false, destructiveHint: false })).toBe(
			"destructive",
		);
	});

	it("does not trust a tool that claims both read-only and destructive", () => {
		expect(riskFromAnnotations({ readOnlyHint: true, destructiveHint: true })).toBe("destructive");
	});

	it.each([
		["a string", { readOnlyHint: "true" }],
		["a number", { readOnlyHint: 1 }],
		["an object", { readOnlyHint: {} }],
		["null", { readOnlyHint: null }],
	])("treats readOnlyHint given as %s as destructive", (_label, annotations) => {
		expect(riskFromAnnotations(annotations)).toBe("destructive");
	});

	it.each([
		["a string", "readOnlyHint"],
		["an array", [{ readOnlyHint: true }]],
		["a number", 7],
		["true", true],
	])("treats annotations given as %s as destructive", (_label, annotations) => {
		expect(riskFromAnnotations(annotations)).toBe("destructive");
	});

	it("never reads an inherited readOnlyHint", () => {
		const inherited = Object.create({ readOnlyHint: true }) as unknown;
		expect(riskFromAnnotations(inherited)).toBe("destructive");
	});
});
