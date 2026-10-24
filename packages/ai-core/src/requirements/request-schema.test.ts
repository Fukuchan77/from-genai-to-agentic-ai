import { describe, expect, it } from "vitest";
import { DEFAULT_INTERVIEW } from "../config/defaults";
import { MODEL_CATALOG } from "../models/catalog";
import { REQUIREMENTS_REQUEST_LIMITS, requirementsSessionRequestSchema } from "./request-schema";

const MODEL_ID = Object.keys(MODEL_CATALOG)[0] as string;

function paths(body: unknown): string[] {
	const result = requirementsSessionRequestSchema.safeParse(body);
	expect(result.success).toBe(false);
	return [...new Set((result.error?.issues ?? []).map((issue) => issue.path.join(".")))];
}

describe("requirementsSessionRequestSchema", () => {
	it("accepts an overview alone and keeps no defaults in the parsed body", () => {
		expect(requirementsSessionRequestSchema.parse({ overview: "アプリ" })).toEqual({
			overview: "アプリ",
		});
	});

	it("accepts every optional field", () => {
		const body = { overview: "x", modelId: MODEL_ID, personaCount: 5, maxRounds: 10 };
		expect(requirementsSessionRequestSchema.parse(body)).toEqual(body);
	});

	it("fixes its limits and agrees with the interview defaults", () => {
		expect(REQUIREMENTS_REQUEST_LIMITS).toEqual({
			overviewMaxCharacters: 2_000,
			personaCountMin: 1,
			personaCountMax: 5,
			maxRoundsMin: 1,
			maxRoundsMax: 10,
		});
		expect(DEFAULT_INTERVIEW.personaCount).toBeLessThanOrEqual(5);
		expect(DEFAULT_INTERVIEW.maxRounds).toBeLessThanOrEqual(10);
	});

	it.each([
		["empty", ""],
		["only spaces", "  \n\t "],
		["only a full-width space", "　"],
	])("rejects an overview that is %s", (_name, overview) => {
		expect(paths({ overview })).toEqual(["overview"]);
	});

	it("counts characters, not UTF-16 units: 2000 emoji pass, 2001 fail", () => {
		expect(
			requirementsSessionRequestSchema.safeParse({ overview: "😀".repeat(2_000) }).success,
		).toBe(true);
		expect(paths({ overview: "😀".repeat(2_001) })).toEqual(["overview"]);
	});

	it.each([
		[{}, "overview"],
		[{ overview: 1 }, "overview"],
		[{ overview: "x", extra: 1 }, ""],
		[{ overview: "x", modelId: "nope" }, "modelId"],
		[{ overview: "x", personaCount: 0 }, "personaCount"],
		[{ overview: "x", personaCount: 6 }, "personaCount"],
		[{ overview: "x", personaCount: 2.5 }, "personaCount"],
		[{ overview: "x", maxRounds: 0 }, "maxRounds"],
		[{ overview: "x", maxRounds: 11 }, "maxRounds"],
		[{ overview: "x", maxRounds: 1.5 }, "maxRounds"],
	])("rejects %j at %s", (body, path) => {
		expect(paths(body)).toEqual([path]);
	});

	it("accepts the bounds 1 and 5, 1 and 10", () => {
		for (const body of [
			{ overview: "x", personaCount: 1, maxRounds: 1 },
			{ overview: "x", personaCount: 5, maxRounds: 10 },
		]) {
			expect(requirementsSessionRequestSchema.parse(body)).toEqual(body);
		}
	});
});
