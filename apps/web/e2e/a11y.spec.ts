import { expect, type Page, test } from "@playwright/test";
import { accessibilityViolations, applyColorScheme, type ColorScheme } from "./support/axe";
import { fillUntilEnabled } from "./support/form";
import { errorReply, jsonReply, mapEvents, mockApi, streamReply } from "./support/mock-api";

// Req 1.19, NFR-09: axe (WCAG 2.2 AA) on every screen in both themes, both on the empty screen and
// after a mocked response has rendered messages, tool cards, errors and summaries. The dark theme
// is a `.dark` class on <html>, so it is checked explicitly rather than through
// prefers-color-scheme.

const PATHS = [
	"/chat",
	"/agent",
	"/summarize",
	"/rag",
	"/workflows",
	"/mcp",
	"/helpdesk",
	"/analysis",
	"/research",
	"/requirements",
	"/marketing",
] as const;
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
	await fillUntilEnabled(
		page.getByLabel("メッセージ"),
		text,
		page.getByRole("button", { name: "送信" }),
	);
	await page.getByRole("button", { name: "送信" }).click();
}

async function summarizeArticle(page: Page): Promise<void> {
	await page.getByRole("radio", { name: "記事の URL" }).check();
	await fillUntilEnabled(
		page.getByLabel("記事の URL（http / https）"),
		"https://example.test/articles/agentic-ai",
		page.getByRole("button", { name: "要約する" }),
	);
	await page.getByRole("button", { name: "要約する" }).click();
}

async function askRag(page: Page, question = "RAG とは何ですか？"): Promise<void> {
	await fillUntilEnabled(
		page.getByLabel("質問", { exact: true }),
		question,
		page.getByRole("button", { name: "質問する" }),
	);
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

// Module 3 screens (plan C14, Req 1.7, 3.1): the helpers reach each screen's richest states, with
// the same mocked streams the per-screen specs use.

async function fillAndClick(
	page: Page,
	label: string,
	text: string,
	button: string,
): Promise<void> {
	await fillUntilEnabled(
		page.getByLabel(label, { exact: true }),
		text,
		page.getByRole("button", { name: button, exact: true }),
	);
	await page.getByRole("button", { name: button, exact: true }).click();
}

async function analyseCsv(page: Page): Promise<void> {
	await page.getByLabel("分析するファイル").setInputFiles({
		name: "sales.csv",
		mimeType: "text/csv",
		buffer: Buffer.from("date,sales\n2026-01-05,120000\n2026-02-05,98000\n"),
	});
	await fillAndClick(page, "分析の指示", "月ごとの売上を集計してください", "分析する");
}

async function startInterview(page: Page): Promise<void> {
	await fillAndClick(
		page,
		"プロダクトの概要",
		"社内の問い合わせを自動で振り分けるチャットボット",
		"面接を始める",
	);
}

async function answerInterview(page: Page): Promise<void> {
	const field = page.getByLabel("今の振り分けで、いちばん時間がかかっているのはどの作業ですか。");
	await fillUntilEnabled(
		field,
		"問い合わせの分類に時間がかかります。",
		page.getByRole("button", { name: "回答を送信" }),
	);
	await page.getByRole("button", { name: "回答を送信" }).click();
}

const REQUIREMENTS_MESSAGES = "/api/requirements/sessions/[id]/messages" as const;

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
	{
		name: "mcp chat with tool calls, then the comparison",
		path: "/mcp",
		routes: {
			"/api/mcp/chat": streamReply("mcp-chat"),
			"/api/mcp/compare": jsonReply("mcp-compare"),
		},
		reach: async (page) => {
			await fillAndClick(page, "メッセージ", "許可ルートのファイルを一覧してください。", "送信");
			await expect(page.getByRole("log", { name: "会話" })).toContainText("listFiles");
			await page.getByRole("button", { name: "比較を実行" }).click();
			await expect(page.getByRole("table").first()).toBeVisible();
		},
	},
	{
		name: "mcp fatal tool error",
		path: "/mcp",
		routes: { "/api/mcp/chat": streamReply("mcp-chat-error") },
		reach: async (page) => {
			await fillAndClick(
				page,
				"メッセージ",
				"許可ルートの外の /etc/hosts を読んでください。",
				"送信",
			);
			await expect(
				page.getByRole("alert").filter({ hasText: "実行がエラーで終了しました" }),
			).toBeVisible();
		},
	},
	{
		name: "mcp server list after a refresh",
		path: "/mcp",
		routes: { "/api/mcp/servers": jsonReply("mcp-servers") },
		reach: async (page) => {
			await page.getByRole("button", { name: "状態を更新" }).click();
			await expect(page.locator("[data-server='github']")).toContainText("利用不可");
		},
	},
	{
		name: "helpdesk run with a revised plan and the ticket list",
		path: "/helpdesk",
		routes: {
			"/api/helpdesk": streamReply("helpdesk"),
			"/api/helpdesk/tickets": jsonReply("helpdesk-tickets"),
		},
		reach: async (page) => {
			await fillAndClick(
				page,
				"問い合わせ",
				"共有プリンターを追加したいのですが、表示されません。",
				"問い合わせる",
			);
			await expect(page.getByRole("region", { name: "最終結果" })).toBeVisible();
			await expect(page.getByRole("region", { name: "修正された計画" })).toContainText("改訂 1");
			await expect(page.locator("[data-ticket-id='T-0003']")).toBeVisible();
		},
	},
	{
		name: "helpdesk error with resend",
		path: "/helpdesk",
		routes: {
			"/api/helpdesk": errorReply(503, {
				code: "provider-unavailable",
				message: "モデルに接続できませんでした。",
			}),
			"/api/helpdesk/tickets": jsonReply("helpdesk-tickets"),
		},
		reach: async (page) => {
			await fillAndClick(page, "問い合わせ", "共有プリンターを追加したい。", "問い合わせる");
			await expect(page.getByRole("button", { name: "再送信" })).toBeVisible();
		},
	},
	{
		name: "analysis result with the figure, the table and the attempt history",
		path: "/analysis",
		routes: { "/api/analysis": streamReply("analysis") },
		reach: async (page) => {
			await analyseCsv(page);
			await expect(page.getByRole("img", { name: "Monthly sales bar chart" })).toBeVisible();
			await expect(page.getByRole("table", { name: "Monthly sales" })).toBeVisible();
			await expect(page.getByRole("region", { name: "試行履歴" })).toContainText("成功");
		},
	},
	{
		name: "analysis stopped at the attempt limit",
		path: "/analysis",
		routes: { "/api/analysis": streamReply("analysis-attempt-limit") },
		reach: async (page) => {
			await analyseCsv(page);
			await expect(page.getByRole("region", { name: "試行履歴" }).getByRole("alert")).toContainText(
				"修正回数の上限に達したため停止しました",
			);
		},
	},
	{
		name: "research report with a citation warning and the token breakdown",
		path: "/research",
		routes: { "/api/research": streamReply("research") },
		reach: async (page) => {
			await fillAndClick(page, "テーマ", "階層型エージェントの最新動向", "リサーチする");
			await expect(page.getByRole("status", { name: "引用の警告" })).toBeVisible();
			await expect(page.getByRole("table", { name: "役割別のトークン内訳" })).toBeVisible();
		},
	},
	{
		name: "research report with a missing aspect",
		path: "/research",
		routes: { "/api/research": streamReply("research-partial") },
		reach: async (page) => {
			await fillAndClick(page, "テーマ", "リサーチエージェントの評価手法", "リサーチする");
			await expect(page.getByRole("status", { name: "欠落した観点" })).toBeVisible();
		},
	},
	{
		name: "requirements preview and an insufficient verdict",
		path: "/requirements",
		routes: {
			"/api/requirements/sessions": jsonReply("requirements-session"),
			[REQUIREMENTS_MESSAGES]: streamReply("requirements"),
		},
		reach: async (page) => {
			await startInterview(page);
			await answerInterview(page);
			await expect(page.getByRole("region", { name: "十分性の判定" })).toContainText(
				"情報が不足しています",
			);
			await expect(page.getByRole("region", { name: "要件プレビュー" })).toContainText("機能要件");
		},
	},
	{
		name: "requirements sufficient verdict with the download link",
		path: "/requirements",
		routes: {
			"/api/requirements/sessions": jsonReply("requirements-session"),
			[REQUIREMENTS_MESSAGES]: streamReply("requirements", {
				transform: (events) =>
					mapEvents(
						events.filter((event) => event.type !== "data-requirements-questions"),
						"data-requirements-judgement",
						(event) => ({
							...event,
							data: { round: 1, sufficient: true, missing: [], forcedEnd: false },
						}),
					),
			}),
		},
		reach: async (page) => {
			await startInterview(page);
			await answerInterview(page);
			await expect(
				page.getByRole("link", { name: "requirements.md をダウンロード" }),
			).toBeVisible();
		},
	},
	{
		name: "marketing council with rounds and the result",
		path: "/marketing",
		routes: { "/api/marketing/council": streamReply("marketing-council") },
		reach: async (page) => {
			await fillAndClick(page, "広告文案", "ステンレス保温ボトル 500ml。", "合議を始める");
			await expect(page.getByRole("region", { name: "合議の結果" })).toBeVisible();
		},
	},
	{
		name: "marketing recommendation cards and the profile",
		path: "/marketing",
		routes: { "/api/marketing/recommend": streamReply("marketing-recommend") },
		reach: async (page) => {
			await fillAndClick(
				page,
				"メッセージ",
				"ランニングを始めたいです。予算は 1 万円です。",
				"送信",
			);
			await expect(page.getByRole("article", { name: "P-006 ランニングシューズ" })).toBeVisible();
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
