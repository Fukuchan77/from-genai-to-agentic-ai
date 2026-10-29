import { describe, expect, it } from "vitest";
import { MODEL_CATALOG } from "../models/catalog";
import { RESEARCH_REQUEST_LIMITS, researchRequestSchema } from "./request-schema";

const MODEL_ID = Object.keys(MODEL_CATALOG)[0] as string;

function paths(body: unknown): string[] {
	const result = researchRequestSchema.safeParse(body);
	expect(result.success).toBe(false);
	return [...new Set((result.error?.issues ?? []).map((issue) => issue.path.join(".")))];
}

describe("researchRequestSchema", () => {
	it("accepts a theme alone", () => {
		expect(researchRequestSchema.parse({ theme: "階層型エージェント" })).toEqual({
			theme: "階層型エージェント",
		});
	});

	it("accepts a catalog model and a call limit", () => {
		const body = { theme: "t", modelId: MODEL_ID, maxSubagentCalls: 4 };
		expect(researchRequestSchema.parse(body)).toEqual(body);
	});

	it("fixes its limits: a theme of 500 characters and 1 to 20 sub-agent calls", () => {
		expect(RESEARCH_REQUEST_LIMITS).toEqual({
			themeMaxCharacters: 500,
			maxSubagentCallsMin: 1,
			maxSubagentCallsMax: 20,
		});
	});

	it.each([
		["empty", ""],
		["only spaces", "  \n\t "],
		["only a full-width space", "　"],
	])("rejects a theme that is %s", (_name, theme) => {
		expect(paths({ theme })).toEqual(["theme"]);
	});

	it("counts the theme in characters, not UTF-16 units: 500 emoji pass, 501 do not", () => {
		expect(researchRequestSchema.safeParse({ theme: "😀".repeat(500) }).success).toBe(true);
		expect(paths({ theme: "😀".repeat(501) })).toEqual(["theme"]);
		expect(researchRequestSchema.safeParse({ theme: "あ".repeat(500) }).success).toBe(true);
		expect(paths({ theme: "あ".repeat(501) })).toEqual(["theme"]);
	});

	it.each([0, -1, 21, 1.5, Number.NaN, "5", null])("rejects maxSubagentCalls %s", (value) => {
		expect(paths({ theme: "t", maxSubagentCalls: value })).toEqual(["maxSubagentCalls"]);
	});

	it.each([1, 20])("accepts maxSubagentCalls %s, the edges of the range", (maxSubagentCalls) => {
		expect(researchRequestSchema.safeParse({ theme: "t", maxSubagentCalls }).success).toBe(true);
	});

	it("rejects a model that is not in the catalog", () => {
		expect(paths({ theme: "t", modelId: "not-a-model" })).toEqual(["modelId"]);
	});

	it("rejects an unknown key, a missing theme and a body that is not an object", () => {
		expect(researchRequestSchema.safeParse({ theme: "t", sources: ["x"] }).success).toBe(false);
		expect(paths({})).toEqual(["theme"]);
		expect(researchRequestSchema.safeParse(null).success).toBe(false);
		expect(researchRequestSchema.safeParse("t").success).toBe(false);
	});
});
