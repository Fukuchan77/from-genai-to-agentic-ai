import { expect, type Page, test } from "@playwright/test";
import { fillUntilEnabled } from "./support/form";
import { mapEvents, mockApi, streamReply } from "./support/mock-api";

// Plan C14, C19, Req 4.9, 4.10: the /research screen end to end. The page is rendered by the real
// server; every browser call goes through `mockApi` and gets a stream the Route Handler produced.

const THEME = "階層型エージェントの最新動向";

/** The visible alerts; Next.js keeps an empty `role="alert"` route announcer on every page. */
function alerts(page: Page) {
	return page.getByRole("alert").filter({ hasText: /\S/ });
}

async function research(page: Page, theme = THEME): Promise<void> {
	await fillUntilEnabled(
		page.getByLabel("テーマ", { exact: true }),
		theme,
		page.getByRole("button", { name: "リサーチする" }),
	);
	await page.getByRole("button", { name: "リサーチする" }).click();
}

const inspector = (page: Page) => page.getByRole("log", { name: "Agent Inspector" });
const usageTable = (page: Page) => page.getByRole("table", { name: "役割別のトークン内訳" });

test("research: the Agent Inspector tells the supervisor and the three sub-agents apart", async ({
	page,
}) => {
	const api = await mockApi(page, { "/api/research": streamReply("research", { paceMs: 20 }) });
	await page.goto("/research");
	await research(page);

	await expect(page.getByRole("status", { name: "実行の状態" })).toHaveText(
		"リサーチが完了しました",
	);

	// The log is a polite live region, so new events are announced.
	await expect(inspector(page)).toHaveAttribute("aria-live", "polite");

	// Every event carries the agent it belongs to; all four agents of the run appear.
	for (const [agent, label] of [
		["supervisor", "Supervisor"],
		["search", "検索"],
		["reading", "読解"],
		["market", "市場"],
	] as const) {
		const own = inspector(page).locator(`li[data-agent='${agent}']`);
		await expect(own.first()).toBeVisible();
		await expect(own.first().getByText(label, { exact: true }).first()).toBeVisible();
	}

	// Two agents doing the same kind of thing stay distinguishable: the supervisor's and the
	// sub-agents' summaries are separate entries under their own agent.
	await expect(
		inspector(page).locator("li[data-agent='supervisor']").filter({ hasText: "要約" }),
	).toHaveCount(1);
	await expect(
		inspector(page).locator("li[data-agent='search']").filter({ hasText: "要約" }),
	).toHaveCount(2);
	await expect(
		inspector(page).locator("li[data-agent='reading']").filter({ hasText: "要約" }),
	).toContainText("上位の計画を担当ごとに分けて実行する");
	await expect(
		inspector(page).locator("li[data-agent='market']").filter({ hasText: "要約" }),
	).toContainText("導入は段階的に広がる見込み");

	// A delegation names the callee; a tool event shows the tool and its input as text.
	await expect(
		inspector(page)
			.locator("li[data-agent='supervisor']")
			.filter({ hasText: "に依頼: 手法の違いと評価に使ったデータ" }),
	).toContainText("読解");
	await expect(
		inspector(page).locator("li[data-agent='search']").filter({ hasText: "searchArxiv" }).first(),
	).toContainText("hierarchical agents tool use");

	// A paper card links only to the arXiv abstract page.
	const card = inspector(page).getByRole("link", {
		name: "Hierarchical Agents & Tool Use in Practice",
	});
	await expect(card.first()).toHaveAttribute("href", "https://arxiv.org/abs/2401.01234");

	// The request carries the theme and the call limit, not a message list.
	expect(api.requests.find((entry) => entry.route === "/api/research")?.body).toMatchObject({
		theme: THEME,
		modelId: "mock:general-v1",
		maxSubagentCalls: 8,
	});
	await expect(alerts(page)).toHaveCount(0);
});

test("research: the token breakdown shows each role, the total and the call count", async ({
	page,
}) => {
	await mockApi(page, { "/api/research": streamReply("research") });
	await page.goto("/research");
	await research(page);
	await expect(page.getByRole("status", { name: "実行の状態" })).toHaveText(
		"リサーチが完了しました",
	);

	await expect(page.getByText("サブエージェント呼び出し: 4 / 8")).toBeVisible();
	const row = (name: string) => usageTable(page).getByRole("row", { name: new RegExp(`^${name}`) });
	await expect(row("Supervisor")).toContainText("6000");
	await expect(row("Supervisor")).toContainText("780");
	await expect(row("Supervisor")).toContainText("6780");
	await expect(row("検索")).toContainText("4440");
	await expect(row("検索")).toContainText("2");
	await expect(row("読解")).toContainText("2220");
	await expect(row("市場")).toContainText("1040");
	// The server's total is shown as it is (the sum of the known usage), not recomputed.
	await expect(row("合計")).toContainText("12810");
	await expect(row("合計")).toContainText("1670");
	await expect(row("合計")).toContainText("14480");
	await expect(page.getByText("取得できなかった分は推定していません。")).toBeVisible();
});

test("research: a role without usage says unknown instead of a zero", async ({ page }) => {
	await mockApi(page, {
		"/api/research": streamReply("research", {
			transform: (events) =>
				mapEvents(events, "data-research-usage", (event) => {
					const usage = event.data as { byRole: Record<string, unknown> };
					return {
						...event,
						data: {
							...usage,
							byRole: Object.fromEntries(
								Object.entries(usage.byRole).map(([role, value]) => [
									role,
									role === "market" ? "unknown" : value,
								]),
							),
						},
					};
				}),
		}),
	});
	await page.goto("/research");
	await research(page);
	await expect(page.getByRole("status", { name: "実行の状態" })).toHaveText(
		"リサーチが完了しました",
	);

	const market = usageTable(page).getByRole("row", { name: /^市場/ });
	await expect(market).toContainText("unknown");
	await expect(market).toContainText("不明");
	await expect(market).not.toContainText("1040");
	// The other roles keep their figures.
	await expect(usageTable(page).getByRole("row", { name: /^読解/ })).toContainText("2220");
});

test("research: the removed citation is a warning, and the report keeps the checked text", async ({
	page,
}) => {
	await mockApi(page, { "/api/research": streamReply("research") });
	await page.goto("/research");
	await research(page);

	const warning = page.getByRole("status", { name: "引用の警告" });
	await expect(warning).toContainText(
		"「2412.99999」は、検索で取得した論文の集合に無いため、その言及を除去しました。",
	);
	await expect(page.getByRole("status", { name: "欠落した観点" })).toHaveCount(0);

	const report = page.getByRole("article", { name: "レポート" });
	await expect(report.getByRole("heading", { name: "手法" })).toBeVisible();
	await expect(report).toContainText("階層型の計画（2401.01234）");
	await expect(report.getByRole("heading", { name: "引用の確認" })).toBeVisible();
});

test("research: a partial run names the missing aspect and still shows the report", async ({
	page,
}) => {
	await mockApi(page, { "/api/research": streamReply("research-partial") });
	await page.goto("/research");
	await research(page, "リサーチエージェントの評価手法");

	await expect(page.getByRole("status", { name: "実行の状態" })).toHaveText(
		"リサーチが完了しました",
	);
	const missing = page.getByRole("status", { name: "欠落した観点" });
	await expect(missing).toContainText("読解: 要約が空だったため、調査の結果を得られませんでした。");
	await expect(page.getByRole("status", { name: "引用の警告" })).toHaveCount(0);

	const report = page.getByRole("article", { name: "レポート" });
	await expect(report).toContainText("研究エージェントの評価基準（2403.05678）が提案された。");
	await expect(report.getByRole("heading", { name: "調査できなかった観点" })).toBeVisible();

	// Three sub-agent calls were made out of eight; the reading agent ran once.
	await expect(page.getByText("サブエージェント呼び出し: 3 / 8")).toBeVisible();
	await expect(usageTable(page).getByRole("row", { name: /^合計/ })).toContainText("10350");
});
