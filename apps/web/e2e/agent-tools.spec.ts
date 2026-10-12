import { expect, type Page, test } from "@playwright/test";
import { mapEvents, mockApi, streamReply } from "./support/mock-api";

// Req 1.17, 5.4, 5.5, NFR-10: the tool agent screen against the generated `agent-weather.sse`
// stream (one `weather` call, then the answer), served by `page.route`.

const ANSWER = "東京は晴れ、気温は22°Cです。";

function conversation(page: Page) {
	return page.getByRole("log", { name: "会話" });
}

async function send(page: Page): Promise<void> {
	await page.getByLabel("メッセージ").fill("東京の天気を教えて");
	await page.getByRole("button", { name: "送信" }).click();
}

test("agent: the tool is shown as running, then as a weather card, then the answer follows", async ({
	page,
}) => {
	const api = await mockApi(page, {
		"/api/agent/tools": streamReply("agent-weather", {
			holdAfter: { type: "tool-input-available" },
		}),
	});
	await page.goto("/agent");

	await send(page);
	await api.waitUntilHeld();

	// The call has been issued and no result has arrived: name, state and input, but no card yet.
	const tool = conversation(page).getByText("weather", { exact: true });
	await expect(tool).toBeVisible();
	await expect(conversation(page)).toContainText("実行しています");
	await expect(conversation(page)).toContainText('"city": "Tokyo"');
	await expect(page.getByRole("region", { name: "天気" })).toHaveCount(0);
	await expect(
		page.getByRole("status").filter({ hasText: "エージェントが実行しています" }),
	).toBeVisible();

	await api.release();

	const card = page.getByRole("region", { name: "天気" });
	await expect(card).toBeVisible();
	await expect(card).toContainText("東京");
	await expect(card).toContainText("晴れ");
	await expect(card).toContainText("22°C");
	await expect(conversation(page)).toContainText("完了");
	await expect(conversation(page)).toContainText("生の JSON を表示");
	await expect(conversation(page)).toContainText(ANSWER);
	// The run summary closes the message once the stream has finished.
	const summary = page.getByRole("status", { name: "実行サマリ" });
	await expect(summary).toContainText("完了");
	await expect(summary.getByRole("list", { name: "呼び出したツール" })).toContainText("weather");
});

test("agent: a tool that is not available is announced with the setting that enables it", async ({
	page,
}) => {
	await mockApi(page, { "/api/agent/tools": streamReply("agent-weather") });
	await page.goto("/agent");

	await send(page);

	const notice = page.getByRole("status").filter({ hasText: "無効なツールがあります" });
	await expect(notice).toContainText("webSearch");
	await expect(notice).toContainText("TAVILY_API_KEY");
});

test("agent: a failed tool result is shown as a failure, not as a card", async ({ page }) => {
	await mockApi(page, {
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
	});
	await page.goto("/agent");

	await send(page);

	const failure = conversation(page).getByRole("group").filter({ hasText: "再試行できる失敗" });
	await expect(failure).toContainText("天気の取得に失敗しました。");
	await expect(failure).toContainText("都市名を確認してもう一度お試しください。");
	await expect(page.getByRole("region", { name: "天気" })).toHaveCount(0);
	await expect(conversation(page)).toContainText(ANSWER);
});

test("agent: a tool that raised an error is marked as failed with a safe message", async ({
	page,
}) => {
	await mockApi(page, {
		"/api/agent/tools": streamReply("agent-weather", {
			transform: (events) =>
				mapEvents(events, "tool-output-available", ({ output: _output, ...call }) => ({
					...call,
					type: "tool-output-error",
					errorText: JSON.stringify({
						code: "unexpected",
						message: "ツールの実行中にエラーが発生しました。",
					}),
				})),
		}),
	});
	await page.goto("/agent");

	await send(page);

	await expect(conversation(page)).toContainText("失敗");
	await expect(conversation(page)).toContainText("ツールの実行中にエラーが発生しました。");
	await expect(page.getByRole("region", { name: "天気" })).toHaveCount(0);
});
