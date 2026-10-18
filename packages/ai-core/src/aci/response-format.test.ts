import { describe, expect, it } from "vitest";
import { applyResponseFormat } from "./response-format";

const HINT = "全文は format を detailed にして再度呼び出してください。";

describe("applyResponseFormat", () => {
	it("returns concise text unchanged when it is exactly at the limit", () => {
		const text = "あ".repeat(1_000);

		expect(
			applyResponseFormat(text, { format: "concise", maxCharacters: 1_000, fullTextHint: HINT }),
		).toBe(text);
	});

	it("truncates concise text one character over the limit and appends the hint", () => {
		const text = "あ".repeat(1_001);
		const result = applyResponseFormat(text, {
			format: "concise",
			maxCharacters: 1_000,
			fullTextHint: HINT,
		});

		expect(result.startsWith("あ".repeat(1_000))).toBe(true);
		expect(result.startsWith("あ".repeat(1_001))).toBe(false);
		expect(result.endsWith(HINT)).toBe(true);
	});

	it("tells the reader how many characters were left out", () => {
		const result = applyResponseFormat("x".repeat(1_250), {
			format: "concise",
			maxCharacters: 1_000,
			fullTextHint: HINT,
		});

		expect(result).toContain("250");
	});

	it("never cuts a surrogate pair in half", () => {
		const text = "😀".repeat(10);
		const result = applyResponseFormat(text, {
			format: "concise",
			maxCharacters: 5,
			fullTextHint: HINT,
		});
		const body = result.split("\n")[0] ?? "";

		expect([...body].every((char) => char === "😀")).toBe(true);
		expect([...body].length).toBeLessThanOrEqual(5);
	});

	it("does not truncate detailed text, however long", () => {
		const text = "あ".repeat(50_000);

		expect(
			applyResponseFormat(text, { format: "detailed", maxCharacters: 10, fullTextHint: HINT }),
		).toBe(text);
	});

	it("rejects a non-positive limit", () => {
		for (const maxCharacters of [0, -1, 1.5, Number.NaN]) {
			expect(() =>
				applyResponseFormat("a", { format: "concise", maxCharacters, fullTextHint: HINT }),
			).toThrow(RangeError);
		}
	});
});
