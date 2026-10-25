import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AgentInspector, type InspectorEvent } from "./AgentInspector";

afterEach(cleanup);

function event(over: Partial<InspectorEvent> & Pick<InspectorEvent, "agent" | "kind">) {
	return { id: "event-1", detail: {}, ...over } satisfies InspectorEvent;
}

function item(index: number): HTMLElement {
	return screen.getAllByRole("listitem")[index] as HTMLElement;
}

describe("AgentInspector", () => {
	it("says there is nothing yet, inside a polite live region", () => {
		render(<AgentInspector events={[]} />);

		expect(screen.getByText("イベントはまだありません。")).toBeTruthy();
		const log = screen.getByRole("log", { name: "Agent Inspector" });
		expect(log.getAttribute("aria-live")).toBe("polite");
	});

	it("labels each event with the agent it belongs to, so equal kinds stay distinguishable", () => {
		render(
			<AgentInspector
				events={[
					event({
						id: "event-1",
						agent: "reading",
						kind: "summary",
						detail: { text: "読解の要約" },
					}),
					event({
						id: "event-2",
						agent: "market",
						kind: "summary",
						detail: { text: "市場の要約" },
					}),
					event({
						id: "event-3",
						agent: "search",
						kind: "error",
						detail: { reason: "arXiv に届きません" },
					}),
					event({
						id: "event-4",
						agent: "supervisor",
						kind: "call",
						detail: { callee: "search", task: "探す" },
					}),
				]}
			/>,
		);

		expect(within(item(0)).getByText("読解")).toBeTruthy();
		expect(within(item(0)).getByText("要約")).toBeTruthy();
		expect(within(item(0)).getByText("読解の要約")).toBeTruthy();
		expect(item(0).getAttribute("data-agent")).toBe("reading");
		expect(within(item(1)).getByText("市場")).toBeTruthy();
		expect(within(item(1)).getByText("市場の要約")).toBeTruthy();
		expect(item(1).getAttribute("data-agent")).toBe("market");
		expect(within(item(2)).getByText("検索")).toBeTruthy();
		expect(within(item(2)).getByText("エラー")).toBeTruthy();
		expect(within(item(2)).getByText("エラー").className).toContain("destructive");
		expect(within(item(1)).getByText("要約").className).not.toContain("destructive");
		expect(within(item(2)).getByText("arXiv に届きません")).toBeTruthy();
		expect(within(item(3)).getByText("Supervisor")).toBeTruthy();
		expect(within(item(3)).getByText("呼び出し")).toBeTruthy();
		expect(within(item(3)).getByText(/に依頼/).textContent).toBe("検索 に依頼: 探す");
	});

	it("keeps the order the events arrived in", () => {
		render(
			<AgentInspector
				events={[
					event({
						id: "event-1",
						agent: "search",
						kind: "tool",
						detail: { name: "searchPapers", input: "q1" },
					}),
					event({
						id: "event-2",
						agent: "search",
						kind: "tool",
						detail: { name: "getPaperAbstract", input: "q2" },
					}),
				]}
			/>,
		);

		expect(item(0).textContent).toContain("searchPapers");
		expect(item(1).textContent).toContain("getPaperAbstract");
		expect(within(item(0)).getByText("ツール")).toBeTruthy();
		expect(within(item(0)).getByText("q1")).toBeTruthy();
	});

	it("draws a paper summary card with a link to arXiv", () => {
		render(
			<AgentInspector
				events={[
					event({
						agent: "search",
						kind: "card",
						detail: {
							arxivId: "2401.00001",
							title: "Agents in Practice",
							authors: ["A. Author", "B. Author"],
							publishedAt: "2024-01-02",
							url: "https://arxiv.org/abs/2401.00001",
						},
					}),
				]}
			/>,
		);

		const card = item(0);
		expect(within(card).getByText("論文")).toBeTruthy();
		const link = within(card).getByRole("link", { name: "Agents in Practice" });
		expect(link.getAttribute("href")).toBe("https://arxiv.org/abs/2401.00001");
		expect(link.getAttribute("rel")).toBe("noopener noreferrer");
		expect(card.textContent).toContain("2401.00001");
		expect(card.textContent).toContain("A. Author, B. Author");
		expect(card.textContent).toContain("2024-01-02");
	});

	it("shows the title without a link when the address is not an arXiv https address", () => {
		for (const url of [
			"javascript:alert(1)",
			"http://arxiv.org/abs/2401.00001",
			"https://evil.example/abs/1",
		]) {
			render(
				<AgentInspector
					events={[
						event({
							agent: "search",
							kind: "card",
							detail: { arxivId: "2401.00001", title: "Unsafe", url },
						}),
					]}
				/>,
			);

			expect(screen.queryByRole("link")).toBeNull();
			expect(screen.getByText("Unsafe")).toBeTruthy();
			cleanup();
		}
	});

	it("shows markup in a model-written field as text, never as elements", () => {
		const hostile = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
		const { container } = render(
			<AgentInspector
				events={[
					event({ id: "event-1", agent: "reading", kind: "summary", detail: { text: hostile } }),
					event({ id: "event-2", agent: "search", kind: "error", detail: { reason: hostile } }),
					event({
						id: "event-3",
						agent: "search",
						kind: "tool",
						detail: { name: hostile, input: hostile },
					}),
					event({
						id: "event-4",
						agent: "search",
						kind: "card",
						detail: { title: hostile, authors: [hostile] },
					}),
					event({
						id: "event-5",
						agent: "supervisor",
						kind: "call",
						detail: { callee: hostile, task: hostile },
					}),
				]}
			/>,
		);

		expect(container.querySelector("img, script")).toBeNull();
		expect(screen.getAllByText(hostile, { exact: false }).length).toBeGreaterThanOrEqual(5);
	});

	it("does not fail on an event whose detail lacks its fields", () => {
		render(
			<AgentInspector
				events={[
					event({ id: "event-1", agent: "search", kind: "card", detail: { title: 5 } }),
					event({ id: "event-2", agent: "reading", kind: "summary" }),
				]}
			/>,
		);

		expect(screen.getAllByRole("listitem")).toHaveLength(2);
	});
});
