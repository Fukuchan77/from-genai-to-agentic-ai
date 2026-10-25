import type { McpServerStatus } from "@platform/ai-core/mcp";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { McpPanel, type McpPanelProps } from "./McpPanel";

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

const SERVERS: readonly McpServerStatus[] = [
	{
		id: "files",
		state: "connected",
		tools: [
			{ name: "listFiles", risk: "read-only", registered: true },
			{ name: "readFile", risk: "read-only", registered: true },
			{
				name: "writeFile",
				risk: "write",
				registered: false,
				disabledReason: "書き込みのツールは承認ゲートが実装されるまで読み込みません。",
			},
		],
	},
] as unknown as readonly McpServerStatus[];

const EXAMPLES = {
	listAndRead: "許可ルートのファイルを一覧して、いちばん上のファイルの内容を教えてください。",
	outsideRoot: "許可ルートの外にある /etc/hosts を読んで、内容を教えてください。",
};

const FATAL_MESSAGE =
	"許可されたルート（/srv/mcp-root）の外のパスにはアクセスできません。実行を終了しました。";

const RUN = {
	stopReason: "completed",
	steps: 3,
	totalTokens: { input: 10, output: 4, cacheRead: 0, reasoning: 0 },
	elapsedMs: 120,
	toolsCalled: ["listFiles"],
	error: undefined,
};

function renderPanel(overrides: Partial<McpPanelProps> = {}) {
	return render(
		<McpPanel
			models={MODELS}
			defaultModelId="mock:general-v1"
			initialServers={SERVERS}
			maxTools={20}
			thinkEnabled={true}
			examples={[
				{ label: "一覧して読む", text: EXAMPLES.listAndRead },
				{ label: "許可ルートの外を読む", text: EXAMPLES.outsideRoot },
			]}
			{...overrides}
		/>,
	);
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
	return new Response(JSON.stringify(body), {
		headers: { "content-type": "application/json" },
		...init,
	});
}

const fetchMock = vi.fn();

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
	fetchMock.mockReset();
	vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe("McpPanel chat", () => {
	it("posts to the MCP chat route with the model, the allow-list and the think switch (Req 1.3)", () => {
		renderPanel();
		expect(((chat.options?.transport ?? {}) as { api?: string }).api).toBe("/api/mcp/chat");

		fireEvent.change(screen.getByLabelText("メッセージ"), { target: { value: "調べて" } });
		fireEvent.click(screen.getByRole("button", { name: "送信" }));

		expect(chat.sendMessage).toHaveBeenCalledWith(
			{ text: "調べて" },
			{
				body: {
					modelId: "mock:general-v1",
					allow: { files: ["listFiles", "readFile"] },
					think: true,
				},
			},
		);
	});

	it("does not send an empty message", () => {
		renderPanel();
		expect(screen.getByRole<HTMLButtonElement>("button", { name: "送信" }).disabled).toBe(true);
		fireEvent.change(screen.getByLabelText("メッセージ"), { target: { value: "   " } });
		expect(screen.getByRole<HTMLButtonElement>("button", { name: "送信" }).disabled).toBe(true);
	});

	it("sends the allow-list the learner narrowed to", () => {
		renderPanel();
		fireEvent.click(screen.getByRole("checkbox", { name: "readFile" }));
		fireEvent.change(screen.getByLabelText("メッセージ"), { target: { value: "x" } });
		fireEvent.click(screen.getByRole("button", { name: "送信" }));

		expect(chat.sendMessage).toHaveBeenCalledWith(
			{ text: "x" },
			{ body: expect.objectContaining({ allow: { files: ["listFiles"] } }) },
		);
	});

	it("draws the answer with its tool calls in order and the run summary", () => {
		chat.state.messages = [
			{ id: "u1", role: "user", parts: [{ type: "text", text: "一覧して" }] },
			{
				id: "a1",
				role: "assistant",
				metadata: { run: RUN },
				parts: [
					{ type: "text", text: "調べます。" },
					{
						type: "tool-listFiles",
						toolCallId: "c1",
						state: "output-available",
						input: {},
						output: { ok: true, data: { files: ["README.md"] } },
					},
					{ type: "text", text: "READMEがありました。" },
				],
			},
		];
		renderPanel();

		const log = screen.getByRole("log", { name: "会話" });
		const order = ["調べます。", "listFiles", "READMEがありました。"].map((text) =>
			log.textContent?.indexOf(text),
		);
		expect(order).toEqual([...order].sort((a, b) => (a ?? 0) - (b ?? 0)));
		expect(within(log).getByRole("status", { name: "実行サマリ" }).textContent).toContain("完了");
	});

	it("shows the stop reason error with the learner's message and the allowed path (Req 1.10)", () => {
		chat.state.messages = [
			{ id: "u1", role: "user", parts: [{ type: "text", text: "x" }] },
			{
				id: "a1",
				role: "assistant",
				metadata: {
					run: {
						...RUN,
						stopReason: "error",
						error: { code: "tool-fatal", message: FATAL_MESSAGE },
					},
				},
				parts: [{ type: "text", text: "" }],
			},
		];
		renderPanel();

		const summary = screen.getByRole("status", { name: "実行サマリ" });
		expect(summary.textContent).toContain("エラー");
		expect(summary.textContent).toContain("/srv/mcp-root");
		const notice = screen.getByRole("alert");
		expect(notice.textContent).toContain(FATAL_MESSAGE);
		expect(notice.textContent).toContain("tool-fatal");
	});

	it("shows no error notice for a run that completed", () => {
		chat.state.messages = [
			{ id: "u1", role: "user", parts: [{ type: "text", text: "x" }] },
			{
				id: "a1",
				role: "assistant",
				metadata: { run: RUN },
				parts: [{ type: "text", text: "ok" }],
			},
		];
		renderPanel();
		expect(screen.queryByRole("alert")).toBeNull();
	});

	it("shows the request error with a retry that keeps the learner's settings", () => {
		chat.state.error = new Error(JSON.stringify({ code: "unexpected", message: "失敗しました。" }));
		renderPanel();

		expect(screen.getByRole("alert").textContent).toContain("失敗しました。");
		fireEvent.click(screen.getByRole("button", { name: "再送信" }));
		expect(chat.clearError).toHaveBeenCalled();
		expect(chat.regenerate).toHaveBeenCalledWith({
			body: {
				modelId: "mock:general-v1",
				allow: { files: ["listFiles", "readFile"] },
				think: true,
			},
		});
	});

	it("offers stop while generating and announces the wait", () => {
		chat.state.status = "streaming";
		renderPanel();
		fireEvent.click(screen.getByRole("button", { name: "停止" }));
		expect(chat.stop).toHaveBeenCalledTimes(1);
		expect(screen.getByText("エージェントが実行しています")).toBeTruthy();
		expect(screen.getByRole<HTMLButtonElement>("button", { name: "送信" }).disabled).toBe(true);
	});

	it("locks the tool settings while a run is in progress", () => {
		chat.state.status = "streaming";
		renderPanel();
		expect(screen.getByRole<HTMLInputElement>("checkbox", { name: /思考ツール/ }).disabled).toBe(
			true,
		);
		expect(screen.getByRole<HTMLInputElement>("checkbox", { name: "readFile" }).disabled).toBe(
			true,
		);
	});

	it("hides the run summary of the answer that is still streaming", () => {
		chat.state.status = "streaming";
		chat.state.messages = [
			{ id: "u1", role: "user", parts: [{ type: "text", text: "x" }] },
			{ id: "a1", role: "assistant", parts: [{ type: "text", text: "途中" }] },
		];
		renderPanel();
		expect(screen.queryByRole("status", { name: "実行サマリ" })).toBeNull();
	});
});

describe("McpPanel think tool", () => {
	it("switches the think tool and counts it against the tool limit (Req 1.15)", () => {
		renderPanel();
		const think = screen.getByRole<HTMLInputElement>("checkbox", { name: /思考ツール/ });
		expect(think.checked).toBe(true);
		expect(screen.getByText(/選択中 3 \/ 20 個/)).toBeTruthy();

		fireEvent.click(think);
		expect(think.checked).toBe(false);
		expect(screen.getByText(/選択中 2 \/ 20 個/)).toBeTruthy();

		fireEvent.change(screen.getByLabelText("メッセージ"), { target: { value: "x" } });
		fireEvent.click(screen.getByRole("button", { name: "送信" }));
		expect(chat.sendMessage).toHaveBeenCalledWith(
			{ text: "x" },
			{ body: expect.objectContaining({ think: false }) },
		);
	});

	it("starts with the think tool off when the server reports it disabled", () => {
		renderPanel({ thinkEnabled: false });
		expect(screen.getByRole<HTMLInputElement>("checkbox", { name: /思考ツール/ }).checked).toBe(
			false,
		);
	});

	it("keeps the default allow-list within the limit when the think tool takes a slot", () => {
		const many = {
			id: "files",
			state: "connected",
			tools: Array.from({ length: 20 }, (_, index) => ({
				name: `tool${index}`,
				risk: "read-only",
				registered: true,
			})),
		} as unknown as McpServerStatus;
		renderPanel({ initialServers: [many] });
		expect(screen.getByText(/選択中 20 \/ 20 個/)).toBeTruthy();
	});
});

describe("McpPanel examples", () => {
	it("fills the message box with the example sentence for the mock scenarios", () => {
		renderPanel();
		const box = screen.getByLabelText<HTMLTextAreaElement>("メッセージ");

		fireEvent.click(screen.getByRole("button", { name: "一覧して読む" }));
		expect(box.value).toBe(EXAMPLES.listAndRead);

		fireEvent.click(screen.getByRole("button", { name: "許可ルートの外を読む" }));
		expect(box.value).toBe(EXAMPLES.outsideRoot);
	});

	it("does not send an example by itself", () => {
		renderPanel();
		fireEvent.click(screen.getByRole("button", { name: "一覧して読む" }));
		expect(chat.sendMessage).not.toHaveBeenCalled();
	});

	it("shows no example section without examples", () => {
		renderPanel({ examples: [] });
		expect(screen.queryByText("入力例")).toBeNull();
	});
});

describe("McpPanel server status", () => {
	it("shows the servers the page loaded", () => {
		renderPanel();
		const status = screen.getByRole("region", { name: "MCP サーバーの状態" });
		expect(within(status).getByText("接続済み")).toBeTruthy();
		expect(
			within(status).getByText("書き込みのツールは承認ゲートが実装されるまで読み込みません。"),
		).toBeTruthy();
	});

	it("fetches the state again on request and shows the new state (Req 1.10)", async () => {
		fetchMock.mockResolvedValueOnce(
			jsonResponse({
				servers: [{ id: "files", state: "unavailable", reason: "接続が切れました。", tools: [] }],
				limits: { maxTools: 20 },
				think: { enabled: true },
			}),
		);
		renderPanel();
		fireEvent.click(screen.getByRole("button", { name: "状態を更新" }));

		await screen.findByText(/接続が切れました。/);
		expect(fetchMock).toHaveBeenCalledWith("/api/mcp/servers", expect.anything());
		expect(screen.getByText("利用不可")).toBeTruthy();
	});

	it("says the refresh failed and keeps the previous state", async () => {
		fetchMock.mockResolvedValueOnce(
			jsonResponse(
				{ error: { code: "unexpected", message: "状態を取得できません。" } },
				{ status: 500 },
			),
		);
		renderPanel();
		fireEvent.click(screen.getByRole("button", { name: "状態を更新" }));

		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toContain("状態を取得できません。");
		expect(screen.getByText("接続済み")).toBeTruthy();
	});

	it("says the refresh failed when the network is down", async () => {
		fetchMock.mockRejectedValueOnce(new TypeError("fetch failed to https://secret.example"));
		renderPanel();
		fireEvent.click(screen.getByRole("button", { name: "状態を更新" }));

		const alert = await screen.findByRole("alert");
		expect(alert.textContent).not.toContain("secret.example");
		expect(alert.textContent).toContain("サーバーの状態を取得できませんでした");
	});

	it("prefers a state fetched after the last answer over the answer's metadata", async () => {
		chat.state.messages = [
			{ id: "u1", role: "user", parts: [{ type: "text", text: "x" }] },
			{
				id: "a1",
				role: "assistant",
				metadata: {
					run: RUN,
					mcp: [{ id: "files", state: "unavailable", reason: "切断されました。", tools: [] }],
				},
				parts: [{ type: "text", text: "ok" }],
			},
		];
		fetchMock.mockResolvedValueOnce(
			jsonResponse({
				servers: [{ id: "files", state: "connected", tools: [] }],
				limits: { maxTools: 20 },
				think: { enabled: true },
			}),
		);
		renderPanel();
		fireEvent.click(screen.getByRole("button", { name: "状態を更新" }));

		await screen.findByText("接続済み");
		expect(screen.queryByText("利用不可")).toBeNull();
	});

	it("disables the refresh button while a run is generating (F-16)", () => {
		chat.state.status = "streaming";
		renderPanel();
		expect(screen.getByRole<HTMLButtonElement>("button", { name: "状態を更新" }).disabled).toBe(
			true,
		);
	});

	it("keeps the finish metadata of a run that ended after a refresh began (Req 1.10, F-16)", async () => {
		const first = {
			id: "a1",
			role: "assistant",
			metadata: { run: RUN, mcp: SERVERS },
			parts: [{ type: "text", text: "ok" }],
		};
		chat.state.messages = [{ id: "u1", role: "user", parts: [{ type: "text", text: "x" }] }, first];
		let resolve: (response: Response) => void = () => {};
		fetchMock.mockReturnValueOnce(new Promise<Response>((r) => (resolve = r)));
		const view = renderPanel();
		fireEvent.click(screen.getByRole("button", { name: "状態を更新" }));

		// A regenerated run replaces the answer (same message count, new id) and its server dropped.
		chat.state.messages = [
			{ id: "u1", role: "user", parts: [{ type: "text", text: "x" }] },
			{
				id: "a2",
				role: "assistant",
				metadata: {
					run: RUN,
					mcp: [{ id: "files", state: "unavailable", reason: "切断されました。", tools: [] }],
				},
				parts: [{ type: "text", text: "done" }],
			},
		];
		view.rerender(
			<McpPanel
				models={MODELS}
				defaultModelId="mock:general-v1"
				initialServers={SERVERS}
				maxTools={20}
				thinkEnabled={true}
				examples={[]}
			/>,
		);
		resolve(
			jsonResponse({
				servers: [{ id: "files", state: "connected", tools: [] }],
				limits: { maxTools: 20 },
				think: { enabled: true },
			}),
		);

		await waitFor(() =>
			expect(screen.getByRole<HTMLButtonElement>("button", { name: "状態を更新" }).disabled).toBe(
				false,
			),
		);
		expect(screen.getByText("利用不可")).toBeTruthy();
	});

	it("takes the servers' state from the answer's finish metadata", () => {
		chat.state.messages = [
			{ id: "u1", role: "user", parts: [{ type: "text", text: "x" }] },
			{
				id: "a1",
				role: "assistant",
				metadata: {
					run: RUN,
					mcp: [{ id: "files", state: "unavailable", reason: "切断されました。", tools: [] }],
				},
				parts: [{ type: "text", text: "ok" }],
			},
		];
		renderPanel();
		const status = screen.getByRole("region", { name: "MCP サーバーの状態" });
		expect(within(status).getByText("利用不可")).toBeTruthy();
		expect(within(status).getByText(/切断されました。/)).toBeTruthy();
	});
});

describe("McpPanel comparison", () => {
	const RESULT = {
		highLevel: {
			steps: 2,
			tokens: 890,
			stopReason: "completed",
			toolsCalled: ["findAndReadFiles"],
		},
		lowLevel: {
			steps: 3,
			tokens: 1500,
			stopReason: "completed",
			toolsCalled: ["searchFiles", "readFile"],
		},
		comparison: { steps: 1, tokens: 610, ratio: 0.59 },
	};

	it("runs the comparison through the compare route and shows the result", async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse(RESULT));
		renderPanel();
		fireEvent.click(screen.getByRole("button", { name: "比較を実行" }));

		await screen.findByText(/比率（高水準 ÷ 低レベル）: 0.59/);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("/api/mcp/compare");
		expect(init.method).toBe("POST");
		expect(JSON.parse(String(init.body))).toEqual({
			task: "list-and-read",
			modelId: "mock:general-v1",
		});
	});

	it("holds the button back while running and announces the wait", async () => {
		let resolve: (response: Response) => void = () => {};
		fetchMock.mockReturnValueOnce(new Promise<Response>((r) => (resolve = r)));
		renderPanel();
		fireEvent.click(screen.getByRole("button", { name: "比較を実行" }));

		await screen.findByText(/比較を実行しています/);
		expect(screen.getByRole<HTMLButtonElement>("button", { name: "比較を実行" }).disabled).toBe(
			true,
		);
		resolve(jsonResponse(RESULT));
		await screen.findByText(/比率（高水準 ÷ 低レベル）/);
		expect(screen.getByRole<HTMLButtonElement>("button", { name: "比較を実行" }).disabled).toBe(
			false,
		);
	});

	it("shows the server's error message when the comparison is rejected", async () => {
		fetchMock.mockResolvedValueOnce(
			jsonResponse(
				{
					error: {
						code: "provider-unavailable",
						message: "比較に使うファイルサーバーに接続できていません。",
					},
				},
				{ status: 503 },
			),
		);
		renderPanel();
		fireEvent.click(screen.getByRole("button", { name: "比較を実行" }));

		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toContain("比較に使うファイルサーバーに接続できていません。");
	});

	it("shows the failed side of a comparison that did not finish", async () => {
		fetchMock.mockResolvedValueOnce(
			jsonResponse({
				...RESULT,
				lowLevel: { ...RESULT.lowLevel, stopReason: "step-limit", failed: true },
			}),
		);
		renderPanel();
		fireEvent.click(screen.getByRole("button", { name: "比較を実行" }));

		await screen.findByText("低レベルの実行は完了しませんでした");
		await waitFor(() => expect(screen.queryByText(/比率（高水準/)).toBeNull());
	});

	it("does not hide a network failure behind raw error text", async () => {
		fetchMock.mockRejectedValueOnce(new TypeError("fetch failed to https://secret.example"));
		renderPanel();
		fireEvent.click(screen.getByRole("button", { name: "比較を実行" }));

		const alert = await screen.findByRole("alert");
		expect(alert.textContent).not.toContain("secret.example");
	});
});
