import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowPanel } from "./WorkflowPanel";

const NAMES = {
	workflow: [
		"prompt-chaining",
		"routing",
		"parallel-sectioning",
		"parallel-voting",
		"evaluator-optimizer",
	],
	pattern: [
		"passive-goal-creator",
		"prompt-response-optimizer",
		"multi-path-plan",
		"self-reflection",
	],
} as const;

const SAMPLES = {
	"prompt-chaining": [{ label: "VPN の手順", task: "VPN の接続手順を書いてください。" }],
	routing: [
		{ label: "技術的な問い合わせ", task: "エラー 403 が出ます。" },
		{ label: "範囲外", task: "週末の天気を教えてください。" },
	],
	"parallel-sectioning": [{ label: "ポータル導入", task: "社内ポータルの導入を検討しています。" }],
	"parallel-voting": [{ label: "承認", task: "この案を承認してよいですか。" }],
	"evaluator-optimizer": [{ label: "入力検証", task: "入力検証の方針を書いてください。" }],
	"passive-goal-creator": [{ label: "十分な指示", task: "週報テンプレートを作ってください。" }],
	"prompt-response-optimizer": [{ label: "短い指示", task: "要約して" }],
	"multi-path-plan": [{ label: "問い合わせ対応", task: "問い合わせ対応を効率化する。" }],
	"self-reflection": [{ label: "紹介文", task: "ポータルの紹介文を書いてください。" }],
} as const;

const LIMITS = {
	maxSections: 8,
	maxVotes: 9,
	maxSubtasks: 6,
	maxCandidates: 5,
	maxIterationsCap: 8,
};

const USAGE = {
	inputTokens: 10,
	outputTokens: 5,
	totalTokens: 15,
	cacheReadTokens: 0,
	llmCalls: 2,
};

const ROUTING_RUN = {
	name: "routing",
	result: {
		category: "technical",
		reason: "エラーコードがあるため",
		matched: true,
		output: "調べます",
	},
	usage: USAGE,
};

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();

beforeEach(() => {
	fetchMock.mockReset();
	fetchMock.mockImplementation(async () => Response.json(ROUTING_RUN));
	vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

function renderPanel(overrides: { taskMaxLength?: number } = {}) {
	return render(
		<WorkflowPanel
			names={NAMES}
			samples={SAMPLES}
			limits={LIMITS}
			taskMaxLength={overrides.taskMaxLength ?? 4000}
		/>,
	);
}

const kindBox = (name: string) => screen.getByRole("radio", { name }) as HTMLInputElement;
const nameSelect = () => screen.getByLabelText("名前") as HTMLSelectElement;
const taskBox = () => screen.getByLabelText("入力") as HTMLTextAreaElement;
const runButton = () => screen.getByRole("button", { name: "実行" }) as HTMLButtonElement;
const field = (label: RegExp) => screen.getByLabelText(label) as HTMLInputElement;

function chooseName(name: string) {
	fireEvent.change(nameSelect(), { target: { value: name } });
}

function lastRequest() {
	const [url, init] = fetchMock.mock.calls.at(-1) ?? [];
	return { url, init, body: JSON.parse(String(init?.body)) as Record<string, unknown> };
}

describe("WorkflowPanel selection", () => {
	it("starts on the first workflow with its sample as the input", () => {
		renderPanel();

		expect(kindBox("ワークフロー").checked).toBe(true);
		expect(nameSelect().value).toBe("prompt-chaining");
		expect(taskBox().value).toBe("VPN の接続手順を書いてください。");
	});

	it("lists the workflows, then the patterns when the kind changes", () => {
		renderPanel();
		expect([...nameSelect().options].map((option) => option.value)).toEqual([...NAMES.workflow]);

		fireEvent.click(kindBox("エージェントパターン"));

		expect([...nameSelect().options].map((option) => option.value)).toEqual([...NAMES.pattern]);
		expect(nameSelect().value).toBe("passive-goal-creator");
		expect(taskBox().value).toBe("週報テンプレートを作ってください。");
	});

	it("labels each name in Japanese", () => {
		renderPanel();

		expect(screen.getByRole("option", { name: /プロンプトチェーン/ })).toBeTruthy();
	});

	it("changes the input example when another name is chosen", () => {
		renderPanel();

		chooseName("routing");

		expect(taskBox().value).toBe("エラー 403 が出ます。");
	});

	it("offers every sample of the name and puts the chosen one into the input", () => {
		renderPanel();
		chooseName("routing");

		fireEvent.click(screen.getByRole("button", { name: "範囲外" }));

		expect(taskBox().value).toBe("週末の天気を教えてください。");
	});

	it("keeps the input empty for a name without samples", () => {
		render(<WorkflowPanel names={NAMES} samples={{}} limits={LIMITS} taskMaxLength={4000} />);

		expect(taskBox().value).toBe("");
		expect(runButton().disabled).toBe(true);
	});
});

describe("WorkflowPanel run", () => {
	it("posts the kind, name and task to /api/workflows without options", async () => {
		renderPanel();
		chooseName("routing");

		fireEvent.click(runButton());

		await screen.findByRole("article", { name: /実行結果/ });
		const { url, init, body } = lastRequest();
		expect(url).toBe("/api/workflows");
		expect(init?.method).toBe("POST");
		expect(body).toEqual({ kind: "workflow", name: "routing", task: "エラー 403 が出ます。" });
	});

	it("posts a pattern with kind pattern", async () => {
		renderPanel();
		fireEvent.click(kindBox("エージェントパターン"));

		fireEvent.click(runButton());

		await waitFor(() => expect(fetchMock).toHaveBeenCalled());
		expect(lastRequest().body).toMatchObject({ kind: "pattern", name: "passive-goal-creator" });
	});

	it("sends the edited task trimmed", async () => {
		renderPanel();

		fireEvent.change(taskBox(), { target: { value: "  別の依頼です。 " } });
		fireEvent.click(runButton());

		await waitFor(() => expect(fetchMock).toHaveBeenCalled());
		expect(lastRequest().body.task).toBe("別の依頼です。");
	});

	it("shows the result of the run", async () => {
		renderPanel();
		chooseName("routing");

		fireEvent.click(runButton());

		const result = await screen.findByRole("article", { name: /実行結果: ルーティング/ });
		expect(result.textContent).toContain("調べます");
	});

	it("does not send a blank task", () => {
		renderPanel();

		fireEvent.change(taskBox(), { target: { value: "   " } });

		expect(runButton().disabled).toBe(true);
		fireEvent.submit(runButton().closest("form") as Element);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("does not send a task over the limit, counting characters", () => {
		renderPanel({ taskMaxLength: 3 });

		fireEvent.change(taskBox(), { target: { value: "😀😀😀" } });
		expect(runButton().disabled).toBe(false);
		fireEvent.change(taskBox(), { target: { value: "😀😀😀😀" } });

		expect(runButton().disabled).toBe(true);
		expect(screen.getByRole("alert").textContent).toContain("3 文字");
		fireEvent.submit(runButton().closest("form") as Element);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("blocks a second run while one is in flight and shows the progress", async () => {
		let release: (response: Response) => void = () => {};
		fetchMock.mockImplementation(() => new Promise<Response>((resolve) => (release = resolve)));
		renderPanel();

		fireEvent.click(runButton());

		await waitFor(() => expect(runButton().disabled).toBe(true));
		expect(screen.getByRole("status", { name: "実行の状態" }).textContent).toContain(
			"実行しています",
		);
		fireEvent.submit(runButton().closest("form") as Element);
		expect(fetchMock).toHaveBeenCalledTimes(1);

		release(Response.json(ROUTING_RUN));
		await screen.findByRole("article", { name: /実行結果/ });
		expect(runButton().disabled).toBe(false);
	});

	it("locks the selection while a run is in flight", async () => {
		fetchMock.mockImplementation(() => new Promise<Response>(() => {}));
		renderPanel();

		fireEvent.click(runButton());

		await waitFor(() => expect(nameSelect().disabled).toBe(true));
		expect(taskBox().disabled).toBe(true);
	});

	it("hides the previous result while the next run is in flight", async () => {
		renderPanel();
		fireEvent.click(runButton());
		await screen.findByRole("article", { name: /実行結果/ });

		fetchMock.mockImplementation(() => new Promise<Response>(() => {}));
		fireEvent.click(runButton());

		await waitFor(() => expect(screen.queryByRole("article")).toBeNull());
	});
});

describe("WorkflowPanel abort", () => {
	it("offers an abort button only while running, and abort cancels the request", async () => {
		let signal: AbortSignal | null | undefined;
		fetchMock.mockImplementation(
			(_url, init) =>
				new Promise<Response>((_resolve, reject) => {
					signal = init?.signal;
					signal?.addEventListener("abort", () =>
						reject(new DOMException("aborted", "AbortError")),
					);
				}),
		);
		renderPanel();
		expect(screen.queryByRole("button", { name: "中断" })).toBeNull();

		fireEvent.click(runButton());
		fireEvent.click(await screen.findByRole("button", { name: "中断" }));

		await waitFor(() => expect(signal?.aborted).toBe(true));
		await screen.findByText("実行を中断しました。");
		expect(screen.queryByRole("alert")).toBeNull();
		expect(screen.queryByRole("button", { name: "中断" })).toBeNull();
		expect(runButton().disabled).toBe(false);
	});

	it("can run again after an abort", async () => {
		fetchMock.mockImplementationOnce(
			(_url, init) =>
				new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () =>
						reject(new DOMException("aborted", "AbortError")),
					);
				}),
		);
		renderPanel();
		fireEvent.click(runButton());
		fireEvent.click(await screen.findByRole("button", { name: "中断" }));
		await screen.findByText("実行を中断しました。");

		fireEvent.click(runButton());

		await screen.findByRole("article", { name: /実行結果/ });
		expect(screen.queryByText("実行を中断しました。")).toBeNull();
	});
});

describe("WorkflowPanel unmount", () => {
	it("cancels a run that is still in flight when the screen goes away", async () => {
		let signal: AbortSignal | null | undefined;
		fetchMock.mockImplementation((_url, init) => {
			signal = init?.signal;
			return new Promise<Response>(() => {});
		});
		const view = renderPanel();
		fireEvent.click(runButton());
		await waitFor(() => expect(signal).toBeDefined());

		view.unmount();

		expect(signal?.aborted).toBe(true);
	});
});

describe("WorkflowPanel errors", () => {
	it("shows the server's message when the request is rejected", async () => {
		fetchMock.mockImplementation(async () =>
			Response.json(
				{ error: { code: "invalid-request", message: "votes は 9 以下で指定してください。" } },
				{ status: 400 },
			),
		);
		renderPanel();

		fireEvent.click(runButton());

		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toContain("votes は 9 以下で指定してください。");
		expect(screen.queryByRole("article")).toBeNull();
	});

	it("shows a fixed message for a network failure, never the raw error", async () => {
		fetchMock.mockImplementation(async () => {
			throw new TypeError("fetch failed: ECONNREFUSED 10.0.0.1 secret=abc");
		});
		renderPanel();

		fireEvent.click(runButton());

		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toContain("予期しないエラー");
		expect(alert.textContent).not.toContain("ECONNREFUSED");
	});

	it("runs the same request again from the error banner", async () => {
		fetchMock.mockImplementationOnce(async () =>
			Response.json(
				{ error: { code: "provider-unavailable", message: "失敗しました。" } },
				{ status: 503 },
			),
		);
		renderPanel();
		chooseName("routing");
		fireEvent.click(runButton());
		await screen.findByRole("alert");

		fireEvent.click(screen.getByRole("button", { name: "再送信" }));

		await screen.findByRole("article", { name: /実行結果/ });
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(lastRequest().body).toEqual({
			kind: "workflow",
			name: "routing",
			task: "エラー 403 が出ます。",
		});
	});
});

describe("WorkflowPanel options", () => {
	it("shows no option fields for a name without options", () => {
		renderPanel();

		expect(screen.queryByRole("group", { name: "オプション" })).toBeNull();
	});

	it("sends the Evaluator-Optimizer options as numbers", async () => {
		renderPanel();
		chooseName("evaluator-optimizer");

		fireEvent.change(field(/合格スコア/), { target: { value: "90" } });
		fireEvent.change(field(/最大反復回数/), { target: { value: "2" } });
		fireEvent.click(runButton());

		await waitFor(() => expect(fetchMock).toHaveBeenCalled());
		expect(lastRequest().body.options).toEqual({ passScore: 90, maxIterations: 2 });
	});

	it("omits an option field that is left empty", async () => {
		renderPanel();
		chooseName("evaluator-optimizer");

		fireEvent.change(field(/最大反復回数/), { target: { value: "2" } });
		fireEvent.click(runButton());

		await waitFor(() => expect(fetchMock).toHaveBeenCalled());
		expect(lastRequest().body.options).toEqual({ maxIterations: 2 });
	});

	it("sends no options key when every field is empty", async () => {
		renderPanel();
		chooseName("evaluator-optimizer");

		fireEvent.click(runButton());

		await waitFor(() => expect(fetchMock).toHaveBeenCalled());
		expect(lastRequest().body).not.toHaveProperty("options");
	});

	it("clears the option fields when the name changes", async () => {
		renderPanel();
		chooseName("evaluator-optimizer");
		fireEvent.change(field(/最大反復回数/), { target: { value: "2" } });

		chooseName("parallel-voting");
		chooseName("evaluator-optimizer");

		expect(field(/最大反復回数/).value).toBe("");
	});

	it("sends the number of votes", async () => {
		renderPanel();
		chooseName("parallel-voting");

		fireEvent.change(field(/投票数/), { target: { value: "5" } });
		fireEvent.click(runButton());

		await waitFor(() => expect(fetchMock).toHaveBeenCalled());
		expect(lastRequest().body.options).toEqual({ votes: 5 });
	});

	it("splits the aspects of the sectioning demo", async () => {
		renderPanel();
		chooseName("parallel-sectioning");

		fireEvent.change(field(/観点/), { target: { value: "技術, 費用 ，リスク" } });
		fireEvent.click(runButton());

		await waitFor(() => expect(fetchMock).toHaveBeenCalled());
		expect(lastRequest().body.options).toEqual({ aspects: ["技術", "費用", "リスク"] });
	});

	it("sends the target and the goal of the optimizer", async () => {
		renderPanel();
		fireEvent.click(kindBox("エージェントパターン"));
		chooseName("prompt-response-optimizer");

		fireEvent.change(screen.getByLabelText("対象"), { target: { value: "response" } });
		fireEvent.change(field(/改善の方針/), { target: { value: "丁寧にする" } });
		fireEvent.click(runButton());

		await waitFor(() => expect(fetchMock).toHaveBeenCalled());
		expect(lastRequest().body.options).toEqual({ target: "response", goal: "丁寧にする" });
	});

	it("sends the candidates of the multi-path plan and the iterations of a reflection", async () => {
		renderPanel();
		fireEvent.click(kindBox("エージェントパターン"));
		chooseName("multi-path-plan");
		fireEvent.change(field(/候補数/), { target: { value: "4" } });
		fireEvent.click(runButton());
		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		expect(lastRequest().body.options).toEqual({ candidates: 4 });

		await screen.findByRole("article");
		chooseName("self-reflection");
		fireEvent.change(field(/最大反復回数/), { target: { value: "2" } });
		fireEvent.click(runButton());
		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
		expect(lastRequest().body.options).toEqual({ maxIterations: 2 });
	});

	it.each([
		["evaluator-optimizer", /最大反復回数/, "9", "1 以上 8 以下の整数"],
		["evaluator-optimizer", /最大反復回数/, "0", "1 以上 8 以下の整数"],
		["evaluator-optimizer", /最大反復回数/, "1.5", "1 以上 8 以下の整数"],
		["evaluator-optimizer", /合格スコア/, "101", "0 以上 100 以下の数"],
		["evaluator-optimizer", /合格スコア/, "-1", "0 以上 100 以下の数"],
		["parallel-voting", /投票数/, "10", "1 以上 9 以下の整数"],
		["parallel-voting", /投票数/, "0", "1 以上 9 以下の整数"],
	])("refuses %s %s = %s and sends nothing", (name, label, value, range) => {
		renderPanel();
		chooseName(name);

		fireEvent.change(field(label), { target: { value } });

		expect(screen.getByRole("alert").textContent).toContain(range);
		expect(field(label).getAttribute("aria-invalid")).toBe("true");
		expect(runButton().disabled).toBe(true);
		fireEvent.submit(runButton().closest("form") as Element);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("refuses more aspects than the section limit, and an over-long aspect", () => {
		renderPanel();
		chooseName("parallel-sectioning");

		fireEvent.change(field(/観点/), { target: { value: "a,b,c,d,e,f,g,h,i" } });
		expect(screen.getByRole("alert").textContent).toContain("8 個まで");
		expect(runButton().disabled).toBe(true);

		fireEvent.change(field(/観点/), { target: { value: "あ".repeat(41) } });
		expect(screen.getByRole("alert").textContent).toContain("40 文字まで");
		expect(runButton().disabled).toBe(true);
	});

	it("counts an aspect's length in characters, not UTF-16 units", () => {
		renderPanel();
		chooseName("parallel-sectioning");

		fireEvent.change(field(/観点/), { target: { value: "😀".repeat(40) } });
		expect(screen.queryByRole("alert")).toBeNull();

		fireEvent.change(field(/観点/), { target: { value: "😀".repeat(41) } });
		expect(screen.getByRole("alert").textContent).toContain("40 文字まで");
	});

	it("accepts the boundary values", async () => {
		renderPanel();
		chooseName("evaluator-optimizer");

		fireEvent.change(field(/最大反復回数/), { target: { value: "8" } });
		fireEvent.change(field(/合格スコア/), { target: { value: "0" } });

		expect(screen.queryByRole("alert")).toBeNull();
		expect(runButton().disabled).toBe(false);
	});

	it("allows the run again once the value is back in range", () => {
		renderPanel();
		chooseName("parallel-voting");
		fireEvent.change(field(/投票数/), { target: { value: "10" } });
		expect(runButton().disabled).toBe(true);

		fireEvent.change(field(/投票数/), { target: { value: "3" } });

		expect(screen.queryByRole("alert")).toBeNull();
		expect(runButton().disabled).toBe(false);
	});
});
