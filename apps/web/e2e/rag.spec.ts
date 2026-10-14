import { expect, type Page, test } from "@playwright/test";
import { errorReply, jsonReply, type MockApi, mockApi, streamReply } from "./support/mock-api";

/** The visible alerts; Next.js keeps an empty `role="alert"` route announcer on every page. */
function alerts(page: Page) {
	return page.getByRole("alert").filter({ hasText: /\S/ });
}

// Plan C14, C19, Req 1.4, 1.5, 1.9, 1.10, 2.8, 2.11: the /rag screen end to end against generated
// fixtures. The page itself is rendered by the real server (so the file lists are the real ones);
// every call the browser makes goes through `mockApi` and is answered with a stream the Route
// Handlers produced (`mise run e2e:fixtures`), or with the small knowledge-base state replies.

const CORPUS_TITLES = [
	"RAG の全体像",
	"チャンク分割",
	"埋め込みと検索",
	"ハイブリッド検索と RRF",
	"Rerank と評価",
	"Agentic RAG",
];

const INGEST_RESULT = {
	ingested: CORPUS_TITLES.map((title, index) => ({
		documentId: `eval:0${index + 1}.md`,
		title,
		chunks: 3,
	})),
	skipped: [{ file: "broken.pdf", reason: "no-text" }],
	embeddingModelId: "mock:embedding-v1",
};

const KNOWLEDGE_AFTER_INGEST = {
	embedding: { modelId: "mock:embedding-v1", dimensions: 768 },
	knowledgeBase: {
		embeddingModelId: "mock:embedding-v1",
		documents: CORPUS_TITLES.map((title, index) => ({
			id: `eval:0${index + 1}.md`,
			title,
			sourceType: "markdown",
			tags: [],
			chunkCount: 3,
			ingestedAt: "2026-10-13T00:00:00.000Z",
		})),
	},
	available: { knowledge: [], evalCorpus: ["01-rag-overview.md"] },
	rerank: { available: true },
};

const QUESTION = "RAG とは何ですか？";

function bodyOf(api: MockApi, path: string, index = 0): Record<string, unknown> {
	const request = api.requests.filter((entry) => entry.path === path)[index];
	if (request === undefined) throw new Error(`no request #${index} to ${path}`);
	return request.body as Record<string, unknown>;
}

async function ask(page: Page, question = QUESTION): Promise<void> {
	await page.getByLabel("質問", { exact: true }).fill(question);
	await page.getByRole("button", { name: "質問する" }).click();
}

const citationCards = (page: Page) =>
	page.getByRole("list", { name: "引用" }).getByRole("listitem");

test("rag: ingest the evaluation corpus, ask with hybrid search and Rerank, and follow a footnote", async ({
	page,
}) => {
	const api = await mockApi(page, {
		"/api/rag/ingest": jsonReply(INGEST_RESULT),
		"/api/rag/knowledge": jsonReply(KNOWLEDGE_AFTER_INGEST),
		"/api/rag/query": streamReply("rag-query"),
	});
	await page.goto("/rag");

	await page.getByRole("radio", { name: "評価用コーパス" }).check();
	await page.getByRole("button", { name: "取り込む" }).click();

	const ingested = page.getByRole("status", { name: "取り込み結果" });
	await expect(ingested).toContainText("6 件の文書を取り込みました");
	await expect(ingested).toContainText("18 チャンク");
	await expect(ingested.getByRole("list", { name: "取り込めなかったファイル" })).toContainText(
		"broken.pdf — テキストを取り出せませんでした",
	);
	await expect(page.getByRole("list", { name: "取り込み済みの文書" })).toContainText("Agentic RAG");
	expect(bodyOf(api, "/api/rag/ingest")).toEqual({ source: "eval-corpus", reset: false });

	await page.getByRole("checkbox", { name: /ハイブリッド検索/ }).check();
	await page.getByRole("checkbox", { name: /Rerank/ }).check();
	await ask(page);

	const answer = page.getByRole("region", { name: "回答" });
	await expect(answer).toContainText("RAG は、質問の前に外部の文書から関連する部分を検索し");
	await expect(page.getByRole("status", { name: "実行の状態" })).toHaveText("回答が完了しました");
	// The stages of the methods that were switched on, each finished.
	const stages = page.getByRole("list", { name: "段階" });
	for (const stage of ["ベクトル検索", "全文検索", "結果の統合", "Rerank", "回答の生成"]) {
		await expect(stages.getByRole("listitem").filter({ hasText: stage })).toContainText("完了");
	}
	await expect(stages).not.toContainText("仮想回答の生成");
	expect(bodyOf(api, "/api/rag/query")).toMatchObject({
		question: QUESTION,
		settings: { methods: { hyde: false, multiQuery: false, hybrid: true, rerank: true } },
	});

	// The footnote is a link to its card, and the card receives the focus.
	await page.getByRole("link", { name: "[1]" }).click();
	await expect(citationCards(page).first()).toBeFocused();
	await expect(citationCards(page).first()).toContainText("引用あり");
	await expect(citationCards(page).nth(1)).toContainText("取得のみ");

	// The intermediate results are collapsed until asked for.
	const vector = page.locator("details", { hasText: "ベクトル検索の候補" });
	await expect(vector).not.toHaveAttribute("open", "");
	await vector.getByText("ベクトル検索の候補", { exact: true }).click();
	await expect(vector).toHaveAttribute("open", "");
	await expect(vector).toContainText("RAG の全体像");
});

test("rag: a footnote moves the focus to its card from the keyboard (Enter and Space)", async ({
	page,
}) => {
	await mockApi(page, { "/api/rag/query": streamReply("rag-query") });
	await page.goto("/rag");
	await ask(page);
	const link = page.getByRole("link", { name: "[1]" });
	await expect(link).toBeVisible();

	await link.focus();
	await page.keyboard.press("Enter");
	await expect(citationCards(page).first()).toBeFocused();

	await link.focus();
	await expect(citationCards(page).first()).not.toBeFocused();
	await page.keyboard.press("Space");
	await expect(citationCards(page).first()).toBeFocused();
});

test("rag: an empty knowledge base answers 'no evidence' with no citation", async ({ page }) => {
	await mockApi(page, { "/api/rag/query": streamReply("rag-query-no-evidence") });
	await page.goto("/rag");

	await ask(page, "存在しない話題について教えてください。");

	const answer = page.getByRole("region", { name: "回答" });
	await expect(answer.getByText("該当なし", { exact: true })).toBeVisible();
	await expect(answer).toContainText("根拠となる資料が見つかりませんでした");
	await expect(answer.getByText("引用できる文書はありません。")).toBeVisible();
	await expect(page.getByRole("link", { name: /^\[\d+\]$/ })).toHaveCount(0);
});

test("rag: Agentic RAG says it searched, and cites what it found", async ({ page }) => {
	const api = await mockApi(page, { "/api/rag/agent": streamReply("rag-agent-search") });
	await page.goto("/rag");

	await page.getByRole("checkbox", { name: /Agentic RAG/ }).check();
	await ask(page, "Agentic RAG は固定の RAG と何が違いますか。");

	const answer = page.getByRole("region", { name: "回答" });
	await expect(answer.getByText("検索しました（1 回）")).toBeVisible();
	await expect(answer.getByRole("list", { name: "検索の呼び出し" })).toBeVisible();
	await expect(answer).toContainText("Agentic RAG は検索の要否や回数をエージェントが決めます");
	await expect(answer.getByRole("status", { name: "実行サマリ" })).toContainText("完了");
	await page.getByRole("link", { name: "[1]" }).click();
	await expect(citationCards(page).first()).toBeFocused();
	// One user message, the persona the schema requires, and none of the pipeline settings.
	const body = bodyOf(api, "/api/rag/agent");
	expect(body).toMatchObject({ modelId: "mock:general-v1" });
	expect(body).not.toHaveProperty("settings");
	expect(body.messages).toHaveLength(1);
});

test("rag: Agentic RAG says so when it answered without searching", async ({ page }) => {
	await mockApi(page, { "/api/rag/agent": streamReply("rag-agent-no-search") });
	await page.goto("/rag");

	await page.getByRole("checkbox", { name: /Agentic RAG/ }).check();
	await ask(page, "ありがとう、助かりました。");

	const answer = page.getByRole("region", { name: "回答" });
	await expect(answer.getByText("検索せずに回答しました")).toBeVisible();
	await expect(answer).toContainText("ナレッジベースを検索していません");
	await expect(answer.getByRole("list", { name: "引用" })).toHaveCount(0);
	await expect(answer).toContainText("どういたしまして");
});

test("rag: emptying the knowledge base asks first, and the dialog defaults to Cancel", async ({
	page,
}) => {
	const api = await mockApi(page, {
		"/api/rag/ingest": jsonReply(INGEST_RESULT),
		"/api/rag/knowledge": jsonReply(KNOWLEDGE_AFTER_INGEST),
	});
	await page.goto("/rag");
	await page.getByRole("radio", { name: "評価用コーパス" }).check();
	await page.getByRole("checkbox", { name: /ナレッジベースを空にしてから/ }).check();
	const dialog = page.getByRole("dialog", { name: "ナレッジベースを削除しますか？" });

	// Escape closes it without sending.
	await page.getByRole("button", { name: "取り込む" }).click();
	await expect(dialog).toBeVisible();
	await expect(dialog.getByRole("button", { name: "キャンセル" })).toBeFocused();
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
	expect(api.requests.filter((entry) => entry.path === "/api/rag/ingest")).toHaveLength(0);

	// So does Cancel.
	await page.getByRole("button", { name: "取り込む" }).click();
	await dialog.getByRole("button", { name: "キャンセル" }).click();
	await expect(dialog).toBeHidden();
	expect(api.requests.filter((entry) => entry.path === "/api/rag/ingest")).toHaveLength(0);

	// Only the explicit confirmation sends `reset: true`.
	await page.getByRole("button", { name: "取り込む" }).click();
	await dialog.getByRole("button", { name: "削除して取り込む" }).click();
	await expect(page.getByRole("status", { name: "取り込み結果" })).toContainText(
		"6 件の文書を取り込みました",
	);
	expect(bodyOf(api, "/api/rag/ingest")).toEqual({ source: "eval-corpus", reset: true });
	await expect(
		page.getByRole("checkbox", { name: /ナレッジベースを空にしてから/ }),
	).not.toBeChecked();
});

test("rag: stop keeps the text received so far and is not an error", async ({ page }) => {
	const api = await mockApi(page, {
		"/api/rag/query": streamReply("rag-query", { holdAfter: { type: "text-delta", count: 2 } }),
	});
	await page.goto("/rag");
	await ask(page);
	await api.waitUntilHeld();

	const answer = page.getByRole("region", { name: "回答" });
	await expect(answer).toContainText("RAG は、質問の前に外部の文書");
	await expect(answer).not.toContainText("生成する方式です");
	await expect(page.getByRole("status", { name: "実行の状態" })).toHaveText("回答を生成しています");
	await expect(page.getByRole("button", { name: "質問する" })).toBeDisabled();

	await page.getByRole("button", { name: "停止" }).click();

	await expect(page.getByRole("button", { name: "停止" })).toHaveCount(0);
	await expect(page.getByRole("status", { name: "実行の状態" })).toContainText(
		"生成を停止しました",
	);
	await expect(answer).toContainText("RAG は、質問の前に外部の文書");
	await expect(answer).not.toContainText("生成する方式です");
	await expect(alerts(page)).toHaveCount(0);
	await expect(page.getByRole("button", { name: "質問する" })).toBeEnabled();
});

test("rag: a failed request shows the server's message and retry asks the same question", async ({
	page,
}) => {
	const api = await mockApi(page, {
		"/api/rag/query": [
			errorReply(503, {
				code: "provider-unavailable",
				message: "検索に失敗しました。ナレッジベースと埋め込みモデルの設定を確認してください。",
			}),
			streamReply("rag-query"),
		],
	});
	await page.goto("/rag");
	await ask(page);

	await expect(alerts(page)).toContainText("検索に失敗しました。");
	await page.getByRole("button", { name: "再送信" }).click();

	await expect(page.getByRole("region", { name: "回答" })).toContainText("RAG は、質問の前に");
	await expect(alerts(page)).toHaveCount(0);
	expect(bodyOf(api, "/api/rag/query", 1)).toMatchObject({ question: QUESTION });
});
