import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
// The mock embedding finds a chunk only for its exact text, so the sample question is the corpus
// text itself; importing it keeps the spec in step with the corpus.
import { M2_1_SAMPLE_QUESTIONS } from "../../../packages/ai-core/fixtures/scenarios/m2-1";
import { M3_1_SAMPLE_TASKS } from "../../../packages/ai-core/fixtures/scenarios/m3-1";
import { M3_2_SAMPLE_INQUIRIES } from "../../../packages/ai-core/fixtures/scenarios/m3-2";
import { M3_3_SAMPLE_INSTRUCTIONS } from "../../../packages/ai-core/fixtures/scenarios/m3-3";
import { M3_4_SAMPLE_THEMES } from "../../../packages/ai-core/fixtures/scenarios/m3-4";
import {
	M3_5_SAMPLE_ANSWERS,
	M3_5_SAMPLE_OVERVIEWS,
} from "../../../packages/ai-core/fixtures/scenarios/m3-5";
import {
	M3_6_SAMPLE_DRAFTS,
	M3_6_SAMPLE_MESSAGES,
} from "../../../packages/ai-core/fixtures/scenarios/m3-6";
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
	{ path: "/mcp", heading: "MCP（Model Context Protocol）" },
	{ path: "/helpdesk", heading: "ヘルプデスク" },
	{ path: "/analysis", heading: "データ分析" },
	{ path: "/research", heading: "階層型リサーチ" },
	{ path: "/requirements", heading: "要件定義インタビュー" },
	{ path: "/marketing", heading: "マーケティング" },
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

// Module 3-1 (plan C13, risk R-1): `@ai-sdk/mcp` and `@modelcontextprotocol/server` are bundled and
// the platform's own file server starts as a child process from the repository's source (Node's type
// stripping). Vitest never goes through the bundler, so only this spec can catch either failing.

interface McpServerStatusBody {
	id: string;
	state: string;
	reason?: string;
	tools: { name: string; risk: string; registered: boolean; disabledReason?: string }[];
}

test("mcp: the real route starts the file server as a child process and lists its tools", async ({
	request,
}) => {
	const response = await request.get("/api/mcp/servers");

	expect(response.status()).toBe(200);
	const body = (await response.json()) as {
		servers: McpServerStatusBody[];
		limits: { maxTools: number };
		think: { enabled: boolean };
	};
	const files = body.servers.find((server) => server.id === "files");
	expect(files?.state, files?.reason).toBe("connected");
	expect(
		files?.tools
			.filter((tool) => tool.registered)
			.map((tool) => tool.name)
			.sort(),
	).toEqual(["findAndReadFiles", "listFiles", "readFile", "searchFiles"]);
	// The write and delete tools are listed with the reason they are not loaded (Req 1.17).
	expect(files?.tools.find((tool) => tool.name === "writeFile")).toMatchObject({
		risk: "destructive",
		registered: false,
	});
	// `mock` never connects to GitHub, token or not (Req 1.9).
	expect(body.servers.map((server) => server.id)).toEqual(["files"]);
	expect(body.limits.maxTools).toBe(20);
});

test("mcp: a chat run lists the allowed root and reads a file through the child process", async ({
	request,
}) => {
	const response = await request.post("/api/mcp/chat", {
		data: {
			id: "mcp-e2e",
			messages: [
				{
					id: "u1",
					role: "user",
					parts: [{ type: "text", text: M3_1_SAMPLE_TASKS.listAndRead }],
				},
			],
		},
	});

	expect(response.status()).toBe(200);
	const text = await response.text();
	// The first entry of `workspace/` is its tracked README.
	expect(text).toContain("README.md");
	expect(text).toContain('"stopReason":"completed"');
	expect(text).toContain('"toolsCalled":["listFiles","readFile"]');
});

test("mcp: a path outside the allowed root ends the run with the fatal error and the root path", async ({
	request,
}) => {
	const response = await request.post("/api/mcp/chat", {
		data: {
			id: "mcp-e2e-outside",
			messages: [
				{
					id: "u1",
					role: "user",
					parts: [{ type: "text", text: M3_1_SAMPLE_TASKS.outsideRoot }],
				},
			],
		},
	});

	expect(response.status()).toBe(200);
	const text = await response.text();
	expect(text).toContain('"stopReason":"error"');
	expect(text).toContain('"code":"not-allowed"');
	expect(text).toContain("許可されたルート");
});

test("mcp: the comparison runs both ways through the real route", async ({ request }) => {
	const response = await request.post("/api/mcp/compare", { data: { task: "list-and-read" } });

	expect(response.status(), await response.text()).toBe(200);
	const body = (await response.json()) as {
		highLevel: { steps: number; tokens: number };
		lowLevel: { steps: number; tokens: number };
		comparison: { steps: number; ratio?: number };
	};
	expect(body.highLevel.steps).toBe(2);
	expect(body.lowLevel.steps).toBe(3);
	expect(body.comparison.steps).toBe(1);
	expect(body.comparison.ratio).toBeLessThan(1);
});

// Module 3-3 (plan C13, risk R-1): `@e2b/code-interpreter` must survive the Turbopack build (the
// platform imports the E2B provider, which loads the SDK only when a key is set), multipart bodies
// are parsed by the real runtime, and the sandbox registry must be ONE registry for the whole
// process even though each Route Handler is its own bundle: a session made by `/api/analysis` is
// closed by `DELETE /api/analysis/sessions/[id]`. Vitest runs every route in one module graph, so
// only this spec can catch the registry being duplicated per bundle.

function analysisForm(options: {
	sessionId: string;
	instruction?: string;
	name?: string;
	bytes?: Buffer;
}) {
	return {
		file: {
			name: options.name ?? "sales.csv",
			mimeType: "text/csv",
			buffer:
				options.bytes ??
				Buffer.from("date,region,product,units,sales\n2026-01-08,東京,ノート,100,40000\n"),
		},
		instruction: options.instruction ?? M3_3_SAMPLE_INSTRUCTIONS.success,
		sessionId: options.sessionId,
	};
}

test("analysis: the status route reports the pseudo sandbox in mock mode", async ({ request }) => {
	const response = await request.get("/api/analysis/status");

	expect(response.status()).toBe(200);
	const body = await response.json();
	expect(body.sandbox).toEqual({ kind: "mock" });
	expect(body.upload).toEqual({ maxBytes: 20 * 1024 * 1024, accepts: [".csv", ".xlsx", ".xls"] });
});

test("analysis: a CSV is analysed through the real route with a figure, a table and the result", async ({
	request,
}) => {
	const response = await request.post("/api/analysis", {
		multipart: analysisForm({ sessionId: crypto.randomUUID() }),
	});

	expect(response.status()).toBe(200);
	const text = await response.text();
	expect(text).toContain('"type":"data-analysis-attempt"');
	expect(text).toContain('"type":"data-analysis-figure"');
	expect(text).toContain('"alt":"Monthly sales bar chart"');
	expect(text).toContain('"type":"data-analysis-table"');
	expect(text).toContain('"status":"succeeded"');
});

test("analysis: a failing run is fixed and the limit stops a run that never succeeds", async ({
	request,
}) => {
	const fixed = await request.post("/api/analysis", {
		multipart: analysisForm({
			sessionId: crypto.randomUUID(),
			instruction: M3_3_SAMPLE_INSTRUCTIONS.fixed,
		}),
	});
	const limited = await request.post("/api/analysis", {
		multipart: analysisForm({
			sessionId: crypto.randomUUID(),
			instruction: M3_3_SAMPLE_INSTRUCTIONS.attemptLimit,
		}),
	});

	const fixedText = await fixed.text();
	expect(fixedText).toContain('"errorSummary":"KeyError: \'revenue\'"');
	expect(fixedText).toContain('"status":"succeeded","attempts":2,"fixes":1');
	const limitedText = await limited.text();
	expect(limitedText).toContain('"status":"attempt-limit","attempts":4,"fixes":3');
});

test("analysis: a session made by /api/analysis is closed by DELETE from another route", async ({
	request,
}) => {
	const sessionId = crypto.randomUUID();
	const made = await request.post("/api/analysis", { multipart: analysisForm({ sessionId }) });
	await made.text();

	const first = await request.delete(`/api/analysis/sessions/${sessionId}`);
	const second = await request.delete(`/api/analysis/sessions/${sessionId}`);

	expect(first.status()).toBe(204);
	// The header tells that a sandbox was really closed: the registry the DELETE bundle sees is the
	// one the POST bundle put the sandbox in.
	expect(first.headers()["x-analysis-session"]).toBe("released");
	expect(second.status()).toBe(204);
	expect(second.headers()["x-analysis-session"]).toBe("absent");
});

test("analysis: files that cannot be analysed are refused by the real route before any sandbox", async ({
	request,
}) => {
	const wrongKind = await request.post("/api/analysis", {
		multipart: analysisForm({ sessionId: crypto.randomUUID(), name: "notes.txt" }),
	});
	const disguised = await request.post("/api/analysis", {
		multipart: analysisForm({
			sessionId: crypto.randomUUID(),
			name: "image.csv",
			bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]),
		}),
	});
	const tooBig = await request.post("/api/analysis", {
		multipart: analysisForm({
			sessionId: crypto.randomUUID(),
			name: "big.csv",
			bytes: Buffer.alloc(20 * 1024 * 1024 + 1, 0x61),
		}),
	});

	expect(wrongKind.status()).toBe(400);
	expect(disguised.status()).toBe(400);
	expect(tooBig.status()).toBe(413);
	expect((await tooBig.json()).error.code).toBe("payload-too-large");
});

// Module 3-4 (plan C13, risk R-1): `fast-xml-parser` must survive the Turbopack build and parse the
// arXiv fixture feed inside the real runtime (a `card` event exists only if a feed was parsed), the
// arXiv client must be reachable from the Route Handler's own bundle, and the whole hierarchy
// (supervisor, three sub-agents, citation check) must complete over the real stream.

test("research: the sample theme runs through the real route with events by agent, usage and a checked report", async ({
	request,
}) => {
	const response = await request.post("/api/research", {
		data: { theme: M3_4_SAMPLE_THEMES.default },
	});

	expect(response.status()).toBe(200);
	const text = await response.text();
	for (const agent of ["supervisor", "search", "reading", "market"]) {
		expect(text).toContain(`"agent":"${agent}"`);
	}
	// A card is written only for a paper the arXiv client parsed from the fixture feed.
	expect(text).toContain('"kind":"card"');
	expect(text).toContain('"arxivId":"2401.01234"');
	expect(text).toContain('"type":"data-research-usage"');
	expect(text).toContain('"type":"data-research-result"');
	expect(text).toContain("## 引用の確認");
	expect(text).not.toContain("未取得の手法 X");
});

test("research: a sub-agent that returns nothing is named in the report by the real route", async ({
	request,
}) => {
	const response = await request.post("/api/research", {
		data: { theme: M3_4_SAMPLE_THEMES.partialFailure },
	});

	expect(response.status()).toBe(200);
	const text = await response.text();
	expect(text).toContain("調査できなかった観点");
	expect(text).toContain('"agent":"reading"');
	expect(text).toContain('"type":"data-research-result"');
});

test("research: the call limit and the checks of the real route apply", async ({ request }) => {
	const limited = await request.post("/api/research", {
		data: { theme: M3_4_SAMPLE_THEMES.default, maxSubagentCalls: 2 },
	});
	const invalid = await request.post("/api/research", { data: { theme: "" } });

	expect(await limited.text()).toContain('"calls":2,"maxCalls":2');
	expect(invalid.status()).toBe(400);
	expect((await invalid.json()).error.code).toBe("invalid-request");
});

// Module 3 screens (plan C14, C19, Req 1.7, 3.1, 3.8): the page-level walk through the real
// `next start` server in `mock` mode. The unit and mocked-API specs cannot see a Server Component
// failing to bundle or a screen talking to a Route Handler in a different shape than it renders.

test("mcp page: the status refresh lists the file server's tools, then a chat reads a file through the child process", async ({
	page,
}) => {
	const errors = collectBrowserErrors(page);
	await page.goto("/mcp");

	const files = page
		.getByRole("region", { name: "MCP サーバーの状態" })
		.locator("[data-server='files']");
	await expect(files).toContainText("接続済み");
	await page.getByRole("button", { name: "状態を更新" }).click();
	await expect(files.getByRole("list", { name: "files の読み込んだツール" })).toContainText(
		"listFiles",
	);
	await expect(files.getByRole("list", { name: "files の拒否したツール" })).toContainText(
		"writeFile",
	);

	await fillUntilEnabled(
		page.getByLabel("メッセージ", { exact: true }),
		M3_1_SAMPLE_TASKS.listAndRead,
		page.getByRole("button", { name: "送信" }),
	);
	await page.getByRole("button", { name: "送信" }).click();

	const log = page.getByRole("log", { name: "会話" });
	await expect(log.getByRole("status", { name: "実行サマリ" })).toContainText("完了");
	await expect(log).toContainText("listFiles");
	await expect(log).toContainText("readFile");
	expect(errors).toEqual([]);
});

test("analysis page: a CSV is analysed in the mock sandbox and the figure and table are shown", async ({
	page,
}) => {
	const errors = collectBrowserErrors(page);
	await page.goto("/analysis");
	await expect(page.getByRole("status").filter({ hasText: "コードの実行環境" })).toContainText(
		"疑似サンドボックス（mock モード）",
	);

	await page.getByLabel("分析するファイル").setInputFiles({
		name: "sales.csv",
		mimeType: "text/csv",
		buffer: Buffer.from(
			"date,region,product,units,sales\n2026-01-08,東京,ノート,100,40000\n2026-02-08,大阪,ペン,50,20000\n",
		),
	});
	await fillUntilEnabled(
		page.getByLabel("分析の指示"),
		M3_3_SAMPLE_INSTRUCTIONS.success,
		page.getByRole("button", { name: "分析する", exact: true }),
	);
	await page.getByRole("button", { name: "分析する", exact: true }).click();

	await expect(page.getByRole("status", { name: "実行の状態" })).toHaveText("分析が完了しました");
	const figure = page.getByRole("img", { name: "Monthly sales bar chart" });
	await expect(figure).toBeVisible();
	await expect
		.poll(() => figure.evaluate((image: HTMLImageElement) => image.naturalWidth))
		.toBeGreaterThan(0);
	await expect(page.getByRole("table", { name: "Monthly sales" })).toBeVisible();

	// Ending the session closes the sandbox the upload made, through the page's DELETE.
	await page.getByRole("button", { name: "セッションを終了" }).click();
	await expect(page.getByRole("status", { name: "セッションの状態" })).toContainText(
		"セッションを終了しました。",
	);
	expect(errors).toEqual([]);
});

// The mock server ingests the help-desk FAQ (`ensureMockFaq`), so the sample inquiries reach the
// outcome their labels promise. Without the FAQ every inquiry would escalate for lack of evidence
// and only the ticket number and the revision would still show.
async function askHelpdesk(page: Page, inquiry: string): Promise<void> {
	await page.goto("/helpdesk");
	await fillUntilEnabled(
		page.getByLabel("問い合わせ", { exact: true }),
		inquiry,
		page.getByRole("button", { name: "問い合わせる" }),
	);
	await page.getByRole("button", { name: "問い合わせる" }).click();
	await expect(page.getByRole("status", { name: "実行の状態" })).toHaveText(
		"問い合わせの処理が完了しました",
	);
}

test("helpdesk page: an inquiry is planned, revised and answered from the FAQ with a ticket", async ({
	page,
}) => {
	const errors = collectBrowserErrors(page);

	await askHelpdesk(page, M3_2_SAMPLE_INQUIRIES.replanned);

	const result = page.getByRole("region", { name: "最終結果" });
	await expect(result).toContainText("T-");
	await expect(result).toContainText("解決済み");
	await expect(result).toContainText("社員用の無線ネットワークに接続し直してから");
	await expect(
		page
			.getByRole("region", { name: "計画ダッシュボード" })
			.getByRole("region", { name: "修正された計画" }),
	).toContainText("改訂 1");
	expect(errors).toEqual([]);
});

test("helpdesk page: the '（解決）' sample is resolved with an answer from the FAQ", async ({
	page,
}) => {
	const errors = collectBrowserErrors(page);

	await askHelpdesk(page, M3_2_SAMPLE_INQUIRIES.resolved);

	const result = page.getByRole("region", { name: "最終結果" });
	await expect(result).toContainText("解決済み");
	await expect(result).toContainText("認証アプリの時刻が正しいか");
	await expect(result).not.toContainText("エスカレーション");
	await expect(result).not.toContainText("ナレッジに根拠が見つからなかった");
	expect(errors).toEqual([]);
});

test("helpdesk page: the '（未解決）' sample is escalated with the reason", async ({ page }) => {
	const errors = collectBrowserErrors(page);

	await askHelpdesk(page, M3_2_SAMPLE_INQUIRIES.unresolved);

	const result = page.getByRole("region", { name: "最終結果" });
	await expect(result).toContainText("エスカレーション");
	await expect(result).toContainText("担当者の確認が必要です");
	await expect(result).not.toContainText("解決済み");
	expect(errors).toEqual([]);
});

test("research page: the sample theme runs the hierarchy and shows the checked report", async ({
	page,
}) => {
	const errors = collectBrowserErrors(page);
	await page.goto("/research");

	await fillUntilEnabled(
		page.getByLabel("テーマ", { exact: true }),
		M3_4_SAMPLE_THEMES.default,
		page.getByRole("button", { name: "リサーチする" }),
	);
	await page.getByRole("button", { name: "リサーチする" }).click();

	await expect(page.getByRole("status", { name: "実行の状態" })).toHaveText(
		"リサーチが完了しました",
	);
	await expect(
		page.getByRole("article", { name: "レポート" }).getByRole("heading", { name: "引用の確認" }),
	).toBeVisible();
	await expect(page.getByRole("table", { name: "役割別のトークン内訳" })).toBeVisible();
	expect(errors).toEqual([]);
});

test("requirements page: an interview starts, takes the round's answers and shows the preview", async ({
	page,
}) => {
	const errors = collectBrowserErrors(page);
	await page.goto("/requirements");

	await fillUntilEnabled(
		page.getByLabel("プロダクトの概要", { exact: true }),
		M3_5_SAMPLE_OVERVIEWS.default,
		page.getByRole("button", { name: "面接を始める" }),
	);
	await page.getByRole("button", { name: "面接を始める" }).click();
	await expect(page.getByRole("heading", { name: "第 1 ラウンド" })).toBeVisible();

	const answers = M3_5_SAMPLE_ANSWERS.default[0] ?? [];
	const fields = page.getByRole("group").getByRole("textbox");
	await expect(fields).toHaveCount(answers.length);
	for (const [index, text] of answers.entries()) {
		await fields.nth(index).fill(text);
	}
	await expect(page.getByRole("button", { name: "回答を送信" })).toBeEnabled();
	await page.getByRole("button", { name: "回答を送信" }).click();

	await expect(page.getByRole("region", { name: "要件プレビュー" })).toContainText(
		"第 1 ラウンドの回答を反映しました。",
	);
	await expect(page.getByRole("region", { name: "十分性の判定" })).toContainText("第 1 ラウンド");
	expect(errors).toEqual([]);
});

test("marketing page: a council reaches its result and a shopper message gets a recommendation", async ({
	page,
}) => {
	const errors = collectBrowserErrors(page);
	await page.goto("/marketing");

	await fillUntilEnabled(
		page.getByLabel("広告文案", { exact: true }),
		M3_6_SAMPLE_DRAFTS.default,
		page.getByRole("button", { name: "合議を始める" }),
	);
	await page.getByRole("button", { name: "合議を始める" }).click();
	await expect(
		page
			.getByRole("log", { name: "合議の経過" })
			.getByRole("region", { name: "合議の結果" })
			.getByRole("heading", { name: "改善後の文案" }),
	).toBeVisible();

	await fillUntilEnabled(
		page.getByLabel("メッセージ", { exact: true }),
		M3_6_SAMPLE_MESSAGES.first,
		page.getByRole("button", { name: "送信" }),
	);
	await page.getByRole("button", { name: "送信" }).click();
	await expect(page.getByRole("log", { name: "会話" })).toContainText("おすすめします");
	expect(errors).toEqual([]);
});

// Review F-7: the page and the Route Handlers are separate bundles, so a registry the page created
// first must still answer the chat route's refusals as 400 `invalid-request`, not 500 `unexpected`.
// Over HTTP the route's own allow-list check answers first (the file server's four read-only tools
// are the whole configured allow-list, and `maxTools` is 20), so the registry's own `ConfigError`
// (21 tools, a tool outside the configured list) cannot be reached from here; that case is covered
// by the route test, which throws it from the registry directly.
test("mcp: after /mcp rendered the registry, the chat route still refuses a bad allow-list with 400", async ({
	page,
	request,
}) => {
	await page.goto("/mcp");
	await expect(
		page.getByRole("heading", { level: 1, name: "MCP（Model Context Protocol）" }),
	).toBeVisible();

	const body = (allow: Record<string, string[]>) => ({
		id: "mcp-e2e-refused",
		messages: [{ id: "u1", role: "user", parts: [{ type: "text", text: "一覧してください" }] }],
		allow,
	});
	const destructive = await request.post("/api/mcp/chat", { data: body({ files: ["writeFile"] }) });
	const unknownTool = await request.post("/api/mcp/chat", {
		data: body({ files: ["noSuchTool"] }),
	});
	const unknownServer = await request.post("/api/mcp/chat", { data: body({ elsewhere: [] }) });

	for (const response of [destructive, unknownTool, unknownServer]) {
		expect(response.status(), await response.text()).toBe(400);
		expect((await response.json()).error.code).toBe("invalid-request");
	}
});

// Review F-13: a requirements interview run to its end on the real server (the mock model, the
// session registry, the document renderer) and the Markdown download that follows. The answers are
// the scripted ones of the `default` scenario: round 1 is judged insufficient, round 2 sufficient.
test("requirements: an interview completes on the real server and its document downloads as requirements.md", async ({
	request,
}) => {
	const started = await request.post("/api/requirements/sessions", {
		data: { overview: M3_5_SAMPLE_OVERVIEWS.default },
	});
	expect(started.status(), await started.text()).toBe(200);
	const created = (await started.json()) as {
		sessionId: string;
		questions: { id: string }[];
	};
	const documentUrl = `/api/requirements/sessions/${created.sessionId}/document`;

	// Before the interview ends there is no document.
	const early = await request.get(documentUrl);
	expect(early.status()).toBe(409);

	let questions = created.questions;
	let completed = false;
	for (const [round, texts] of M3_5_SAMPLE_ANSWERS.default.entries()) {
		expect(questions, `round ${round + 1} has questions`).toHaveLength(texts.length);
		const response = await request.post(
			`/api/requirements/sessions/${created.sessionId}/messages`,
			{
				data: {
					answers: questions.map((question, index) => ({
						questionId: question.id,
						text: texts[index],
					})),
				},
			},
		);
		expect(response.status(), `round ${round + 1}`).toBe(200);
		const text = await response.text();
		const line = text
			.split("\n")
			.find(
				(entry) => entry.startsWith("data: ") && entry.includes('"data-requirements-questions"'),
			);
		if (line === undefined) {
			expect(text).toContain('"sufficient":true');
			completed = true;
			break;
		}
		const part = JSON.parse(line.slice("data: ".length)) as {
			data: { questions: { id: string }[] };
		};
		questions = part.data.questions;
	}
	expect(completed).toBe(true);

	const document = await request.get(documentUrl);
	expect(document.status()).toBe(200);
	expect(document.headers()["content-disposition"]).toBe('attachment; filename="requirements.md"');
	expect(document.headers()["content-type"]).toContain("text/markdown");
	const markdown = await document.text();
	expect(markdown).toMatch(/^#+ /m);
	expect(markdown).toContain("## 1. 機能要件");

	// A further answer to the finished interview is refused as "completed", not as "busy".
	const again = await request.post(`/api/requirements/sessions/${created.sessionId}/messages`, {
		data: { answers: [{ questionId: created.questions[0]?.id, text: "追加の回答" }] },
	});
	expect(again.status()).toBe(409);
	expect((await again.json()).error.details).toEqual({ reason: "completed" });
});
