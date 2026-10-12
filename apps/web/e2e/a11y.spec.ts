import { expect, type Page, test } from "@playwright/test";
import { accessibilityViolations, applyColorScheme, type ColorScheme } from "./support/axe";
import { errorReply, mapEvents, mockApi, streamReply } from "./support/mock-api";

// Req 1.19, NFR-09: axe (WCAG 2.2 AA) on every screen in both themes, both on the empty screen and
// after a mocked response has rendered messages, tool cards, errors and summaries. The dark theme
// is a `.dark` class on <html>, so it is checked explicitly rather than through
// prefers-color-scheme.

const PATHS = ["/chat", "/agent", "/summarize"] as const;
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
