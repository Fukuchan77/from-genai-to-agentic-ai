import { expect, type Page, test } from "@playwright/test";
import { accessibilityViolations, applyColorScheme, type ColorScheme } from "./support/axe";
import { errorReply, jsonReply, mapEvents, mockApi, streamReply } from "./support/mock-api";

// Req 1.19, NFR-09: axe (WCAG 2.2 AA) on every screen in both themes, both on the empty screen and
// after a mocked response has rendered messages, tool cards, errors and summaries. The dark theme
// is a `.dark` class on <html>, so it is checked explicitly rather than through
// prefers-color-scheme.

const PATHS = ["/chat", "/agent", "/summarize", "/rag", "/workflows"] as const;
const SCHEMES: readonly ColorScheme[] = ["light", "dark"];

for (const path of PATHS) {
	for (const scheme of SCHEMES) {
		test(`${path} has no axe violations (${scheme})`, async ({ page }) => {
			await page.goto(path);
			await applyColorScheme(page, scheme);
			await expect(page.locator("html")).toHaveClass(scheme === "dark" ? /dark/ : /^(?!.*dark).*$/);

			expect(await accessibilityViolations(page)).toEqual([]);
		});
	}
}

async function sendMessage(page: Page, text: string): Promise<void> {
	await page.getByLabel("メッセージ").fill(text);
	await page.getByRole("button", { name: "送信" }).click();
}

async function summarizeArticle(page: Page): Promise<void> {
	await page.getByRole("radio", { name: "記事の URL" }).check();
	await page
		.getByLabel("記事の URL（http / https）")
		.fill("https://example.test/articles/agentic-ai");
	await page.getByRole("button", { name: "要約する" }).click();
}

async function askRag(page: Page, question = "RAG とは何ですか？"): Promise<void> {
	await page.getByLabel("質問", { exact: true }).fill(question);
	await page.getByRole("button", { name: "質問する" }).click();
}

const INGEST_RESULT = {
	ingested: [{ documentId: "eval:01-rag-overview.md", title: "RAG の全体像", chunks: 6 }],
	skipped: [{ file: "broken.pdf", reason: "no-text" }],
	embeddingModelId: "mock:embedding-v1",
};

const KNOWLEDGE_AFTER_INGEST = {
	embedding: { modelId: "mock:embedding-v1", dimensions: 768 },
	knowledgeBase: {
		embeddingModelId: "mock:embedding-v1",
		documents: [
			{
				id: "eval:01-rag-overview.md",
				title: "RAG の全体像",
				sourceType: "markdown",
				tags: [],
				chunkCount: 6,
				ingestedAt: "2026-10-13T00:00:00.000Z",
			},
		],
	},
	available: { knowledge: [], evalCorpus: ["01-rag-overview.md"] },
	rerank: { available: true },
};

/** A rendered state: its mocked API, the screen, and how to reach the state on that screen. */
interface RenderedState {
	readonly name: string;
	readonly path: (typeof PATHS)[number];
	readonly routes: Parameters<typeof mockApi>[1];
	readonly reach: (page: Page, api: Awaited<ReturnType<typeof mockApi>>) => Promise<void>;
}

const STATES: readonly RenderedState[] = [
	{
		name: "chat answer",
		path: "/chat",
		routes: { "/api/chat": streamReply("chat-greeting") },
		reach: async (page) => {
			await sendMessage(page, "こんにちは");
			await expect(page.getByRole("log", { name: "会話" })).toContainText("決定論的に応答");
		},
	},
	{
		name: "chat error with resend",
		path: "/chat",
		routes: {
			"/api/chat": errorReply(503, {
				code: "provider-unavailable",
				message: "モデルのプロバイダに接続できませんでした。",
			}),
		},
		reach: async (page) => {
			await sendMessage(page, "こんにちは");
			await expect(page.getByRole("button", { name: "再送信" })).toBeVisible();
		},
	},
	{
		name: "agent weather card and run summary",
		path: "/agent",
		routes: { "/api/agent/tools": streamReply("agent-weather") },
		reach: async (page) => {
			await sendMessage(page, "東京の天気を教えて");
			await expect(page.getByRole("region", { name: "天気" })).toBeVisible();
			await expect(page.getByRole("status", { name: "実行サマリ" })).toBeVisible();
		},
	},
	{
		name: "agent tool failure",
		path: "/agent",
		routes: {
			"/api/agent/tools": streamReply("agent-weather", {
				transform: (events) =>
					mapEvents(events, "tool-output-available", (event) => ({
						...event,
						output: {
							ok: false,
							failure: {
								kind: "recoverable",
								summary: "天気の取得に失敗しました。",
								nextAction: "都市名を確認してもう一度お試しください。",
							},
						},
					})),
			}),
		},
		reach: async (page) => {
			await sendMessage(page, "東京の天気を教えて");
			await expect(page.getByRole("group").filter({ hasText: "再試行できる失敗" })).toBeVisible();
		},
	},
	{
		name: "summary card while streaming (skeletons)",
		path: "/summarize",
		routes: {
			"/api/summarize": streamReply("summarize-article", {
				holdAfter: { type: "data-summary", count: 3 },
			}),
		},
		reach: async (page, api) => {
			await summarizeArticle(page);
			await api.waitUntilHeld();
			await expect(page.getByRole("article")).toHaveAttribute("aria-busy", "true");
		},
	},
	{
		name: "finished summary and processing info",
		path: "/summarize",
		routes: { "/api/summarize": streamReply("summarize-article") },
		reach: async (page) => {
			await summarizeArticle(page);
			await expect(page.getByRole("region", { name: "要約の処理情報" })).toBeVisible();
		},
	},
	{
		name: "rag answer with stages, citations and the intermediate results opened",
		path: "/rag",
		routes: { "/api/rag/query": streamReply("rag-query") },
		reach: async (page) => {
			await page.getByRole("checkbox", { name: /ハイブリッド検索/ }).check();
			await page.getByRole("checkbox", { name: /Rerank/ }).check();
			await askRag(page);
			await expect(page.getByRole("list", { name: "引用" })).toBeVisible();
			await page.getByText("ベクトル検索の候補", { exact: true }).click();
			await page.getByText("Rerank 後", { exact: true }).click();
			await expect(page.locator("details[open]")).toHaveCount(2);
		},
	},
	{
		name: "rag answer while streaming",
		path: "/rag",
		routes: {
			"/api/rag/query": streamReply("rag-query", { holdAfter: { type: "text-delta", count: 2 } }),
		},
		reach: async (page, api) => {
			await askRag(page);
			await api.waitUntilHeld();
			await expect(page.getByRole("region", { name: "回答" })).toHaveAttribute("aria-busy", "true");
		},
	},
	{
		name: "rag no-evidence answer",
		path: "/rag",
		routes: { "/api/rag/query": streamReply("rag-query-no-evidence") },
		reach: async (page) => {
			await askRag(page, "存在しない話題について教えてください。");
			await expect(page.getByText("該当なし", { exact: true })).toBeVisible();
		},
	},
	{
		name: "rag error with resend",
		path: "/rag",
		routes: {
			"/api/rag/query": errorReply(503, {
				code: "provider-unavailable",
				message: "検索に失敗しました。",
			}),
		},
		reach: async (page) => {
			await askRag(page);
			await expect(page.getByRole("button", { name: "再送信" })).toBeVisible();
		},
	},
	{
		name: "rag agent run that searched",
		path: "/rag",
		routes: { "/api/rag/agent": streamReply("rag-agent-search") },
		reach: async (page) => {
			await page.getByRole("checkbox", { name: /Agentic RAG/ }).check();
			await askRag(page, "Agentic RAG は固定の RAG と何が違いますか。");
			await expect(page.getByText("検索しました（1 回）")).toBeVisible();
			await expect(page.getByRole("status", { name: "実行サマリ" })).toBeVisible();
		},
	},
	{
		name: "rag agent run that did not search",
		path: "/rag",
		routes: { "/api/rag/agent": streamReply("rag-agent-no-search") },
		reach: async (page) => {
			await page.getByRole("checkbox", { name: /Agentic RAG/ }).check();
			await askRag(page, "ありがとう、助かりました。");
			await expect(page.getByText("検索せずに回答しました")).toBeVisible();
		},
	},
	{
		name: "rag ingest result with a skipped file",
		path: "/rag",
		routes: {
			"/api/rag/ingest": jsonReply(INGEST_RESULT),
			"/api/rag/knowledge": jsonReply(KNOWLEDGE_AFTER_INGEST),
		},
		reach: async (page) => {
			await page.getByRole("radio", { name: "評価用コーパス" }).check();
			await page.getByRole("button", { name: "取り込む" }).click();
			await expect(page.getByRole("status", { name: "取り込み結果" })).toBeVisible();
		},
	},
	{
		name: "rag reset confirmation dialog",
		path: "/rag",
		routes: {},
		reach: async (page) => {
			await page.getByRole("radio", { name: "評価用コーパス" }).check();
			await page.getByRole("checkbox", { name: /ナレッジベースを空にしてから/ }).check();
			await page.getByRole("button", { name: "取り込む" }).click();
			await expect(
				page.getByRole("dialog", { name: "ナレッジベースを削除しますか？" }),
			).toBeVisible();
		},
	},
	{
		name: "workflows evaluator-optimizer that missed the pass score",
		path: "/workflows",
		routes: { "/api/workflows": jsonReply("workflows-evaluator-optimizer") },
		reach: async (page) => {
			await page.getByLabel("名前").selectOption("evaluator-optimizer");
			await page.getByRole("button", { name: "実行" }).click();
			await expect(page.getByRole("article", { name: /実行結果/ })).toContainText("未合格");
		},
	},
	{
		name: "workflows option error",
		path: "/workflows",
		routes: {},
		reach: async (page) => {
			await page.getByLabel("名前").selectOption("evaluator-optimizer");
			await page.getByLabel("最大反復回数").fill("99");
			await expect(page.getByText("1 以上 8 以下の整数")).toBeVisible();
		},
	},
	{
		name: "workflows rejected run",
		path: "/workflows",
		routes: {
			"/api/workflows": errorReply(400, {
				code: "invalid-request",
				message: "options の形式が正しくありません。",
			}),
		},
		reach: async (page) => {
			await page.getByRole("button", { name: "実行" }).click();
			await expect(page.getByRole("button", { name: "再送信" })).toBeVisible();
		},
	},
];

for (const state of STATES) {
	for (const scheme of SCHEMES) {
		test(`${state.path}: ${state.name} has no axe violations (${scheme})`, async ({ page }) => {
			const api = await mockApi(page, state.routes);
			await page.goto(state.path);
			await applyColorScheme(page, scheme);

			await state.reach(page, api);

			expect(await accessibilityViolations(page)).toEqual([]);
		});
	}
}
