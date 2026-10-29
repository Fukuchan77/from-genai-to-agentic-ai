import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TicketList, type TicketSummary } from "./TicketList";

afterEach(cleanup);

const RESOLVED: TicketSummary = {
	id: "T-0001",
	inquiry: "VPN に接続できません",
	status: "resolved",
	answer: "接続設定の手順に従って再設定してください。",
	stepsUsed: 4,
	createdAt: "2026-10-01T00:00:00.000Z",
	updatedAt: "2026-10-01T00:05:00.000Z",
};
const ESCALATED: TicketSummary = {
	id: "T-0002",
	inquiry: "経費精算の承認が止まっています",
	status: "escalated",
	escalationReason: "ナレッジに根拠が見つからなかったため、解決できませんでした。",
	stepsUsed: 3,
	createdAt: "2026-10-02T00:00:00.000Z",
	updatedAt: "2026-10-02T00:03:00.000Z",
};
const STEP_LIMIT: TicketSummary = {
	id: "T-0003",
	inquiry: "新しい端末の設定手順を知りたい",
	status: "open",
	stoppedReason: "step-limit",
	stepsUsed: 8,
	createdAt: "2026-10-03T00:00:00.000Z",
	updatedAt: "2026-10-03T00:09:00.000Z",
};

function items() {
	return within(screen.getByRole("list", { name: "チケット" })).getAllByRole("listitem");
}

describe("TicketList", () => {
	it("is a polite live region so a screen reader hears a new or changed ticket", () => {
		render(<TicketList tickets={[RESOLVED]} />);

		expect(screen.getByRole("region", { name: "チケット一覧" }).getAttribute("aria-live")).toBe(
			"polite",
		);
	});

	it("says so when there are no tickets, and draws no list", () => {
		render(<TicketList tickets={[]} />);

		expect(screen.getByText("チケットはまだありません")).toBeTruthy();
		expect(screen.queryByRole("list", { name: "チケット" })).toBeNull();
	});

	it("keeps the order it was given (newest first)", () => {
		render(<TicketList tickets={[STEP_LIMIT, ESCALATED, RESOLVED]} />);

		expect(items().map((item) => item.getAttribute("data-ticket-id"))).toEqual([
			"T-0003",
			"T-0002",
			"T-0001",
		]);
	});

	it("shows the id, the inquiry and the steps used of every ticket", () => {
		render(<TicketList tickets={[RESOLVED]} />);

		const [item] = items();
		expect(item?.textContent).toContain("T-0001");
		expect(item?.textContent).toContain("VPN に接続できません");
		expect(item?.textContent).toContain("4 ステップ");
	});

	it("shows the answer of a resolved ticket", () => {
		render(<TicketList tickets={[RESOLVED]} />);

		const [item] = items();
		expect(item?.textContent).toContain("解決済み");
		expect(item?.textContent).toContain("回答");
		expect(item?.textContent).toContain("接続設定の手順に従って再設定してください。");
	});

	it("shows why an escalated ticket was not solved", () => {
		render(<TicketList tickets={[ESCALATED]} />);

		const [item] = items();
		expect(item?.textContent).toContain("エスカレーション");
		expect(item?.textContent).toContain("未解決の理由");
		expect(item?.textContent).toContain(
			"ナレッジに根拠が見つからなかったため、解決できませんでした。",
		);
		expect(item?.textContent).not.toContain("回答");
	});

	it("shows an open ticket stopped by the step limit as unfinished", () => {
		render(<TicketList tickets={[STEP_LIMIT]} />);

		const [item] = items();
		expect(item?.textContent).toContain("未完了");
		expect(item?.textContent).toContain("ステップ上限に達したため、実行を止めました");
		expect(item?.textContent).toContain("8 ステップ");
		expect(item?.textContent).not.toContain("未解決の理由");
	});

	it("draws no stop notice for a ticket that has an outcome", () => {
		render(<TicketList tickets={[RESOLVED, ESCALATED]} />);

		// Each item holds its inquiry and one outcome paragraph, and nothing else.
		for (const item of items()) expect(item.querySelectorAll("p")).toHaveLength(2);
	});

	it("shows an open ticket that was aborted as unfinished", () => {
		render(<TicketList tickets={[{ ...STEP_LIMIT, stoppedReason: "aborted" }]} />);

		expect(items()[0]?.textContent).toContain("中断されたため、実行を止めました");
	});

	it("lists the tasks that did not finish when the step limit was reached", () => {
		render(<TicketList tickets={[{ ...STEP_LIMIT, remaining: ["t3", "t4"] }]} />);

		const remaining = screen.getByRole("list", { name: "未完了のタスク" });
		expect(
			within(remaining)
				.getAllByRole("listitem")
				.map((item) => item.textContent),
		).toEqual(["t3", "t4"]);
	});

	it("draws no unfinished-task list when none is known or none remains", () => {
		render(<TicketList tickets={[STEP_LIMIT, { ...ESCALATED, remaining: [] }]} />);

		expect(screen.queryByRole("list", { name: "未完了のタスク" })).toBeNull();
	});

	it("labels the status of every ticket", () => {
		render(<TicketList tickets={[STEP_LIMIT, ESCALATED, RESOLVED]} />);

		expect(items().map((item) => item.getAttribute("data-status"))).toEqual([
			"open",
			"escalated",
			"resolved",
		]);
	});

	it("shows when the ticket was last updated, as a machine-readable time", () => {
		render(<TicketList tickets={[RESOLVED]} />);

		const time = items()[0]?.querySelector("time");
		expect(time?.getAttribute("datetime")).toBe("2026-10-01T00:05:00.000Z");
		expect(time?.textContent).toContain("2026");
	});

	it("shows the raw value when a date cannot be read", () => {
		render(<TicketList tickets={[{ ...RESOLVED, updatedAt: "not-a-date" }]} />);

		expect(items()[0]?.querySelector("time")?.textContent).toBe("not-a-date");
	});

	it("renders a markup-like answer as text, not as markup", () => {
		render(<TicketList tickets={[{ ...RESOLVED, answer: '<img src="x" alt="y"><b>太字</b>' }]} />);

		expect(items()[0]?.querySelector("img")).toBeNull();
		expect(items()[0]?.querySelector("b")).toBeNull();
		expect(items()[0]?.textContent).toContain('<img src="x" alt="y"><b>太字</b>');
	});

	it("shows a newly arrived ticket when the list is updated", () => {
		const { rerender } = render(<TicketList tickets={[RESOLVED]} />);

		rerender(<TicketList tickets={[STEP_LIMIT, RESOLVED]} />);

		expect(items()).toHaveLength(2);
	});
});
