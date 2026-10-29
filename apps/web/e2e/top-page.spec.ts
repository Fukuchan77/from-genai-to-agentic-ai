import { expect, test } from "@playwright/test";

// 35.1: the top page reaches the six screens added in module 3, and each link lands on its screen.
// No `page.route`: the links and the pages are the real server's (review F-12).

const MODULE_3_LINKS = [
	{ name: "MCP", path: "/mcp", heading: "MCP（Model Context Protocol）" },
	{ name: "ヘルプデスク", path: "/helpdesk", heading: "ヘルプデスク" },
	{ name: "データ分析", path: "/analysis", heading: "データ分析" },
	{ name: "リサーチ", path: "/research", heading: "階層型リサーチ" },
	{ name: "要件定義", path: "/requirements", heading: "要件定義インタビュー" },
	{ name: "マーケティング", path: "/marketing", heading: "マーケティング" },
] as const;

test("the top page lists the six module 3 screens by name", async ({ page }) => {
	await page.goto("/");

	const list = page.getByRole("region", { name: "モジュール一覧" });
	for (const { name, path } of MODULE_3_LINKS) {
		await expect(list.getByRole("link", { name, exact: true })).toHaveAttribute("href", path);
	}
});

for (const { name, path, heading } of MODULE_3_LINKS) {
	test(`the top page link "${name}" leads to ${path}`, async ({ page }) => {
		await page.goto("/");

		await page
			.getByRole("region", { name: "モジュール一覧" })
			.getByRole("link", { name, exact: true })
			.click();

		await expect(page).toHaveURL(new RegExp(`${path}$`));
		await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
	});
}
