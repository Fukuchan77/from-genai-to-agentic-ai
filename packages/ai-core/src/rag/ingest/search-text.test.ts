import { describe, expect, it } from "vitest";
import { buildFullTextQuery, toSearchText } from "./search-text";

function words(text: string): string[] {
	const searchText = toSearchText(text);
	return searchText === "" ? [] : searchText.split(" ");
}

describe("ICU word segmentation (Node runtime)", () => {
	it("segments Japanese into words with the ja locale", () => {
		const segmenter = new Intl.Segmenter("ja", { granularity: "word" });
		const segments = [...segmenter.segment("全文検索")]
			.filter((part) => part.isWordLike)
			.map((part) => part.segment);

		expect(segments).toContain("全文");
		expect(segments).toContain("検索");
	});
});

describe("toSearchText", () => {
	it("splits Japanese text into space-separated words", () => {
		expect(words("全文検索")).toEqual(["全文", "検索"]);
	});

	it("drops particles and other hiragana-only words of two characters or fewer", () => {
		const result = words("私はベクトル検索の仕組みを学びます。");

		expect(result).toContain("ベクトル");
		expect(result).toContain("検索");
		expect(result).toContain("仕組み");
		for (const particle of ["は", "の", "を", "ます"]) {
			expect(result).not.toContain(particle);
		}
	});

	it("keeps hiragana-only words longer than two characters", () => {
		expect(words("私のことば")).toContain("ことば");
	});

	it("keeps short words that contain katakana, kanji, Latin letters or digits", () => {
		const result = words("AI と DB と 猫 と 7");

		expect(result).toEqual(expect.arrayContaining(["ai", "db", "猫", "7"]));
	});

	it("handles mixed Japanese and alphanumeric text, lowercasing Latin letters", () => {
		const result = words("RAGとpgvectorの比較");

		expect(result).toEqual(["rag", "pgvector", "比較"]);
	});

	it("normalises full-width letters and digits (NFKC)", () => {
		expect(words("ＲＡＧ２０２６")).toEqual(["rag2026"]);
	});

	it("splits punctuation-joined tokens into plain words", () => {
		expect(words("v1.2 foo-bar")).toEqual(["v1", "2", "foo", "bar"]);
	});

	it("removes punctuation and operator characters", () => {
		expect(words("a & b | !c :d 'e' \"f\" (g) <h>")).toEqual([
			"a",
			"b",
			"c",
			"d",
			"e",
			"f",
			"g",
			"h",
		]);
	});

	it("keeps repeated words so term frequency survives", () => {
		expect(words("検索 検索 検索")).toEqual(["検索", "検索", "検索"]);
	});

	it("returns an empty string for empty, symbol-only and particle-only input", () => {
		expect(toSearchText("")).toBe("");
		expect(toSearchText("&|!:'\"()")).toBe("");
		expect(toSearchText("のをは")).toBe("");
	});
});

describe("buildFullTextQuery", () => {
	it("joins distinct words into an OR query", () => {
		expect(buildFullTextQuery("全文検索")).toBe("全文 | 検索");
	});

	it("removes duplicate words and keeps first-seen order", () => {
		expect(buildFullTextQuery("検索 ベクトル 検索")).toBe("検索 | ベクトル");
	});

	it("drops particles from the query", () => {
		expect(buildFullTextQuery("ベクトル検索の仕組みを学びます")).toBe(
			"ベクトル | 検索 | 仕組み | 学び",
		);
	});

	it("handles alphanumerics mixed with Japanese", () => {
		expect(buildFullTextQuery("RAGとpgvectorの比較")).toBe("rag | pgvector | 比較");
	});

	it("neutralises tsquery operator characters so only plain words remain", () => {
		const query = buildFullTextQuery("a & b | !c :d 'e' \"f\" (g) <-> h:* \\ ; --");

		expect(query).toBe("a | b | c | d | e | f | g | h");
		expect(query).toMatch(/^[\p{L}\p{N}]+(?: \| [\p{L}\p{N}]+)*$/u);
	});

	it("cannot smuggle an operator through full-width or decorated input", () => {
		const query = buildFullTextQuery("ａ＆ｂ｜！ｃ");

		expect(query).toMatch(/^[\p{L}\p{N}]+(?: \| [\p{L}\p{N}]+)*$/u);
	});

	it("returns undefined when only particles remain", () => {
		expect(buildFullTextQuery("のをは")).toBeUndefined();
		expect(buildFullTextQuery("ですます")).toBeUndefined();
	});

	it("returns undefined for empty, whitespace-only and symbol-only input", () => {
		expect(buildFullTextQuery("")).toBeUndefined();
		expect(buildFullTextQuery("   \n")).toBeUndefined();
		expect(buildFullTextQuery("& | ! : ' \"")).toBeUndefined();
	});
});
