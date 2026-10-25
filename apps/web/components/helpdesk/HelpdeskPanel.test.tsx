import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { HelpdeskPanel, prepareHelpdeskRequest, selectHelpdeskView } from "./HelpdeskPanel";
import type { TicketSummary } from "./TicketList";

const chat = vi.hoisted(() => ({
	state: {
		messages: [] as unknown[],
		status: "ready" as string,
		error: undefined as Error | undefined,
	},
	sendMessage: vi.fn(async () => {}),
	stop: vi.fn(async () => {}),
	setMessages: vi.fn(),
	clearError: vi.fn(),
	onData: undefined as ((part: unknown) => void) | undefined,
}));

vi.mock("@ai-sdk/react", () => ({
	useChat: (options?: { onData?: (part: unknown) => void }) => {
		chat.onData = options?.onData;
		return {
			...chat.state,
			sendMessage: chat.sendMessage,
			stop: chat.stop,
			setMessages: chat.setMessages,
			clearError: chat.clearError,
		};
	},
}));

const CAPS = {
	tools: true,
	structuredOutput: true,
	reasoning: false,
	imageInput: false,
	embedding: false,
	promptCache: "none",
} as const;

const MODELS = [
	{
		id: "mock:general-v1",
		displayName: "Deterministic Mock Model",
		provider: "mock",
		contextWindow: 131072,
		capabilities: CAPS,
	},
] as const;

const TICKET: TicketSummary = {
	id: "T-0001",
	inquiry: "VPN に接続できません",
	status: "escalated",
	escalationReason: "根拠が見つかりませんでした。",
	stepsUsed: 3,
	createdAt: "2026-10-01T00:00:00.000Z",
	updatedAt: "2026-10-01T00:05:00.000Z",
};

type Initial = { tickets: readonly TicketSummary[] } | { message: string };

function Panel({
	initial = { tickets: [TICKET] },
	max = 4000,
}: {
	initial?: Initial;
	max?: number;
}) {
	return (
		<HelpdeskPanel
			models={MODELS}
			defaultModelId="mock:general-v1"
			initial={initial}
			inquiryMaxLength={max}
			examples={[
				{ label: "VPN", inquiry: "自宅から VPN に接続できません。" },
				{ label: "プリンター", inquiry: "共有プリンターを追加したいです。" },
			]}
		/>
	);
}

function renderPanel(props: Parameters<typeof Panel>[0] = {}) {
	const view = render(<Panel {...props} />);
	return { ...view, redraw: () => view.rerender(<Panel {...props} />) };
}

const assistant = (parts: unknown[], id = "a1") => ({ id, role: "assistant", parts });
const planPart = (revision: number, tasks: unknown[], diff?: unknown) => ({
	type: "data-helpdesk-plan",
	id: "plan",
	data: { revision, tasks, ...(diff ? { diff } : {}) },
});
const task = (id: string, description: string, state = "pending") => ({
	id,
	description,
	dependsOn: [],
	state,
});
const progressPart = (stepsUsed: number) => ({
	type: "data-helpdesk-progress",
	id: "progress",
	data: { stepsUsed, maxSteps: 8 },
});
const resultPart = (data: Record<string, unknown>, n = 1) => ({
	type: "data-helpdesk-result",
	id: `result-${n}`,
	data,
});

beforeAll(() => {
	// jsdom has no pointer capture or scrollIntoView, which Radix Select calls.
	Element.prototype.hasPointerCapture ??= () => false;
	Element.prototype.scrollIntoView ??= () => {};
});

beforeEach(() => {
	chat.state = { messages: [], status: "ready", error: undefined };
	chat.sendMessage.mockClear();
	chat.stop.mockClear();
	chat.setMessages.mockClear();
	chat.clearError.mockClear();
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => Response.json({ tickets: [] })),
	);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

function type(text: string) {
	fireEvent.change(screen.getByLabelText("問い合わせ"), { target: { value: text } });
}

describe("HelpdeskPanel input", () => {
	it("sends a trimmed inquiry with the model", () => {
		renderPanel();
		type("  VPN に接続できません  ");
		fireEvent.click(screen.getByRole("button", { name: "問い合わせる" }));
		expect(chat.sendMessage).toHaveBeenCalledWith(
			{ text: "VPN に接続できません" },
			{ body: { modelId: "mock:general-v1" } },
		);
	});

	it("disables sending for a blank inquiry", () => {
		renderPanel();
		expect(
			(screen.getByRole("button", { name: "問い合わせる" }) as HTMLButtonElement).disabled,
		).toBe(true);
		type("   ");
		expect(
			(screen.getByRole("button", { name: "問い合わせる" }) as HTMLButtonElement).disabled,
		).toBe(true);
	});

	it("accepts exactly the limit and rejects one character more", () => {
		renderPanel({ max: 10 });
		type("あ".repeat(10));
		expect(
			(screen.getByRole("button", { name: "問い合わせる" }) as HTMLButtonElement).disabled,
		).toBe(false);
		expect(screen.getByText("10 / 10 文字")).not.toBeNull();
		expect(screen.queryByRole("alert")).toBeNull();
		type("あ".repeat(11));
		expect(
			(screen.getByRole("button", { name: "問い合わせる" }) as HTMLButtonElement).disabled,
		).toBe(true);
		expect(screen.getByRole("alert").textContent).toContain(
			"問い合わせは 10 文字までです（現在 11 文字）",
		);
		expect(screen.getByLabelText("問い合わせ").getAttribute("aria-invalid")).toBe("true");
	});

	it("counts code points, not UTF-16 units", () => {
		renderPanel({ max: 3 });
		type("😀😀😀");
		expect(
			(screen.getByRole("button", { name: "問い合わせる" }) as HTMLButtonElement).disabled,
		).toBe(false);
	});

	it("does not submit an over-long inquiry with the form", () => {
		renderPanel({ max: 2 });
		type("あああ");
		fireEvent.submit(screen.getByLabelText("問い合わせ").closest("form") as HTMLFormElement);
		expect(chat.sendMessage).not.toHaveBeenCalled();
	});

	it("fills the input from an example without sending it", () => {
		renderPanel();
		fireEvent.click(screen.getByRole("button", { name: "プリンター" }));
		expect((screen.getByLabelText("問い合わせ") as HTMLTextAreaElement).value).toBe(
			"共有プリンターを追加したいです。",
		);
		expect(chat.sendMessage).not.toHaveBeenCalled();
	});

	it("shows a stop button only while generating and locks the form", () => {
		renderPanel();
		expect(screen.queryByRole("button", { name: "停止" })).toBeNull();
		cleanup();
		chat.state.status = "streaming";
		renderPanel();
		type("x");
		expect(
			(screen.getByRole("button", { name: "問い合わせる" }) as HTMLButtonElement).disabled,
		).toBe(true);
		fireEvent.click(screen.getByRole("button", { name: "停止" }));
		expect(chat.stop).toHaveBeenCalled();
	});

	it("clears the earlier run when a new inquiry is sent", () => {
		renderPanel();
		type("VPN の件");
		fireEvent.click(screen.getByRole("button", { name: "問い合わせる" }));
		expect(chat.setMessages).toHaveBeenCalledWith([]);
	});

	it("announces the run state in a polite live region and marks the result busy", () => {
		chat.state.status = "streaming";
		chat.state.messages = [assistant([planPart(1, [task("t1", "調べる", "running")])])];
		renderPanel();
		expect(screen.getByRole("status", { name: "実行の状態" }).getAttribute("aria-live")).toBe(
			"polite",
		);
		expect(screen.getByRole("region", { name: "実行結果" }).getAttribute("aria-busy")).toBe("true");
		for (const name of ["VPN", "プリンター"]) {
			expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
		}
	});

	it("builds the wire body from the newest user message", () => {
		const prepared = prepareHelpdeskRequest({
			id: "c1",
			messages: [
				{ id: "u0", role: "user", parts: [{ type: "text", text: "古い" }] },
				{ id: "u1", role: "user", parts: [{ type: "text", text: "新しい" }] },
			],
			body: { modelId: "mock:general-v1" },
		});
		expect(prepared).toEqual({
			api: "/api/helpdesk",
			body: { inquiry: "新しい", modelId: "mock:general-v1" },
		});
	});
});

describe("HelpdeskPanel streamed state", () => {
	it("folds the newest plan, progress and result parts", () => {
		const view = selectHelpdeskView([
			assistant([
				planPart(1, [task("t1", "調べる")]),
				progressPart(1),
				planPart(2, [task("t1", "調べる", "done")]),
				progressPart(2),
				resultPart({ ticketId: "T-9", status: "resolved", answer: "回答" }),
			]),
		] as never);
		expect(view.plan?.revision).toBe(2);
		expect(view.progress?.stepsUsed).toBe(2);
		expect(view.result?.ticketId).toBe("T-9");
	});

	it("renders the dashboard live during a run", () => {
		chat.state.status = "streaming";
		chat.state.messages = [
			assistant([planPart(1, [task("t1", "手順を調べる", "running")]), progressPart(1)]),
		];
		renderPanel();
		const dashboard = screen.getByRole("region", { name: "計画ダッシュボード" });
		expect(within(dashboard).getByText("手順を調べる")).not.toBeNull();
		expect(within(dashboard).getByText("1 / 8")).not.toBeNull();
		expect(screen.getByRole("status", { name: "実行の状態" }).textContent).toContain(
			"問い合わせを処理しています",
		);
	});

	const REPLAN_DIFF = { added: [], removed: [], changed: ["t2"] };

	/** Delivers data parts the way `useChat` does: one `onData` call per part, outside any render. */
	function deliver(...parts: unknown[]) {
		act(() => {
			for (const part of parts) chat.onData?.(part);
		});
	}

	it("pairs a replan with the tasks of the revision before it", () => {
		chat.state.status = "streaming";
		const rev0 = planPart(0, [task("t2", "古い説明")]);
		chat.state.messages = [assistant([rev0])];
		const view = renderPanel();
		deliver(rev0);
		const rev1 = planPart(1, [task("t2", "新しい説明")], REPLAN_DIFF);
		chat.state.messages = [assistant([rev1])];
		deliver(rev1);
		view.redraw();
		const changed = screen.getByRole("list", { name: "変更されたタスク" });
		expect(within(changed).getByText("古い説明")).not.toBeNull();
		expect(within(changed).getByText("新しい説明")).not.toBeNull();
	});

	it("shows the right before text when revisions 0 and 1 arrive before a single render", () => {
		chat.state.status = "streaming";
		const rev0 = planPart(0, [task("t2", "古い説明"), task("t3", "消える手順")]);
		const rev1 = planPart(1, [task("t2", "新しい説明")], {
			added: [],
			removed: ["t3"],
			changed: ["t2"],
		});
		chat.state.messages = [];
		const view = renderPanel();
		// Both parts are applied; the message only ever holds the newest one.
		deliver(rev0, rev1);
		chat.state.messages = [assistant([rev1])];
		view.redraw();
		const changed = screen.getByRole("list", { name: "変更されたタスク" });
		expect(within(changed).getByText("古い説明")).not.toBeNull();
		expect(within(changed).getByText("新しい説明")).not.toBeNull();
		const removed = screen.getByRole("list", { name: "削除されたタスク" });
		expect(within(removed).getByText("消える手順")).not.toBeNull();
	});

	it("pairs revision 2 with revision 1 when the screen never rendered revision 1", () => {
		chat.state.status = "streaming";
		const rev0 = planPart(0, [task("t2", "第0版の説明")]);
		const rev1 = planPart(1, [task("t2", "第1版の説明")], REPLAN_DIFF);
		const rev2 = planPart(2, [task("t2", "第2版の説明")], REPLAN_DIFF);
		chat.state.messages = [assistant([rev0])];
		const view = renderPanel();
		deliver(rev0, rev1, rev2);
		chat.state.messages = [assistant([rev2])];
		view.redraw();
		const changed = screen.getByRole("list", { name: "変更されたタスク" });
		expect(within(changed).getByText("第1版の説明")).not.toBeNull();
		expect(within(changed).getByText("第2版の説明")).not.toBeNull();
		expect(screen.queryByText("第0版の説明")).toBeNull();
	});

	it("shows ids only when the earlier revision is unknown, never another revision's text", () => {
		chat.state.status = "streaming";
		const rev0 = planPart(0, [task("t2", "第0版の説明")]);
		const rev2 = planPart(2, [task("t2", "第2版の説明")], REPLAN_DIFF);
		chat.state.messages = [];
		const view = renderPanel();
		deliver(rev0, rev2);
		chat.state.messages = [assistant([rev2])];
		view.redraw();
		const changed = screen.getByRole("list", { name: "変更されたタスク" });
		expect(within(changed).getByText("t2")).not.toBeNull();
		expect(within(changed).getByText("第2版の説明")).not.toBeNull();
		expect(screen.queryByText("第0版の説明")).toBeNull();
		expect(screen.queryByText("変更前:")).toBeNull();
	});

	it("forgets the earlier revisions when a new inquiry starts", () => {
		const rev0 = planPart(0, [task("t2", "古い説明")]);
		chat.state.messages = [assistant([rev0])];
		const view = renderPanel();
		deliver(rev0);
		type("次の問い合わせ");
		fireEvent.click(screen.getByRole("button", { name: "問い合わせる" }));
		// The new run's first part is revision 1 (a stale-looking jump); revision 0 must be gone.
		const rev1 = planPart(1, [task("t2", "別の説明")], REPLAN_DIFF);
		chat.state.messages = [assistant([rev1])];
		deliver(rev1);
		view.redraw();
		expect(screen.queryByText("古い説明")).toBeNull();
		expect(screen.getAllByText("別の説明").length).toBeGreaterThan(0);
	});

	it("shows the resolved answer", () => {
		chat.state.messages = [
			assistant([
				resultPart({ ticketId: "T-9", status: "resolved", answer: "手順は次のとおりです" }),
			]),
		];
		renderPanel();
		const result = screen.getByRole("region", { name: "最終結果" });
		expect(within(result).getByText("解決済み")).not.toBeNull();
		expect(within(result).getByText("手順は次のとおりです")).not.toBeNull();
		expect(screen.getByRole("status", { name: "実行の状態" }).textContent).toContain(
			"問い合わせの処理が完了しました",
		);
	});

	it("shows the escalation reason and the unfinished tasks", () => {
		chat.state.messages = [
			assistant([
				resultPart({
					ticketId: "T-9",
					status: "open",
					reason: "ステップ上限に達しました",
					remaining: ["t3", "t4"],
				}),
			]),
		];
		renderPanel();
		const result = screen.getByRole("region", { name: "最終結果" });
		expect(within(result).getByText("ステップ上限に達しました")).not.toBeNull();
		expect(within(result).getByText("t3")).not.toBeNull();
		expect(within(result).getByText("t4")).not.toBeNull();
	});

	it("shows credential kinds by kind only, never a value", () => {
		chat.state.messages = [
			assistant([
				resultPart({
					ticketId: "T-9",
					status: "escalated",
					reason: "認証情報を含むため対応できません",
					credentialKinds: ["plaintext-password", "api-key"],
				}),
			]),
		];
		renderPanel();
		const notice = screen.getByRole("note", { name: "検出された認証情報" });
		expect(within(notice).getByText("パスワード（平文）")).not.toBeNull();
		expect(within(notice).getByText("API キー")).not.toBeNull();
		expect(notice.textContent).toContain(
			"回答の下書きに認証情報の形をした文字列が見つかったため、担当者へエスカレーションしました（種別だけを表示し、値は表示しません）。",
		);
		expect(notice.textContent).not.toContain("問い合わせに");
	});

	it("says the answer was redrafted when a resolved ticket had a credential-shaped draft", () => {
		chat.state.messages = [
			assistant([
				resultPart({
					ticketId: "T-9",
					status: "resolved",
					answer: "再設定の手順です",
					credentialKinds: ["temporary-password"],
				}),
			]),
		];
		renderPanel();
		const notice = screen.getByRole("note", { name: "検出された認証情報" });
		expect(notice.textContent).toContain(
			"回答の下書きに認証情報の形をした文字列が見つかったため、回答を作り直しました（種別だけを表示し、値は表示しません）。",
		);
		expect(within(notice).getByText("仮パスワード")).not.toBeNull();
	});

	it("drops a credential kind outside the closed vocabulary", () => {
		chat.state.messages = [
			assistant([
				resultPart({
					ticketId: "T-9",
					status: "escalated",
					credentialKinds: ["hunter2-secret-value"],
				}),
			]),
		];
		renderPanel();
		expect(screen.queryByText(/hunter2/)).toBeNull();
		expect(screen.queryByRole("note", { name: "検出された認証情報" })).toBeNull();
	});

	it("shows an interrupted run when the stream stopped without a result", () => {
		chat.state.messages = [assistant([planPart(1, [task("t1", "調べる", "running")])])];
		renderPanel();
		expect(screen.getByRole("status", { name: "実行の状態" }).textContent).toContain(
			"生成を停止しました",
		);
	});

	it("shows the error banner and retries the same inquiry", () => {
		chat.state.messages = [assistant([planPart(1, [task("t1", "調べる")])])];
		chat.state.error = new Error(
			JSON.stringify({ error: { code: "rate-limited", message: "リクエストが多すぎます" } }),
		);
		const view = renderPanel();
		type("VPN の件");
		fireEvent.click(screen.getByRole("button", { name: "問い合わせる" }));
		chat.sendMessage.mockClear();
		view.redraw();
		expect(screen.getByRole("alert").textContent).toContain("リクエストが多すぎます");
		expect(screen.getByRole("status", { name: "実行の状態" }).textContent).toBe("");
		fireEvent.click(screen.getByRole("button", { name: "再送信" }));
		expect(chat.clearError).toHaveBeenCalled();
		expect(chat.sendMessage).toHaveBeenCalledWith(
			{ text: "VPN の件" },
			{ body: { modelId: "mock:general-v1" } },
		);
	});
});

describe("HelpdeskPanel tickets", () => {
	it("lists the initial tickets", () => {
		renderPanel();
		expect(screen.getByText("VPN に接続できません")).not.toBeNull();
	});

	it("shows the message when the tickets could not be loaded", () => {
		renderPanel({ initial: { message: "データベースに接続できません" } });
		expect(screen.getByRole("alert").textContent).toContain("データベースに接続できません");
		expect(screen.queryByRole("region", { name: "チケット一覧" })).toBeNull();
	});

	it("reloads the tickets when a run ends and attaches remaining to the matching ticket", async () => {
		const reloaded: TicketSummary[] = [
			{
				...TICKET,
				id: "T-0009",
				inquiry: "新しい問い合わせ",
				status: "open",
				stoppedReason: "step-limit",
			},
			TICKET,
		];
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json({ tickets: reloaded })),
		);
		chat.state.status = "streaming";
		chat.state.messages = [
			assistant([resultPart({ ticketId: "T-0009", status: "open", remaining: ["t5"] })]),
		];
		const view = renderPanel();
		chat.state.status = "ready";
		await act(async () => view.redraw());
		await waitFor(() => expect(screen.getByText("新しい問い合わせ")).not.toBeNull());
		expect(fetch).toHaveBeenCalledWith("/api/helpdesk/tickets");
		const item = screen.getByText("新しい問い合わせ").closest("li") as HTMLElement;
		expect(within(item).getByText("t5")).not.toBeNull();
		const other = screen.getByText("VPN に接続できません").closest("li") as HTMLElement;
		expect(within(other).queryByText("t5")).toBeNull();
	});

	it("keeps the current list when the reload fails", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json({ error: { code: "x", message: "x" } }, { status: 500 })),
		);
		chat.state.status = "streaming";
		const view = renderPanel();
		chat.state.status = "ready";
		await act(async () => view.redraw());
		expect(fetch).toHaveBeenCalled();
		expect(screen.getByText("VPN に接続できません")).not.toBeNull();
	});

	it("does not reload while idle", () => {
		renderPanel();
		expect(fetch).not.toHaveBeenCalled();
	});
});
