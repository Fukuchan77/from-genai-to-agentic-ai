import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnalysisPanel, type AnalysisPanelProps, selectAnalysisView } from "./AnalysisPanel";

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
	transport: undefined as
		| {
				sendMessages: (options: object) => Promise<unknown>;
		  }
		| undefined,
}));

vi.mock("@ai-sdk/react", () => ({
	useChat: (options: { transport: (typeof chat)["transport"] }) => {
		chat.transport = options.transport;
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

const UPLOAD = { maxBytes: 20 * 1024 * 1024, accepts: [".csv", ".xlsx", ".xls"] } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function props(overrides: Partial<AnalysisPanelProps> = {}): AnalysisPanelProps {
	return {
		status: { sandbox: { kind: "docker" }, upload: UPLOAD },
		models: MODELS,
		defaultModelId: "mock:general-v1",
		limits: { maxFigureBytes: 1_048_576, maxTableRows: 200 },
		...overrides,
	};
}

function renderPanel(overrides: Partial<AnalysisPanelProps> = {}) {
	const view = render(<AnalysisPanel {...props(overrides)} />);
	return {
		...view,
		/** Draws the panel again with the current mock chat state (what a `useChat` update does). */
		update: () => view.rerender(<AnalysisPanel {...props(overrides)} />),
	};
}

const message = (parts: unknown[], id = "a1") => ({ id, role: "assistant", parts });
const attemptPart = (index: number, extra: object = {}) => ({
	type: "data-analysis-attempt",
	id: `attempt-${index}`,
	data: { index, code: `print(${index})`, stdout: `out-${index}`, stderr: "", ...extra },
});
const resultPart = (extra: object = {}) => ({
	type: "data-analysis-result",
	id: "result",
	data: { status: "succeeded", attempts: 1, fixes: 0, text: "売上は増加しています。", ...extra },
});

const PNG = "iVBORw0KGgoAAAAA";

function choose(file: File) {
	fireEvent.change(screen.getByLabelText("分析するファイル"), { target: { files: [file] } });
}
function fill(instruction: string) {
	fireEvent.change(screen.getByLabelText("分析の指示"), { target: { value: instruction } });
}
function submit() {
	fireEvent.click(screen.getByRole("button", { name: "分析する" }));
}

const fetchMock = vi.fn();

beforeEach(() => {
	chat.state = { messages: [], status: "ready", error: undefined };
	chat.sendMessage.mockClear();
	chat.stop.mockClear();
	chat.setMessages.mockClear();
	chat.clearError.mockClear();
	fetchMock.mockReset();
	vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe("AnalysisPanel: sandbox disabled (Req 3.8)", () => {
	const disabled = {
		status: {
			sandbox: {
				kind: "disabled",
				reason: "実行環境がありません",
				guidance: "Docker を起動します",
			},
			upload: UPLOAD,
		},
	} as const;

	it("locks the file, the instruction and the button and shows the guidance", () => {
		renderPanel(disabled);

		expect(screen.getByText("Docker を起動します")).toBeTruthy();
		expect((screen.getByLabelText("分析するファイル") as HTMLInputElement).disabled).toBe(true);
		expect((screen.getByLabelText("分析の指示") as HTMLTextAreaElement).disabled).toBe(true);
		expect((screen.getByRole("button", { name: "分析する" }) as HTMLButtonElement).disabled).toBe(
			true,
		);
	});

	it("does not offer to end a session that cannot exist", () => {
		renderPanel(disabled);

		expect(screen.queryByRole("button", { name: "セッションを終了" })).toBeNull();
	});
});

describe("AnalysisPanel: sending", () => {
	it("sends the file as multipart/form-data with the instruction, a session UUID and the model", async () => {
		renderPanel();
		const file = new File(["a,b\n1,2\n"], "sales.csv", { type: "text/csv" });
		choose(file);
		fill("  月ごとに集計して  ");
		submit();

		expect(chat.sendMessage).toHaveBeenCalledTimes(1);
		expect(chat.setMessages).toHaveBeenCalledWith([]);
		fetchMock.mockResolvedValue(new Response("", { status: 200 }));
		await chat.transport?.sendMessages({
			chatId: "c1",
			messages: [],
			trigger: "submit-message",
			messageId: undefined,
			abortSignal: undefined,
		});

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("/api/analysis");
		expect(init.method).toBe("POST");
		expect(init.body).toBeInstanceOf(FormData);
		const form = init.body as FormData;
		expect((form.get("file") as File).name).toBe("sales.csv");
		expect(form.get("instruction")).toBe("月ごとに集計して");
		expect(String(form.get("sessionId"))).toMatch(UUID);
		expect(form.get("modelId")).toBe("mock:general-v1");
		// The browser must set the multipart boundary itself.
		expect(new Headers(init.headers).has("content-type")).toBe(false);
	});

	it("keeps one session id across analyses", async () => {
		renderPanel();
		const ids: string[] = [];
		for (const name of ["a.csv", "b.csv"]) {
			choose(new File(["x"], name));
			fill("集計");
			submit();
			fetchMock.mockResolvedValue(new Response("", { status: 200 }));
			await chat.transport?.sendMessages({ chatId: "c", messages: [], trigger: "submit-message" });
			const init = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
			ids.push(String((init.body as FormData).get("sessionId")));
		}

		expect(ids[0]).toBe(ids[1]);
	});

	it("locks the inputs while an analysis runs and says so politely", () => {
		chat.state = { ...chat.state, status: "streaming" };
		renderPanel();

		expect((screen.getByLabelText("分析するファイル") as HTMLInputElement).disabled).toBe(true);
		expect(screen.getByRole("status", { name: "実行の状態" }).textContent).toContain(
			"分析しています",
		);
		expect(screen.getByRole("status", { name: "実行の状態" }).getAttribute("aria-live")).toBe(
			"polite",
		);
	});

	it("stops the running analysis from the stop button", () => {
		chat.state = { ...chat.state, status: "streaming" };
		renderPanel();

		fireEvent.click(screen.getByRole("button", { name: "停止" }));

		expect(chat.stop).toHaveBeenCalledTimes(1);
	});
});

describe("AnalysisPanel: showing the stream", () => {
	it("shows attempts, a figure, a table and the result", () => {
		chat.state = {
			...chat.state,
			messages: [
				message([
					attemptPart(1, { errorSummary: "KeyError" }),
					attemptPart(2),
					{
						type: "data-analysis-figure",
						id: "figure-1",
						data: { alt: "月別の売上", mediaType: "image/png", base64: PNG },
					},
					{
						type: "data-analysis-table",
						id: "table-1",
						data: { caption: "集計表", columns: ["月"], rows: [["1月"]], totalRows: 1 },
					},
					resultPart({ attempts: 2, fixes: 2 }),
				]),
			],
		};
		renderPanel();

		expect(screen.getByRole("heading", { name: "試行 2" })).toBeTruthy();
		expect(screen.getByText("修正回数: 2 回")).toBeTruthy();
		expect(screen.getByAltText("月別の売上")).toBeTruthy();
		expect(screen.getByText("集計表")).toBeTruthy();
		expect(screen.getByText("売上は増加しています。")).toBeTruthy();
		expect(screen.getByRole("status", { name: "実行の状態" }).textContent).toContain("完了");
	});

	it("draws the rows and figure within the limits the page passed", () => {
		chat.state = {
			...chat.state,
			messages: [
				message([
					{
						type: "data-analysis-figure",
						id: "figure-1",
						data: { alt: "大きすぎる図", mediaType: "image/png", base64: PNG },
					},
					{
						type: "data-analysis-table",
						id: "table-1",
						data: {
							caption: "集計表",
							columns: ["月"],
							rows: [["1月"], ["2月"], ["3月"]],
							totalRows: 3,
						},
					},
				]),
			],
		};
		renderPanel({ limits: { maxFigureBytes: 1, maxTableRows: 2 } });

		expect(screen.getByText("3 件中 2 件を表示")).toBeTruthy();
		expect(screen.queryByAltText("大きすぎる図")).toBeNull();
	});

	it("highlights the last run when the fixes ran out", () => {
		chat.state = {
			...chat.state,
			messages: [
				message([
					attemptPart(1, { errorSummary: "boom" }),
					resultPart({ status: "attempt-limit", text: "止まりました" }),
				]),
			],
		};
		renderPanel();

		expect(screen.getByText("修正回数の上限に達したため停止しました")).toBeTruthy();
		expect(screen.getByText("最後のコードとエラー")).toBeTruthy();
	});

	it("tells that the sandbox was recreated (Req 3.7)", () => {
		chat.state = {
			...chat.state,
			messages: [
				message([
					{
						type: "data-analysis-notice",
						id: "notice-recreated",
						data: { reasons: ["サンドボックスの有効期限が切れていたため、作り直しました。"] },
					},
				]),
			],
		};
		renderPanel();

		const notice = screen.getByRole("status", { name: "お知らせ" });
		expect(notice.textContent).toContain("作り直しました");
		expect(notice.getAttribute("aria-live")).toBe("polite");
	});

	it("shows why an analysis ended without a success", () => {
		chat.state = {
			...chat.state,
			messages: [message([resultPart({ status: "sandbox-unavailable", text: "接続できません" })])],
		};
		renderPanel();

		expect(screen.getByText("接続できません")).toBeTruthy();
		expect(screen.getByText(/サンドボックスが使えなくなりました/u)).toBeTruthy();
	});

	it("shows a stream error and retries with the same file and instruction", () => {
		const view = renderPanel();
		choose(new File(["x"], "a.csv"));
		fill("集計");
		submit();
		chat.sendMessage.mockClear();
		chat.state = { ...chat.state, error: new Error("boom") };
		view.update();

		fireEvent.click(screen.getByRole("button", { name: "再送信" }));

		expect(chat.clearError).toHaveBeenCalled();
		expect(chat.sendMessage).toHaveBeenCalledTimes(1);
		expect(chat.sendMessage).toHaveBeenCalledWith({ text: "集計" });
	});

	it("shows the newest assistant message even when a user message follows it", () => {
		chat.state = {
			...chat.state,
			messages: [
				message([attemptPart(4)]),
				{ id: "u2", role: "user", parts: [{ type: "text", text: "次" }] },
			],
		};
		renderPanel();

		expect(screen.getByRole("heading", { name: "試行 4" })).toBeTruthy();
	});

	it("falls back to the first model when the default is not offered", async () => {
		renderPanel({ defaultModelId: "mock:gone" });
		choose(new File(["x"], "a.csv"));
		fill("集計");
		submit();
		fetchMock.mockResolvedValue(new Response("", { status: 200 }));
		await chat.transport?.sendMessages({ chatId: "c", messages: [], trigger: "submit-message" });

		const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
		expect((init.body as FormData).get("modelId")).toBe("mock:general-v1");
	});
});

describe("AnalysisPanel: ending the session (Req 3.7)", () => {
	async function startAndEnd() {
		const view = renderPanel();
		choose(new File(["x"], "a.csv"));
		fill("集計");
		submit();
		fetchMock.mockResolvedValue(new Response("", { status: 200 }));
		await chat.transport?.sendMessages({ chatId: "c", messages: [], trigger: "submit-message" });
		const sessionId = String(
			((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as FormData).get("sessionId"),
		);
		fetchMock.mockReset();
		fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
		fireEvent.click(screen.getByRole("button", { name: "セッションを終了" }));
		return { view, sessionId };
	}

	it("sends DELETE for the session, clears the screen and announces it", async () => {
		const { sessionId } = await startAndEnd();

		await waitFor(() => expect(screen.getByText(/セッションを終了しました/u)).toBeTruthy());
		expect(chat.setMessages).toHaveBeenCalledTimes(2);
		expect(chat.clearError).toHaveBeenCalledTimes(1);
		expect(fetchMock).toHaveBeenCalledWith(`/api/analysis/sessions/${sessionId}`, {
			method: "DELETE",
		});
		expect(chat.setMessages).toHaveBeenLastCalledWith([]);
		expect(screen.getByRole("status", { name: "セッションの状態" }).getAttribute("aria-live")).toBe(
			"polite",
		);
	});

	it("uses a new session id for the next analysis", async () => {
		const { sessionId } = await startAndEnd();
		await waitFor(() => expect(screen.getByText(/セッションを終了しました/u)).toBeTruthy());
		fetchMock.mockReset();
		choose(new File(["x"], "b.csv"));
		fill("もう一度");
		submit();
		fetchMock.mockResolvedValue(new Response("", { status: 200 }));
		await chat.transport?.sendMessages({ chatId: "c", messages: [], trigger: "submit-message" });

		const next = String(
			((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as FormData).get("sessionId"),
		);
		expect(next).toMatch(UUID);
		expect(next).not.toBe(sessionId);
	});

	it("stops a running analysis before it ends the session", async () => {
		chat.state = { ...chat.state, status: "streaming" };
		renderPanel();
		fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

		fireEvent.click(screen.getByRole("button", { name: "セッションを終了" }));

		expect(chat.stop).toHaveBeenCalledTimes(1);
		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
	});

	it("says so when the server could not end the session", async () => {
		renderPanel();
		fetchMock.mockResolvedValue(new Response("{}", { status: 500 }));

		fireEvent.click(screen.getByRole("button", { name: "セッションを終了" }));

		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toContain("終了できませんでした");
	});

	it("drops the failure notice when the next analysis starts", async () => {
		renderPanel();
		fetchMock.mockResolvedValue(new Response("{}", { status: 500 }));
		fireEvent.click(screen.getByRole("button", { name: "セッションを終了" }));
		await screen.findByRole("alert");
		choose(new File(["x"], "a.csv"));
		fill("集計");
		submit();

		expect(screen.queryByRole("alert")).toBeNull();
	});

	it("says so when the request itself failed", async () => {
		renderPanel();
		fetchMock.mockRejectedValue(new TypeError("network"));

		fireEvent.click(screen.getByRole("button", { name: "セッションを終了" }));

		expect((await screen.findByRole("alert")).textContent).toContain("終了できませんでした");
	});
});

describe("selectAnalysisView", () => {
	it("returns an empty view without an assistant message", () => {
		const view = selectAnalysisView([]);

		expect(view).toEqual({
			attempts: [],
			figures: [],
			tables: [],
			notices: [],
			result: undefined,
		});
	});

	it("reads only the newest assistant message", () => {
		const view = selectAnalysisView([
			message([attemptPart(1)], "old") as never,
			message([attemptPart(7)], "new") as never,
		]);

		expect(view.attempts.map((attempt) => attempt.index)).toEqual([7]);
	});
});

describe("AnalysisPanel: the sandbox becomes unavailable at run time (Req 3.8)", () => {
	const GUIDANCE = "Docker を起動してください";
	const body503 = JSON.stringify({
		error: {
			code: "provider-unavailable",
			message: "分析エージェントを使えません。Docker が止まっています",
			details: { guidance: GUIDANCE },
		},
	});

	it("shows the guidance of a 503 and locks the form", () => {
		chat.state = { ...chat.state, error: new Error(body503) };
		renderPanel();

		expect(screen.getAllByText(GUIDANCE).length).toBeGreaterThan(0);
		expect(screen.getByText("分析エージェントは無効です")).toBeTruthy();
		expect((screen.getByLabelText("分析の指示") as HTMLTextAreaElement).disabled).toBe(true);
		expect(screen.queryByRole("button", { name: "セッションを終了" })).toBeNull();
	});

	it("ignores a provider-unavailable error without guidance", () => {
		chat.state = {
			...chat.state,
			error: new Error(
				JSON.stringify({ error: { code: "provider-unavailable", message: "モデルが使えません" } }),
			),
		};
		renderPanel();

		expect((screen.getByLabelText("分析の指示") as HTMLTextAreaElement).disabled).toBe(false);
		expect(screen.getByRole("button", { name: "セッションを終了" })).toBeTruthy();
	});

	it("re-reads the status after a sandbox-unavailable result and shows the guidance", async () => {
		fetchMock.mockResolvedValue(
			Response.json({
				sandbox: { kind: "disabled", reason: "Docker が止まっています", guidance: GUIDANCE },
				upload: UPLOAD,
			}),
		);
		chat.state = {
			...chat.state,
			messages: [message([resultPart({ status: "sandbox-unavailable", text: "" })])],
		};
		renderPanel();

		await waitFor(() => expect(screen.getByText(GUIDANCE)).toBeTruthy());
		expect(fetchMock).toHaveBeenCalledWith("/api/analysis/status", expect.anything());
		expect((screen.getByLabelText("分析の指示") as HTMLTextAreaElement).disabled).toBe(true);
		expect(screen.queryByRole("button", { name: "セッションを終了" })).toBeNull();
	});

	it("keeps the form when the re-read status shows a working sandbox", async () => {
		fetchMock.mockResolvedValue(Response.json({ sandbox: { kind: "docker" }, upload: UPLOAD }));
		chat.state = {
			...chat.state,
			messages: [message([resultPart({ status: "sandbox-unavailable", text: "" })])],
		};
		renderPanel();

		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		expect((screen.getByLabelText("分析の指示") as HTMLTextAreaElement).disabled).toBe(false);
	});
});

describe("AnalysisPanel: notices and models (F-20)", () => {
	it("shows two identical reasons as two items without a React key warning", () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		chat.state = {
			...chat.state,
			messages: [
				message([
					{
						type: "data-analysis-notice",
						id: "n1",
						data: { reasons: ["再作成しました", "再作成しました"] },
					},
				]),
			],
		};
		renderPanel();

		expect(screen.getAllByText("再作成しました")).toHaveLength(2);
		expect(errorSpy).not.toHaveBeenCalled();
		errorSpy.mockRestore();
	});

	it("shows the disabled-sandbox guidance even when no model can be used", () => {
		renderPanel({
			models: [],
			defaultModelId: "",
			status: {
				sandbox: {
					kind: "disabled",
					reason: "実行環境がありません",
					guidance: "Docker を起動します",
				},
				upload: UPLOAD,
			},
		});

		expect(screen.getByText("Docker を起動します")).toBeTruthy();
		expect(screen.getByText("利用できるモデルがありません")).toBeTruthy();
	});
});
