import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SummaryCard } from "./SummaryCard";

afterEach(cleanup);

const COMPLETE = {
	title: "Agentic AI 入門",
	keyPoints: ["目的を明確にする", "ツールを安全に使う", "評価で品質を確認する"],
	tags: ["AI", "agents"],
	actionItems: ["モックでテストする"],
};

function skeletons(container: HTMLElement): Element[] {
	return Array.from(container.querySelectorAll('[data-slot="skeleton"]'));
}

describe("SummaryCard", () => {
	it("shows skeletons for every field before anything is generated (Req 4.5)", () => {
		const { container } = render(<SummaryCard summary={undefined} generating />);

		expect(skeletons(container).length).toBeGreaterThanOrEqual(4);
		for (const skeleton of skeletons(container)) {
			expect(skeleton.getAttribute("aria-hidden")).toBe("true");
		}
		expect(container.querySelector("article")?.getAttribute("aria-busy")).toBe("true");
		expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
	});

	it("renders confirmed fields and keeps skeletons for the rest", () => {
		const { container } = render(
			<SummaryCard
				summary={{ title: "Agentic AI 入門", keyPoints: ["目的を明確にする"] }}
				generating
			/>,
		);

		expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Agentic AI 入門");
		const keyPoints = screen.getByRole("list", { name: "要点" });
		expect(keyPoints.querySelectorAll("li")).toHaveLength(3);
		expect(keyPoints.textContent).toContain("目的を明確にする");
		// two key points still pending + tags + action items
		expect(skeletons(keyPoints as HTMLElement)).toHaveLength(2);
		expect(skeletons(container).length).toBeGreaterThanOrEqual(4);
	});

	it("renders a streamed partial text as it is", () => {
		render(<SummaryCard summary={{ title: "Agentic", keyPoints: ["目的を明"] }} generating />);

		expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Agentic");
		expect(screen.getByText("目的を明")).toBeTruthy();
	});

	it("renders a complete summary without skeletons and clears the busy state", () => {
		const { container } = render(<SummaryCard summary={COMPLETE} generating={false} />);

		expect(skeletons(container)).toHaveLength(0);
		expect(container.querySelector("article")?.getAttribute("aria-busy")).toBe("false");
		expect(screen.getByRole("list", { name: "要点" }).querySelectorAll("li")).toHaveLength(3);
		expect(screen.getByRole("list", { name: "タグ" }).textContent).toContain("agents");
		expect(screen.getByRole("list", { name: "アクションアイテム" }).textContent).toContain(
			"モックでテストする",
		);
		expect(screen.queryByRole("list", { name: "チャプター" })).toBeNull();
	});

	it("says there are no action items when the finished list is empty", () => {
		render(<SummaryCard summary={{ ...COMPLETE, actionItems: [] }} generating={false} />);

		expect(screen.getByText("アクションアイテムはありません")).toBeTruthy();
	});

	it("shows an action-item skeleton, not the empty text, while the list is still pending", () => {
		render(<SummaryCard summary={{ title: "題" }} generating />);

		expect(screen.queryByText("アクションアイテムはありません")).toBeNull();
	});

	it("renders chapters with MM:SS start times when the summary has them (Req 4.10)", () => {
		render(
			<SummaryCard
				summary={{
					...COMPLETE,
					chapters: [
						{ heading: "導入", startSeconds: 0 },
						{ heading: "実装", startSeconds: 90 },
					],
				}}
				generating={false}
			/>,
		);

		const chapters = screen.getByRole("list", { name: "チャプター" });
		expect(Array.from(chapters.querySelectorAll("li")).map((li) => li.textContent)).toEqual([
			"00:00導入",
			"01:30実装",
		]);
	});

	it("labels the card by its title heading, or by a fixed name while the title is pending", () => {
		const { rerender, container } = render(<SummaryCard summary={undefined} generating />);
		const article = () => container.querySelector("article") as HTMLElement;
		expect(article().getAttribute("aria-label")).toBe("要約");

		rerender(<SummaryCard summary={COMPLETE} generating={false} />);
		const labelledBy = article().getAttribute("aria-labelledby");
		expect(labelledBy).toBeTruthy();
		expect(document.getElementById(labelledBy as string)?.textContent).toBe("Agentic AI 入門");
	});
});
