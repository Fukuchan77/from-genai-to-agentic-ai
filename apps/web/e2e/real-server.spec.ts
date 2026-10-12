import { expect, type Page, test } from "@playwright/test";

// No `page.route`: every request goes through the real Route Handlers of `next start` in `mock`
// mode (request guard, gateway, scenario models). Plan C19, Req 1.17.

const PAGES = [
	{ path: "/chat", heading: "チャット" },
	{ path: "/agent", heading: "ツールエージェント" },
	{ path: "/summarize", heading: "要約" },
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

	await page.getByLabel("メッセージ").fill("こんにちは");
	await page.getByRole("button", { name: "送信" }).click();

	await expect(page.getByRole("log", { name: "会話" })).toContainText(
		"モックモードから決定論的に応答しています。",
	);
});

test("agent: one tool call and its answer through the real route", async ({ page }) => {
	await page.goto("/agent");

	await page.getByLabel("メッセージ").fill("東京の天気を教えて");
	await page.getByRole("button", { name: "送信" }).click();

	await expect(page.getByRole("log", { name: "会話" })).toContainText(
		"東京は晴れ、気温は22°Cです。",
	);
});

test("summarize: one summary through the real route", async ({ page }) => {
	await page.goto("/summarize");

	await page.getByRole("radio", { name: "字幕テキスト" }).check();
	await page.getByLabel("字幕テキストを貼り付け").fill("fixture:summary-full 本文です。");
	await page.getByRole("button", { name: "要約する" }).click();

	await expect(page.getByRole("list", { name: "要点" })).toBeVisible();
});
