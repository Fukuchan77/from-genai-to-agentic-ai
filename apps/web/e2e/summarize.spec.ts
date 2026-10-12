import { expect, type Page, test } from "@playwright/test";
import { errorReply, loadFixture, mockApi, type SseEvent, streamReply } from "./support/mock-api";

// Req 1.17, 4.5, 4.7, 4.11, NFR-10: the summarize screen against the generated
// `summarize-transcript.sse` stream, served by `page.route`.

async function summarizeTranscript(page: Page): Promise<void> {
	await page.getByRole("radio", { name: "字幕テキスト" }).check();
	await page.getByLabel("字幕テキストを貼り付け").fill("fixture:summary-full 本文です。");
	await page.getByRole("button", { name: "要約する" }).click();
}

/** The summary the fixture ends with, read from the generated stream rather than written here. */
function fixtureSummary(): { title: string; keyPoints: string[]; tags: string[] } {
	const event = loadFixture("summarize-transcript").find(
		(candidate) => candidate.type === "data-summary",
	);
	const data = event?.data as { title: string; keyPoints: string[]; tags: string[] } | undefined;
	if (!data) throw new Error("summarize-transcript.sse has no data-summary event");
	return data;
}

/** The stream as the model would produce it: title first, then one key point, then everything. */
function progressively(events: readonly SseEvent[]): SseEvent[] {
	const final = events.find((event) => event.type === "data-summary");
	if (!final) throw new Error("summarize-transcript.sse has no data-summary event");
	const full = final.data as { title: string; keyPoints: string[] };
	const stage = (data: Record<string, unknown>): SseEvent => ({ ...final, data });
	return [
		stage({ title: full.title }),
		stage({ title: full.title, keyPoints: full.keyPoints.slice(0, 1) }),
		...events,
	];
}

test("summarize: the card fills in as fields arrive and the processing info follows", async ({
	page,
}) => {
	const summary = fixtureSummary();
	const api = await mockApi(page, {
		"/api/summarize": streamReply("summarize-transcript", {
			transform: progressively,
			holdAfter: { type: "data-summary", count: 2 },
		}),
	});
	await page.goto("/summarize");

	await summarizeTranscript(page);
	await api.waitUntilHeld();

	// Title and the first key point are confirmed; the rest are still skeletons, not text.
	const card = page.getByRole("article", { name: summary.title });
	await expect(card).toBeVisible();
	await expect(card).toHaveAttribute("aria-busy", "true");
	const keyPoints = card.getByRole("list", { name: "要点" });
	await expect(keyPoints).toContainText(summary.keyPoints[0] ?? "");
	await expect(keyPoints).not.toContainText(summary.keyPoints[1] ?? "");
	await expect(card.getByRole("list", { name: "タグ" })).toHaveCount(0);
	await expect(page.getByRole("status")).toHaveText("要約を生成しています");
	await expect(page.getByRole("button", { name: "停止" })).toBeVisible();
	await expect(page.getByRole("region", { name: "要約の処理情報" })).toHaveCount(0);

	await api.release();

	await expect(card).toHaveAttribute("aria-busy", "false");
	for (const point of summary.keyPoints) await expect(keyPoints).toContainText(point);
	for (const tag of summary.tags) {
		await expect(card.getByRole("list", { name: "タグ" })).toContainText(tag);
	}
	await expect(page.getByRole("status")).toHaveText("要約が完了しました");
	const meta = page.getByRole("region", { name: "要約の処理情報" });
	await expect(meta).toContainText("全文を一度に入力");
	await expect(meta).toContainText("再生成回数0 回");
});

test("summarize: an article that cannot be fetched shows the reason and no summary", async ({
	page,
}) => {
	await mockApi(page, {
		"/api/summarize": errorReply(422, {
			code: "source-unavailable",
			message: "記事を取得できませんでした。",
			details: { reason: "http-status", status: 404 },
		}),
	});
	await page.goto("/summarize");

	await page.getByLabel("記事の URL（http / https）").fill("https://example.com/missing");
	await page.getByRole("button", { name: "要約する" }).click();

	const alert = page.getByRole("alert").filter({ hasText: "ソースを取得できませんでした" });
	await expect(alert).toContainText("ソースを取得できませんでした");
	await expect(alert).toContainText("記事のサーバーがエラーを返しました。");
	await expect(alert).toContainText("HTTP ステータス 404");
	await expect(page.getByRole("article")).toHaveCount(0);
	await expect(page.getByRole("region", { name: "要約の処理情報" })).toHaveCount(0);
});

test("summarize: a video without captions shows the reason and the transcript hint", async ({
	page,
}) => {
	await mockApi(page, {
		"/api/summarize": errorReply(422, {
			code: "source-unavailable",
			message: "字幕を取得できませんでした。",
			details: { reason: "no-captions" },
		}),
	});
	await page.goto("/summarize");

	await page.getByRole("radio", { name: "YouTube の URL" }).check();
	await page.getByLabel("YouTube 動画の URL").fill("https://www.youtube.com/watch?v=abcdefghijk");
	await page.getByRole("button", { name: "要約する" }).click();

	const alert = page.getByRole("alert").filter({ hasText: "ソースを取得できませんでした" });
	await expect(alert).toContainText("この動画には利用できる字幕がありません。");
	await expect(alert).toContainText("字幕テキストを貼り付けて要約することもできます。");
	await expect(page.getByRole("article")).toHaveCount(0);
});

test("summarize: the real route refuses an address it must not fetch, before any summary", async ({
	page,
}) => {
	// No `page.route`: the request guard and the source loader of `next start` answer. A loopback
	// address is refused without any network access, so this stays deterministic offline.
	await page.goto("/summarize");

	await page.getByLabel("記事の URL（http / https）").fill("http://localhost/article");
	await page.getByRole("button", { name: "要約する" }).click();

	const alert = page.getByRole("alert").filter({ hasText: "ソースを取得できませんでした" });
	await expect(alert).toContainText("ソースを取得できませんでした");
	await expect(alert).toContainText("この URL は取得できません。");
	await expect(page.getByRole("article")).toHaveCount(0);
});
