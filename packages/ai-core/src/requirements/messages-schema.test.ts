import { describe, expect, it } from "vitest";
import { MESSAGES_REQUEST_LIMITS, requirementsMessagesRequestSchema } from "./messages-schema";

const answer = (questionId = "q-1-1", text = "回答") => ({ questionId, text });

describe("requirementsMessagesRequestSchema", () => {
	it("accepts one answer and keeps the text as written", () => {
		const parsed = requirementsMessagesRequestSchema.parse({
			answers: [answer("q-1-1", " 回答 ")],
		});

		expect(parsed.answers).toEqual([{ questionId: "q-1-1", text: " 回答 " }]);
	});

	it("exposes the limits the plan names", () => {
		expect(MESSAGES_REQUEST_LIMITS).toEqual({
			answersMin: 1,
			answersMax: 10,
			textMaxCharacters: 2000,
			questionIdMaxCharacters: 64,
		});
	});

	it("accepts 10 answers and rejects 0 and 11", () => {
		const many = (n: number) => ({
			answers: Array.from({ length: n }, (_, i) => answer(`q-1-${i + 1}`)),
		});

		expect(requirementsMessagesRequestSchema.safeParse(many(10)).success).toBe(true);
		expect(requirementsMessagesRequestSchema.safeParse(many(11)).success).toBe(false);
		expect(requirementsMessagesRequestSchema.safeParse(many(0)).success).toBe(false);
	});

	it("counts characters (code points): exactly 2000 passes, 2001 fails", () => {
		const ok = requirementsMessagesRequestSchema.safeParse({
			answers: [answer("q", "😀".repeat(2000))],
		});
		const over = requirementsMessagesRequestSchema.safeParse({
			answers: [answer("q", "😀".repeat(2001))],
		});

		expect(ok.success).toBe(true);
		expect(over.success).toBe(false);
	});

	it.each([
		["a missing body field", {}],
		["answers that are not an array", { answers: "x" }],
		["an unknown top-level field", { answers: [answer()], sessionId: "x" }],
		["an unknown answer field", { answers: [{ ...answer(), personaId: "p" }] }],
		["an empty text", { answers: [answer("q-1-1", "")] }],
		["a blank text", { answers: [answer("q-1-1", " \n\t")] }],
		["a non-string text", { answers: [{ questionId: "q", text: 1 }] }],
		["an empty questionId", { answers: [answer("", "x")] }],
		["a questionId over 64 characters", { answers: [answer("q".repeat(65), "x")] }],
		["the same questionId twice", { answers: [answer("q-1-1", "a"), answer("q-1-1", "b")] }],
	])("rejects %s", (_name, body) => {
		expect(requirementsMessagesRequestSchema.safeParse(body).success).toBe(false);
	});

	it("accepts a questionId of exactly 64 characters", () => {
		expect(
			requirementsMessagesRequestSchema.safeParse({ answers: [answer("q".repeat(64), "x")] })
				.success,
		).toBe(true);
	});
});
