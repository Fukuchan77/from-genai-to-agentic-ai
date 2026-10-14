import type { Citation } from "@platform/ai-core/rag";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CitationList } from "./CitationList";

afterEach(cleanup);

const BASE: Citation = {
	chunkId: "c1",
	label: 1,
	documentId: "d1",
	documentTitle: "エージェント設計ガイド",
	locator: { kind: "heading", path: ["第 2 章", "ツール設計"] },
	excerpt: "ツールの説明は具体的に書く。",
	cited: true,
};

const CITATIONS: Citation[] = [
	{ ...BASE, similarity: 0.8234 },
	{
		...BASE,
		chunkId: "c2",
		label: 2,
		documentId: "d2",
		documentTitle: "運用マニュアル.pdf",
		locator: { kind: "page", page: 7 },
		excerpt: "停止条件を必ず設定する。",
		cited: false,
	},
];

function cards() {
	return within(screen.getByRole("list", { name: "引用" })).getAllByRole("listitem");
}

describe("CitationList", () => {
	it("draws one card per citation in retrieval order with title, locator and excerpt", () => {
		render(<CitationList citations={CITATIONS} />);

		const [first, second] = cards();
		expect(cards()).toHaveLength(2);
		expect(within(first as HTMLElement).getByText("[1]")).toBeTruthy();
		expect(within(first as HTMLElement).getByText("エージェント設計ガイド")).toBeTruthy();
		expect(within(first as HTMLElement).getByText("第 2 章 › ツール設計")).toBeTruthy();
		expect(within(first as HTMLElement).getByText("ツールの説明は具体的に書く。")).toBeTruthy();
		expect(within(second as HTMLElement).getByText("運用マニュアル.pdf")).toBeTruthy();
		expect(within(second as HTMLElement).getByText("ページ 7")).toBeTruthy();
	});

	it("tells cited and retrieved-only cards apart with text, not colour alone", () => {
		render(<CitationList citations={CITATIONS} />);

		const [first, second] = cards();
		expect(within(first as HTMLElement).getByText("引用あり")).toBeTruthy();
		expect(within(first as HTMLElement).queryByText("取得のみ")).toBeNull();
		expect(within(second as HTMLElement).getByText("取得のみ")).toBeTruthy();
		expect(within(second as HTMLElement).queryByText("引用あり")).toBeNull();
	});

	it("shows the similarity when the citation has one", () => {
		render(<CitationList citations={CITATIONS} />);

		const [first, second] = cards();
		expect(within(first as HTMLElement).getByText("類似度 0.82")).toBeTruthy();
		expect(within(second as HTMLElement).queryByText(/類似度/)).toBeNull();
	});

	it("gives each card a focusable target id built from the prefix and the label", () => {
		render(<CitationList citations={CITATIONS} idPrefix="rag-a" />);

		const [first, second] = cards();
		expect((first as HTMLElement).id).toBe("rag-a-1");
		expect((second as HTMLElement).id).toBe("rag-a-2");
		expect((first as HTMLElement).getAttribute("tabindex")).toBe("-1");
	});

	it("notifies which out-of-range footnotes the server removed", () => {
		render(<CitationList citations={CITATIONS} removedCitations={[7, 9]} />);

		const note = screen.getByRole("status", { name: "除去された脚注" });
		expect(note.textContent).toContain("[7]");
		expect(note.textContent).toContain("[9]");
		expect(note.textContent).toContain("除去");
	});

	it("shows no removal notice when nothing was removed", () => {
		render(<CitationList citations={CITATIONS} removedCitations={[]} />);

		expect(screen.queryByRole("status", { name: "除去された脚注" })).toBeNull();
	});

	it("says there is nothing to cite when the list is empty", () => {
		render(<CitationList citations={[]} />);

		expect(screen.queryByRole("list", { name: "引用" })).toBeNull();
		expect(screen.getByText("引用できる文書はありません。")).toBeTruthy();
	});
});
