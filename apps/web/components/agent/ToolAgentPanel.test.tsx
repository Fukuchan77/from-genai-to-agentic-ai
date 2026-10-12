import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ToolAgentPanel } from "./ToolAgentPanel";

// useChat is replaced so the test controls status and messages without a network.
const chat = vi.hoisted(() => ({
	state: {
		messages: [] as unknown[],
		status: "ready" as string,
		error: undefined as Error | undefined,
	},
	options: undefined as { transport?: unknown } | undefined,
	sendMessage: vi.fn(async () => {}),
	stop: vi.fn(async () => {}),
	regenerate: vi.fn(async () => {}),
	clearError: vi.fn(),
}));

vi.mock("@ai-sdk/react", () => ({
	useChat: (options: { transport?: unknown }) => {
		chat.options = options;
		return {
			...chat.state,
			sendMessage: chat.sendMessage,
			stop: chat.stop,
			regenerate: chat.regenerate,
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
const PERSONAS = [{ id: "general-assistant", title: "汎用アシスタント" }] as const;

const RUN = {
	stopReason: "completed",
	steps: 2,
	totalTokens: { input: 10, output: 4, cacheRead: 0, reasoning: 0 },
	elapsedMs: 120,
	toolsCalled: ["weather"],
	error: undefined,
};

const METADATA = {
	modelId: "mock:general-v1",
	modelName: "Deterministic Mock Model",
	provider: "mock",
	personaId: "general-assistant",
	personaVersion: "1",
	disabledTools: [
		{ name: "webSearch", reason: "必要な設定が未設定です。", requiredEnv: ["FROM_SERVER_ONLY"] },
	],
};

function renderPanel() {
	return render(
		<ToolAgentPanel
			models={MODELS}
			defaultModelId="mock:general-v1"
			personas={PERSONAS}
			defaultPersonaId="general-assistant"
		/>,
	);
}

beforeAll(() => {
	Element.prototype.hasPointerCapture ??= () => false;
	Element.prototype.releasePointerCapture ??= () => {};
	Element.prototype.setPointerCapture ??= () => {};
	Element.prototype.scrollIntoView ??= () => {};
});

beforeEach(() => {
	chat.state = { messages: [], status: "ready", error: undefined };
	chat.options = undefined;
	vi.clearAllMocks();
});
afterEach(cleanup);

describe("ToolAgentPanel", () => {
	it("posts to the agent route with the selected model and persona (Req 5.1)", () => {
		renderPanel();
		expect(((chat.options?.transport ?? {}) as { api?: string }).api).toBe("/api/agent/tools");

		fireEvent.change(screen.getByLabelText("メッセージ"), { target: { value: "東京の天気" } });
		fireEvent.click(screen.getByRole("button", { name: "送信" }));

		expect(chat.sendMessage).toHaveBeenCalledWith(
			{ text: "東京の天気" },
			{ body: { modelId: "mock:general-v1", personaId: "general-assistant" } },
		);
	});

	it("draws tool parts between the text around them, with the run summary and disabled notice", () => {
		chat.state.messages = [
			{ id: "u1", role: "user", parts: [{ type: "text", text: "東京の天気" }] },
			{
				id: "a1",
				role: "assistant",
				metadata: { ...METADATA, run: RUN },
				parts: [
					{ type: "text", text: "調べます。" },
					{
						type: "tool-weather",
						toolCallId: "c1",
						state: "output-available",
						input: { city: "Tokyo" },
						output: { ok: true, data: { cityLabel: "東京", condition: "快晴", temperatureC: 22 } },
					},
					{ type: "text", text: "東京は快晴です。" },
				],
			},
		];
		renderPanel();

		const log = screen.getByRole("log", { name: "会話" });
		const order = ["調べます。", "22°C", "東京は快晴です。"].map((text) =>
			log.textContent?.indexOf(text),
		);
		expect(order).toEqual([...order].sort((a, b) => (a ?? 0) - (b ?? 0)));
		expect(within(log).getByRole("region", { name: "天気" })).toBeTruthy();
		expect(within(log).getByRole("status", { name: "実行サマリ" })).toBeTruthy();
		expect(screen.getByText("FROM_SERVER_ONLY")).toBeTruthy();
	});

	it("shows an interrupted display when a finished answer has no run summary", () => {
		chat.state.messages = [
			{ id: "u1", role: "user", parts: [{ type: "text", text: "x" }] },
			{ id: "a1", role: "assistant", parts: [{ type: "text", text: "途中" }] },
		];
		renderPanel();

		expect(screen.getByText("中断")).toBeTruthy();
	});

	it("shows an error display for the last answer when the request failed", () => {
		chat.state.error = new Error(JSON.stringify({ code: "unexpected", message: "失敗しました。" }));
		chat.state.messages = [
			{ id: "u1", role: "user", parts: [{ type: "text", text: "x" }] },
			{ id: "a1", role: "assistant", parts: [{ type: "text", text: "途中" }] },
		];
		renderPanel();

		expect(screen.getByRole("status", { name: "実行サマリ" }).textContent).toContain("エラー");
		expect(screen.getByRole("alert").textContent).toContain("失敗しました。");
	});

	it("hides the run summary of the answer that is still streaming and offers stop (Req 6.3)", () => {
		chat.state.status = "streaming";
		chat.state.messages = [
			{ id: "u1", role: "user", parts: [{ type: "text", text: "x" }] },
			{ id: "a1", role: "assistant", parts: [{ type: "text", text: "途中" }] },
		];
		renderPanel();

		expect(screen.queryByRole("status", { name: "実行サマリ" })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "停止" }));
		expect(chat.stop).toHaveBeenCalledTimes(1);
	});
});
