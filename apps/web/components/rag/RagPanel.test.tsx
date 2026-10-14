import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prepareRagRequest, RagPanel, selectRagView } from "./RagPanel";

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
	{
		id: "mock:no-tools",
		displayName: "No Tools Model",
		provider: "mock",
		contextWindow: 8192,
		capabilities: { ...CAPS, tools: false },
	},
] as const;

const LIMITS = {
	topK: { min: 1, max: 20 },
	minSimilarity: { min: -1, max: 1 },
};

function renderPanel(overrides: { defaultModelId?: string; questionMaxLength?: number } = {}) {
	return render(
		<RagPanel
			models={MODELS}
			defaultModelId={overrides.defaultModelId ?? "mock:general-v1"}
			rerank={{ available: true }}
			limits={LIMITS}
			defaults={{ topK: 4, minSimilarity: 0.2 }}
			questionMaxLength={overrides.questionMaxLength ?? 2000}
			agentPersonaId="general"
		/>,
	);
}

/** Draws the panel again with the current mock chat state (what a `useChat` update does). */
function rerender(view: ReturnType<typeof renderPanel>) {
	view.rerender(
		<RagPanel
			models={MODELS}
			defaultModelId="mock:general-v1"
			rerank={{ available: true }}
			limits={LIMITS}
			defaults={{ topK: 4, minSimilarity: 0.2 }}
			questionMaxLength={2000}
			agentPersonaId="general"
		/>,
	);
}

const citation = (label: number, cited: boolean) => ({
	chunkId: `c${label}`,
	label,
	documentId: `d${label}`,
	documentTitle: `文書 ${label}`,
	locator: { kind: "page", page: label },
	excerpt: `抜粋 ${label}`,
	cited,
});

const RESULT = {
	answer: "停止条件を設定します[1]。",
	citations: [citation(1, true), citation(2, false)],
	removedCitations: [],
	noEvidence: false,
	rerank: { status: "disabled" },
	settings: {},
	usage: {},
};

const TRACE = {
	settings: {
		topK: 4,
		minSimilarity: 0.2,
		pool: 20,
		methods: { hyde: false, multiQuery: false, hybrid: false, rerank: false },
	},
	vector: [{ query: "質問", candidates: [] }],
	fullText: [],
	fused: [],
	rerank: { status: "disabled" },
	final: [],
	stages: [],
};

const message = (parts: unknown[], metadata?: unknown, id = "a1") => ({
	id,
	role: "assistant",
	parts,
	...(metadata === undefined ? {} : { metadata }),
});
const user = (text: string, id = "u1") => ({ id, role: "user", parts: [{ type: "text", text }] });
const stagePart = (stage: string, status: string, detail?: string) => ({
	type: "data-rag-stage",
	id: `stage-${stage}`,
	data: { stage, status, ...(detail === undefined ? {} : { detail }) },
});
const tracePart = (data: unknown = TRACE) => ({ type: "data-rag-trace", id: "trace", data });
const resultPart = (data: unknown = RESULT) => ({ type: "data-rag-result", id: "result", data });
const textPart = (text: string) => ({ type: "text", text });

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

const questionBox = () => screen.getByLabelText(/^質問/) as HTMLTextAreaElement;
const sendButton = () => screen.getByRole("button", { name: "質問する" }) as HTMLButtonElement;

function ask(text: string) {
	fireEvent.change(questionBox(), { target: { value: text } });
	fireEvent.submit(sendButton().closest("form") as Element);
}

describe("selectRagView", () => {
	it("is empty before any message", () => {
		const view = selectRagView([]);

		expect(view).toMatchObject({ text: "", stages: [], trace: undefined, result: undefined });
		expect(view.tools).toEqual([]);
	});

	it("keeps the newest state of each stage, whatever order the parts came in", () => {
		const view = selectRagView([
			message([
				stagePart("vector-search", "running"),
				stagePart("fusion", "done"),
				stagePart("vector-search", "done"),
			]),
		] as never);

		expect(view.stages).toEqual([
			{ stage: "vector-search", status: "done" },
			{ stage: "fusion", status: "done" },
		]);
	});

	it("keeps the detail of a skipped stage", () => {
		const view = selectRagView([message([stagePart("rerank", "skipped", "理由")])] as never);

		expect(view.stages).toEqual([{ stage: "rerank", status: "skipped", detail: "理由" }]);
	});

	it("keeps the newest trace", () => {
		const newer = { ...TRACE, final: [{}] };
		const view = selectRagView([message([tracePart(), tracePart(newer)])] as never);

		expect(view.trace).toBe(newer);
	});

	it("shows the streamed text before the result and the settled answer after it", () => {
		const streaming = selectRagView([message([textPart("途中の")])] as never);
		expect(streaming.text).toBe("途中の");
		expect(streaming.result).toBeUndefined();

		const settled = selectRagView([
			message([textPart("途中の回答 [9]"), resultPart({ ...RESULT, answer: "確定した回答" })]),
		] as never);
		expect(settled.text).toBe("確定した回答");
		expect(settled.result?.answer).toBe("確定した回答");
	});

	it("reads only the newest assistant message", () => {
		const view = selectRagView([
			user("一つ目"),
			message([textPart("一つ目の回答"), resultPart()], undefined, "a1"),
			user("二つ目", "u2"),
			message([textPart("二つ目の回答")], undefined, "a2"),
		] as never);

		expect(view.text).toBe("二つ目の回答");
		expect(view.result).toBeUndefined();
		expect(view.messageId).toBe("a2");
	});

	it("ignores parts it does not know", () => {
		const view = selectRagView([
			message([{ type: "data-other", id: "x", data: 1 }, { type: "step-start" }, textPart("本文")]),
		] as never);

		expect(view.text).toBe("本文");
		expect(view.stages).toEqual([]);
	});

	it("uses the last text part of an agent run, which is the answer of the final step", () => {
		const view = selectRagView([
			message([
				textPart("調べます"),
				{ type: "tool-searchKnowledgeBase", state: "output-available" },
				textPart("答えです[1]"),
			]),
		] as never);

		expect(view.text).toBe("答えです[1]");
		expect(view.tools).toHaveLength(1);
	});

	it("takes the reconciled answer and the run from the agent's message metadata", () => {
		const rag = {
			searched: true,
			searchCount: 1,
			answer: "整えた回答",
			citations: [],
			removedCitations: [],
		};
		const run = { stopReason: "completed" };
		const view = selectRagView([message([textPart("元の回答 [9]")], { rag, run })] as never);

		expect(view.text).toBe("整えた回答");
		expect(view.agent).toEqual({ rag, run });
	});

	it("has no agent view for a pipeline answer", () => {
		const view = selectRagView([message([textPart("a"), resultPart()])] as never);

		expect(view.agent).toBeUndefined();
	});
});

describe("prepareRagRequest", () => {
	const settings = {
		topK: 6,
		minSimilarity: 0.3,
		methods: { hyde: true, multiQuery: false, hybrid: true, rerank: false },
	};

	it("builds the strict /api/rag/query body from the question, not a message list", () => {
		const prepared = prepareRagRequest({
			id: "chat-1",
			messages: [user("停止条件は？")] as never,
			body: { mode: "query", modelId: "mock:general-v1", personaId: "general", settings },
		});

		expect(prepared).toEqual({
			api: "/api/rag/query",
			body: { id: "chat-1", question: "停止条件は？", modelId: "mock:general-v1", settings },
		});
	});

	it("builds the /api/rag/agent body from the newest user message only", () => {
		const first = user("前の質問", "u1");
		const second = user("今の質問", "u2");
		const prepared = prepareRagRequest({
			id: "chat-1",
			messages: [first, message([textPart("前の回答")]), second] as never,
			body: { mode: "agent", modelId: "mock:general-v1", personaId: "general", settings },
		});

		expect(prepared).toEqual({
			api: "/api/rag/agent",
			body: { id: "chat-1", messages: [second], modelId: "mock:general-v1", personaId: "general" },
		});
	});

	it("takes the question from the newest user message when earlier ones are still in the list", () => {
		const prepared = prepareRagRequest({
			id: "chat-1",
			messages: [
				user("前の質問", "u1"),
				message([textPart("前の回答")]),
				user("今の質問", "u2"),
			] as never,
			body: { mode: "query", modelId: "mock:general-v1", personaId: "general", settings },
		});

		expect(prepared.body).toMatchObject({ question: "今の質問" });
	});

	it("is the transport's request builder", () => {
		renderPanel();
		const transport = chat.transportOptions as {
			prepareSendMessagesRequest: (options: unknown) => { api: string; body: unknown };
		};

		const prepared = transport.prepareSendMessagesRequest({
			id: "chat-1",
			messages: [user("質問")],
			body: { mode: "query", modelId: "mock:general-v1", personaId: "general", settings },
		});

		expect(prepared.api).toBe("/api/rag/query");
	});
});

describe("RagPanel form", () => {
	it("starts with an empty result area and a disabled send", () => {
		renderPanel();

		expect(sendButton().disabled).toBe(true);
		expect(screen.queryByRole("list", { name: "引用" })).toBeNull();
		expect(screen.queryByRole("button", { name: "停止" })).toBeNull();
	});

	it("sends the question with the model and the default settings, clearing the previous run", () => {
		renderPanel();

		ask("  停止条件は？ ");

		expect(chat.setMessages).toHaveBeenCalledWith([]);
		expect(chat.sendMessage).toHaveBeenCalledWith(
			{ text: "停止条件は？" },
			{
				body: {
					mode: "query",
					modelId: "mock:general-v1",
					personaId: "general",
					settings: {
						topK: 4,
						minSimilarity: 0.2,
						methods: { hyde: false, multiQuery: false, hybrid: false, rerank: false },
					},
				},
			},
		);
	});

	it("puts the method switches into the request", () => {
		renderPanel();

		fireEvent.click(screen.getByRole("checkbox", { name: /HyDE/ }));
		fireEvent.click(screen.getByRole("checkbox", { name: /Rerank/ }));
		fireEvent.change(screen.getByLabelText(/取得件数/), { target: { value: "8" } });
		ask("質問");

		expect(chat.sendMessage).toHaveBeenCalledWith(expect.anything(), {
			body: expect.objectContaining({
				settings: {
					topK: 8,
					minSimilarity: 0.2,
					methods: { hyde: true, multiQuery: false, hybrid: false, rerank: true },
				},
			}),
		});
	});

	it("switches the destination to the agent when Agentic RAG is on", () => {
		renderPanel();

		fireEvent.click(screen.getByRole("checkbox", { name: /Agentic RAG/ }));
		ask("質問");

		expect(chat.sendMessage).toHaveBeenCalledWith(expect.anything(), {
			body: expect.objectContaining({ mode: "agent" }),
		});
	});

	it("offers only tool-capable models to the agent and sends one of them", () => {
		renderPanel({ defaultModelId: "mock:no-tools" });

		fireEvent.click(screen.getByRole("checkbox", { name: /Agentic RAG/ }));
		ask("質問");

		expect(chat.sendMessage).toHaveBeenCalledWith(expect.anything(), {
			body: expect.objectContaining({ modelId: "mock:general-v1" }),
		});
	});

	it("clears the screen when the mode changes, so a pipeline answer is never read as an agent run", () => {
		renderPanel();

		fireEvent.click(screen.getByRole("checkbox", { name: /Agentic RAG/ }));

		expect(chat.setMessages).toHaveBeenCalledWith([]);
	});

	it("does not send a blank question", () => {
		renderPanel();

		fireEvent.change(questionBox(), { target: { value: "   " } });

		expect(sendButton().disabled).toBe(true);
		fireEvent.submit(sendButton().closest("form") as Element);
		expect(chat.sendMessage).not.toHaveBeenCalled();
	});

	it("does not send a question over the limit, counting characters rather than UTF-16 units", () => {
		renderPanel({ questionMaxLength: 5 });

		fireEvent.change(questionBox(), { target: { value: "😀😀😀😀😀" } });
		expect(sendButton().disabled).toBe(false);

		fireEvent.change(questionBox(), { target: { value: "😀😀😀😀😀😀" } });
		expect(sendButton().disabled).toBe(true);
		expect(screen.getByRole("alert").textContent).toContain("5 文字");
		fireEvent.submit(sendButton().closest("form") as Element);
		expect(chat.sendMessage).not.toHaveBeenCalled();
	});

	it("does not send a second question while the first is still running", () => {
		chat.state.status = "streaming";
		renderPanel();

		fireEvent.change(questionBox(), { target: { value: "二つ目の質問" } });
		fireEvent.submit(sendButton().closest("form") as Element);

		expect(chat.sendMessage).not.toHaveBeenCalled();
	});

	it("does not let a numeric field that Agentic RAG turned off block the send", () => {
		renderPanel();
		fireEvent.change(screen.getByLabelText(/取得件数/), { target: { value: "99" } });
		fireEvent.change(questionBox(), { target: { value: "質問" } });
		expect(sendButton().disabled).toBe(true);

		fireEvent.click(screen.getByRole("checkbox", { name: /Agentic RAG/ }));

		expect(sendButton().disabled).toBe(false);
	});

	it("holds back the send while a numeric setting is invalid", () => {
		renderPanel();
		fireEvent.change(questionBox(), { target: { value: "質問" } });

		fireEvent.change(screen.getByLabelText(/取得件数/), { target: { value: "99" } });

		expect(sendButton().disabled).toBe(true);
		fireEvent.change(screen.getByLabelText(/取得件数/), { target: { value: "3" } });
		expect(sendButton().disabled).toBe(false);
	});
});

describe("RagPanel running", () => {
	it("shows a stop button while generating, and stop aborts the run", () => {
		chat.state.status = "streaming";
		chat.state.messages = [user("質問"), message([stagePart("vector-search", "running")])];
		renderPanel();

		fireEvent.click(screen.getByRole("button", { name: "停止" }));

		expect(chat.stop).toHaveBeenCalledTimes(1);
		expect(sendButton().disabled).toBe(true);
	});

	it("locks the settings while generating", () => {
		chat.state.status = "submitted";
		renderPanel();

		expect((screen.getByRole("checkbox", { name: /HyDE/ }) as HTMLInputElement).disabled).toBe(
			true,
		);
	});

	it("announces the run politely and marks the result area busy", () => {
		chat.state.status = "streaming";
		chat.state.messages = [user("質問"), message([textPart("途中")])];
		renderPanel();

		expect(screen.getByRole("status", { name: "実行の状態" }).textContent).toContain(
			"回答を生成しています",
		);
		expect(screen.getByRole("region", { name: "回答" }).getAttribute("aria-busy")).toBe("true");
	});

	it("shows the error message with its code text and sends the same question again on retry", () => {
		chat.state.error = new Error(
			JSON.stringify({ error: { code: "provider-unavailable", message: "検索に失敗しました。" } }),
		);
		renderPanel();
		ask("もう一度");
		chat.sendMessage.mockClear();

		expect(screen.getByRole("alert").textContent).toContain("検索に失敗しました。");
		expect(screen.getByText("provider-unavailable").tagName).toBe("CODE");
		fireEvent.click(screen.getByRole("button", { name: "再送信" }));

		expect(chat.clearError).toHaveBeenCalled();
		expect(chat.sendMessage).toHaveBeenCalledWith({ text: "もう一度" }, expect.anything());
	});
});

describe("RagPanel pipeline result", () => {
	it("shows the stages, the streamed answer and the trace while the run is going", () => {
		chat.state.status = "streaming";
		chat.state.messages = [
			user("質問"),
			message([
				stagePart("vector-search", "done"),
				stagePart("generate", "running"),
				tracePart(),
				textPart("停止条件を"),
			]),
		];
		renderPanel();

		const stages = screen.getByRole("list", { name: "段階" });
		expect(stages.textContent).toContain("ベクトル検索");
		expect(stages.textContent).toContain("回答の生成");
		expect(screen.getByText("停止条件を")).toBeTruthy();
		expect(screen.getByRole("region", { name: "中間結果" })).toBeTruthy();
		expect(screen.queryByRole("link")).toBeNull();
	});

	it("replaces the streamed text with the settled answer and links its footnotes to the cards", () => {
		chat.state.messages = [
			user("質問"),
			message([textPart("途中の回答"), tracePart(), resultPart()]),
		];
		renderPanel();

		expect(screen.queryByText("途中の回答")).toBeNull();
		const link = screen.getByRole("link", { name: "[1]" });
		fireEvent.click(link);
		const cards = within(screen.getByRole("list", { name: "引用" })).getAllByRole("listitem");
		expect(cards).toHaveLength(2);
		expect(document.activeElement).toBe(cards[0]);
		expect(cards[0]?.textContent).toContain("引用あり");
		expect(cards[1]?.textContent).toContain("取得のみ");
	});

	it("keeps the card ids of two runs apart", () => {
		chat.state.messages = [user("質問"), message([resultPart()], undefined, "run-7")];
		renderPanel();

		expect(document.getElementById("rag-run-7-1")).toBeTruthy();
	});

	it("shows the removed out-of-range footnotes the server reported", () => {
		chat.state.messages = [
			user("質問"),
			message([resultPart({ ...RESULT, removedCitations: [9] })]),
		];
		renderPanel();

		expect(screen.getByRole("status", { name: "除去された脚注" }).textContent).toContain("[9]");
	});

	it("shows a no-evidence answer as such", () => {
		chat.state.messages = [
			user("質問"),
			message([
				resultPart({
					...RESULT,
					answer: "根拠が見つかりませんでした。",
					citations: [],
					noEvidence: true,
				}),
			]),
		];
		renderPanel();

		expect(screen.getByText("該当なし")).toBeTruthy();
		expect(screen.getByText("根拠が見つかりませんでした。")).toBeTruthy();
		expect(screen.getByText("引用できる文書はありません。")).toBeTruthy();
	});

	it("hides the stage of a method that was off", () => {
		chat.state.messages = [
			user("質問"),
			message([stagePart("hyde", "skipped", "無効"), stagePart("vector-search", "done")]),
		];
		renderPanel();

		expect(screen.queryByText("仮想回答の生成")).toBeNull();
		expect(screen.getByText("ベクトル検索")).toBeTruthy();
	});

	it("keeps showing the stages of the run that was sent after the switches change", () => {
		const view = renderPanel();
		fireEvent.click(screen.getByRole("checkbox", { name: /HyDE/ }));
		ask("質問");
		chat.state.messages = [user("質問"), message([stagePart("hyde", "done")])];
		rerender(view);
		fireEvent.click(screen.getByRole("checkbox", { name: /HyDE/ }));

		expect(screen.getByText("仮想回答の生成")).toBeTruthy();
	});
});

describe("RagPanel agent result", () => {
	const RAG = {
		searched: true,
		searchCount: 2,
		answer: "停止条件を設定します[1]。",
		citations: [citation(1, true)],
		removedCitations: [],
	};
	const RUN = {
		stopReason: "completed",
		steps: 3,
		totalTokens: { input: 100, output: 20, cacheRead: 0, reasoning: 0 },
		elapsedMs: 1200,
		toolsCalled: ["searchKnowledgeBase", "searchKnowledgeBase"],
	};

	function renderAgentRun(metadata: unknown, parts: unknown[] = [textPart("答えです")]) {
		const view = renderPanel();
		fireEvent.click(screen.getByRole("checkbox", { name: /Agentic RAG/ }));
		ask("質問");
		chat.state.messages = [user("質問"), message(parts, metadata)];
		rerender(view);
	}

	it("says whether the agent searched, and how many times", () => {
		renderAgentRun({ rag: RAG, run: RUN });

		expect(screen.getByText("検索しました（2 回）")).toBeTruthy();
	});

	it("shows the citations the run recorded, with footnote links", () => {
		renderAgentRun({ rag: RAG, run: RUN });

		expect(screen.getByRole("link", { name: "[1]" })).toBeTruthy();
		expect(screen.getByText("文書 1")).toBeTruthy();
	});

	it("says plainly when the agent answered without searching, and shows no citations", () => {
		renderAgentRun({
			rag: {
				...RAG,
				searched: false,
				searchCount: 0,
				citations: [],
				answer: "知識だけで答えます。",
			},
			run: { ...RUN, toolsCalled: [] },
		});

		expect(screen.getByText("検索せずに回答しました")).toBeTruthy();
		expect(screen.getByText(/ナレッジベースを検索していません/)).toBeTruthy();
		expect(screen.queryByRole("list", { name: "引用" })).toBeNull();
	});

	it("shows the stop reason with the same vocabulary as the tool agent", () => {
		renderAgentRun({ rag: RAG, run: { ...RUN, stopReason: "step-limit" } });

		expect(screen.getByText("ステップ数の上限")).toBeTruthy();
	});

	it("shows the search calls the agent made", () => {
		renderAgentRun({ rag: RAG, run: RUN }, [
			textPart("調べます"),
			{
				type: "tool-searchKnowledgeBase",
				toolCallId: "t1",
				state: "output-available",
				input: { query: "停止条件" },
				output: { ok: true, data: { hits: [] } },
			},
			textPart("答えです"),
		]);

		const calls = within(screen.getByRole("list", { name: "検索の呼び出し" })).getAllByRole(
			"listitem",
		);
		expect(calls).toHaveLength(1);
		expect(calls[0]?.textContent).toContain("searchKnowledgeBase");
	});

	it("shows no run summary while the agent is still running", () => {
		chat.state.status = "streaming";
		renderAgentRun(undefined);

		expect(screen.queryByRole("status", { name: "実行サマリ" })).toBeNull();
	});

	it("shows an error summary, not an interrupted one, when the run failed", () => {
		chat.state.error = new Error("unexpected");
		renderAgentRun(undefined);

		const summary = screen.getByRole("status", { name: "実行サマリ" });
		expect(summary.textContent).toContain("エラー");
		expect(summary.textContent).not.toContain("中断");
	});

	it("shows an interrupted summary when the stream ended without one", () => {
		renderAgentRun(undefined);

		expect(screen.getByRole("status", { name: "実行サマリ" }).textContent).toContain("中断");
		expect(screen.queryByText(/検索しました|検索せずに/)).toBeNull();
	});
});
