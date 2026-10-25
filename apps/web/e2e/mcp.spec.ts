import { expect, type Page, test } from "@playwright/test";
import { fillUntilEnabled } from "./support/form";
import { jsonReply, mapEvents, mockApi, streamReply } from "./support/mock-api";

// Plan C14, C19, Req 1.3, 1.10: the /mcp screen end to end. The page is rendered by the real
// server (its initial server list is the real one); every browser call goes through `mockApi`.

const MESSAGE = "許可ルートのファイルを一覧して、いちばん上のファイルの内容を教えてください。";

/** The visible alerts; Next.js keeps an empty `role="alert"` route announcer on every page. */
function alerts(page: Page) {
	return page.getByRole("alert").filter({ hasText: /\S/ });
}

async function send(page: Page, text = MESSAGE): Promise<void> {
	await fillUntilEnabled(
		page.getByLabel("メッセージ", { exact: true }),
		text,
		page.getByRole("button", { name: "送信" }),
	);
	await page.getByRole("button", { name: "送信" }).click();
}

const statusList = (page: Page) => page.getByRole("region", { name: "MCP サーバーの状態" });

test("mcp: the server list shows each server's state, loaded tools and refused tools with the reason", async ({
	page,
}) => {
	const api = await mockApi(page, { "/api/mcp/servers": jsonReply("mcp-servers") });
	await page.goto("/mcp");

	// The state the real server rendered into the page: the built-in file server is connected.
	await expect(statusList(page).locator("[data-server='files']")).toContainText("接続済み");

	await page.getByRole("button", { name: "状態を更新" }).click();

	const files = statusList(page).locator("[data-server='files']");
	await expect(files).toContainText("接続済み");
	await expect(files).toContainText("読み込み 4 個 / 拒否 2 個");
	await expect(files.getByRole("list", { name: "files の読み込んだツール" })).toContainText(
		"listFiles",
	);
	const refused = files.getByRole("list", { name: "files の拒否したツール" });
	await expect(refused).toContainText("writeFile");
	await expect(refused).toContainText("destructive");
	await expect(refused).toContainText("deleteFile");
	await expect(refused).toContainText("許可リストにありません。");

	const github = statusList(page).locator("[data-server='github']");
	await expect(github).toContainText("利用不可");
	await expect(github).toContainText("原因: 起動コマンドが見つかりません（ENOENT）。");
	await expect(github).toContainText("このサーバーのツールは使えません。");

	expect(api.requests.filter((entry) => entry.route === "/api/mcp/servers")).toHaveLength(1);
});

test("mcp: a refresh failure is shown, and the server list stays", async ({ page }) => {
	await mockApi(page, {
		"/api/mcp/servers": jsonReply(
			{ error: { code: "unexpected", message: "状態を取得できませんでした。" } },
			500,
		),
	});
	await page.goto("/mcp");
	await page.getByRole("button", { name: "状態を更新" }).click();

	await expect(alerts(page)).toContainText("状態を更新できません");
	await expect(statusList(page).locator("[data-server='files']")).toBeVisible();
});

test("mcp: a chat shows the tool calls and the answer, sends the allow-list, and announces a server that dropped", async ({
	page,
}) => {
	const api = await mockApi(page, {
		"/api/mcp/chat": streamReply("mcp-chat", {
			// The run ended with the github server gone: the state in the finish metadata wins.
			transform: (events) =>
				mapEvents(events, "finish", (event) => {
					const metadata = event.messageMetadata as { mcp: { id: string }[] };
					return {
						...event,
						messageMetadata: {
							...metadata,
							mcp: [
								...metadata.mcp,
								{
									id: "github",
									state: "unavailable",
									reason: "接続が切れました（closed）。",
									tools: [],
								},
							],
						},
					};
				}),
		}),
	});
	await page.goto("/mcp");
	await send(page);

	const log = page.getByRole("log", { name: "会話" });
	await expect(log).toContainText("一覧の先頭のファイルを読みました。");
	await expect(log).toContainText("listFiles");
	await expect(log).toContainText("readFile");
	await expect(log.getByRole("status", { name: "実行サマリ" })).toContainText("完了");

	// Both live regions are polite, so the new tool calls and the changed server state are announced.
	await expect(log).toHaveAttribute("aria-live", "polite");
	await expect(statusList(page)).toHaveAttribute("aria-live", "polite");
	const github = statusList(page).locator("[data-server='github']");
	await expect(github).toContainText("利用不可");
	await expect(github).toContainText("原因: 接続が切れました（closed）。");

	const body = api.requests.find((entry) => entry.route === "/api/mcp/chat")?.body as {
		modelId: string;
		think: boolean;
		allow: Record<string, string[]>;
		messages: { role: string }[];
	};
	expect(body.modelId).toBe("mock:general-v1");
	expect(body.think).toBe(true);
	expect(body.allow.files).toContain("listFiles");
	expect(body.messages.at(-1)?.role).toBe("user");
});

test("mcp: a fatal tool error ends the run with the 'error' stop reason and the learner-facing message", async ({
	page,
}) => {
	await mockApi(page, { "/api/mcp/chat": streamReply("mcp-chat-error") });
	await page.goto("/mcp");
	await send(page, "許可ルートの外の /etc/hosts を読んでください。");

	const log = page.getByRole("log", { name: "会話" });
	const summary = log.getByRole("status", { name: "実行サマリ" });
	await expect(summary).toContainText("エラー");
	await expect(summary).toContainText(
		"許可されたルート（/srv/mcp-workspace）の外のパスにはアクセスできません。",
	);

	const notice = log.getByRole("alert").filter({ hasText: "実行がエラーで終了しました" });
	await expect(notice).toContainText(
		"許可されたルート（/srv/mcp-workspace）の外のパスにはアクセスできません。",
	);
	await expect(notice).toContainText("エラーコード: not-allowed");
	// The failed tool call itself is shown with its reason as well.
	await expect(log.getByRole("group").filter({ hasText: "再試行できる失敗" })).toBeVisible();
	// A fatal tool error ends the run, not the screen: the form takes the next message (the button
	// was empty-disabled before; it enables only because the finished run no longer blocks it).
	await expect(page.getByRole("button", { name: "停止" })).toHaveCount(0);
	await fillUntilEnabled(
		page.getByLabel("メッセージ", { exact: true }),
		"もう一度試します。",
		page.getByRole("button", { name: "送信" }),
	);
});

test("mcp: the comparison shows both approaches and the saving, announced in a live region", async ({
	page,
}) => {
	const api = await mockApi(page, { "/api/mcp/compare": jsonReply("mcp-compare") });
	await page.goto("/mcp");

	// The labelled wrapper section shares the name; the live region is the inner one.
	const compare = page.locator('section[aria-live="polite"][aria-label="高水準と低レベルの比較"]');
	await expect(compare).toHaveAttribute("aria-live", "polite");
	await page.getByRole("button", { name: "比較を実行" }).click();

	const table = compare.getByRole("table");
	await expect(table.getByRole("row", { name: /ステップ数/ })).toContainText("2");
	await expect(table.getByRole("row", { name: /ステップ数/ })).toContainText("3");
	await expect(table.getByRole("row", { name: /呼んだツール/ })).toContainText("findAndReadFiles");
	await expect(compare).toContainText("トークン数: 高水準のほうが 588 トークン少ない");
	await expect(compare).toContainText("比率（高水準 ÷ 低レベル）: 0.60");
	expect(api.requests.find((entry) => entry.route === "/api/mcp/compare")?.body).toMatchObject({
		task: "list-and-read",
	});
});
