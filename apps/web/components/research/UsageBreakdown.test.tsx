import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { type ResearchUsageData, UsageBreakdown } from "./UsageBreakdown";

afterEach(cleanup);

const USAGE: ResearchUsageData = {
	byRole: {
		supervisor: {
			inputTokens: 1000,
			outputTokens: 200,
			totalTokens: 1200,
			calls: 1,
			unknownCalls: 0,
		},
		search: { inputTokens: 300, outputTokens: 50, totalTokens: 350, calls: 2, unknownCalls: 0 },
		reading: "unknown",
		market: { inputTokens: 40, outputTokens: 10, totalTokens: 50, calls: 3, unknownCalls: 1 },
	},
	total: { inputTokens: 1340, outputTokens: 260, totalTokens: 1600 },
	calls: 5,
	maxCalls: 8,
};

function row(name: string): HTMLElement {
	const found = screen
		.getAllByRole("row")
		.find((r) => within(r).queryByRole("rowheader", { name }));
	if (!found) throw new Error(`no row for ${name}`);
	return found;
}

function cells(r: HTMLElement): string[] {
	return within(r)
		.getAllByRole("cell")
		.map((c) => c.textContent ?? "");
}

describe("UsageBreakdown", () => {
	it("shows a placeholder before any usage has arrived", () => {
		render(<UsageBreakdown usage={undefined} />);

		expect(screen.getByText("使用量はまだありません。")).toBeTruthy();
		expect(screen.queryByRole("table")).toBeNull();
	});

	it("shows the calls against the limit in a polite live region", () => {
		render(<UsageBreakdown usage={USAGE} />);

		const status = screen.getByRole("status");
		expect(status.textContent).toContain("5 / 8");
		expect(status.textContent).toContain("サブエージェント呼び出し");
	});

	it("shows tokens and calls for each role, named by agent", () => {
		render(<UsageBreakdown usage={USAGE} />);

		expect(screen.getByRole("table", { name: "役割別のトークン内訳" })).toBeTruthy();
		expect(cells(row("Supervisor"))).toEqual(["1000", "200", "1200", "1"]);
		expect(cells(row("検索"))).toEqual(["300", "50", "350", "2"]);
	});

	it("shows unknown for a role whose usage could not be read, not zero", () => {
		render(<UsageBreakdown usage={USAGE} />);

		const reading = row("読解");
		expect(reading.textContent).toContain("unknown");
		expect(within(reading).queryByText("0")).toBeNull();
		expect(cells(reading).at(-1)).toBe("不明");
	});

	it("notes calls without usage in a role that has some", () => {
		render(<UsageBreakdown usage={USAGE} />);

		expect(cells(row("市場"))).toEqual(["40", "10", "50", "3（うち使用量不明 1）"]);
	});

	it("shows the total as the server gave it, and says it counts known usage only", () => {
		render(<UsageBreakdown usage={USAGE} />);

		const total = row("合計");
		expect(cells(total).slice(0, 3)).toEqual(["1340", "260", "1600"]);
		expect(screen.getByText(/取得できた使用量のみ/)).toBeTruthy();
	});

	it("lists roles in the order supervisor, search, reading, market, then any other", () => {
		render(
			<UsageBreakdown
				usage={{
					...USAGE,
					byRole: {
						moderator: "unknown",
						market: "unknown",
						supervisor: "unknown",
						reading: "unknown",
						search: "unknown",
					},
				}}
			/>,
		);

		const names = screen.getAllByRole("rowheader").map((h) => h.textContent);
		expect(names).toEqual(["Supervisor", "検索", "読解", "市場", "moderator", "合計"]);
	});
});
