import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
// The mock embedding finds a chunk only for its exact text, so the sample question is the corpus
// text itself; importing it keeps the spec in step with the corpus.
import { M2_1_SAMPLE_QUESTIONS } from "../../../packages/ai-core/fixtures/scenarios/m2-1";
// A pure module (no vitest import), unlike the `@platform/ai-core/testing` index.
import { buildTextPdf } from "../../../packages/ai-core/src/testing/pdf-builder";
import { fillUntilEnabled } from "./support/form";

// No `page.route`: every request goes through the real Route Handlers of `next start` in `mock`
// mode (request guard, gateway, scenario models). Plan C19, Req 1.17.

const PAGES = [
	{ path: "/chat", heading: "チャット" },
	{ path: "/agent", heading: "ツールエージェント" },
	{ path: "/summarize", heading: "要約" },
	{ path: "/rag", heading: "RAG（検索拡張生成）" },
	{ path: "/workflows", heading: "ワークフローとエージェントパターン" },
] as const;

function collectBrowserErrors(page: Page): string[] {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") errors.push(message.text());
	});
	return errors;
}

for (const { path, heading } of PAGES) {
	test(`${path} renders with its styles and no browser errors`, async ({ page }) => {
		const errors = collectBrowserErrors(page);

		const response = await page.goto(path);

		// Regression: Turbopack failed on the fixtures directory URL and on `tw-animate-css`, which
		// made every page a 500.
		expect(response?.status()).toBe(200);
		await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
		// Regression: without `@tailwindcss/postcss` the theme rules are dropped and the page is
		// unstyled, so the body has no background colour.
		const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
		expect(background).not.toBe("rgba(0, 0, 0, 0)");
		expect(errors).toEqual([]);
	});
}

test("chat: one round trip through the real route", async ({ page }) => {
	await page.goto("/chat");

	await fillUntilEnabled(
		page.getByLabel("メッセージ"),
		"こんにちは",
		page.getByRole("button", { name: "送信" }),
	);
	await page.getByRole("button", { name: "送信" }).click();

	await expect(page.getByRole("log", { name: "会話" })).toContainText(
		"モックモードから決定論的に応答しています。",
	);
});

test("agent: one tool call and its answer through the real route", async ({ page }) => {
	await page.goto("/agent");

	await fillUntilEnabled(
		page.getByLabel("メッセージ"),
		"東京の天気を教えて",
		page.getByRole("button", { name: "送信" }),
	);
	await page.getByRole("button", { name: "送信" }).click();

	await expect(page.getByRole("log", { name: "会話" })).toContainText(
		"東京は晴れ、気温は22°Cです。",
	);
});

test("summarize: one summary through the real route", async ({ page }) => {
	await page.goto("/summarize");

	await page.getByRole("radio", { name: "字幕テキスト" }).check();
	await fillUntilEnabled(
		page.getByLabel("字幕テキストを貼り付け"),
		"fixture:summary-full 本文です。",
		page.getByRole("button", { name: "要約する" }),
	);
	await page.getByRole("button", { name: "要約する" }).click();

	await expect(page.getByRole("list", { name: "要点" })).toBeVisible();
});

// RAG knowledge base (plan "実サーバーの確認", risk R-1): PGlite's WASM, `unpdf` and `postgres`
// must survive the Turbopack server bundle. The pages arrive in W5; the routes are checked here
// through the real server, with the in-memory PGlite of `mock` mode. All three engines share the
// one server, so the assertions hold in any order (ingesting the same corpus twice replaces it).
const CORPUS_FILES = [
	"01-rag-overview.md",
	"02-chunking.md",
	"03-embeddings-and-search.md",
	"04-hybrid-and-rrf.md",
	"05-rerank-and-evaluation.md",
	"06-agentic-rag.md",
];

test("rag: the knowledge route reports the embedding model and the corpus files", async ({
	request,
}) => {
	const response = await request.get("/api/rag/knowledge");

	expect(response.status()).toBe(200);
	const body = await response.json();
	expect(body.embedding).toEqual({ modelId: "mock:embedding-v1", dimensions: 768 });
	expect(body.available.evalCorpus).toEqual(CORPUS_FILES);
	expect(body.rerank).toEqual({ available: true });
});

test("rag: ingesting the evaluation corpus through PGlite, then listing it", async ({
	request,
}) => {
	const ingest = await request.post("/api/rag/ingest", { data: { source: "eval-corpus" } });

	expect(ingest.status()).toBe(200);
	const result = await ingest.json();
	expect(result.skipped).toEqual([]);
	expect(result.ingested.map((entry: { documentId: string }) => entry.documentId)).toEqual(
		CORPUS_FILES.map((file) => `eval:${file}`),
	);

	const listed = await (await request.get("/api/rag/knowledge")).json();
	expect(listed.knowledgeBase.embeddingModelId).toBe("mock:embedding-v1");
	expect(listed.knowledgeBase.documents.map((doc: { id: string }) => doc.id)).toEqual(
		expect.arrayContaining(CORPUS_FILES.map((file) => `eval:${file}`)),
	);
});

test("rag: a path-traversing file name is refused by the real route", async ({ request }) => {
	const response = await request.post("/api/rag/ingest", {
		data: { source: "knowledge", files: ["../README.md"] },
	});

	expect(response.status()).toBe(400);
	expect((await response.json()).error.code).toBe("invalid-request");
});

test("rag: a PDF is read by unpdf in the real server and keeps its page numbers", async ({
	request,
}, testInfo) => {
	// The learner's `knowledge/` directory is the only place the route reads PDFs from. Each engine
	// writes its own file and removes it, so parallel projects do not touch each other's file.
	const directory = path.resolve(process.cwd(), "..", "..", "knowledge");
	const file = `e2e-real-server-${testInfo.project.name}.pdf`;
	await mkdir(directory, { recursive: true });
	await writeFile(
		path.join(directory, file),
		buildTextPdf(["first page of the report", "second page of the report"]),
	);
	try {
		const response = await request.post("/api/rag/ingest", {
			data: { source: "knowledge", files: [file] },
		});

		expect(response.status()).toBe(200);
		const result = await response.json();
		expect(result.skipped).toEqual([]);
		expect(result.ingested).toEqual([
			{ documentId: `kb:${file}`, title: file.replace(/\.pdf$/, ""), chunks: 2 },
		]);
	} finally {
		await rm(path.join(directory, file), { force: true });
	}
});

// Plan "実サーバーの確認" (risk R-1), W5: the /rag page reads the knowledge base while it renders
// (a Server Component), which is a different bundle layer from the Route Handlers above. Without
// `serverExternalPackages` for PGlite it answered "Extension bundle not found" and the page showed
// a connection error while Vitest stayed green. This walks the whole path in the browser: ingest
// the evaluation corpus, ask the corpus's own first chunk, read the cited answer.
test("rag: ingest the corpus on the page and ask a question through the real routes", async ({
	page,
}) => {
	const errors = collectBrowserErrors(page);
	await page.goto("/rag");
	// The server-rendered panel, not the "cannot connect" alert.
	await expect(page.getByRole("region", { name: "ナレッジベースの取り込み" })).toBeVisible();
	await expect(page.getByText("ナレッジベースに接続できません")).toHaveCount(0);

	await page.getByRole("radio", { name: "評価用コーパス" }).check();
	await page.getByRole("button", { name: "取り込む" }).click();
	await expect(page.getByRole("status", { name: "取り込み結果" })).toContainText(
		"6 件の文書を取り込みました",
	);
	await expect(page.getByRole("list", { name: "取り込み済みの文書" })).toContainText(
		"RAG の全体像",
	);

	await fillUntilEnabled(
		page.getByLabel("質問", { exact: true }),
		M2_1_SAMPLE_QUESTIONS.answer,
		page.getByRole("button", { name: "質問する" }),
	);
	await page.getByRole("button", { name: "質問する" }).click();

	await expect(page.getByRole("region", { name: "回答" })).toContainText(
		"RAG は、質問の前に外部の文書から関連する部分を検索し",
	);
	await expect(page.getByRole("link", { name: "[1]" })).toBeVisible();
	await expect(
		page.getByRole("list", { name: "引用" }).getByRole("listitem").first(),
	).toContainText("RAG の全体像");
	expect(errors).toEqual([]);
});

test("workflows: one run through the real route", async ({ page }) => {
	await page.goto("/workflows");

	await page.getByRole("button", { name: "実行" }).click();

	const result = page.getByRole("article", { name: "実行結果: プロンプトチェーン" });
	await expect(result.getByRole("list", { name: "ステップ" })).toBeVisible();
	await expect(result.getByRole("region", { name: "最終出力" })).toBeVisible();
	await expect(result.getByRole("region", { name: "使用量" })).toContainText("モデル呼び出し 2 回");
});
