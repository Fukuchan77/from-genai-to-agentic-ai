import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	writeRequirementsJudgement,
	writeRequirementsPreview,
	writeRequirementsQuestions,
} from "@/lib/server/domain-stream";
import { InterviewPanel } from "./InterviewPanel";

// The rounds go through the real `useChat` and the real stream decoding: only `fetch` is replaced,
// by Responses built from the server's own stream writers, so the second turn runs on an assistant
// message that real stream parts produced.

const PERSONAS = [
	{ id: "persona-1", name: "田中 花子", role: "経理担当者", goals: ["月次締めを早くする"] },
	{ id: "persona-2", name: "佐藤 太郎", role: "情報システム部長", goals: ["運用負荷を下げる"] },
];

const ROUND_1 = [
	{ id: "q-1-1", personaId: "persona-1", text: "いま一番時間がかかる作業は何ですか？" },
	{ id: "q-1-2", personaId: "persona-2", text: "既存システムとの連携で守る条件はありますか？" },
	{ id: "q-1-3", personaId: "persona-1", text: "承認の流れを教えてください。" },
];

const ROUND_2 = [{ id: "q-2-1", personaId: "persona-2", text: "監査ログはどの期間残しますか？" }];

const item = (text: string, personaId = "persona-1") => ({ text, personaId });
const EMPTY = { functional: [], nonFunctional: [], constraints: [], unconfirmed: [] };

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function errorResponse(status: number, message: string, reason?: string): Response {
	return jsonResponse(
		{ error: { code: "invalid-request", message, ...(reason ? { details: { reason } } : {}) } },
		status,
	);
}

type Write = (writer: Parameters<typeof writeRequirementsPreview>[0]) => void;

function streamResponse(...writes: Write[]): Response {
	return createUIMessageStreamResponse({
		stream: createUIMessageStream({
			execute: ({ writer }) => {
				for (const write of writes) write(writer);
			},
		}),
	});
}

const preview = (functional: string[]): Write => {
	return (writer) =>
		writeRequirementsPreview(writer, {
			...EMPTY,
			functional: functional.map((text) => item(text)),
		} as never);
};
const judgement =
	(round: number, sufficient: boolean, forcedEnd = false, missing: string[] = []): Write =>
	(writer) =>
		writeRequirementsJudgement(writer, round, { sufficient, forcedEnd, missing } as never);
const questions =
	(round: number, list: typeof ROUND_2): Write =>
	(writer) =>
		writeRequirementsQuestions(writer, round, list);

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

function calls() {
	return fetchMock.mock.calls.map(([input, init]) => ({
		url: String(input),
		body: init?.body ? JSON.parse(String(init.body)) : undefined,
	}));
}

function renderPanel() {
	return render(<InterviewPanel overviewMaxLength={2000} answerMaxLength={2000} />);
}

function type(label: string | RegExp, value: string) {
	fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

async function startInterview() {
	fetchMock.mockResolvedValueOnce(
		jsonResponse({ sessionId: "s-1", personas: PERSONAS, questions: ROUND_1 }),
	);
	renderPanel();
	type("プロダクトの概要", "経費精算を自動化するサービス");
	fireEvent.click(screen.getByRole("button", { name: "面接を始める" }));
	await screen.findByText(ROUND_1[0]?.text ?? "");
}

beforeEach(() => {
	fetchMock.mockReset();
	vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe("overview form", () => {
	it("disables the start button until an overview is written", () => {
		renderPanel();
		expect(
			(screen.getByRole("button", { name: "面接を始める" }) as HTMLButtonElement).disabled,
		).toBe(true);
		type("プロダクトの概要", "   ");
		expect(
			(screen.getByRole("button", { name: "面接を始める" }) as HTMLButtonElement).disabled,
		).toBe(true);
		type("プロダクトの概要", "概要");
		expect(
			(screen.getByRole("button", { name: "面接を始める" }) as HTMLButtonElement).disabled,
		).toBe(false);
	});

	it("accepts exactly 2000 characters and refuses 2001 with an announced message", () => {
		renderPanel();
		type("プロダクトの概要", "あ".repeat(2000));
		expect(
			(screen.getByRole("button", { name: "面接を始める" }) as HTMLButtonElement).disabled,
		).toBe(false);
		expect(screen.getByText("2000 / 2000 文字")).not.toBeNull();
		type("プロダクトの概要", "あ".repeat(2001));
		expect(
			(screen.getByRole("button", { name: "面接を始める" }) as HTMLButtonElement).disabled,
		).toBe(true);
		expect(screen.getByRole("alert").textContent).toContain("2000 文字まで");
		expect(screen.getByLabelText("プロダクトの概要").getAttribute("aria-invalid")).toBe("true");
	});

	it("counts characters by code point, not UTF-16 units", () => {
		renderPanel();
		type("プロダクトの概要", "😀".repeat(2000));
		expect(
			(screen.getByRole("button", { name: "面接を始める" }) as HTMLButtonElement).disabled,
		).toBe(false);
	});
});

describe("starting an interview", () => {
	it("posts the overview and shows the personas and their questions grouped by persona", async () => {
		await startInterview();
		expect(calls()[0]).toEqual({
			url: "/api/requirements/sessions",
			body: { overview: "経費精算を自動化するサービス" },
		});
		const first = screen.getByRole("group", { name: "田中 花子" });
		expect(within(first).getByText("経理担当者")).not.toBeNull();
		expect(within(first).getByLabelText(ROUND_1[0]?.text ?? "")).not.toBeNull();
		expect(within(first).getByLabelText(ROUND_1[2]?.text ?? "")).not.toBeNull();
		expect(within(first).queryByLabelText(ROUND_1[1]?.text ?? "")).toBeNull();
		const second = screen.getByRole("group", { name: "佐藤 太郎" });
		expect(within(second).getByLabelText(ROUND_1[1]?.text ?? "")).not.toBeNull();
		expect(screen.getByText("第 1 ラウンド")).not.toBeNull();
	});

	it("shows a failed start as an error with a retry that posts again", async () => {
		fetchMock.mockResolvedValueOnce(errorResponse(502, "ペルソナを生成できませんでした。"));
		renderPanel();
		type("プロダクトの概要", "概要");
		fireEvent.click(screen.getByRole("button", { name: "面接を始める" }));
		expect(await screen.findByText("ペルソナを生成できませんでした。")).not.toBeNull();
		fetchMock.mockResolvedValueOnce(
			jsonResponse({ sessionId: "s-1", personas: PERSONAS, questions: ROUND_1 }),
		);
		fireEvent.click(screen.getByRole("button", { name: "再送信" }));
		expect(await screen.findByText(ROUND_1[0]?.text ?? "")).not.toBeNull();
		expect(calls()).toHaveLength(2);
	});
});

describe("answering", () => {
	it("keeps the send button disabled until at least one answer is written", async () => {
		await startInterview();
		const send = screen.getByRole("button", { name: "回答を送信" });
		expect((send as HTMLButtonElement).disabled).toBe(true);
		type(ROUND_1[0]?.text ?? "", "   ");
		expect((send as HTMLButtonElement).disabled).toBe(true);
		type(ROUND_1[0]?.text ?? "", "仕訳の入力です");
		expect((send as HTMLButtonElement).disabled).toBe(false);
	});

	it("sends only the filled answers, with their question ids, to the session's messages route", async () => {
		await startInterview();
		fetchMock.mockResolvedValueOnce(
			streamResponse(preview(["仕訳を自動入力する"]), judgement(1, false, false, ["監査要件"])),
		);
		type(ROUND_1[0]?.text ?? "", "仕訳の入力です");
		type(ROUND_1[2]?.text ?? "", "部長が承認します");
		fireEvent.click(screen.getByRole("button", { name: "回答を送信" }));
		await screen.findByText("仕訳を自動入力する", { exact: false });
		expect(calls()[1]).toEqual({
			url: "/api/requirements/sessions/s-1/messages",
			body: {
				answers: [
					{ questionId: "q-1-1", text: "仕訳の入力です" },
					{ questionId: "q-1-3", text: "部長が承認します" },
				],
			},
		});
	});

	it("limits an answer to 2000 characters and tells which one is too long", async () => {
		await startInterview();
		const label = ROUND_1[1]?.text ?? "";
		type(label, "い".repeat(2000));
		expect((screen.getByRole("button", { name: "回答を送信" }) as HTMLButtonElement).disabled).toBe(
			false,
		);
		type(label, "い".repeat(2001));
		expect((screen.getByRole("button", { name: "回答を送信" }) as HTMLButtonElement).disabled).toBe(
			true,
		);
		expect(screen.getByRole("alert").textContent).toContain("2000 文字まで");
		expect(screen.getByLabelText(label).getAttribute("aria-invalid")).toBe("true");
	});

	it("refuses more than 10 answers at once", async () => {
		const many = Array.from({ length: 11 }, (_, index) => ({
			id: `q-1-${index + 1}`,
			personaId: "persona-1",
			text: `質問${index + 1}`,
		}));
		fetchMock.mockResolvedValueOnce(
			jsonResponse({ sessionId: "s-1", personas: PERSONAS, questions: many }),
		);
		renderPanel();
		type("プロダクトの概要", "概要");
		fireEvent.click(screen.getByRole("button", { name: "面接を始める" }));
		await screen.findByLabelText("質問1");
		for (let n = 1; n <= 10; n++) type(`質問${n}`, "答え");
		expect((screen.getByRole("button", { name: "回答を送信" }) as HTMLButtonElement).disabled).toBe(
			false,
		);
		type("質問11", "答え");
		expect((screen.getByRole("button", { name: "回答を送信" }) as HTMLButtonElement).disabled).toBe(
			true,
		);
		expect(screen.getByRole("alert").textContent).toContain("10 件まで");
	});

	it("shows the preview and the verdict, and keeps the round open while information is missing", async () => {
		await startInterview();
		fetchMock.mockResolvedValueOnce(
			streamResponse(
				preview(["仕訳を自動入力する"]),
				judgement(1, false, false, ["監査要件"]),
				questions(2, ROUND_2),
			),
		);
		type(ROUND_1[0]?.text ?? "", "仕訳の入力です");
		fireEvent.click(screen.getByRole("button", { name: "回答を送信" }));
		expect(await screen.findByLabelText(ROUND_2[0]?.text ?? "")).not.toBeNull();
		expect(screen.getByText("第 2 ラウンド")).not.toBeNull();
		const previewRegion = screen.getByRole("region", { name: "要件プレビュー" });
		expect(within(previewRegion).getByText("仕訳を自動入力する")).not.toBeNull();
		expect(within(previewRegion).getByText("（出所: 田中 花子）")).not.toBeNull();
		expect(screen.getByRole("list", { name: "不足項目" }).textContent).toContain("監査要件");
		// The previous round's fields are gone and the new field is empty.
		expect(screen.queryByLabelText(ROUND_1[0]?.text ?? "")).toBeNull();
		expect((screen.getByRole("button", { name: "回答を送信" }) as HTMLButtonElement).disabled).toBe(
			true,
		);
		expect(
			(screen.getByRole("button", { name: /requirements\.md/ }) as HTMLButtonElement).disabled,
		).toBe(true);
	});

	it("runs a second round on the assistant message the first round's stream produced", async () => {
		await startInterview();
		fetchMock.mockResolvedValueOnce(
			streamResponse(preview(["仕訳を自動入力する"]), judgement(1, false), questions(2, ROUND_2)),
		);
		type(ROUND_1[0]?.text ?? "", "仕訳の入力です");
		fireEvent.click(screen.getByRole("button", { name: "回答を送信" }));
		await screen.findByLabelText(ROUND_2[0]?.text ?? "");

		fetchMock.mockResolvedValueOnce(
			streamResponse(preview(["仕訳を自動入力する", "監査ログを7年残す"]), judgement(2, true)),
		);
		type(ROUND_2[0]?.text ?? "", "7年です");
		fireEvent.click(screen.getByRole("button", { name: "回答を送信" }));
		expect(await screen.findByText("監査ログを7年残す", { exact: false })).not.toBeNull();
		expect(calls()[2]).toEqual({
			url: "/api/requirements/sessions/s-1/messages",
			body: { answers: [{ questionId: "q-2-1", text: "7年です" }] },
		});
	});

	it("disables the form while a round is running", async () => {
		await startInterview();
		let release: (response: Response) => void = () => {};
		fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => (release = resolve)));
		type(ROUND_1[0]?.text ?? "", "仕訳の入力です");
		fireEvent.click(screen.getByRole("button", { name: "回答を送信" }));
		const sendButton = screen.getByRole("button", { name: "回答を送信" }) as HTMLButtonElement;
		await waitFor(() => expect(sendButton.disabled).toBe(true));
		// A disabled fieldset disables its fields through the :disabled state, not the property.
		expect(screen.getByLabelText(ROUND_1[0]?.text ?? "").matches(":disabled")).toBe(true);
		expect(screen.getByRole("status").textContent).toContain("回答を処理しています");
		await act(async () => {
			release(streamResponse(preview(["x"]), judgement(1, false), questions(2, ROUND_2)));
		});
		await screen.findByLabelText(ROUND_2[0]?.text ?? "");
	});
});

describe("completion", () => {
	it("announces the end, hides the answer form and enables the download when the verdict is sufficient", async () => {
		await startInterview();
		fetchMock.mockResolvedValueOnce(
			streamResponse(preview(["仕訳を自動入力する"]), judgement(1, true)),
		);
		type(ROUND_1[0]?.text ?? "", "仕訳の入力です");
		fireEvent.click(screen.getByRole("button", { name: "回答を送信" }));
		expect(await screen.findByText("面接が完了しました。")).not.toBeNull();
		expect(screen.queryByRole("button", { name: "回答を送信" })).toBeNull();
		const link = screen.getByRole("link", { name: /requirements\.md/ });
		expect(link.getAttribute("href")).toBe("/api/requirements/sessions/s-1/document");
	});

	it("treats a forced end as complete too", async () => {
		await startInterview();
		fetchMock.mockResolvedValueOnce(
			streamResponse(preview(["a"]), judgement(1, false, true, ["監査要件"])),
		);
		type(ROUND_1[0]?.text ?? "", "答え");
		fireEvent.click(screen.getByRole("button", { name: "回答を送信" }));
		expect(await screen.findByText("面接が完了しました。")).not.toBeNull();
		expect(screen.getByRole("link", { name: /requirements\.md/ })).not.toBeNull();
	});

	it.each([
		["busy", "前の回答を処理中です。終わってからもう一度送ってください。"],
		[undefined, "原因の分からない競合です。"],
	])(
		"keeps the interview alive on a 409 with reason %s: message, retry, form, no download",
		async (reason, message) => {
			await startInterview();
			fetchMock.mockResolvedValueOnce(errorResponse(409, message, reason));
			type(ROUND_1[0]?.text ?? "", "答え");
			fireEvent.click(screen.getByRole("button", { name: "回答を送信" }));
			expect(await screen.findByText(message)).not.toBeNull();
			expect(screen.queryByText("面接が完了しました。")).toBeNull();
			expect(screen.queryByRole("link", { name: /requirements\.md/ })).toBeNull();
			expect(
				(screen.getByRole("button", { name: "回答を送信" }) as HTMLButtonElement).disabled,
			).toBe(false);
			expect(screen.getByLabelText(ROUND_1[0]?.text ?? "")).not.toBeNull();
			fetchMock.mockResolvedValueOnce(streamResponse(preview(["a"]), judgement(1, true)));
			fireEvent.click(screen.getByRole("button", { name: "再送信" }));
			expect(await screen.findByText("面接が完了しました。")).not.toBeNull();
		},
	);

	it("treats 409 with reason completed as complete", async () => {
		await startInterview();
		fetchMock.mockResolvedValueOnce(
			errorResponse(409, "この面接はすでに完了しています。", "completed"),
		);
		type(ROUND_1[0]?.text ?? "", "答え");
		fireEvent.click(screen.getByRole("button", { name: "回答を送信" }));
		expect(await screen.findByText("面接が完了しました。")).not.toBeNull();
		expect(screen.getByRole("link", { name: /requirements\.md/ })).not.toBeNull();
		expect(screen.queryByText("エラーが発生しました")).toBeNull();
	});

	it("starts over from the completed screen", async () => {
		await startInterview();
		fetchMock.mockResolvedValueOnce(streamResponse(preview(["a"]), judgement(1, true)));
		type(ROUND_1[0]?.text ?? "", "答え");
		fireEvent.click(screen.getByRole("button", { name: "回答を送信" }));
		await screen.findByText("面接が完了しました。");
		fireEvent.click(screen.getByRole("button", { name: "新しい面接を始める" }));
		expect((screen.getByLabelText("プロダクトの概要") as HTMLTextAreaElement).value).toBe("");
		expect(screen.queryByRole("link", { name: /requirements\.md/ })).toBeNull();
		expect(screen.queryByRole("region", { name: "要件プレビュー" })).toBeNull();
	});

	it("shows no state of the earlier interview in the next one", async () => {
		await startInterview();
		fetchMock.mockResolvedValueOnce(streamResponse(preview(["古い要件"]), judgement(1, true)));
		type(ROUND_1[0]?.text ?? "", "答え");
		fireEvent.click(screen.getByRole("button", { name: "回答を送信" }));
		await screen.findByText("面接が完了しました。");
		fireEvent.click(screen.getByRole("button", { name: "新しい面接を始める" }));
		fetchMock.mockResolvedValueOnce(
			jsonResponse({ sessionId: "s-2", personas: PERSONAS, questions: ROUND_1 }),
		);
		type("プロダクトの概要", "別のサービス");
		fireEvent.click(screen.getByRole("button", { name: "面接を始める" }));
		await screen.findByText(ROUND_1[0]?.text ?? "");
		expect(screen.queryByText("面接が完了しました。")).toBeNull();
		expect(screen.queryByText("古い要件", { exact: false })).toBeNull();
		expect(screen.queryByRole("link", { name: /requirements\.md/ })).toBeNull();
		expect(screen.getByText("第 1 ラウンド")).not.toBeNull();
	});
});

describe("announcements", () => {
	it("announces the run status politely", async () => {
		await startInterview();
		expect(screen.getByRole("status").getAttribute("aria-live")).toBe("polite");
	});
});

describe("errors", () => {
	it("explains an expired session (404) and offers to start again", async () => {
		await startInterview();
		fetchMock.mockResolvedValueOnce(errorResponse(404, "指定された面接は見つかりません。"));
		type(ROUND_1[0]?.text ?? "", "答え");
		fireEvent.click(screen.getByRole("button", { name: "回答を送信" }));
		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toContain("面接の有効期限が切れました");
		expect(screen.queryByRole("button", { name: "再送信" })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "新しい面接を始める" }));
		expect(screen.getByLabelText("プロダクトの概要")).not.toBeNull();
		expect(screen.queryByRole("alert")).toBeNull();
	});

	it("keeps the written answers after another failure and resends them on retry", async () => {
		await startInterview();
		fetchMock.mockResolvedValueOnce(errorResponse(502, "要件を抽出できませんでした。"));
		type(ROUND_1[0]?.text ?? "", "仕訳の入力です");
		fireEvent.click(screen.getByRole("button", { name: "回答を送信" }));
		expect(await screen.findByText("要件を抽出できませんでした。")).not.toBeNull();
		expect((screen.getByLabelText(ROUND_1[0]?.text ?? "") as HTMLTextAreaElement).value).toBe(
			"仕訳の入力です",
		);
		fetchMock.mockResolvedValueOnce(streamResponse(preview(["a"]), judgement(1, true)));
		fireEvent.click(screen.getByRole("button", { name: "再送信" }));
		expect(await screen.findByText("面接が完了しました。")).not.toBeNull();
		expect(calls()[2]?.body).toEqual({
			answers: [{ questionId: "q-1-1", text: "仕訳の入力です" }],
		});
		expect(screen.queryByText("エラーが発生しました")).toBeNull();
	});
});
