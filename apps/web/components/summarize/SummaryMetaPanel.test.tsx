import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SummaryMetaPanel, type SummaryMetaView } from "./SummaryMetaPanel";

afterEach(cleanup);

const whole: SummaryMetaView = {
	strategy: "whole",
	estimatedInputTokens: 12_345,
	actualInputTokens: 11_900,
	chunks: 1,
	cacheReadTokens: 4_000,
	attempts: 1,
};

/** The value shown next to a label of the definition list. */
function valueFor(label: string): string | null | undefined {
	return screen.getByText(label).nextElementSibling?.textContent;
}

describe("SummaryMetaPanel", () => {
	it("shows the whole-input strategy, estimated and measured input tokens, cache reads and regenerations (Req 4.8, 4.12)", () => {
		render(<SummaryMetaPanel meta={whole} />);

		expect(valueFor("処理方式")).toBe("全文を一度に入力");
		expect(valueFor("入力トークン（推定）")).toBe("12,345");
		expect(valueFor("入力トークン（実測）")).toBe("11,900");
		expect(valueFor("キャッシュ読み出し")).toBe("4,000 トークン");
		expect(valueFor("再生成回数")).toBe("0 回");
	});

	it("shows the number of chunks for a staged summary and counts regenerations as attempts - 1", () => {
		render(<SummaryMetaPanel meta={{ ...whole, strategy: "staged", chunks: 4, attempts: 3 }} />);

		expect(valueFor("処理方式")).toBe("分割して段階的に要約（4 分割）");
		expect(valueFor("再生成回数")).toBe("2 回");
	});

	it("says so when the provider reported no measured tokens or no cache reads", () => {
		const { actualInputTokens: _a, cacheReadTokens: _c, ...rest } = whole;
		render(<SummaryMetaPanel meta={rest} />);

		expect(valueFor("入力トークン（実測）")).toBe("取得できませんでした");
		expect(valueFor("キャッシュ読み出し")).toBe("記録なし");
	});

	it("shows a cache read of zero as a recorded value", () => {
		render(<SummaryMetaPanel meta={{ ...whole, cacheReadTokens: 0 }} />);

		expect(valueFor("キャッシュ読み出し")).toBe("0 トークン");
	});

	it("is a labelled region", () => {
		render(<SummaryMetaPanel meta={whole} />);

		expect(screen.getByRole("region", { name: "要約の処理情報" })).toBeTruthy();
	});
});
