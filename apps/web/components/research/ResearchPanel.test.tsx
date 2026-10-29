import { M3_4_SAMPLE_THEMES } from "@platform/ai-core/mock";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	EXAMPLE_THEMES,
	prepareResearchRequest,
	ResearchPanel,
	selectResearchView,
} from "./ResearchPanel";

// useChat is replaced so the test controls status, messages and errors without a network.
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
	transportOptions: undefined as unknown,
}));

vi.mock("@ai-sdk/react", () => ({
	useChat: (options: { transport: unknown }) => {
		chat.transportOptions = options.transport;
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

function renderPanel(overrides: { themeMaxLength?: number; defaultModelId?: string } = {}) {
	return render(
		<ResearchPanel
			models={MODELS}
			defaultModelId={overrides.defaultModelId ?? "mock:general-v1"}
			themeMaxLength={overrides.themeMaxLength ?? 500}
			calls={{ min: 1, max: 20, default: 8 }}
		/>,
	);
}

const user = (text: string, id = "u1") => ({ id, role: "user", parts: [{ type: "text", text }] });
const message = (parts: unknown[], id = "a1") => ({ id, role: "assistant", parts });
const eventPart = (kind: string, agent: string, detail: unknown, id = "event-1") => ({
	type: "data-research-event",
	id,
	data: { agent, kind, detail },
});
const usageData = (calls: number) => ({
	byRole: {
		supervisor: { inputTokens: 10, outputTokens: 5, totalTokens: 15, calls: 1, unknownCalls: 0 },
	},
	total: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
	calls,
	maxCalls: 8,
});
const usagePart = (calls: number) => ({
	type: "data-research-usage",
	id: "usage",
	data: usageData(calls),
});
const resultPart = (report: string) => ({
	type: "data-research-result",
	id: "result",
	data: { report, warnings: [], missing: [{ agent: "reading", reason: "精読に失敗" }] },
});

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

const themeBox = () => screen.getByLabelText(/^テーマ/) as HTMLTextAreaElement;
const callsBox = () => screen.getByLabelText(/呼び出し回数の上限/) as HTMLInputElement;
const sendButton = () => screen.getByRole("button", { name: "リサーチする" }) as HTMLButtonElement;

function enterTheme(text: string) {
	fireEvent.change(themeBox(), { target: { value: text } });
}
function submit() {
	fireEvent.submit(sendButton().closest("form") as Element);
}

describe("selectResearchView", () => {
	it("is empty before any message", () => {
		expect(selectResearchView([])).toEqual({ events: [], usage: undefined, result: undefined });
	});

	it("keeps the events in arrival order with an incrementing id", () => {
		const view = selectResearchView([
			message([
				eventPart("call", "supervisor", { callee: "search", task: "a" }, "event-1"),
				eventPart("call", "search", { task: "b" }, "event-2"),
				eventPart("error", "search", { reason: "c" }, "event-3"),
			]),
		] as never);

		expect(view.events.map((event) => [event.id, event.agent, event.kind])).toEqual([
			["event-1", "supervisor", "call"],
			["event-2", "search", "call"],
			["event-3", "search", "error"],
		]);
	});

	it("keeps only the latest usage and the latest result", () => {
		const view = selectResearchView([
			message([usagePart(1), resultPart("古い"), usagePart(3), resultPart("新しい")]),
		] as never);

		expect(view.usage?.calls).toBe(3);
		expect(view.result?.report).toBe("新しい");
	});

	it("reads only the newest assistant message and ignores unknown parts", () => {
		const view = selectResearchView([
			message([usagePart(1)], "a1"),
			user("次のテーマ", "u2"),
			message(
				[
					{ type: "text", text: "x" },
					{ type: "data-other", data: {} },
				],
				"a2",
			),
		] as never);

		expect(view).toEqual({ events: [], usage: undefined, result: undefined });
	});
});

describe("prepareResearchRequest", () => {
	it("builds the strict /api/research body from the newest user message", () => {
		const request = prepareResearchRequest({
			messages: [user("古い", "u1"), user("新しい", "u2")] as never,
			body: { modelId: "mock:general-v1", maxSubagentCalls: 5 },
		});

		expect(request).toEqual({
			api: "/api/research",
			body: { theme: "新しい", modelId: "mock:general-v1", maxSubagentCalls: 5 },
		});
	});

	it("is the transport's request builder", () => {
		renderPanel();
		const transport = chat.transportOptions as { api: string };

		expect(transport.api).toBe("/api/research");
	});
});

describe("ResearchPanel form", () => {
	it("starts with a disabled send and no result area", () => {
		renderPanel();

		expect(sendButton().disabled).toBe(true);
		expect(screen.queryByRole("region", { name: "リサーチ結果" })).toBeNull();
		expect(screen.queryByRole("button", { name: "停止" })).toBeNull();
	});

	it("sends the trimmed theme with the model and the default call limit, clearing the previous run", () => {
		renderPanel();

		enterTheme("  階層型エージェントの最新動向 ");
		submit();

		expect(chat.setMessages).toHaveBeenCalledWith([]);
		expect(chat.sendMessage).toHaveBeenCalledWith(
			{ text: "階層型エージェントの最新動向" },
			{ body: { modelId: "mock:general-v1", maxSubagentCalls: 8 } },
		);
	});

	it("sends the call limit the learner chose", () => {
		renderPanel();

		fireEvent.change(callsBox(), { target: { value: "3" } });
		enterTheme("テーマ");
		submit();

		expect(chat.sendMessage).toHaveBeenCalledWith(
			{ text: "テーマ" },
			{ body: { modelId: "mock:general-v1", maxSubagentCalls: 3 } },
		);
	});

	it("accepts the limits of the call range and refuses one beyond them", () => {
		renderPanel();
		enterTheme("テーマ");

		for (const [value, ok] of [
			["1", true],
			["20", true],
			["0", false],
			["21", false],
			["2.5", false],
			["", false],
		] as const) {
			fireEvent.change(callsBox(), { target: { value } });
			expect(sendButton().disabled).toBe(!ok);
			expect(callsBox().getAttribute("aria-invalid")).toBe(ok ? "false" : "true");
		}
		expect(callsBox().getAttribute("min")).toBe("1");
		expect(callsBox().getAttribute("max")).toBe("20");
	});

	it("explains a call limit out of range", () => {
		renderPanel();

		fireEvent.change(callsBox(), { target: { value: "21" } });

		expect(screen.getByRole("alert").textContent).toContain("1〜20");
	});

	it("does not send a blank theme", () => {
		renderPanel();

		enterTheme("   ");
		submit();

		expect(sendButton().disabled).toBe(true);
		expect(chat.sendMessage).not.toHaveBeenCalled();
	});

	it("allows a theme of exactly the limit and refuses one character more, counting characters", () => {
		renderPanel({ themeMaxLength: 5 });

		enterTheme("😀😀😀😀😀");
		expect(sendButton().disabled).toBe(false);
		expect(screen.getByText("5 / 5 文字")).toBeTruthy();

		enterTheme("😀😀😀😀😀😀");
		expect(sendButton().disabled).toBe(true);
		expect(themeBox().getAttribute("aria-invalid")).toBe("true");
		expect(screen.getByRole("alert").textContent).toContain("5 文字まで");
		expect(screen.getByRole("alert").textContent).toContain("現在 6 文字");
		submit();
		expect(chat.sendMessage).not.toHaveBeenCalled();
	});

	it("uses the 500-character limit from the page", () => {
		renderPanel();

		enterTheme("あ".repeat(500));
		expect(sendButton().disabled).toBe(false);
		enterTheme("あ".repeat(501));
		expect(sendButton().disabled).toBe(true);
	});

	it("does not send a second run while the first is still running", () => {
		chat.state.status = "streaming";
		renderPanel();

		enterTheme("テーマ");
		submit();

		expect(sendButton().disabled).toBe(true);
		expect(chat.sendMessage).not.toHaveBeenCalled();
	});

	it("locks the inputs while generating and offers stop", () => {
		chat.state.status = "streaming";
		renderPanel();

		expect(themeBox().disabled).toBe(true);
		expect(callsBox().disabled).toBe(true);
		fireEvent.click(screen.getByRole("button", { name: "停止" }));
		expect(chat.stop).toHaveBeenCalled();
	});
});

describe("ResearchPanel examples", () => {
	it("offers example themes that match the mock scenarios", () => {
		expect(EXAMPLE_THEMES).toEqual([M3_4_SAMPLE_THEMES.default, M3_4_SAMPLE_THEMES.partialFailure]);
	});

	it("fills the theme from an example without sending it", () => {
		renderPanel();

		fireEvent.click(screen.getByRole("button", { name: M3_4_SAMPLE_THEMES.partialFailure }));

		expect(themeBox().value).toBe(M3_4_SAMPLE_THEMES.partialFailure);
		expect(chat.sendMessage).not.toHaveBeenCalled();
	});
});

describe("ResearchPanel result", () => {
	it("shows the inspector events, the usage and the report", () => {
		chat.state.status = "ready";
		chat.state.messages = [
			user("テーマ"),
			message([
				eventPart("call", "supervisor", { callee: "search", task: "探す" }, "event-1"),
				usagePart(2),
				resultPart("# 調査結果\n\n本文です。"),
			]),
		];
		renderPanel();
		enterTheme("テーマ");
		submit();

		const region = screen.getByRole("region", { name: "リサーチ結果" });
		expect(within(region).getByRole("log", { name: "Agent Inspector" })).toBeTruthy();
		expect(within(region).getByRole("heading", { name: "調査結果" })).toBeTruthy();
		expect(within(region).getByText("本文です。")).toBeTruthy();
		expect(within(region).getByText(/精読に失敗/)).toBeTruthy();
		expect(within(region).getByText("サブエージェント呼び出し: 2 / 8")).toBeTruthy();
	});

	it("shows the events before the report exists", () => {
		chat.state.status = "streaming";
		chat.state.messages = [
			user("テーマ"),
			message([eventPart("call", "supervisor", { callee: "search", task: "探す" })]),
		];
		renderPanel();

		const region = screen.getByRole("region", { name: "リサーチ結果" });
		expect(region.getAttribute("aria-busy")).toBe("true");
		expect(within(region).getByRole("log", { name: "Agent Inspector" }).textContent).toContain(
			"探す",
		);
	});

	it("announces the run politely", () => {
		chat.state.status = "streaming";
		chat.state.messages = [user("テーマ"), message([])];
		renderPanel();

		const status = screen.getByRole("status", { name: "実行の状態" });
		expect(status.getAttribute("aria-live")).toBe("polite");
		expect(status.textContent).toContain("リサーチを実行しています");
	});

	it("announces completion once the report arrived", () => {
		chat.state.messages = [user("テーマ"), message([resultPart("本文")])];
		renderPanel();

		expect(screen.getByRole("status", { name: "実行の状態" }).textContent).toContain(
			"リサーチが完了しました",
		);
	});

	it("says the display is partial when the stream stopped without a report", () => {
		chat.state.messages = [user("テーマ"), message([usagePart(1)])];
		renderPanel();

		expect(screen.getByRole("status", { name: "実行の状態" }).textContent).toContain(
			"停止しました",
		);
	});

	it("says nothing in the status line while an error is shown", () => {
		chat.state.error = new Error(JSON.stringify({ error: { code: "x", message: "失敗" } }));
		chat.state.messages = [user("テーマ"), message([usagePart(1)])];
		renderPanel();

		expect(screen.getByRole("status", { name: "実行の状態" }).textContent).toBe("");
	});

	it("falls back to the first model when the default is not offered", () => {
		renderPanel({ defaultModelId: "mock:gone" });

		enterTheme("テーマ");
		submit();

		expect(chat.sendMessage).toHaveBeenCalledWith(
			{ text: "テーマ" },
			{ body: { modelId: "mock:general-v1", maxSubagentCalls: 8 } },
		);
	});

	it("shows the error and sends the same theme and limit again on retry", () => {
		chat.state.error = new Error(
			JSON.stringify({ error: { code: "provider-unavailable", message: "実行に失敗しました。" } }),
		);
		renderPanel();
		fireEvent.change(callsBox(), { target: { value: "4" } });
		enterTheme("もう一度");
		submit();
		chat.sendMessage.mockClear();

		expect(screen.getByRole("alert").textContent).toContain("実行に失敗しました。");
		fireEvent.click(screen.getByRole("button", { name: "再送信" }));

		expect(chat.clearError).toHaveBeenCalled();
		expect(chat.sendMessage).toHaveBeenCalledWith(
			{ text: "もう一度" },
			{ body: { modelId: "mock:general-v1", maxSubagentCalls: 4 } },
		);
	});
});
