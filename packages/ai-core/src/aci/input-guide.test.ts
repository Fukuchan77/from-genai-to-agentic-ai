import { describe, expect, it } from "vitest";
import { z } from "zod";
import { formatInputGuide } from "./input-guide";

const schema = z.object({
	path: z.string().min(1).describe("読むファイルの相対パス"),
	mode: z.enum(["read", "stat"]).describe("操作の種類"),
	limit: z.number().int().max(100).optional().describe("返す件数（最大 100）"),
	tags: z.array(z.string()).min(1).optional().describe("タグ"),
});

function guideFor(input: unknown, target: z.ZodType = schema): string {
	const result = target.safeParse(input);
	if (result.success) throw new Error("expected the input to be invalid");
	return formatInputGuide(result.error, target);
}

describe("formatInputGuide", () => {
	it("names a missing required parameter, its type and that it cannot be omitted", () => {
		const guide = guideFor({ mode: "read" });

		expect(guide).toContain("path");
		expect(guide).toContain("string");
		expect(guide).toContain("省略できません");
	});

	it("names the parameter and the expected type for a type mismatch", () => {
		const guide = guideFor({ path: "a", mode: "read", limit: "ten" });

		expect(guide).toContain("limit");
		expect(guide).toContain("number");
		expect(guide).not.toContain("省略できません");
	});

	it("lists the allowed values for an enum violation", () => {
		const guide = guideFor({ path: "a", mode: "delete" });

		expect(guide).toContain("mode");
		expect(guide).toContain('"read"');
		expect(guide).toContain('"stat"');
	});

	it("explains size limits for strings, numbers and arrays", () => {
		const guide = guideFor({ path: "", mode: "read", limit: 500, tags: [] });

		expect(guide).toContain("path");
		expect(guide).toMatch(/path[^\n]*1 文字以上/u);
		expect(guide).toMatch(/limit[^\n]*100 以下/u);
		expect(guide).toMatch(/tags[^\n]*1 件以上/u);
	});

	it("lists every violation, one line each", () => {
		const guide = guideFor({ mode: "delete", limit: "x" });
		const lines = guide.split("\n").filter((line) => line.startsWith("- "));

		expect(lines).toHaveLength(3);
		expect(lines.map((line) => line.split("（")[0]?.split("：")[0])).toEqual(
			expect.arrayContaining(["- path", "- mode", "- limit"]),
		);
	});

	it("shows the field description so the model knows what the value means", () => {
		const guide = guideFor({ mode: "read" });

		expect(guide).toContain("読むファイルの相対パス");
	});

	it("ends with a valid example input built from the schema", () => {
		const guide = guideFor({ mode: "delete" });
		const example = guide.split("正しい入力の例:")[1]?.trim();

		expect(example).toBeDefined();
		const parsed = schema.safeParse(JSON.parse(example ?? "null"));
		expect(parsed.success).toBe(true);
	});

	it("names nested parameters with a dotted path", () => {
		const nested = z.object({
			filter: z.object({ since: z.string().describe("開始日") }).describe("絞り込み"),
		});

		expect(guideFor({ filter: {} }, nested)).toContain("filter.since");
	});

	it("reports unexpected keys from a strict schema", () => {
		const strict = z.strictObject({ path: z.string().describe("パス") });
		const guide = guideFor({ path: "a", extra: 1 }, strict);

		expect(guide).toContain("extra");
		expect(guide).toContain("不要");
	});

	it("handles a top-level type mismatch", () => {
		const guide = guideFor("text");

		expect(guide).toContain("入力全体");
	});

	it("does not echo the received values (they may be private)", () => {
		const secret = "private-value-42";
		const guide = guideFor({ path: "a", mode: secret });

		expect(guide).not.toContain(secret);
	});

	it("never contains a stack trace or Zod's JSON dump", () => {
		const guide = guideFor({ mode: 1 });

		expect(guide).not.toMatch(/\n\s+at /u);
		expect(guide).not.toContain('"code"');
		expect(guide).not.toContain("invalid_type");
	});

	it.each([
		["an exclusive lower bound", z.object({ n: z.number().gt(5).describe("n") })],
		["an exclusive upper bound", z.object({ n: z.number().lt(0).describe("n") })],
		["an integer range", z.object({ n: z.number().int().min(10).max(20).describe("n") })],
		["an email", z.object({ mail: z.email().describe("mail") })],
		["a url", z.object({ link: z.url().describe("link") })],
		["a uuid", z.object({ id: z.uuid().describe("id") })],
		["a date-time", z.object({ at: z.iso.datetime().describe("at") })],
		["a boolean", z.object({ flag: z.boolean().describe("flag") })],
		["a required array", z.object({ tags: z.array(z.string()).min(2).describe("tags") })],
		["a nested object", z.object({ a: z.object({ b: z.string().describe("b") }).describe("a") })],
		["a literal", z.object({ kind: z.literal("x").describe("kind") })],
	])("emits an example that parses for %s", (_label, target) => {
		const guide = guideFor({ unknown: 1, extra: true }, target);
		const example = guide.split("正しい入力の例:")[1]?.trim();

		expect(example, guide).toBeDefined();
		expect(target.safeParse(JSON.parse(example ?? "null")).success).toBe(true);
	});

	it("omits the example when the schema would reject the generated one", () => {
		const refined = z
			.object({ a: z.number().describe("a"), b: z.number().describe("b") })
			.refine((value) => value.a < value.b, { error: "a は b より小さくしてください" });
		const guide = guideFor({ a: "x" }, refined);

		expect(guide).not.toContain("正しい入力の例:");
		expect(guide).toContain("a");
	});

	it("explains number bounds that are not inclusive", () => {
		const target = z.object({ n: z.number().gt(5).lt(9).describe("n") });

		expect(guideFor({ n: 1 }, target)).toMatch(/n[^\n]*5 より大きい/u);
		expect(guideFor({ n: 99 }, target)).toMatch(/n[^\n]*9 より小さい/u);
	});
});
