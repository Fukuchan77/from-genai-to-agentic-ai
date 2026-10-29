import { expect, type Page, test } from "@playwright/test";
import { fillUntilEnabled } from "./support/form";
import { errorReply, jsonReply, mockApi, streamReply } from "./support/mock-api";

// Plan C14, C19, Req 2.5: the /helpdesk screen end to end. The page is rendered by the real
// server; every browser call goes through `mockApi` and gets a stream the Route Handler produced.

const INQUIRY = "共有プリンターを追加したいのですが、一覧に表示されません。どうすればよいですか。";

function alerts(page: Page) {
	return page.getByRole("alert").filter({ hasText: /\S/ });
}

async function ask(page: Page, inquiry = INQUIRY): Promise<void> {
	await fillUntilEnabled(
		page.getByLabel("問い合わせ", { exact: true }),
		inquiry,
		page.getByRole("button", { name: "問い合わせる" }),
	);
	await page.getByRole("button", { name: "問い合わせる" }).click();
}

const dashboard = (page: Page) => page.getByRole("region", { name: "計画ダッシュボード" });

test("helpdesk: the dashboard shows the current task, the done tasks and the revised plan with its diff", async ({
	page,
}) => {
	const api = await mockApi(page, {
		// Paced like a real run, so the screen sees the plan before the replan (it keeps those
		// tasks to show what a removed task was).
		"/api/helpdesk": streamReply("helpdesk", { paceMs: 30 }),
		"/api/helpdesk/tickets": jsonReply("helpdesk-tickets"),
	});
	await page.goto("/helpdesk");
	await ask(page);

	await expect(page.getByRole("status", { name: "実行の状態" })).toHaveText(
		"問い合わせの処理が完了しました",
	);

	// The three items of the dashboard (current task, done tasks, revised plan) and its live region.
	await expect(dashboard(page)).toHaveAttribute("aria-live", "polite");
	await expect(dashboard(page).getByRole("heading", { name: "現在のタスク" })).toBeVisible();
	await expect(dashboard(page).getByRole("heading", { name: "完了タスク" })).toBeVisible();
	await expect(dashboard(page).getByRole("heading", { name: "修正された計画" })).toBeVisible();

	// Final state: both remaining tasks done, nothing running.
	const done = dashboard(page).getByRole("region", { name: "完了タスク" });
	await expect(done).toContainText("t1");
	await expect(done).toContainText("t3 社員用の無線ネットワークへの接続手順を調べる");
	await expect(done).toContainText("2 / 2");
	await expect(dashboard(page)).toContainText("実行中のタスクはありません");

	// The revised plan: t3 added, t2 removed (shown with the text it had before the replan).
	const revised = dashboard(page).getByRole("region", { name: "修正された計画" });
	await expect(revised).toContainText("改訂 1");
	await expect(revised.getByRole("list", { name: "追加されたタスク" })).toContainText(
		"t3 社員用の無線ネットワークへの接続手順を調べる",
	);
	await expect(revised.getByRole("list", { name: "削除されたタスク" })).toContainText(
		"t2 プリンターの追加方法を調べる",
	);

	// Steps used and the replanner's last decision.
	await expect(dashboard(page)).toContainText("4 / 12");
	await expect(dashboard(page)).toContainText("最終回答へ進む");
	await expect(dashboard(page)).toContainText("原因と対処が分かった。");

	const result = page.getByRole("region", { name: "最終結果" });
	await expect(result).toContainText("T-0001");
	await expect(result).toContainText("解決済み");
	await expect(result).toContainText("VPN 経由では共有プリンターを使えません。");

	// The request carries the inquiry text, not a message list.
	expect(api.requests.find((entry) => entry.route === "/api/helpdesk")?.body).toMatchObject({
		inquiry: INQUIRY,
		modelId: "mock:general-v1",
	});
	await expect(alerts(page)).toHaveCount(0);
});

test("helpdesk: the revised plan is announced mid-run, while the stream is held", async ({
	page,
}) => {
	const api = await mockApi(page, {
		"/api/helpdesk": streamReply("helpdesk", {
			holdAfter: { type: "data-helpdesk-plan", count: 3 },
		}),
		"/api/helpdesk/tickets": jsonReply("helpdesk-tickets"),
	});
	await page.goto("/helpdesk");
	await ask(page);
	await api.waitUntilHeld();

	// Before the replan: t1 done, t2 still waiting, no revision yet.
	await expect(page.getByRole("status", { name: "実行の状態" })).toHaveText(
		"問い合わせを処理しています",
	);
	await expect(dashboard(page).getByRole("list", { name: "待機中のタスク" })).toContainText(
		"t2 プリンターの追加方法を調べる",
	);
	await expect(dashboard(page).getByRole("region", { name: "修正された計画" })).toContainText(
		"計画はまだ修正されていません",
	);
	await expect(page.getByRole("region", { name: "最終結果" })).toHaveCount(0);

	await api.release();
	await expect(page.getByRole("region", { name: "最終結果" })).toBeVisible();
});

test("helpdesk: the ticket list shows each state and reloads once a run ends", async ({ page }) => {
	const api = await mockApi(page, {
		"/api/helpdesk": streamReply("helpdesk"),
		"/api/helpdesk/tickets": jsonReply("helpdesk-tickets"),
	});
	await page.goto("/helpdesk");
	await ask(page);
	await expect(page.getByRole("region", { name: "最終結果" })).toBeVisible();

	// The reload after the run is the mocked list: one ticket of each state.
	const list = page.getByRole("region", { name: "チケット一覧" });
	await expect(list).toHaveAttribute("aria-live", "polite");
	const resolved = list.locator("[data-ticket-id='T-0001']");
	await expect(resolved).toHaveAttribute("data-status", "resolved");
	await expect(resolved).toContainText("解決済み");
	await expect(resolved).toContainText("回答です");
	const open = list.locator("[data-ticket-id='T-0002']");
	await expect(open).toHaveAttribute("data-status", "open");
	await expect(open).toContainText("未完了");
	const escalated = list.locator("[data-ticket-id='T-0003']");
	await expect(escalated).toHaveAttribute("data-status", "escalated");
	await expect(escalated).toContainText("エスカレーション");
	await expect(escalated).toContainText("未解決の理由");
	await expect(escalated).toContainText("根拠がありません");
	expect(api.requests.filter((entry) => entry.route === "/api/helpdesk/tickets")).toHaveLength(1);
});

test("helpdesk: a failed request shows the server's message and retry asks the same inquiry", async ({
	page,
}) => {
	const api = await mockApi(page, {
		"/api/helpdesk": [
			errorReply(503, {
				code: "provider-unavailable",
				message: "モデルに接続できませんでした。設定を確認してください。",
			}),
			streamReply("helpdesk"),
		],
		"/api/helpdesk/tickets": jsonReply("helpdesk-tickets"),
	});
	await page.goto("/helpdesk");
	await ask(page);

	await expect(alerts(page)).toContainText("モデルに接続できませんでした。");
	await page.getByRole("button", { name: "再送信" }).click();

	await expect(page.getByRole("region", { name: "最終結果" })).toContainText("T-0001");
	await expect(alerts(page)).toHaveCount(0);
	const bodies = api.requests
		.filter((entry) => entry.route === "/api/helpdesk")
		.map((entry) => entry.body);
	expect(bodies).toHaveLength(2);
	expect(bodies[1]).toMatchObject({ inquiry: INQUIRY });
});
