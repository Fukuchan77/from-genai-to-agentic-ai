import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
	checkDescription,
	checkJsonSchemaDescription,
	DESCRIPTION_HEADINGS,
	type DescriptionIssue,
} from "./description-check";

const GOOD = [
	"ファイルの内容を読む。",
	"使うとき: パスが分かっていて内容を知りたいとき。",
	"使わないとき: ファイルを探したいとき。",
	"例: path=notes/a.md",
].join("\n");

const described = z.object({ path: z.string().describe("読むファイルの相対パス") });

function codes(issues: readonly DescriptionIssue[]): string[] {
	return issues.map((issue) => `${issue.code}:${issue.target}`);
}

describe("checkDescription: headings", () => {
	it("returns no issue when the summary, all headings and all field descriptions exist", () => {
		expect(checkDescription(GOOD, described)).toEqual([]);
	});

	it("publishes the three headings of CL-18", () => {
		expect(DESCRIPTION_HEADINGS).toEqual(["使うとき:", "使わないとき:", "例:"]);
	});

	it.each([
		["使うとき:", GOOD.replace("使うとき:", "いつ使うか:")],
		["使わないとき:", GOOD.replace("使わないとき:", "")],
		["例:", GOOD.replace("例:", "サンプル:")],
	])("reports the missing heading %s", (heading, description) => {
		expect(codes(checkDescription(description, described))).toEqual([`missing-heading:${heading}`]);
	});

	it("reports every missing heading at once", () => {
		const issues = checkDescription("ファイルを読む。", described);

		expect(codes(issues)).toEqual([
			"missing-heading:使うとき:",
			"missing-heading:使わないとき:",
			"missing-heading:例:",
		]);
	});

	it("requires a heading to start a line: a mention in the middle of a sentence does not count", () => {
		const inline = "ファイルを読む。使うとき: 常に。使わないとき: 無し。例: a";

		expect(codes(checkDescription(inline, described))).toEqual([
			"missing-heading:使うとき:",
			"missing-heading:使わないとき:",
			"missing-heading:例:",
		]);
	});

	it("accepts a full-width colon after a heading", () => {
		expect(checkDescription(GOOD.replaceAll(":", "："), described)).toEqual([]);
	});

	it("accepts indented heading lines", () => {
		const indented = GOOD.replaceAll("\n", "\n  ");

		expect(checkDescription(indented, described)).toEqual([]);
	});

	it("reports a missing purpose sentence when the text starts with a heading", () => {
		const noSummary = GOOD.split("\n").slice(1).join("\n");

		expect(codes(checkDescription(noSummary, described))).toEqual(["missing-summary:description"]);
	});

	it("reports a heading with an empty body", () => {
		const empty = GOOD.replace("使うとき: パスが分かっていて内容を知りたいとき。", "使うとき:");

		expect(codes(checkDescription(empty, described))).toEqual(["empty-heading:使うとき:"]);
	});

	it("reports an empty description as missing summary and headings", () => {
		expect(codes(checkDescription("", described))).toEqual([
			"missing-summary:description",
			"missing-heading:使うとき:",
			"missing-heading:使わないとき:",
			"missing-heading:例:",
		]);
	});
});

describe("checkDescription: input field descriptions", () => {
	it("reports a field without .describe()", () => {
		const schema = z.object({ path: z.string().describe("path"), limit: z.number() });

		expect(codes(checkDescription(GOOD, schema))).toEqual(["missing-field-description:limit"]);
	});

	it("looks through optional, nullable and default wrappers", () => {
		const schema = z.object({
			a: z.string().describe("a").optional(),
			b: z.number().describe("b").nullable(),
			c: z.boolean().describe("c").default(true),
			d: z.string().optional(),
		});

		expect(codes(checkDescription(GOOD, schema))).toEqual(["missing-field-description:d"]);
	});

	it("checks nested object fields with their dotted path", () => {
		const schema = z.object({
			filter: z
				.object({ since: z.string().describe("since"), until: z.string() })
				.describe("filter"),
		});

		expect(codes(checkDescription(GOOD, schema))).toEqual([
			"missing-field-description:filter.until",
		]);
	});

	it("checks the fields of objects inside arrays", () => {
		const schema = z.object({
			items: z.array(z.object({ id: z.string() })).describe("items"),
		});

		expect(codes(checkDescription(GOOD, schema))).toEqual(["missing-field-description:items[].id"]);
	});

	it("reports every undescribed field", () => {
		const schema = z.object({ a: z.string(), b: z.string() });

		expect(codes(checkDescription(GOOD, schema))).toEqual([
			"missing-field-description:a",
			"missing-field-description:b",
		]);
	});

	it("passes a schema with no fields", () => {
		expect(checkDescription(GOOD, z.object({}))).toEqual([]);
	});

	it("reports a schema that cannot be sent to the model instead of throwing", () => {
		const schema = z.object({ when: z.date().describe("when") });

		expect(codes(checkDescription(GOOD, schema))).toEqual(["unsendable-schema:input"]);
	});

	it("checks the values of a record", () => {
		const schema = z.object({
			map: z.record(z.string(), z.object({ inner: z.string() })).describe("map"),
		});

		expect(codes(checkDescription(GOOD, schema))).toEqual([
			"missing-field-description:map{}.inner",
		]);
	});

	it("checks the fields of a recursive schema once", () => {
		interface Node {
			bad: string;
			child?: Node | undefined;
		}
		const node: z.ZodType<Node> = z.lazy(() =>
			z.object({ bad: z.string(), child: node.optional().describe("child") }),
		);
		const schema = z.object({ tree: node.describe("tree") });

		expect(codes(checkDescription(GOOD, schema))).toContain("missing-field-description:tree.bad");
	});

	it("requires a union to be described as a whole or in every member", () => {
		const partly = z.object({ v: z.union([z.string().describe("s"), z.number()]) });
		const whole = z.object({ v: z.union([z.string(), z.number()]).describe("v") });
		const every = z.object({
			v: z.union([z.string().describe("s"), z.number().describe("n")]),
		});

		expect(codes(checkDescription(GOOD, partly))).toEqual(["missing-field-description:v"]);
		expect(checkDescription(GOOD, whole)).toEqual([]);
		expect(checkDescription(GOOD, every)).toEqual([]);
	});

	it("puts a message on every issue", () => {
		const issues = checkDescription("", z.object({ a: z.string() }));

		expect(issues.length).toBeGreaterThan(0);
		for (const issue of issues) expect(issue.message.length).toBeGreaterThan(0);
	});
});

describe("checkJsonSchemaDescription", () => {
	it("shares the heading rules with checkDescription", () => {
		const schema = { type: "object", properties: {} };

		expect(codes(checkJsonSchemaDescription("読む。", schema))).toEqual([
			"missing-heading:使うとき:",
			"missing-heading:使わないとき:",
			"missing-heading:例:",
		]);
		expect(checkJsonSchemaDescription(GOOD, schema)).toEqual([]);
	});

	it("accepts a property that has a description", () => {
		const schema = {
			type: "object",
			properties: { owner: { type: "string", description: "リポジトリの所有者" } },
		};

		expect(checkJsonSchemaDescription(GOOD, schema)).toEqual([]);
	});

	it("accepts a property whose name appears in the description as a word (CL-25)", () => {
		const schema = { type: "object", properties: { path: { type: "string" } } };

		expect(checkJsonSchemaDescription(GOOD, schema)).toEqual([]);
	});

	it("does not accept a short name that only occurs inside other words", () => {
		const description = [
			"Reads a file at a valid path.",
			"使うとき: 読むとき。",
			"使わないとき: 書くとき。",
			"例: x",
		].join("\n");
		const schema = {
			type: "object",
			properties: { a: { type: "string" }, id: { type: "string" }, at: { type: "string" } },
		};

		expect(codes(checkJsonSchemaDescription(description, schema))).toEqual([
			"missing-field-description:id",
		]);
	});

	it("accepts a name written as a key or in code quotes", () => {
		const description = [
			"Searches.",
			"使うとき: `query` に検索語を渡す。",
			"使わないとき: なし。",
			"例: limit=3",
		].join("\n");
		const schema = {
			type: "object",
			properties: { query: { type: "string" }, limit: { type: "number" } },
		};

		expect(checkJsonSchemaDescription(description, schema)).toEqual([]);
	});

	it("reports a property with neither a description nor its name in the description", () => {
		const schema = {
			type: "object",
			properties: {
				path: { type: "string" },
				branch: { type: "string" },
				ref: { type: "string", description: "git ref" },
			},
		};

		expect(codes(checkJsonSchemaDescription(GOOD, schema))).toEqual([
			"missing-field-description:branch",
		]);
	});

	it("checks nested properties and array items", () => {
		const schema = {
			type: "object",
			properties: {
				query: {
					type: "object",
					description: "query",
					properties: { text: { type: "string", description: "text" }, page: { type: "number" } },
				},
				labels: {
					type: "array",
					description: "labels",
					items: { type: "object", properties: { name: { type: "string" } } },
				},
			},
		};

		expect(codes(checkJsonSchemaDescription(GOOD, schema))).toEqual([
			"missing-field-description:query.page",
			"missing-field-description:labels[].name",
		]);
	});

	it("treats a schema without properties as having no fields", () => {
		expect(checkJsonSchemaDescription(GOOD, {})).toEqual([]);
	});
});
