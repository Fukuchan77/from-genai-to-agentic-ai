import { expect, type Page, test } from "@playwright/test";
import { fillUntilEnabled } from "./support/form";
import { errorReply, jsonReply, type MockApi, mockApi } from "./support/mock-api";

/** The visible alerts; Next.js keeps an empty `role="alert"` route announcer on every page. */
function alerts(page: Page) {
	return page.getByRole("alert").filter({ hasText: /\S/ });
}

// Plan C14, C19, Req 3.9, 4.1: the /workflows screen against the generated Evaluator-Optimizer run
// (`mise run e2e:fixtures`). The run in the fixture misses the pass score, so the screen has to
// show the history and say plainly that the criterion was not met.

const STALLS_TASK = "障害対応の連絡テンプレートを作ってください。";

function bodyOf(api: MockApi): Record<string, unknown> {
	const request = api.requests.find((entry) => entry.path === "/api/workflows");
	if (request === undefined) throw new Error("no request to /api/workflows");
	return request.body as Record<string, unknown>;
}

async function chooseEvaluator(page: Page): Promise<void> {
	await page.getByLabel("名前").selectOption("evaluator-optimizer");
	await page.getByRole("button", { name: "改善が進まず未合格になる例" }).click();
	await expect(page.getByLabel("入力", { exact: true })).toHaveValue(STALLS_TASK);
}

test("workflows: the Evaluator-Optimizer shows each iteration and says the pass score was missed", async ({
	page,
}) => {
	const api = await mockApi(page, {
		"/api/workflows": jsonReply("workflows-evaluator-optimizer"),
	});
	await page.goto("/workflows");

	await chooseEvaluator(page);
	await page.getByRole("button", { name: "実行" }).click();

	const result = page.getByRole("article", { name: "実行結果: 評価・改善ループ" });
	await expect(result.getByText("未合格", { exact: true })).toBeVisible();
	await expect(result.getByRole("alert")).toContainText("合格基準に達しませんでした");
	await expect(result.getByRole("alert")).toContainText("反復 1");
	const history = result.getByRole("list", { name: "反復の履歴" });
	const iterations = history.locator(":scope > li");
	await expect(iterations).toHaveCount(3);
	await expect(iterations.nth(0)).toContainText("反復 1");
	await expect(iterations.nth(0)).toContainText("スコア 62");
	await expect(iterations.nth(0)).toContainText(
		"security（62 点）: 影響を受ける範囲が書かれていません。",
	);
	await expect(iterations.nth(0)).toContainText("performance（75 点）: 短く、すぐ読めます。");
	await expect(iterations.nth(2)).toContainText("スコア 58");
	await expect(iterations.nth(0)).toContainText("採用");
	await expect(iterations.nth(2)).not.toContainText("採用");
	await expect(result.getByRole("region", { name: "最終出力" })).toContainText(
		"障害が発生しました。対応中です。",
	);
	await expect(result.getByRole("region", { name: "使用量" })).toContainText("モデル呼び出し 9 回");
	expect(bodyOf(api)).toEqual({ kind: "workflow", name: "evaluator-optimizer", task: STALLS_TASK });
});

test("workflows: the options are sent, and a value over the limit is refused before any request", async ({
	page,
}) => {
	const api = await mockApi(page, {
		"/api/workflows": jsonReply("workflows-evaluator-optimizer"),
	});
	await page.goto("/workflows");
	await chooseEvaluator(page);

	await page.getByLabel("最大反復回数").fill("99");
	await expect(alerts(page)).toContainText("1 以上 8 以下の整数");
	await expect(page.getByRole("button", { name: "実行" })).toBeDisabled();
	expect(api.requests).toHaveLength(0);

	await page.getByLabel("最大反復回数").fill("3");
	await fillUntilEnabled(
		page.getByLabel("合格スコア"),
		"90",
		page.getByRole("button", { name: "実行" }),
	);
	await page.getByRole("button", { name: "実行" }).click();

	await expect(page.getByRole("article", { name: /実行結果/ })).toBeVisible();
	expect(bodyOf(api)).toMatchObject({ options: { maxIterations: 3, passScore: 90 } });
});

test("workflows: the pattern kind lists the agent patterns with their own examples", async ({
	page,
}) => {
	await mockApi(page, {});
	await page.goto("/workflows");

	await page.getByRole("radio", { name: "エージェントパターン" }).check();

	await expect(page.getByLabel("名前")).toHaveValue("passive-goal-creator");
	await expect(page.getByLabel("入力", { exact: true })).toHaveValue(
		"社内向けの週報テンプレートを A4 1 枚で作ってください。",
	);
	await expect(page.getByRole("button", { name: "曖昧な指示" })).toBeVisible();
});

test("workflows: a rejected run shows the server's message", async ({ page }) => {
	await mockApi(page, {
		"/api/workflows": errorReply(400, {
			code: "invalid-request",
			message: "maxIterations は 8 以下で指定してください。",
		}),
	});
	await page.goto("/workflows");

	await page.getByRole("button", { name: "実行" }).click();

	await expect(alerts(page)).toContainText("maxIterations は 8 以下で指定してください。");
	await expect(page.getByRole("article")).toHaveCount(0);
});
