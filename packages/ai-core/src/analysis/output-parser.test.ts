import { describe, expect, it } from "vitest";
import {
	DEFAULT_OUTPUT_LIMITS,
	PNG_MARKER,
	parseSandboxOutput,
	TABLE_MARKER,
} from "./output-parser";

// A real 1x1 PNG.
const PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const pngLine = (payload: Record<string, unknown> = {}) =>
	`${PNG_MARKER}${JSON.stringify({ alt: "売上の棒グラフ", base64: PNG_BASE64, ...payload })}`;
const tableLine = (payload: Record<string, unknown> = {}) =>
	`${TABLE_MARKER}${JSON.stringify({
		caption: "月別売上",
		columns: ["month", "sales"],
		rows: [["2026-01", 120000]],
		totalRows: 1,
		...payload,
	})}`;

const LIMITS = DEFAULT_OUTPUT_LIMITS;

describe("parseSandboxOutput", () => {
	it("returns plain output untouched, with nothing extracted", () => {
		const result = parseSandboxOutput("hello\nworld\n", LIMITS);

		expect(result).toEqual({ text: "hello\nworld\n", figures: [], tables: [], rejected: [] });
	});

	it("uses the documented markers", () => {
		expect(PNG_MARKER).toBe("__PNG__:");
		expect(TABLE_MARKER).toBe("__TABLE__:");
	});

	describe("figures", () => {
		it("extracts a PNG and removes its line from the text", () => {
			const result = parseSandboxOutput(`before\n${pngLine()}\nafter\n`, LIMITS);

			expect(result.figures).toEqual([
				{ alt: "売上の棒グラフ", mediaType: "image/png", base64: PNG_BASE64 },
			]);
			expect(result.text).toBe("before\nafter\n");
			expect(result.rejected).toEqual([]);
		});

		it("keeps several figures in order", () => {
			const result = parseSandboxOutput(
				[pngLine({ alt: "一枚目" }), "between", pngLine({ alt: "二枚目" })].join("\n"),
				LIMITS,
			);

			expect(result.figures.map((figure) => figure.alt)).toEqual(["一枚目", "二枚目"]);
			expect(result.text).toBe("between");
		});

		it("rejects an image that is not a PNG, including SVG and HTML, and says so", () => {
			const svg = Buffer.from(
				'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
			).toString("base64");
			const html = Buffer.from("<html><img src=x onerror=alert(1)></html>").toString("base64");
			const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]).toString("base64");

			const result = parseSandboxOutput(
				[pngLine({ base64: svg }), pngLine({ base64: html }), pngLine({ base64: jpeg })].join("\n"),
				LIMITS,
			);

			expect(result.figures).toEqual([]);
			expect(result.rejected).toHaveLength(3);
			expect(result.rejected[0]).toContain("PNG");
			expect(result.text).toBe("");
		});

		it("accepts a PNG of exactly the size limit and rejects one byte more", () => {
			const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
			const exact = Buffer.concat([header, Buffer.alloc(1024 - header.length)]);
			const over = Buffer.concat([header, Buffer.alloc(1025 - header.length)]);
			const limits = { ...LIMITS, maxFigureBytes: 1024 };

			expect(
				parseSandboxOutput(pngLine({ base64: exact.toString("base64") }), limits).figures,
			).toHaveLength(1);
			const rejected = parseSandboxOutput(pngLine({ base64: over.toString("base64") }), limits);
			expect(rejected.figures).toEqual([]);
			expect(rejected.rejected[0]).toContain("大き");
		});

		it("rejects a payload too large to decode without decoding it", () => {
			const huge = "A".repeat(10_000_000);

			const result = parseSandboxOutput(pngLine({ base64: huge }), {
				...LIMITS,
				maxFigureBytes: 1024,
			});

			expect(result.figures).toEqual([]);
			expect(result.rejected).toHaveLength(1);
		});

		it.each([
			["is empty", ""],
			["is only blanks", "   "],
			["is missing", undefined],
			["is not a string", 7],
			["is longer than 200 characters", "あ".repeat(201)],
		])("rejects a figure whose alt %s", (_label, alt) => {
			const result = parseSandboxOutput(pngLine({ alt }), LIMITS);

			expect(result.figures).toEqual([]);
			expect(result.rejected[0]).toContain("alt");
		});

		it("accepts an alt of 1 and of exactly 200 characters", () => {
			expect(parseSandboxOutput(pngLine({ alt: "a" }), LIMITS).figures).toHaveLength(1);
			expect(parseSandboxOutput(pngLine({ alt: "あ".repeat(200) }), LIMITS).figures).toHaveLength(
				1,
			);
		});

		it.each([
			["not valid base64", "not*base64!"],
			["valid characters of the wrong length", "AAAAA"],
			["the right length with an invalid character", "AA*A"],
			["base64 with extra characters after the padding", `${PNG_BASE64}A`],
			["empty", ""],
			["not a string", 5],
		])(
			"rejects a figure whose data is %s, as malformed rather than as a non-PNG",
			(_label, base64) => {
				const result = parseSandboxOutput(pngLine({ base64 }), LIMITS);

				expect(result.figures).toEqual([]);
				expect(result.rejected).toHaveLength(1);
				expect(result.rejected[0]).toContain("画像データの形式が不正");
			},
		);

		it("rejects a figure whose line is not JSON, or JSON of another shape", () => {
			const result = parseSandboxOutput(
				[`${PNG_MARKER}{oops`, `${PNG_MARKER}[1,2]`, `${PNG_MARKER}null`].join("\n"),
				LIMITS,
			);

			expect(result.figures).toEqual([]);
			expect(result.rejected).toHaveLength(3);
			for (const reason of result.rejected) expect(reason).toContain("JSON の形式が不正");
			expect(result.text).toBe("");
		});

		it("stops at the item limit and reports the rest", () => {
			const lines = Array.from({ length: 4 }, (_, index) => pngLine({ alt: `図${index}` }));

			const result = parseSandboxOutput(lines.join("\n"), { ...LIMITS, maxItems: 2 });

			expect(result.figures.map((figure) => figure.alt)).toEqual(["図0", "図1"]);
			expect(result.rejected).toHaveLength(2);
			expect(result.rejected[0]).toContain("多すぎ");
		});
	});

	describe("tables", () => {
		it("extracts a table and removes its line from the text", () => {
			const result = parseSandboxOutput(`${tableLine()}\ndone\n`, LIMITS);

			expect(result.tables).toEqual([
				{
					caption: "月別売上",
					columns: ["month", "sales"],
					rows: [["2026-01", 120000]],
					totalRows: 1,
				},
			]);
			expect(result.text).toBe("done\n");
		});

		it("accepts null, string and number cells", () => {
			const result = parseSandboxOutput(
				tableLine({
					rows: [
						["a", null],
						[null, 1.5],
						["", -3],
					],
					totalRows: 3,
				}),
				LIMITS,
			);

			expect(result.tables[0]?.rows).toEqual([
				["a", null],
				[null, 1.5],
				["", -3],
			]);
		});

		it("keeps 200 rows and drops the rest, but keeps the real row count", () => {
			const rows = Array.from({ length: 250 }, (_, index) => [`r${index}`, index]);

			const result = parseSandboxOutput(tableLine({ rows, totalRows: 250 }), LIMITS);

			expect(result.tables[0]?.rows).toHaveLength(200);
			expect(result.tables[0]?.rows[199]).toEqual(["r199", 199]);
			expect(result.tables[0]?.totalRows).toBe(250);
		});

		it("accepts exactly the row limit without dropping a row", () => {
			const rows = Array.from({ length: 200 }, (_, index) => [`r${index}`, index]);

			const result = parseSandboxOutput(tableLine({ rows, totalRows: 200 }), LIMITS);

			expect(result.tables[0]?.rows).toHaveLength(200);
			expect(result.tables[0]?.totalRows).toBe(200);
		});

		it("never reports fewer total rows than it was given", () => {
			const rows = Array.from({ length: 5 }, (_, index) => [`r${index}`, index]);

			expect(
				parseSandboxOutput(tableLine({ rows, totalRows: 1 }), LIMITS).tables[0]?.totalRows,
			).toBe(5);
			expect(
				parseSandboxOutput(tableLine({ rows, totalRows: undefined }), LIMITS).tables[0]?.totalRows,
			).toBe(5);
			expect(
				parseSandboxOutput(tableLine({ rows, totalRows: 1000 }), LIMITS).tables[0]?.totalRows,
			).toBe(1000);
		});

		it.each([
			["a caption that is not a string", { caption: 3 }],
			["columns that are not strings", { columns: ["a", 1] }],
			["no columns", { columns: [] }],
			["rows that are not arrays", { rows: ["x"] }],
			["a row with the wrong number of cells", { rows: [["only-one"]] }],
			["a cell that is an object", { rows: [["a", { x: 1 }]] }],
			["a cell that is a boolean", { rows: [["a", true]] }],
			["a total that is negative", { totalRows: -1 }],
			["a total that is not an integer", { totalRows: 1.5 }],
		])("rejects a table with %s", (_label, payload) => {
			const result = parseSandboxOutput(tableLine(payload), LIMITS);

			expect(result.tables).toEqual([]);
			expect(result.rejected).toHaveLength(1);
			expect(result.text).toBe("");
		});

		it("rejects a table with no columns even when it has no rows", () => {
			const result = parseSandboxOutput(tableLine({ columns: [], rows: [], totalRows: 0 }), LIMITS);

			expect(result.tables).toEqual([]);
			expect(result.rejected).toHaveLength(1);
		});

		it("rejects a number that JSON reads as infinity", () => {
			const raw = `${TABLE_MARKER}{"caption":"x","columns":["a","b"],"rows":[["a",1e999]],"totalRows":1}`;

			const result = parseSandboxOutput(raw, LIMITS);

			expect(result.tables).toEqual([]);
			expect(result.rejected).toHaveLength(1);
		});

		it("cuts a cell and a column name that are longer than the limit, with a mark, instead of passing megabytes on", () => {
			const long = "あ".repeat(5_000);

			const result = parseSandboxOutput(
				tableLine({ columns: [long, "b"], rows: [[long, 1]], totalRows: 1 }),
				LIMITS,
			);

			const table = result.tables[0];
			expect([...(table?.columns[0] ?? "")].length).toBeLessThanOrEqual(
				LIMITS.maxCellCharacters + 1,
			);
			expect(table?.columns[0]?.endsWith("…")).toBe(true);
			const cell = table?.rows[0]?.[0];
			expect(typeof cell === "string" && [...cell].length).toBe(LIMITS.maxCellCharacters + 1);
			expect(String(cell).endsWith("…")).toBe(true);
			expect(table?.columns[1]).toBe("b");
		});

		it("leaves a cell of exactly the limit alone", () => {
			const exact = "x".repeat(LIMITS.maxCellCharacters);

			const result = parseSandboxOutput(
				tableLine({ columns: ["a", "b"], rows: [[exact, 1]], totalRows: 1 }),
				LIMITS,
			);

			expect(result.tables[0]?.rows[0]?.[0]).toBe(exact);
		});

		it("rejects a table with too many columns", () => {
			const columns = Array.from({ length: 101 }, (_, index) => `c${index}`);

			const result = parseSandboxOutput(tableLine({ columns, rows: [], totalRows: 0 }), LIMITS);

			expect(result.tables).toEqual([]);
			expect(result.rejected).toHaveLength(1);
		});

		it("accepts a table with no rows", () => {
			const result = parseSandboxOutput(tableLine({ rows: [], totalRows: 0 }), LIMITS);

			expect(result.tables[0]?.rows).toEqual([]);
		});
	});

	describe("which lines count as markers", () => {
		it("takes a marker only at the start of a line", () => {
			const indented = ` ${pngLine()}`;
			const embedded = `value=${tableLine()}`;

			const result = parseSandboxOutput(`${indented}\n${embedded}\n`, LIMITS);

			expect(result.figures).toEqual([]);
			expect(result.tables).toEqual([]);
			expect(result.text).toBe(`${indented}\n${embedded}\n`);
		});

		it("leaves other would-be markers (SVG, HTML) in the text as plain text", () => {
			const text = "__SVG__:<svg/>\n__HTML__:<b>x</b>\n";

			expect(parseSandboxOutput(text, LIMITS)).toEqual({
				text,
				figures: [],
				tables: [],
				rejected: [],
			});
		});

		it("reads Windows line endings and removes the marker lines cleanly", () => {
			const result = parseSandboxOutput(`a\r\n${pngLine()}\r\nb\r\n`, LIMITS);

			expect(result.figures).toHaveLength(1);
			expect(result.text).toBe("a\nb\n");
		});

		it("keeps a final line without a newline", () => {
			expect(parseSandboxOutput(`${pngLine()}\nlast`, LIMITS).text).toBe("last");
		});
	});

	describe("a very large output", () => {
		it("still finds marker lines placed after megabytes of text, because it extracts before cutting the text", () => {
			const noise = `${"x".repeat(99)}\n`.repeat(50_000); // about 5 MB
			const stdout = `${pngLine({ alt: "先頭" })}\n${noise}${tableLine()}\n${pngLine({ alt: "末尾" })}\n`;

			const result = parseSandboxOutput(stdout, { ...LIMITS, maxTextCharacters: 1000 });

			expect(result.figures.map((figure) => figure.alt)).toEqual(["先頭", "末尾"]);
			expect(result.tables).toHaveLength(1);
			expect(result.text.length).toBeLessThanOrEqual(1000 + 200);
			expect(result.text).toContain("省略");
		});

		it("cuts the text at the limit and says so, but leaves text under the limit alone", () => {
			const long = "あ".repeat(50);

			const cut = parseSandboxOutput(long, { ...LIMITS, maxTextCharacters: 10 });
			const kept = parseSandboxOutput(long, { ...LIMITS, maxTextCharacters: 50 });

			expect(cut.text.startsWith("あ".repeat(10))).toBe(true);
			expect(cut.text).toContain("省略");
			expect(kept.text).toBe(long);
		});

		it("does not split a character in two when it cuts", () => {
			const emoji = "😀".repeat(20);

			const cut = parseSandboxOutput(emoji, { ...LIMITS, maxTextCharacters: 5 });

			expect(cut.text).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/u);
			expect(cut.text).not.toMatch(/(?<![\ud800-\udbff])[\udc00-\udfff]/u);
		});
	});

	it("defaults the limits to the documented ones", () => {
		expect(DEFAULT_OUTPUT_LIMITS).toMatchObject({
			maxFigureBytes: 1024 * 1024,
			maxTableRows: 200,
			maxCellCharacters: 1_000,
		});
	});
});
