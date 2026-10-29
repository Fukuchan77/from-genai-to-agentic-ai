import { describe, expect, it } from "vitest";
import type { ArxivPaper } from "./arxiv/types";
import { attachCitationWarnings, checkCitations } from "./citations";

function paper(arxivId: string, overrides: Partial<ArxivPaper> = {}): ArxivPaper {
	return {
		arxivId,
		title: `Title of ${arxivId}`,
		authors: ["A. Author"],
		publishedAt: "2024-01-01T00:00:00.000Z",
		summary: "S",
		links: [],
		...overrides,
	};
}

const SET = [paper("2401.01234"), paper("2403.05678"), paper("cs/0501001")];

function check(report: string, papers: readonly ArxivPaper[] = SET) {
	return checkCitations(report, papers);
}

describe("checkCitations", () => {
	describe("a report with nothing to check or nothing wrong", () => {
		it("returns an empty report unchanged", () => {
			expect(check("")).toEqual({ report: "", removed: [], warnings: [] });
		});

		it("returns a report without any paper mention unchanged", () => {
			const report = "# 調査\n\nエージェントは便利です。2024 年に増えました。\n";
			expect(check(report)).toEqual({ report, removed: [], warnings: [] });
		});

		it.each([
			["a bare ID", "- 手法 A（2401.01234）が有効。"],
			["an ID with a version", "- 手法 A [2401.01234v2] が有効。"],
			["an ID with a high version", "- 手法 A [2401.01234v17] が有効。"],
			["an arXiv: prefix", "手法 A（arXiv:2401.01234）が有効。"],
			["an old-style ID", "- Old paper (cs/0501001) shows it."],
			["an old-style ID with a version", "- Old paper (cs/0501001v1) shows it."],
			["an https abstract link", "- [A](https://arxiv.org/abs/2401.01234) shows it."],
			[
				"an http abstract link with a version",
				"- [A](http://arxiv.org/abs/2401.01234v2) shows it.",
			],
			["a pdf link", "- 詳細は https://arxiv.org/pdf/2401.01234v1 を参照。"],
			["a pdf link ending in .pdf", "- 詳細は https://arxiv.org/pdf/2401.01234v1.pdf を参照。"],
			["a www link", "- see https://www.arxiv.org/abs/2403.05678"],
			["an export link", "- see http://export.arxiv.org/abs/2403.05678v1"],
			["a link without a scheme", "- see arxiv.org/abs/2403.05678"],
			["an html link", "- see https://arxiv.org/html/2401.01234v2"],
			["a link followed by a full stop", "手法は https://arxiv.org/abs/2401.01234."],
			["a link whose text is the ID", "- [2401.01234](https://arxiv.org/abs/2401.01234)"],
		])("keeps a mention that is in the set: %s", (_name, report) => {
			expect(check(report)).toEqual({ report, removed: [], warnings: [] });
		});

		it("treats a bare ID in a table as a valid mention", () => {
			const report = "| 手法 | ID |\n|---|---|\n| A | 2401.01234 |\n| B | 2403.05678v2 |\n";
			expect(check(report).report).toBe(report);
		});
	});

	describe("a mention that is not in the set", () => {
		it("removes a list item that cites an unknown ID, and nothing around it", () => {
			const report = [
				"## 関連研究",
				"- 手法 A（2401.01234）が有効。",
				"- 手法 X（2412.99999）が最強。",
				"- 手法 B（2403.05678）も有効。",
				"",
			].join("\n");
			const result = check(report);
			expect(result.report).not.toContain("2412.99999");
			expect(result.report).not.toContain("手法 X");
			expect(result.report).toContain("- 手法 A（2401.01234）が有効。");
			expect(result.report).toContain("- 手法 B（2403.05678）も有効。");
			expect(result.removed).toEqual(["2412.99999"]);
			expect(result.warnings).toHaveLength(1);
			expect(result.warnings[0]).toContain("2412.99999");
		});

		it("removes a numbered list item", () => {
			const result = check(
				"1. 手法 A（2401.01234）\n2. 手法 X（2412.99999）\n3. 手法 B（2403.05678）\n",
			);
			expect(result.report).toBe("1. 手法 A（2401.01234）\n3. 手法 B（2403.05678）\n");
		});

		it("removes a table row", () => {
			const report = "| 手法 | ID |\n|---|---|\n| A | 2401.01234 |\n| X | 2412.99999 |\n";
			expect(check(report).report).toBe("| 手法 | ID |\n|---|---|\n| A | 2401.01234 |\n");
		});

		it("removes the sentence in a Japanese paragraph, and keeps its neighbours", () => {
			const report = "最初の文です。手法 X が最強です（2412.99999）。最後の文です。";
			expect(check(report).report).toBe("最初の文です。最後の文です。");
		});

		it("removes the sentence in an English paragraph, and keeps its neighbours", () => {
			const report = "First sentence. Method X is the best (2412.99999). Last sentence.";
			expect(check(report).report).toBe("First sentence. Last sentence.");
		});

		it("does not take the dot inside an ID for the end of a sentence", () => {
			const report = "Before. See 2412.99999 for details. After.";
			expect(check(report).report).toBe("Before. After.");
		});

		it("drops a line that is left empty and does not leave a double gap", () => {
			expect(check("上\n\n手法 X（2412.99999）。\n\n下").report).toBe("上\n\n下");
		});

		it("keeps a valid mention when the unknown one sits in the same sentence, and removes only the unknown one", () => {
			const report = "手法 A（2401.01234）と手法 X（2412.99999）を比べた。";
			const result = check(report);
			expect(result.report).toContain("2401.01234");
			expect(result.report).not.toContain("2412.99999");
			expect(result.removed).toEqual(["2412.99999"]);
			expect(result.warnings[0]).toContain("確認");
		});

		it("keeps a valid list item item's own ID when the same line has an unknown one", () => {
			const result = check("- A（2401.01234）と X（2412.99999）\n");
			expect(result.report).toContain("2401.01234");
			expect(result.report).not.toContain("2412.99999");
		});

		it("removes an unknown ID the model wrote in a different style", () => {
			expect(check("- X arXiv:2412.99999v3 は…\n- A 2401.01234\n").report).toBe("- A 2401.01234\n");
		});

		it("removes a labelled ID even when its month is impossible", () => {
			const result = check("- X arXiv:2499.99999v3 は…\n- A 2401.01234\n");
			expect(result.report).toBe("- A 2401.01234\n");
			expect(result.removed).toEqual(["2499.99999"]);
		});

		it("reads a label with spaces around the colon", () => {
			expect(check("- X arXiv: 2499.99999\n- Y arXiv : 2488.88888v2\n").removed).toEqual([
				"2499.99999",
				"2488.88888",
			]);
		});

		it("removes the whole list item, however many sentences it has, for a bullet of any kind", () => {
			for (const bullet of ["-", "*", "+", "1.", "2)"]) {
				const result = check(
					`${bullet} First point. X is best (2412.99999). Third point.\nA 2401.01234\n`,
				);
				expect(result.report, bullet).toBe("A 2401.01234\n");
			}
		});

		it("removes the whole table row, however many sentences its cells have", () => {
			const result = check("| h |\n| A. B (2412.99999) | C. D |\n| ok 2401.01234 |\n");
			expect(result.report).toBe("| h |\n| ok 2401.01234 |\n");
		});

		it("removes only the brackets that close around the mention", () => {
			expect(check("手法 A（2401.01234）と手法 X（2412.99999）を比べた。").report).toBe(
				"手法 A（2401.01234）と手法 Xを比べた。",
			);
			expect(check("A 2401.01234 and X (2412.99999] y.").report).toBe("A 2401.01234 and X (] y.");
			expect(check("A 2401.01234 and X [2412.99999] y.").report).toBe("A 2401.01234 and X y.");
		});

		it("keeps the indentation of a list item and trims what the removal leaves at the end", () => {
			expect(check("  - A (2401.01234) and X (2412.99999)\n").report).toBe(
				"  - A (2401.01234) and X\n",
			);
			expect(check("A 2401.01234 and 2412.99999").report).toBe("A 2401.01234 and");
		});

		it("removes two unknown IDs of one sentence together", () => {
			const result = check("Before. X (2412.99999) and Y (2411.88888) are bad. After.");
			expect(result.report).toBe("Before. After.");
			expect(result.removed).toEqual(["2412.99999", "2411.88888"]);
		});

		it("removes the sentence even when a neighbouring sentence cites a paper in the set", () => {
			expect(check("A (2401.01234). X is bad (2412.99999).").report).toBe("A (2401.01234).");
			expect(check("X is bad (2412.99999). A (2401.01234).").report).toBe("A (2401.01234).");
		});

		it("removes only the mention from a list item that also cites a kept paper, whatever its sentences", () => {
			const result = check("- First. A (2401.01234). X (2412.99999). Last.\n");
			expect(result.report).toBe("- First. A (2401.01234). X . Last.\n");
		});

		it("warns for review once an ID has been removed from a shared sentence anywhere", () => {
			const result = check("- X (2412.99999)\nA 2401.01234 vs X (2412.99999) here.\n");
			expect(result.warnings).toHaveLength(1);
			expect(result.warnings[0]).toContain("確認");
		});

		it("keeps the warning for review whichever of the two removals comes first", () => {
			const result = check("A 2401.01234 vs X (2412.99999) here.\n- X (2412.99999)\n");
			expect(result.warnings).toHaveLength(1);
			expect(result.warnings[0]).toContain("確認");
		});

		it("reports an address as it was first written", () => {
			const result = check("- https://doi.org/10.1000/Zed\n- http://www.doi.org/10.1000/Zed\n");
			expect(result.removed).toEqual(["https://doi.org/10.1000/Zed"]);
		});

		it("drops a line that is left empty without a blank line around it", () => {
			expect(check("上\n手法 X（2412.99999）。\n下").report).toBe("上\n下");
		});

		it("takes the line break before the last line when the last line goes", () => {
			expect(check("- A (2401.01234)\n- X (2412.99999)").report).toBe("- A (2401.01234)");
		});

		it("normalises the version before it compares and before it reports", () => {
			const result = check("- X (2412.99999v3)\n- A (2401.01234v9)\n");
			expect(result.removed).toEqual(["2412.99999"]);
			expect(result.report).toContain("2401.01234v9");
		});

		it("lists each removed ID once, in the order it first appears", () => {
			const result = check("- X (2412.99999)\n- Y (2411.88888)\n- X again (2412.99999v2)\n");
			expect(result.removed).toEqual(["2412.99999", "2411.88888"]);
			expect(result.warnings).toHaveLength(2);
		});

		it("removes an unknown old-style ID", () => {
			const result = check("- Z (hep-th/9901001)\n- A (cs/0501001)\n");
			expect(result.report).toBe("- A (cs/0501001)\n");
			expect(result.removed).toEqual(["hep-th/9901001"]);
		});

		it("removes everything that cites a paper when the set is empty", () => {
			const result = check("- A (2401.01234)\n- B (2403.05678)\n", []);
			expect(result.report).toBe("");
			expect(result.removed).toEqual(["2401.01234", "2403.05678"]);
		});
	});

	describe("links", () => {
		it.each([
			["an https abstract link", "- X: https://arxiv.org/abs/2412.99999"],
			["an http link with a version", "- X: http://arxiv.org/abs/2412.99999v2"],
			["a pdf link", "- X: https://arxiv.org/pdf/2412.99999v1.pdf"],
			["a www link", "- X: https://www.arxiv.org/abs/2412.99999"],
			["a link without a scheme", "- X: arxiv.org/abs/2412.99999"],
			["a markdown link", "- [X の論文](https://arxiv.org/abs/2412.99999)"],
		])("removes %s to a paper that is not in the set", (_name, line) => {
			const result = check(`- A (2401.01234)\n${line}\n`);
			expect(result.report).toBe("- A (2401.01234)\n");
			expect(result.removed).toEqual(["2412.99999"]);
		});

		it.each([
			["an export link", "- X: http://export.arxiv.org/abs/2412.99999v1"],
			["an html link", "- X: https://arxiv.org/html/2412.99999v1"],
			["an ar5iv link", "- X: https://ar5iv.org/abs/2412.99999"],
			["an ar5iv labs link", "- X: https://ar5iv.labs.arxiv.org/html/2412.99999"],
			["an upper-case host", "- X: HTTPS://WWW.ARXIV.ORG/abs/2412.99999"],
		])("removes %s to a paper that is not in the set", (_name, line) => {
			expect(check(`- A (2401.01234)\n${line}\n`).removed).toEqual(["2412.99999"]);
		});

		it("keeps a markdown link to a paper in the set, whatever its text says", () => {
			const report = "- [この論文](https://arxiv.org/abs/2401.01234v3) が重要。";
			expect(check(report).report).toBe(report);
		});

		it("removes only the markdown link when the sentence also has a paper in the set", () => {
			const result = check("A（2401.01234）と [X](https://arxiv.org/abs/2412.99999) を比べた。");
			expect(result.report).toContain("2401.01234");
			expect(result.report).not.toContain("2412.99999");
			expect(result.report).not.toContain("[X]");
		});

		it("looks for an ID in the text of a link that goes elsewhere", () => {
			const result = check("- [arXiv:2412.99999](https://example.com/x)\n- A (2401.01234)\n");
			expect(result.removed).toEqual(["2412.99999"]);
		});

		it("removes only the ID in the text of a link that goes elsewhere, brackets with it", () => {
			const result = check(
				"A（2401.01234）と [arXiv:2412.99999](https://example.com/x) を比べた。",
			);
			expect(result.report).toBe("A（2401.01234）と (https://example.com/x) を比べた。");
		});

		it("does not take the full stop after a removed address for part of it", () => {
			const result = check("Compare 2401.01234 with https://arxiv.org/abs/2412.99999.");
			expect(result.report).toBe("Compare 2401.01234 with .");
		});

		it("keeps a link to another site", () => {
			const report =
				"- ソース: https://github.com/example/agents と [docs](https://example.com/docs)";
			expect(check(report)).toEqual({ report, removed: [], warnings: [] });
		});

		it("keeps an arXiv link that is not a paper", () => {
			const report = "- 一覧: https://arxiv.org/list/cs.AI/recent";
			expect(check(report)).toEqual({ report, removed: [], warnings: [] });
		});

		it("keeps a DOI link that is one of the set's own links, whichever host spelling it uses", () => {
			const withDoi = [
				paper("2401.01234", {
					links: [{ href: "http://dx.doi.org/10.1000/xyz123", rel: "related", title: "doi" }],
				}),
			];
			expect(check("- A: http://dx.doi.org/10.1000/xyz123\n", withDoi).removed).toEqual([]);
			expect(check("- A: https://doi.org/10.1000/xyz123\n", withDoi).removed).toEqual([]);
			expect(check("- A: https://doi.org/10.1000/other\n", withDoi).removed).toEqual([
				"https://doi.org/10.1000/other",
			]);
		});

		it("compares the host of a link in lower case and ignores a trailing slash", () => {
			const withLinks = [paper("2401.01234", { links: [{ href: "https://openreview.net/x/" }] })];
			expect(check("- https://OpenReview.NET/x\n", withLinks).removed).toEqual([]);
			expect(check("- https://openreview.net/x/\n", withLinks).removed).toEqual([]);
			expect(check("- https://DOI.ORG/10.1000/none\n", withLinks).removed).toHaveLength(1);
			const bare = [paper("2401.01234", { links: [{ href: "https://openreview.net/x" }] })];
			expect(check("- https://openreview.net/x/\n", bare).removed).toEqual([]);
		});

		it("removes a DOI or other paper-site link that no paper in the set has", () => {
			const result = check("- A (2401.01234)\n- Z: https://doi.org/10.1000/unknown\n");
			expect(result.report).toBe("- A (2401.01234)\n");
			expect(result.removed).toEqual(["https://doi.org/10.1000/unknown"]);
		});

		it("compares a link without its scheme, a leading www, a trailing slash and its fragment", () => {
			const withLink = [
				paper("2401.01234", { links: [{ href: "https://openreview.net/forum?id=abc" }] }),
			];
			for (const written of [
				"http://openreview.net/forum?id=abc",
				"https://www.openreview.net/forum?id=abc",
				"https://openreview.net/forum?id=abc#intro",
			]) {
				expect(check(`- ${written}\n`, withLink).removed, written).toEqual([]);
			}
			expect(check("- https://openreview.net/forum?id=zzz\n", withLink).removed).toHaveLength(1);
		});
	});

	describe("shapes that used to slip through, and sites that used to be destroyed (W5 review F-2, F-3)", () => {
		it.each([
			["underscore emphasis", "- _2412.99999_ が最強。"],
			["double underscore", "- __2412.99999__ が最強。"],
			["bold", "- **2412.99999** が最強。"],
			["a Hugging Face papers page", "- https://huggingface.co/papers/2412.99999"],
			["an alphaxiv page", "- https://www.alphaxiv.org/abs/2412.99999"],
			["an alphaxiv overview page", "- https://www.alphaxiv.org/overview/2412.99999"],
			["a mobile arXiv page", "- https://m.arxiv.org/abs/2412.99999"],
			["a Semantic Scholar arXiv page", "- https://www.semanticscholar.org/arxiv/2412.99999"],
			["an arXiv DOI link", "- https://doi.org/10.48550/arXiv.2412.99999"],
			["an arXiv DOI written bare", "- DOI: 10.48550/arXiv.2412.99999"],
			["an upper-case path", "- https://arxiv.org/ABS/2412.99999"],
			["a doubled slash", "- https://arxiv.org//abs/2412.99999"],
			["an upper-case old-style ID", "- CS/0501002 が最強。"],
			["a labelled upper-case old-style ID", "- arXiv:CS/0501002 が最強。"],
		])("removes %s that names a paper outside the set", (_name, line) => {
			const result = check(`- A (2401.01234)\n${line}\n`);
			expect(result.report, line).toBe("- A (2401.01234)\n");
			expect(result.removed).toHaveLength(1);
		});

		it("looks for an unknown ID in the text of a link whose address is a paper in the set", () => {
			const result = check("A [2412.99999](https://arxiv.org/abs/2401.01234) を見よ。");
			expect(result.report).not.toContain("2412.99999");
			expect(result.removed).toEqual(["2412.99999"]);
		});

		it("does not take the text of a link that repeats its own address for a second mention", () => {
			const report = "- [2401.01234](https://arxiv.org/abs/2401.01234)\n";
			expect(check(report)).toEqual({ report, removed: [], warnings: [] });
			const unknown = check("- [2412.99999](https://arxiv.org/abs/2412.99999)\n");
			expect(unknown.removed).toEqual(["2412.99999"]);
			expect(unknown.report).toBe("");
		});

		it.each([
			["the arXiv DOI", "- https://doi.org/10.48550/arXiv.2401.01234"],
			["the arXiv DOI in lower case", "- https://doi.org/10.48550/arxiv.2401.01234"],
			["the arXiv DOI written bare", "- DOI: 10.48550/arXiv.2401.01234"],
			["a Semantic Scholar arXiv page", "- https://www.semanticscholar.org/arxiv/2401.01234"],
			["a Hugging Face papers page", "- https://huggingface.co/papers/2401.01234"],
			["an upper-case path", "- https://arxiv.org/ABS/2401.01234"],
			["a doubled slash", "- https://arxiv.org//abs/2401.01234"],
			["an upper-case old-style ID", "- CS/0501001"],
		])("keeps %s of a paper that was fetched", (_name, line) => {
			const report = `${line}\n`;
			expect(check(report)).toEqual({ report, removed: [], warnings: [] });
		});

		it("compares a DOI whatever its host spelling or case", () => {
			const withDoi = [
				paper("2401.01234", { links: [{ href: "http://dx.doi.org/10.1000/AbC123" }] }),
			];
			for (const written of [
				"https://doi.org/10.1000/abc123",
				"https://dx.doi.org/10.1000/ABC123",
				"http://www.doi.org/10.1000/AbC123",
			]) {
				expect(check(`- ${written}\n`, withDoi).removed, written).toEqual([]);
			}
			expect(check("- https://doi.org/10.1000/other\n", withDoi).removed).toHaveLength(1);
		});

		it("cuts the whole link out when its text names another paper than its address does", () => {
			const result = check(
				"A（2401.01234）と [2412.99999](https://arxiv.org/abs/2401.01234) を見よ。",
			);
			expect(result.report).toBe("A（2401.01234）と を見よ。");
		});

		it("compares IDs whatever the case of the subject class", () => {
			const math = [paper("math.GT/0309136")];
			expect(check("- math.gt/0309136 と MATH.GT/0309136\n", math).removed).toEqual([]);
		});

		it("does not take a word with an underscore for an ID", () => {
			const report = "変数 my_2401.0 と file_2412.99999x は対象外。\n";
			expect(check(report, [])).toEqual({ report, removed: [], warnings: [] });
		});
	});

	describe("text that only looks like an ID", () => {
		it.each([
			["a number with decimals", "平均は 1234.5678 でした。"],
			["a version number", "v2024.5000 をリリース。"],
			["pi", "円周率は 3.14159 です。"],
			["a month that does not exist", "コードは 2413.01234 とする。"],
			["a month of 99", "値は 2499.99999 です。"],
			["a month of 00", "値は 2400.01234 です。"],
			["an ID with more digits after a dot", "版は 2412.99999.5 です。"],
			["an old-style looking name with six digits", "- Z (hep-th/990100)"],
			["a longer digit string", "ID は 2401.012345 です。"],
			["digits glued to letters", "型番 2401.01234x を使う。"],
			["a path", "ファイルは data/2401.01234/log を読む。"],
			["a path ending in an old-style looking name", "see src/lib/1234567 for it"],
		])("leaves %s alone", (_name, report) => {
			expect(check(report, []).report).toBe(report);
		});
	});

	describe("a paper that is mentioned without an ID", () => {
		const withTitle = [
			paper("2401.01234", { title: "Hierarchical Agents and Tool Use" }),
			paper("2403.05678", { title: "Short" }),
		];

		it("warns when a known title appears with no ID or link in the paragraph, and keeps the text", () => {
			const report = "Hierarchical Agents and Tool Use は階層化の有効性を示した。";
			const result = check(report, withTitle);
			expect(result.report.startsWith(report)).toBe(true);
			expect(result.removed).toEqual([]);
			expect(result.warnings).toHaveLength(1);
			expect(result.warnings[0]).toContain("Hierarchical Agents and Tool Use");
		});

		it("matches the title whatever its case and spacing", () => {
			const report = "hierarchical   AGENTS and\ntool use を紹介する。";
			expect(check(report, withTitle).warnings).toHaveLength(1);
		});

		it("does not warn when the paragraph carries the paper's ID", () => {
			const report = "Hierarchical Agents and Tool Use（2401.01234）は階層化の有効性を示した。";
			expect(check(report, withTitle).warnings).toEqual([]);
		});

		it("does not warn when the paragraph carries a link to the paper", () => {
			const report = "[Hierarchical Agents and Tool Use](https://arxiv.org/abs/2401.01234)";
			expect(check(report, withTitle).warnings).toEqual([]);
		});

		it("does not take another paper's ID for this paper's", () => {
			const report = "Hierarchical Agents and Tool Use と比べて 2403.05678 は軽い。";
			expect(check(report, withTitle).warnings).toHaveLength(1);
		});

		it("warns for a paragraph without the ID even when another paragraph has it", () => {
			const report =
				"Hierarchical Agents and Tool Use（2401.01234）を紹介する。\n\nHierarchical Agents and Tool Use は…";
			expect(check(report, withTitle).warnings).toHaveLength(1);
		});

		it("does not warn when the paragraph links to the paper by one of the paper's own links", () => {
			const linked = [
				paper("2401.01234", {
					title: "Hierarchical Agents and Tool Use",
					links: [{ href: "https://openreview.net/forum?id=abc" }],
				}),
			];
			const report = "Hierarchical Agents and Tool Use https://openreview.net/forum?id=abc";
			expect(check(report, linked).warnings).toEqual([]);
		});

		it("ignores a title that is too short to tell from ordinary words", () => {
			expect(check("This is a Short note.", withTitle).warnings).toEqual([]);
		});

		it("takes a title of exactly eight characters", () => {
			const eight = [paper("2401.01234", { title: "12345678" })];
			expect(check("x 12345678 y", eight).warnings).toHaveLength(1);
			const seven = [paper("2401.01234", { title: "1234567" })];
			expect(check("x 1234567 y", seven).warnings).toEqual([]);
		});

		it("warns once per paper however often the title appears", () => {
			const report =
				"Hierarchical Agents and Tool Use は…\n\nまた Hierarchical Agents and Tool Use は…";
			expect(check(report, withTitle).warnings).toHaveLength(1);
		});
	});

	describe("a line that looks like a reference but has no ID", () => {
		it.each([
			["et al.", "- Smith et al. showed that agents can plan."],
			["a parenthesised year", "- Smith and Lee (2023) showed that agents can plan."],
			["a full-width parenthesised year", "- 田中ら（2023）は計画を示した。"],
		])("warns for %s", (_name, line) => {
			const result = check(`${line}\n`);
			expect(result.report.startsWith(`${line}\n`)).toBe(true);
			expect(result.warnings).toHaveLength(1);
			expect(result.warnings[0]).toContain("ID");
		});

		it("does not warn when the same line carries an ID", () => {
			expect(check("- Smith et al. (2023) 2401.01234\n").warnings).toEqual([]);
		});

		it("does not take a word that merely contains the letters for et al.", () => {
			expect(check("- a diet also helps (note)\n").warnings).toEqual([]);
		});

		it("does not warn when the ID is on the next line of a wrapped paragraph", () => {
			expect(check("Smith et al. (2023) showed\nit works (2401.01234).\n").warnings).toEqual([]);
		});

		it("looks at the next line only for a paragraph, not for a list item", () => {
			expect(check("- Smith et al. (2023)\n- A (2401.01234)\n").warnings).toHaveLength(1);
		});

		it("cuts the quoted line at exactly 60 characters and marks the cut", () => {
			const exact = `Smith et al. ${"x".repeat(60 - "Smith et al. ".length)}`;
			expect(exact).toHaveLength(60);
			expect(check(`${exact}\n`).warnings[0]).toBe(
				`ID の付いていない論文の言及の可能性があります: 「${exact}」`,
			);
			const over = `${exact}y`;
			expect(check(`${over}\n`).warnings[0]).toBe(
				`ID の付いていない論文の言及の可能性があります: 「${exact}…」`,
			);
		});

		it("reports exactly five lines without a summary line", () => {
			const lines = Array.from({ length: 5 }, (_, i) => `- Author${i} et al. showed ${i}.`).join(
				"\n",
			);
			const result = check(`${lines}\n`);
			expect(result.warnings).toHaveLength(5);
			expect(result.warnings.some((warning) => warning.includes("ほかに"))).toBe(false);
		});

		it("counts only the lines beyond five in the summary line", () => {
			const lines = Array.from({ length: 7 }, (_, i) => `- Author${i} et al. showed ${i}.`).join(
				"\n",
			);
			expect(check(`${lines}\n`).warnings.at(-1)).toContain("ほかに 2 行");
		});

		it("does not warn for a year that is not in parentheses", () => {
			expect(check("2023 年に多くの研究が出た。\n").warnings).toEqual([]);
		});

		it("does not warn for a year outside 1900-2099", () => {
			expect(check("(1850) と (2150) は対象外。\n").warnings).toEqual([]);
		});

		it("does not warn twice for a line that also names a known paper without an ID", () => {
			const titled = [paper("2401.01234", { title: "Hierarchical Agents and Tool Use" })];
			const result = check("- Hierarchical Agents and Tool Use (2023) showed it.\n", titled);
			expect(result.warnings).toHaveLength(1);
		});

		it("shortens the quoted line in the warning", () => {
			const long = `- Smith et al. ${"x".repeat(200)}`;
			const warning = check(`${long}\n`).warnings[0] ?? "";
			expect(warning.length).toBeLessThan(150);
		});

		it("reports at most five such lines and counts the rest", () => {
			const lines = Array.from({ length: 8 }, (_, i) => `- Author${i} et al. showed ${i}.`).join(
				"\n",
			);
			const result = check(`${lines}\n`);
			expect(result.warnings).toHaveLength(6);
			expect(result.warnings.at(-1)).toContain("3");
		});
	});

	describe("attachCitationWarnings", () => {
		it("adds a section naming each warning", () => {
			const result = check("- X (2412.99999)\n- A (2401.01234)\n");
			const attached = attachCitationWarnings(result.report, result.warnings);
			expect(attached).toContain("## 引用の確認");
			for (const warning of result.warnings) expect(attached).toContain(`- ${warning}`);
		});

		it("adds nothing when there are no warnings", () => {
			expect(attachCitationWarnings("本文\n", [])).toBe("本文\n");
		});

		it("puts the section after the body, separated by a rule", () => {
			const attached = attachCitationWarnings("本文", ["警告です。"]);
			expect(attached).toBe("本文\n\n---\n\n## 引用の確認\n\n- 警告です。\n");
		});

		it("does not pile up blank lines when the body ends with newlines", () => {
			expect(attachCitationWarnings("本文\n\n\n", ["w"])).toBe(
				"本文\n\n---\n\n## 引用の確認\n\n- w\n",
			);
		});
	});

	describe("robustness", () => {
		it("handles a very large report without slowing down", () => {
			const report = `${"文です。 hello world, version 2.0 and 1234.5678. ".repeat(5_000)}\n- X (2412.99999)\n`;
			const started = performance.now();
			const result = check(report);
			expect(performance.now() - started).toBeLessThan(2_000);
			expect(result.removed).toEqual(["2412.99999"]);
		});

		it("handles a pathological run of brackets without hanging", () => {
			const report = `${"[".repeat(100_000)}(${"(".repeat(100_000)}`;
			const started = performance.now();
			check(report);
			expect(performance.now() - started).toBeLessThan(2_000);
		});

		it("handles Windows line endings", () => {
			const result = check("- A (2401.01234)\r\n- X (2412.99999)\r\n");
			expect(result.report).toBe("- A (2401.01234)\r\n");
		});
	});
});
