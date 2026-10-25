import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RequirementsPreview, type RequirementsPreviewData } from "./RequirementsPreview";

afterEach(cleanup);

const FULL: RequirementsPreviewData = {
	functional: [
		{ text: "在庫を一覧で見られる", personaId: "clerk" },
		{ text: "CSV で出力できる", personaId: "manager" },
	],
	nonFunctional: [{ text: "表示は 2 秒以内", personaId: "clerk" }],
	constraints: [{ text: "予算は 100 万円まで", personaId: "manager" }],
	unconfirmed: [{ text: "連携する会計システム", personaId: "manager" }],
};

const NAMES = { clerk: "現場担当者", manager: "管理者" };

function category(name: string) {
	return screen.getByRole("region", { name });
}

describe("RequirementsPreview", () => {
	it("is a polite live region so each update is announced", () => {
		render(<RequirementsPreview requirements={FULL} />);

		const preview = screen.getByRole("region", { name: "要件プレビュー" });
		expect(preview.getAttribute("aria-live")).toBe("polite");
		expect(preview.getAttribute("aria-relevant")).toBe("additions text");
	});

	it("tells the learner nothing has been extracted before the first answer", () => {
		render(<RequirementsPreview requirements={null} />);

		expect(screen.getByText(/まだ要件はありません/)).toBeTruthy();
		expect(screen.queryByRole("region", { name: "機能要件" })).toBeNull();
	});

	it("shows the four categories with their items", () => {
		render(<RequirementsPreview requirements={FULL} />);

		const functional = within(category("機能要件")).getAllByRole("listitem");
		expect(functional.map((item) => item.textContent)).toEqual([
			expect.stringContaining("在庫を一覧で見られる"),
			expect.stringContaining("CSV で出力できる"),
		]);
		expect(within(category("非機能要件")).getByText(/表示は 2 秒以内/)).toBeTruthy();
		expect(within(category("制約")).getByText(/予算は 100 万円まで/)).toBeTruthy();
		expect(within(category("未確認事項")).getByText(/連携する会計システム/)).toBeTruthy();
	});

	it("counts the items of each category in its heading", () => {
		render(<RequirementsPreview requirements={FULL} />);

		expect(within(category("機能要件")).getByRole("heading").textContent).toContain("2 件");
		expect(within(category("制約")).getByRole("heading").textContent).toContain("1 件");
	});

	it("says a category is still empty instead of drawing an empty list", () => {
		render(<RequirementsPreview requirements={{ ...FULL, constraints: [], unconfirmed: [] }} />);

		const constraints = category("制約");
		expect(within(constraints).getByText("まだありません")).toBeTruthy();
		expect(within(constraints).queryByRole("list")).toBeNull();
		expect(within(constraints).getByRole("heading").textContent).toContain("0 件");
	});

	it("names the persona each item came from, falling back to the id", () => {
		render(<RequirementsPreview requirements={FULL} personaNames={NAMES} />);

		const [first] = within(category("機能要件")).getAllByRole("listitem");
		expect(first?.textContent).toContain("出所: 現場担当者");

		cleanup();
		render(<RequirementsPreview requirements={FULL} personaNames={{ manager: "管理者" }} />);
		const [fallback] = within(category("機能要件")).getAllByRole("listitem");
		expect(fallback?.textContent).toContain("出所: clerk");
	});

	it("reflects a later answer: the new item appears and the old ones stay", () => {
		const { rerender } = render(<RequirementsPreview requirements={FULL} />);
		expect(screen.queryByText(/承認フローがある/)).toBeNull();

		rerender(
			<RequirementsPreview
				requirements={{
					...FULL,
					functional: [...FULL.functional, { text: "承認フローがある", personaId: "manager" }],
				}}
				round={2}
			/>,
		);

		const items = within(category("機能要件")).getAllByRole("listitem");
		expect(items).toHaveLength(3);
		expect(items[2]?.textContent).toContain("承認フローがある");
		expect(within(category("機能要件")).getByRole("heading").textContent).toContain("3 件");
	});

	it("announces which round's answers the preview now reflects", () => {
		const { rerender } = render(<RequirementsPreview requirements={FULL} />);
		expect(screen.queryByText(/ラウンドの回答を反映/)).toBeNull();

		rerender(<RequirementsPreview requirements={FULL} round={2} />);

		const note = screen.getByText(/第 2 ラウンドの回答を反映/);
		expect(screen.getByRole("region", { name: "要件プレビュー" }).contains(note)).toBe(true);
	});

	it("renders item text as plain text, never as markup", () => {
		const { container } = render(
			<RequirementsPreview
				requirements={{
					...FULL,
					functional: [{ text: "<img src=x onerror=alert(1)>", personaId: "clerk" }],
				}}
			/>,
		);

		expect(container.querySelector("img")).toBeNull();
		expect(within(category("機能要件")).getByText(/<img src=x/)).toBeTruthy();
	});
});
