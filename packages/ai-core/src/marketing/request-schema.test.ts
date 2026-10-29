import { describe, expect, it } from "vitest";
import { MODEL_CATALOG } from "../models/catalog";
import { COUNCIL_REQUEST_LIMITS, councilRequestSchema } from "./request-schema";

const MODEL_ID = Object.keys(MODEL_CATALOG)[0] as string;

function paths(body: unknown): string[] {
	const result = councilRequestSchema.safeParse(body);
	expect(result.success).toBe(false);
	return [...new Set((result.error?.issues ?? []).map((issue) => issue.path.join(".")))];
}

describe("councilRequestSchema", () => {
	it("accepts a draft alone", () => {
		expect(councilRequestSchema.parse({ draft: "文案" })).toEqual({ draft: "文案" });
	});

	it("accepts every optional field", () => {
		const body = { draft: "d", modelId: MODEL_ID, maxRounds: 6, personaIds: ["a", "b"] };
		expect(councilRequestSchema.parse(body)).toEqual(body);
	});

	it("fixes its limits", () => {
		expect(COUNCIL_REQUEST_LIMITS).toEqual({
			draftMaxCharacters: 2000,
			maxRoundsMin: 1,
			maxRoundsMax: 6,
			personaIdsMin: 2,
			personaIdsMax: 5,
		});
	});

	it("counts the draft in characters: 2000 pass, 2001 fail", () => {
		expect(councilRequestSchema.safeParse({ draft: "あ".repeat(2000) }).success).toBe(true);
		expect(paths({ draft: "あ".repeat(2001) })).toEqual(["draft"]);
		expect(councilRequestSchema.safeParse({ draft: "😀".repeat(2000) }).success).toBe(true);
	});

	it.each([
		["no draft", {}, "draft"],
		["an empty draft", { draft: "" }, "draft"],
		["a blank draft", { draft: " \n" }, "draft"],
		["an unknown model", { draft: "d", modelId: "nope" }, "modelId"],
		["maxRounds 0", { draft: "d", maxRounds: 0 }, "maxRounds"],
		["maxRounds 7", { draft: "d", maxRounds: 7 }, "maxRounds"],
		["a fractional maxRounds", { draft: "d", maxRounds: 1.5 }, "maxRounds"],
		["one persona", { draft: "d", personaIds: ["a"] }, "personaIds"],
		["six personas", { draft: "d", personaIds: ["a", "b", "c", "d", "e", "f"] }, "personaIds"],
		["a duplicated persona", { draft: "d", personaIds: ["a", "a"] }, "personaIds"],
		["an empty persona id", { draft: "d", personaIds: ["a", ""] }, "personaIds.1"],
		["an unknown field", { draft: "d", extra: 1 }, ""],
	])("rejects %s", (_name, body, path) => {
		expect(paths(body)).toContain(path);
	});

	it("accepts two and five personas", () => {
		expect(councilRequestSchema.safeParse({ draft: "d", personaIds: ["a", "b"] }).success).toBe(
			true,
		);
		expect(
			councilRequestSchema.safeParse({ draft: "d", personaIds: ["a", "b", "c", "d", "e"] }).success,
		).toBe(true);
	});
});
