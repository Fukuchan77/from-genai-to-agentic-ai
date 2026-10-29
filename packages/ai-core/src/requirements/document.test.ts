import { describe, expect, it } from "vitest";
import {
	NONE_TEXT,
	REQUIREMENT_DOCUMENT_HEADINGS,
	REQUIREMENT_DOCUMENT_TITLE,
	renderRequirementDocument,
} from "./document";
import { EMPTY_REQUIREMENTS, type Requirements } from "./session";

const item = (text: string, personaId = "persona-1") => ({ text, personaId });

const sample: Requirements = {
	functional: [item("商品を検索できる"), item("カートに入れられる", "persona-2")],
	nonFunctional: [item("応答は 2 秒以内")],
	constraints: [item("予算は 100 万円")],
	unconfirmed: [item("決済手段は未定", "persona-2")],
};

const headingLines = (doc: string) => doc.split("\n").filter((line) => line.startsWith("#"));

describe("renderRequirementDocument", () => {
	it("uses a fixed chapter list in a fixed order", () => {
		const doc = renderRequirementDocument(sample, { forcedEnd: false, missing: [] });
		expect(REQUIREMENT_DOCUMENT_TITLE).toBe("# 要件定義書");
		expect(REQUIREMENT_DOCUMENT_HEADINGS).toEqual({
			functional: "## 1. 機能要件",
			nonFunctional: "## 2. 非機能要件",
			constraints: "## 3. 制約",
			unconfirmed: "## 4. 未確認事項",
		});
		expect(headingLines(doc)).toEqual([
			"# 要件定義書",
			"## 1. 機能要件",
			"## 2. 非機能要件",
			"## 3. 制約",
			"## 4. 未確認事項",
		]);
	});

	it("renders each item as a list item with its source persona", () => {
		const doc = renderRequirementDocument(sample, { forcedEnd: false, missing: [] });
		expect(doc).toContain("- 商品を検索できる（出所: persona-1）\n");
		expect(doc).toContain("- カートに入れられる（出所: persona-2）\n");
		expect(doc).toContain("- 決済手段は未定（出所: persona-2）\n");
	});

	it("writes the exact document and ends with a single trailing newline", () => {
		const doc = renderRequirementDocument(
			{ ...EMPTY_REQUIREMENTS, functional: [item("A")] },
			{ forcedEnd: false, missing: [] },
		);
		expect(doc).toBe(
			[
				"# 要件定義書",
				"",
				"## 1. 機能要件",
				"",
				"- A（出所: persona-1）",
				"",
				"## 2. 非機能要件",
				"",
				"なし",
				"",
				"## 3. 制約",
				"",
				"なし",
				"",
				"## 4. 未確認事項",
				"",
				"なし",
				"",
			].join("\n"),
		);
		expect(doc.endsWith("\n\n")).toBe(false);
	});

	it("writes なし for every empty chapter", () => {
		const doc = renderRequirementDocument(EMPTY_REQUIREMENTS, { forcedEnd: false, missing: [] });
		expect(NONE_TEXT).toBe("なし");
		expect(doc.match(/^なし$/gm)).toHaveLength(4);
	});

	it("lists missing items in the unconfirmed chapter on a forced end", () => {
		const doc = renderRequirementDocument(sample, {
			forcedEnd: true,
			missing: ["認証方式", "  データ保持期間 "],
		});
		const unconfirmed = doc.slice(doc.indexOf(REQUIREMENT_DOCUMENT_HEADINGS.unconfirmed));
		expect(unconfirmed).toContain("- 決済手段は未定（出所: persona-2）\n");
		expect(unconfirmed).toContain("- 認証方式\n");
		expect(unconfirmed).toContain("- データ保持期間\n");
		expect(unconfirmed).not.toContain("なし");
	});

	it("ignores missing when the interview did not end at the limit", () => {
		const doc = renderRequirementDocument(EMPTY_REQUIREMENTS, {
			forcedEnd: false,
			missing: ["認証方式"],
		});
		expect(doc).not.toContain("認証方式");
		expect(doc.match(/^なし$/gm)).toHaveLength(4);
	});

	it("writes なし in the unconfirmed chapter on a forced end with nothing missing", () => {
		const doc = renderRequirementDocument(EMPTY_REQUIREMENTS, { forcedEnd: true, missing: [] });
		expect(doc.match(/^なし$/gm)).toHaveLength(4);
		const blank = renderRequirementDocument(EMPTY_REQUIREMENTS, {
			forcedEnd: true,
			missing: ["", "   "],
		});
		expect(blank).toBe(doc);
	});

	it("drops missing entries that duplicate an unconfirmed item or each other", () => {
		const doc = renderRequirementDocument(sample, {
			forcedEnd: true,
			missing: ["決済手段は未定", "認証方式", "認証方式"],
		});
		expect(doc.match(/決済手段は未定/g)).toHaveLength(1);
		expect(doc.match(/認証方式/g)).toHaveLength(1);
	});

	it("keeps forged headings in item text out of the structure", () => {
		const hostile: Requirements = {
			...EMPTY_REQUIREMENTS,
			functional: [item("通常\n## 偽の章\n本文"), item("# 見出し風"), item("\n\n### 先頭改行")],
		};
		const doc = renderRequirementDocument(hostile, {
			forcedEnd: true,
			missing: ["\n## 偽の不足\n"],
		});
		expect(headingLines(doc)).toEqual(
			headingLines(
				renderRequirementDocument(EMPTY_REQUIREMENTS, { forcedEnd: false, missing: [] }),
			),
		);
		expect(doc).toContain("- 通常 ## 偽の章 本文（出所: persona-1）\n");
		expect(doc).toContain("- \\# 見出し風（出所: persona-1）\n");
		expect(doc).toContain("- \\### 先頭改行（出所: persona-1）\n");
		expect(doc).toContain("- \\## 偽の不足\n");
	});

	it("neutralizes persona ids and other line-start markdown", () => {
		const doc = renderRequirementDocument(
			{
				...EMPTY_REQUIREMENTS,
				constraints: [item("> 引用", "p\n## 偽"), item("- 入れ子"), item("1. 番号")],
			},
			{ forcedEnd: false, missing: [] },
		);
		expect(headingLines(doc)).toHaveLength(5);
		expect(doc).toContain("- \\> 引用（出所: p ## 偽）\n");
		expect(doc).toContain("- \\- 入れ子（出所: persona-1）\n");
		expect(doc).toContain("- \\1. 番号（出所: persona-1）\n");
	});

	it("skips items that are blank after normalization", () => {
		const doc = renderRequirementDocument(
			{ ...EMPTY_REQUIREMENTS, functional: [item("  \n "), item("有効")] },
			{ forcedEnd: false, missing: [] },
		);
		expect(doc.match(/^- /gm)).toHaveLength(1);
	});

	it("is deterministic and does not mutate its input", () => {
		const params = { forcedEnd: true, missing: ["x"] } as const;
		const before = JSON.stringify(sample);
		expect(renderRequirementDocument(sample, params)).toBe(
			renderRequirementDocument(sample, params),
		);
		expect(JSON.stringify(sample)).toBe(before);
	});
});
