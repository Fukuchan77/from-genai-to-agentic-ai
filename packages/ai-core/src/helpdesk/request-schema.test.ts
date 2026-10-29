import { describe, expect, it } from "vitest";
import { DEFAULT_HELPDESK } from "../config";
import { MODEL_CATALOG } from "../models/catalog";
import { HELPDESK_REQUEST_LIMITS, helpdeskRequestSchema } from "./request-schema";

const MODEL_ID = Object.keys(MODEL_CATALOG)[0] as string;

function paths(body: unknown): string[] {
	const result = helpdeskRequestSchema.safeParse(body);
	expect(result.success).toBe(false);
	// One field can fail more than one check; the field is what the caller learns.
	return [...new Set((result.error?.issues ?? []).map((issue) => issue.path.join(".")))];
}

describe("helpdeskRequestSchema", () => {
	it("accepts an inquiry alone", () => {
		expect(helpdeskRequestSchema.parse({ inquiry: "VPN に接続できません" })).toEqual({
			inquiry: "VPN に接続できません",
		});
	});

	it("accepts a catalog model and a step limit", () => {
		const body = { inquiry: "q", modelId: MODEL_ID, maxSteps: 5 };
		expect(helpdeskRequestSchema.parse(body)).toEqual(body);
	});

	it("takes its limits from the defaults: 4,000 characters and 1 to 30 steps", () => {
		expect(HELPDESK_REQUEST_LIMITS).toEqual({
			inquiryMaxCharacters: DEFAULT_HELPDESK.maxInquiryCharacters,
			maxStepsMin: 1,
			maxStepsMax: 30,
		});
		expect(DEFAULT_HELPDESK.maxInquiryCharacters).toBe(4_000);
	});

	it.each([
		["empty", ""],
		["only spaces", "  \n\t "],
		["only a full-width space", "　"],
	])("rejects an inquiry that is %s", (_name, inquiry) => {
		expect(paths({ inquiry })).toEqual(["inquiry"]);
	});

	it("counts the inquiry in characters, not UTF-16 units: 4,000 emoji pass, 4,001 do not", () => {
		const limit = HELPDESK_REQUEST_LIMITS.inquiryMaxCharacters;
		expect(helpdeskRequestSchema.safeParse({ inquiry: "😀".repeat(limit) }).success).toBe(true);
		expect(paths({ inquiry: "😀".repeat(limit + 1) })).toEqual(["inquiry"]);
		expect(helpdeskRequestSchema.safeParse({ inquiry: "あ".repeat(limit) }).success).toBe(true);
		expect(paths({ inquiry: "あ".repeat(limit + 1) })).toEqual(["inquiry"]);
	});

	it.each([0, -1, 31, 1.5, Number.NaN, "5", null])("rejects maxSteps %s", (maxSteps) => {
		expect(paths({ inquiry: "q", maxSteps })).toEqual(["maxSteps"]);
	});

	it.each([1, 30])("accepts maxSteps %s, the edges of the range", (maxSteps) => {
		expect(helpdeskRequestSchema.safeParse({ inquiry: "q", maxSteps }).success).toBe(true);
	});

	it("rejects a model that is not in the catalog", () => {
		expect(paths({ inquiry: "q", modelId: "not-a-model" })).toEqual(["modelId"]);
	});

	it("rejects an unknown key and a missing inquiry", () => {
		expect(helpdeskRequestSchema.safeParse({ inquiry: "q", persona: "x" }).success).toBe(false);
		expect(paths({})).toEqual(["inquiry"]);
		expect(helpdeskRequestSchema.safeParse(null).success).toBe(false);
		expect(helpdeskRequestSchema.safeParse("q").success).toBe(false);
	});
});
