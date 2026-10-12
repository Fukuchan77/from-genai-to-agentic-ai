import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SummaryPanel, selectSummaryView } from "./SummaryPanel";

// useChat is replaced so the test controls status, messages and errors without a network.
const chat = vi.hoisted(() => ({
	state: {
		messages: [] as unknown[],
		status: "ready" as string,
		error: undefined as Error | undefined,
	},
	sendMessage: vi.fn(async () => {}),
	regenerate: vi.fn(async () => {}),
	stop: vi.fn(async () => {}),
	setMessages: vi.fn(),
	clearError: vi.fn(),
	transportOptions: undefined as unknown,
}));

vi.mock("@ai-sdk/react", () => ({
	useChat: (options: { transport: unknown }) => {
		chat.transportOptions = options.transport;
		return {
			...chat.state,
			sendMessage: chat.sendMessage,
			regenerate: chat.regenerate,
			stop: chat.stop,
			setMessages: chat.setMessages,
			clearError: chat.clearError,
		};
	},
}));

const MODELS = [
	{
		id: "mock:general-v1",
		displayName: "Deterministic Mock Model",
		provider: "mock",
		contextWindow: 131072,
		capabilities: {
			tools: true,
			structuredOutput: true,
			reasoning: true,
			imageInput: true,
			embedding: false,
			promptCache: "none",
		},
	},
] as const;

const SUMMARY = {
	title: "Agentic AI 入門",
	keyPoints: ["目的を明確にする", "ツールを安全に使う", "評価で品質を確認する"],
	tags: ["AI"],
	actionItems: ["試す"],
};

function message(parts: unknown[]) {
	return { id: "a1", role: "assistant", parts };
}
const summaryPart = (attempt: number, data: unknown) => ({
	type: "data-summary",
	id: `summary-${attempt}`,
	data,
});
const restartPart = (attempt: number) => ({
	type: "data-summary-restart",
	id: `summary-restart-${attempt}`,
	data: { attempt, issues: ["keyPoints: 3 件必要です"] },
});
const metaPart = {
	type: "data-summary-meta",
	id: "summary-meta",
	data: {
		strategy: "whole",
		estimatedInputTokens: 100,
		actualInputTokens: 90,
		chunks: 1,
		attempts: 1,
	},
};

function renderPanel() {
	return render(<SummaryPanel models={MODELS} defaultModelId="mock:general-v1" />);
}

beforeAll(() => {
	Element.prototype.hasPointerCapture ??= () => false;
	Element.prototype.releasePointerCapture ??= () => {};
	Element.prototype.setPointerCapture ??= () => {};
	Element.prototype.scrollIntoView ??= () => {};
});

beforeEach(() => {
	chat.state.messages = [];
	chat.state.status = "ready";
	chat.state.error = undefined;
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("selectSummaryView", () => {
	it("returns the newest data-summary part of the active attempt", () => {
		const view = selectSummaryView([
			message([summaryPart(1, { title: "a" }), summaryPart(1, { title: "b" })]),
		] as never);
		expect(view).toMatchObject({ summary: { title: "b" }, restarted: false });
	});

	it("discards the provisional summary of an earlier attempt after a restart (Req 4.4)", () => {
		const view = selectSummaryView([
			message([summaryPart(1, { title: "old" }), restartPart(2)]),
		] as never);
		expect(view.summary).toBeUndefined();
		expect(view.restarted).toBe(true);

		const next = selectSummaryView([
			message([summaryPart(1, { title: "old" }), restartPart(2), summaryPart(2, { title: "new" })]),
		] as never);
		expect(next.summary).toEqual({ title: "new" });
	});

	it("reads only the newest assistant message and the meta part", () => {
		const view = selectSummaryView([
			message([summaryPart(1, { title: "first run" }), metaPart]),
			message([summaryPart(1, { title: "second run" })]),
		] as never);
		expect(view.summary).toEqual({ title: "second run" });
		expect(view.meta).toBeUndefined();
	});

	it("exposes the meta of the run", () => {
		const view = selectSummaryView([message([summaryPart(1, SUMMARY), metaPart])] as never);
		expect(view.meta).toMatchObject({ strategy: "whole", attempts: 1 });
	});
});

describe("SummaryPanel", () => {
	it("starts with the form and no result", () => {
		renderPanel();

		expect(screen.getByRole("button", { name: "要約する" })).toBeTruthy();
		expect(screen.queryByRole("article")).toBeNull();
	});

	it("sends the chosen input and model in the request body and clears the previous run", () => {
		renderPanel();

		fireEvent.click(screen.getByRole("radio", { name: "字幕テキスト" }));
		fireEvent.change(screen.getByLabelText("字幕テキストを貼り付け"), {
			target: { value: "字幕です" },
		});
		fireEvent.submit(screen.getByRole("button", { name: "要約する" }).closest("form") as Element);

		expect(chat.setMessages).toHaveBeenCalledWith([]);
		expect(chat.sendMessage).toHaveBeenCalledWith(
			{ text: expect.any(String) },
			{ body: { input: { kind: "transcript", text: "字幕です" }, modelId: "mock:general-v1" } },
		);
	});

	it("posts an article URL as kind article by default", () => {
		renderPanel();

		fireEvent.change(screen.getByLabelText("記事の URL（http / https）"), {
			target: { value: "https://example.test/a" },
		});
		fireEvent.submit(screen.getByRole("button", { name: "要約する" }).closest("form") as Element);

		expect(chat.sendMessage).toHaveBeenCalledWith(expect.anything(), {
			body: {
				input: { kind: "article", url: "https://example.test/a" },
				modelId: "mock:general-v1",
			},
		});
	});

	it("builds the request body for /api/summarize from the sendMessage body (no messages array)", async () => {
		renderPanel();
		const transport = chat.transportOptions as {
			prepareSendMessagesRequest: (options: unknown) => { body: Record<string, unknown> };
		};

		const prepared = transport.prepareSendMessagesRequest({
			id: "chat-1",
			messages: [{ id: "u", role: "user", parts: [] }],
			body: { input: { kind: "transcript", text: "x" }, modelId: "mock:general-v1" },
		});

		expect(prepared.body).toEqual({
			id: "chat-1",
			input: { kind: "transcript", text: "x" },
			modelId: "mock:general-v1",
		});
	});

	it("renders the partial summary with skeletons while streaming, and announces progress politely", () => {
		chat.state.status = "streaming";
		chat.state.messages = [message([summaryPart(1, { title: "Agentic", keyPoints: ["目的"] })])];
		const { container } = renderPanel();

		expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Agentic");
		expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
		const status = screen.getByRole("status");
		expect(status.getAttribute("aria-live")).toBe("polite");
		expect(status.textContent).toBe("要約を生成しています");
		expect(screen.getByRole("button", { name: "停止" })).toBeTruthy();
	});

	it("shows a loading status and skeletons while waiting for the first part", () => {
		chat.state.status = "submitted";
		const { container } = renderPanel();

		expect(screen.getByRole("status").textContent).toBe("要約を生成しています");
		expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
	});

	it("shows skeletons again after a restart until the new attempt's first part arrives", () => {
		chat.state.status = "streaming";
		chat.state.messages = [message([summaryPart(1, { title: "古い暫定" }), restartPart(2)])];
		renderPanel();

		expect(screen.queryByText("古い暫定")).toBeNull();
		expect(screen.getByRole("status").textContent).toBe(
			"出力が検証に通らなかったため、もう一度生成しています",
		);
	});

	it("shows the finished summary with the meta panel and a done status", () => {
		chat.state.messages = [message([summaryPart(1, SUMMARY), metaPart])];
		const { container } = renderPanel();

		expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Agentic AI 入門");
		expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(0);
		expect(screen.getByRole("region", { name: "要約の処理情報" })).toBeTruthy();
		expect(screen.getByRole("status").textContent).toBe("要約が完了しました");
		expect(screen.queryByRole("button", { name: "停止" })).toBeNull();
	});

	it("stops the stream from the stop button", () => {
		chat.state.status = "streaming";
		renderPanel();

		fireEvent.click(screen.getByRole("button", { name: "停止" }));

		expect(chat.stop).toHaveBeenCalledTimes(1);
	});

	it("shows the reason for a 422 source error and no summary card", () => {
		chat.state.error = new Error(
			JSON.stringify({
				error: {
					code: "source-unavailable",
					message: "記事を取得できませんでした（HTTP ステータス 404）。",
					details: { reason: "http-status", status: 404 },
				},
			}),
		);
		renderPanel();

		const alert = screen.getByRole("alert");
		expect(alert.textContent).toContain("記事のサーバーがエラーを返しました。");
		expect(alert.textContent).toContain("HTTP ステータス 404");
		expect(screen.queryByRole("article")).toBeNull();
	});

	it("shows other errors through the error banner and retries the same request", () => {
		chat.state.error = new Error(
			JSON.stringify({
				code: "output-invalid",
				message: "要約がスキーマ検証に 3 回失敗しました。",
			}),
		);
		renderPanel();
		fireEvent.change(screen.getByLabelText("記事の URL（http / https）"), {
			target: { value: "https://example.test/a" },
		});
		fireEvent.submit(screen.getByRole("button", { name: "要約する" }).closest("form") as Element);

		expect(screen.getByRole("alert").textContent).toContain(
			"要約がスキーマ検証に 3 回失敗しました。",
		);
		fireEvent.click(screen.getByRole("button", { name: "再送信" }));

		expect(chat.clearError).toHaveBeenCalled();
		expect(chat.regenerate).toHaveBeenCalledWith({
			body: {
				input: { kind: "article", url: "https://example.test/a" },
				modelId: "mock:general-v1",
			},
		});
	});

	it("keeps a failed summary's provisional card out of view once an error is shown", () => {
		chat.state.messages = [message([summaryPart(1, { title: "暫定の題" })])];
		chat.state.error = new Error(
			JSON.stringify({
				code: "output-invalid",
				message: "要約がスキーマ検証に 3 回失敗しました。",
			}),
		);
		renderPanel();

		expect(screen.queryByText("暫定の題")).toBeNull();
	});
});

describe("SummaryPanel stopped run", () => {
	it("labels a stopped run's partial card as provisional", () => {
		chat.state.status = "ready";
		chat.state.messages = [message([summaryPart(1, { title: "途中" })])];
		renderPanel();

		expect(screen.getByRole("status").textContent).toBe(
			"生成を停止しました。表示は途中までの暫定です",
		);
	});
});
