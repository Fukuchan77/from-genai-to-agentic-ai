import { describe, expect, it } from "vitest";
import { DEFAULT_ANALYSIS } from "../config/defaults";
import { PNG_MARKER, TABLE_MARKER } from "./output-parser";
import { ANALYSIS_HELPERS_MODULE, analysisPrelude, helpersImportLine } from "./prelude";

describe("analysisPrelude", () => {
	it("defines show_figure(alt) and show_table(df, caption)", () => {
		expect(analysisPrelude).toMatch(/^def show_figure\(alt\b/mu);
		expect(analysisPrelude).toMatch(/^def show_table\(df, caption\b/mu);
	});

	it("prints the same markers the parser reads, as the start of a line", () => {
		expect(analysisPrelude).toContain(`"${PNG_MARKER}"`);
		expect(analysisPrelude).toContain(`"${TABLE_MARKER}"`);
		expect(analysisPrelude).toMatch(/print\(\s*"__PNG__:" \+/u);
		expect(analysisPrelude).toMatch(/print\(\s*"__TABLE__:" \+/u);
	});

	it("keeps tables to the row limit before printing", () => {
		expect(analysisPrelude).toContain(String(DEFAULT_ANALYSIS.maxTableRows));
		expect(analysisPrelude).toContain("totalRows");
		expect(analysisPrelude).toContain("head(");
	});

	it("draws with a non-interactive backend and a Japanese-capable font when one is installed", () => {
		expect(analysisPrelude).toContain('use("Agg")');
		expect(analysisPrelude).toContain('("IPAGothic", ');
		expect(analysisPrelude).toContain("DejaVu Sans");
	});

	it("turns NaN and infinity into null, so a table is always valid JSON", () => {
		expect(analysisPrelude).toMatch(/isfinite|isnan/u);
		expect(analysisPrelude).toContain("None");
	});

	it("imports only base64, io, json, math and matplotlib: no network, process or file access", () => {
		const imports = [
			...analysisPrelude.matchAll(/^\s*(?:from\s+(\S+)\s+import|import\s+(\S+))/gmu),
		].map((match) => (match[1] ?? match[2] ?? "").split(".")[0]);

		expect(new Set(imports)).toEqual(new Set(["base64", "io", "json", "math", "matplotlib"]));
		expect(analysisPrelude).not.toMatch(/\b(socket|subprocess|urllib|requests|open\()/u);
	});

	it("is the file the run imports from, by a one-line import", () => {
		expect(ANALYSIS_HELPERS_MODULE).toBe("sandbox_helpers");
		expect(helpersImportLine()).toBe("from sandbox_helpers import show_figure, show_table");
	});
});
