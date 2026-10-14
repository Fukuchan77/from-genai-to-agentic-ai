import { expect, type Page, test } from "@playwright/test";
import { fillUntilEnabled } from "./support/form";

// Regression for the WebKit CI flake: a `fill` that lands before React hydrates leaves the submit
// button disabled, and filling the same text again does not help (React ignores an unchanged value).

/** Delays every script so that the first `fill` is guaranteed to land before hydration. */
async function delayScripts(page: Page): Promise<void> {
	await page.route("**/_next/static/**/*.js", async (route) => {
		await new Promise((resolve) => setTimeout(resolve, 1_500));
		await route.continue();
	});
}

test("a fill before hydration is recovered by fillUntilEnabled", async ({ page }) => {
	await delayScripts(page);
	await page.goto("/chat", { waitUntil: "domcontentloaded" });
	const field = page.getByLabel("メッセージ");
	const send = page.getByRole("button", { name: "送信" });

	await field.fill("こんにちは");
	await page.waitForTimeout(4_000);
	await expect(send).toBeDisabled();
	await field.fill("こんにちは");
	await expect(send).toBeDisabled();

	await fillUntilEnabled(field, "こんにちは", send);
	await expect(send).toBeEnabled();
});
