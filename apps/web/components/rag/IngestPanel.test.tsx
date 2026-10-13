import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { IngestPanel, type KnowledgeInfo } from "./IngestPanel";

// jsdom has no <dialog> behaviour; this stands in for what the browser does on showModal / close.
beforeAll(() => {
	HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
		this.setAttribute("open", "");
	};
	HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
		this.removeAttribute("open");
		this.dispatchEvent(new Event("close"));
	};
});

const INFO: KnowledgeInfo = {
	embedding: { modelId: "mock:embedding-v1", dimensions: 768 },
	knowledgeBase: { embeddingModelId: null, documents: [] },
	available: { knowledge: ["a.md", "b.md", "c.pdf"], evalCorpus: ["eval-1.md", "eval-2.md"] },
	rerank: { available: true },
};

const OK_RESULT = {
	ingested: [
		{ documentId: "d1", title: "文書 A", chunks: 5 },
		{ documentId: "d2", title: "文書 B", chunks: 10 },
	],
	skipped: [],
	embeddingModelId: "mock:embedding-v1",
};

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();

function route(handlers: { ingest?: Handler; knowledge?: Handler }) {
	fetchMock.mockImplementation(async (url, init) => {
		if (url === "/api/rag/ingest") {
			return (handlers.ingest ?? (() => Response.json(OK_RESULT)))(url, init);
		}
		if (url === "/api/rag/knowledge") {
			return (handlers.knowledge ?? (() => Response.json(INFO)))(url, init);
		}
		throw new Error(`unexpected request ${url}`);
	});
}

beforeEach(() => {
	fetchMock.mockReset();
	vi.stubGlobal("fetch", fetchMock);
	route({});
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

function ingestCalls() {
	return fetchMock.mock.calls.filter(([url]) => url === "/api/rag/ingest");
}

function ingestBody(index = 0): unknown {
	const init = ingestCalls()[index]?.[1];
	return JSON.parse(String(init?.body));
}

const submit = () => screen.getByRole("button", { name: "取り込む" });
const fileBox = (name: string) => screen.getByRole("checkbox", { name }) as HTMLInputElement;

describe("IngestPanel selection", () => {
	it("lists the files of the folder with every file selected", () => {
		render(<IngestPanel initial={INFO} />);

		for (const name of ["a.md", "b.md", "c.pdf"]) expect(fileBox(name).checked).toBe(true);
		expect((screen.getByRole("radio", { name: /knowledge/ }) as HTMLInputElement).checked).toBe(
			true,
		);
	});

	it("switches the file list when the source changes", () => {
		render(<IngestPanel initial={INFO} />);

		fireEvent.click(screen.getByRole("radio", { name: /評価用コーパス/ }));

		expect(screen.queryByRole("checkbox", { name: "a.md" })).toBeNull();
		expect(fileBox("eval-1.md").checked).toBe(true);
		expect(fileBox("eval-2.md").checked).toBe(true);
	});

	it("selects every file again after switching the source and back", () => {
		render(<IngestPanel initial={INFO} />);
		fireEvent.click(fileBox("a.md"));
		expect(fileBox("a.md").checked).toBe(false);

		fireEvent.click(screen.getByRole("radio", { name: /評価用コーパス/ }));
		fireEvent.click(screen.getByRole("radio", { name: /knowledge/ }));

		expect(fileBox("a.md").checked).toBe(true);
	});

	it("says so and blocks the send when the source has no files", () => {
		render(
			<IngestPanel initial={{ ...INFO, available: { knowledge: [], evalCorpus: ["e.md"] } }} />,
		);

		expect(screen.getByText("取り込める文書がありません。")).toBeTruthy();
		expect((submit() as HTMLButtonElement).disabled).toBe(true);
	});

	it("blocks the send when every file is deselected", () => {
		render(<IngestPanel initial={INFO} />);

		for (const name of ["a.md", "b.md", "c.pdf"]) fireEvent.click(fileBox(name));

		expect((submit() as HTMLButtonElement).disabled).toBe(true);
	});

	it("warns and blocks the send when no embedding model is configured", () => {
		render(<IngestPanel initial={{ ...INFO, embedding: null }} />);

		expect(screen.getByText(/埋め込みモデルが設定されていません/)).toBeTruthy();
		expect((submit() as HTMLButtonElement).disabled).toBe(true);
	});

	it("shows the embedding model and the documents already in the knowledge base", () => {
		render(
			<IngestPanel
				initial={{
					...INFO,
					knowledgeBase: {
						embeddingModelId: "mock:embedding-v1",
						documents: [
							{
								id: "d1",
								title: "既存の文書",
								sourceType: "markdown",
								tags: [],
								chunkCount: 7,
								ingestedAt: "2026-10-13T00:00:00.000Z",
							},
						],
					},
				}}
			/>,
		);

		expect(screen.getByText(/mock:embedding-v1/)).toBeTruthy();
		const list = screen.getByRole("list", { name: "取り込み済みの文書" });
		expect(within(list).getByText("既存の文書")).toBeTruthy();
		expect(list.textContent).toContain("7 チャンク");
	});

	it("tells the learner to ingest when the knowledge base is empty", () => {
		render(<IngestPanel initial={INFO} />);

		expect(screen.getByText(/取り込みが必要です/)).toBeTruthy();
		expect(screen.queryByRole("list", { name: "取り込み済みの文書" })).toBeNull();
	});
});

describe("IngestPanel send", () => {
	it("omits the file list when every file is selected", async () => {
		render(<IngestPanel initial={INFO} />);

		fireEvent.click(submit());

		await screen.findByRole("status", { name: "取り込み結果" });
		expect(ingestBody()).toEqual({ source: "knowledge", reset: false });
	});

	it("sends only the selected files", async () => {
		render(<IngestPanel initial={INFO} />);

		fireEvent.click(fileBox("b.md"));
		fireEvent.click(submit());

		await screen.findByRole("status", { name: "取り込み結果" });
		expect(ingestBody()).toEqual({ source: "knowledge", files: ["a.md", "c.pdf"], reset: false });
	});

	it("sends the chosen source", async () => {
		render(<IngestPanel initial={INFO} />);

		fireEvent.click(screen.getByRole("radio", { name: /評価用コーパス/ }));
		fireEvent.click(submit());

		await screen.findByRole("status", { name: "取り込み結果" });
		expect(ingestBody()).toEqual({ source: "eval-corpus", reset: false });
	});

	it("posts JSON to the ingest endpoint", async () => {
		render(<IngestPanel initial={INFO} />);

		fireEvent.click(submit());

		await screen.findByRole("status", { name: "取り込み結果" });
		const [url, init] = ingestCalls()[0] ?? [];
		expect(url).toBe("/api/rag/ingest");
		expect(init?.method).toBe("POST");
		expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
	});

	it("shows how many documents and chunks were ingested", async () => {
		render(<IngestPanel initial={INFO} />);

		fireEvent.click(submit());

		const result = await screen.findByRole("status", { name: "取り込み結果" });
		expect(result.textContent).toContain("2 件の文書を取り込みました");
		expect(result.textContent).toContain("15 チャンク");
		expect(result.textContent).toContain("文書 A");
		expect(result.textContent).toContain("文書 B");
	});

	it.each([
		["unsupported-format", "対応していない形式です"],
		["no-text", "テキストを取り出せませんでした"],
		["parse-failed", "解析に失敗しました"],
		["too-large", "ファイルが大きすぎます"],
		["not-found", "ファイルが見つかりません"],
	])("shows a skipped file with the reason %s", async (reason, message) => {
		route({
			ingest: () =>
				Response.json({ ...OK_RESULT, ingested: [], skipped: [{ file: "bad.bin", reason }] }),
		});
		render(<IngestPanel initial={INFO} />);

		fireEvent.click(submit());

		const result = await screen.findByRole("status", { name: "取り込み結果" });
		const skipped = within(result).getByRole("list", { name: "取り込めなかったファイル" });
		expect(skipped.textContent).toContain("bad.bin");
		expect(skipped.textContent).toContain(message);
		expect(result.textContent).toContain("0 件の文書を取り込みました");
	});

	it("shows no skipped list when nothing was skipped", async () => {
		render(<IngestPanel initial={INFO} />);

		fireEvent.click(submit());

		await screen.findByRole("status", { name: "取り込み結果" });
		expect(screen.queryByRole("list", { name: "取り込めなかったファイル" })).toBeNull();
	});

	it("refreshes the knowledge base state after a successful ingest and calls onIngested", async () => {
		const onIngested = vi.fn();
		route({
			knowledge: () =>
				Response.json({
					...INFO,
					knowledgeBase: {
						embeddingModelId: "mock:embedding-v1",
						documents: [
							{
								id: "d1",
								title: "取り込んだ文書",
								sourceType: "markdown",
								tags: [],
								chunkCount: 5,
								ingestedAt: "2026-10-13T00:00:00.000Z",
							},
						],
					},
				}),
		});
		render(<IngestPanel initial={INFO} onIngested={onIngested} />);

		fireEvent.click(submit());

		await waitFor(() =>
			expect(
				within(screen.getByRole("list", { name: "取り込み済みの文書" })).getByText(
					"取り込んだ文書",
				),
			).toBeTruthy(),
		);
		expect(screen.queryByText(/取り込みが必要です/)).toBeNull();
		expect(onIngested).toHaveBeenCalledTimes(1);
	});

	it("disables the send while a request is in flight and shows the progress", async () => {
		let release: (response: Response) => void = () => {};
		route({ ingest: () => new Promise<Response>((resolve) => (release = resolve)) });
		render(<IngestPanel initial={INFO} />);

		fireEvent.click(submit());

		await waitFor(() => expect((submit() as HTMLButtonElement).disabled).toBe(true));
		expect(screen.getByText("取り込み中です")).toBeTruthy();
		fireEvent.click(submit());
		expect(ingestCalls()).toHaveLength(1);

		release(Response.json(OK_RESULT));
		await screen.findByRole("status", { name: "取り込み結果" });
		expect((submit() as HTMLButtonElement).disabled).toBe(false);
	});

	it("hides the previous result while the next ingest runs", async () => {
		render(<IngestPanel initial={INFO} />);
		fireEvent.click(submit());
		await screen.findByRole("status", { name: "取り込み結果" });

		let release: (response: Response) => void = () => {};
		route({ ingest: () => new Promise<Response>((resolve) => (release = resolve)) });
		fireEvent.click(submit());

		await waitFor(() => expect(screen.getByText("取り込み中です")).toBeTruthy());
		expect(screen.queryByRole("status", { name: "取り込み結果" })).toBeNull();
		release(Response.json(OK_RESULT));
		await screen.findByRole("status", { name: "取り込み結果" });
	});

	it("shows the server's code message when the request is rejected", async () => {
		route({
			ingest: () =>
				Response.json(
					{ error: { code: "invalid-request", message: "ファイル名が正しくありません。" } },
					{ status: 400 },
				),
		});
		render(<IngestPanel initial={INFO} />);

		fireEvent.click(submit());

		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toContain("ファイル名が正しくありません。");
		expect(screen.queryByRole("status", { name: "取り込み結果" })).toBeNull();
	});

	it("shows a fixed message for a network failure and never the raw error", async () => {
		route({
			ingest: () => {
				throw new TypeError("fetch failed: ECONNREFUSED 10.0.0.1:5432 secret=abc");
			},
		});
		render(<IngestPanel initial={INFO} />);

		fireEvent.click(submit());

		const alert = await screen.findByRole("alert");
		expect(alert.textContent).not.toContain("ECONNREFUSED");
		expect(alert.textContent).not.toContain("secret");
		expect(alert.textContent).toContain("予期しないエラー");
	});

	it("sends again from the error banner", async () => {
		route({
			ingest: () =>
				Response.json(
					{ error: { code: "provider-unavailable", message: "失敗しました。" } },
					{ status: 503 },
				),
		});
		render(<IngestPanel initial={INFO} />);
		fireEvent.click(submit());
		await screen.findByRole("alert");

		route({});
		fireEvent.click(screen.getByRole("button", { name: "再送信" }));

		await screen.findByRole("status", { name: "取り込み結果" });
		expect(ingestCalls()).toHaveLength(2);
	});
});

describe("IngestPanel reset confirmation", () => {
	const resetBox = () =>
		screen.getByRole("checkbox", { name: /ナレッジベースを空にしてから/ }) as HTMLInputElement;
	const dialog = () => document.querySelector("dialog") as HTMLDialogElement;

	it("is off by default and the dialog is closed", () => {
		render(<IngestPanel initial={INFO} />);

		expect(resetBox().checked).toBe(false);
		expect(dialog().open).toBe(false);
	});

	it("opens a confirmation instead of sending when reset is on", () => {
		render(<IngestPanel initial={INFO} />);

		fireEvent.click(resetBox());
		fireEvent.click(submit());

		expect(dialog().open).toBe(true);
		expect(ingestCalls()).toHaveLength(0);
		expect(within(dialog()).getByText(/すべての文書.*削除/)).toBeTruthy();
	});

	it("puts the focus on Cancel, the safe default", () => {
		render(<IngestPanel initial={INFO} />);

		fireEvent.click(resetBox());
		fireEvent.click(submit());

		expect(document.activeElement).toBe(
			within(dialog()).getByRole("button", { name: "キャンセル" }),
		);
	});

	it("does not send when the confirmation is cancelled", () => {
		render(<IngestPanel initial={INFO} />);
		fireEvent.click(resetBox());
		fireEvent.click(submit());

		fireEvent.click(within(dialog()).getByRole("button", { name: "キャンセル" }));

		expect(dialog().open).toBe(false);
		expect(ingestCalls()).toHaveLength(0);
	});

	it("does not send when the dialog is dismissed with Escape (a native close)", () => {
		render(<IngestPanel initial={INFO} />);
		fireEvent.click(resetBox());
		fireEvent.click(submit());

		dialog().close();

		expect(ingestCalls()).toHaveLength(0);
	});

	it("sends with reset true only after the confirmation", async () => {
		render(<IngestPanel initial={INFO} />);
		fireEvent.click(resetBox());
		fireEvent.click(submit());

		fireEvent.click(within(dialog()).getByRole("button", { name: "削除して取り込む" }));

		await screen.findByRole("status", { name: "取り込み結果" });
		expect(dialog().open).toBe(false);
		expect(ingestBody()).toEqual({ source: "knowledge", reset: true });
	});

	it("asks again on the next send after a cancel", () => {
		render(<IngestPanel initial={INFO} />);
		fireEvent.click(resetBox());
		fireEvent.click(submit());
		fireEvent.click(within(dialog()).getByRole("button", { name: "キャンセル" }));

		fireEvent.click(submit());

		expect(dialog().open).toBe(true);
		expect(ingestCalls()).toHaveLength(0);
	});

	it("sends without a confirmation when reset is off", async () => {
		render(<IngestPanel initial={INFO} />);

		fireEvent.click(submit());

		await screen.findByRole("status", { name: "取り込み結果" });
		expect(dialog().open).toBe(false);
	});

	it("turns reset off again after a reset ingest, so the next send is not destructive", async () => {
		render(<IngestPanel initial={INFO} />);
		fireEvent.click(resetBox());
		fireEvent.click(submit());
		fireEvent.click(within(dialog()).getByRole("button", { name: "削除して取り込む" }));
		await screen.findByRole("status", { name: "取り込み結果" });

		expect(resetBox().checked).toBe(false);
	});
});
