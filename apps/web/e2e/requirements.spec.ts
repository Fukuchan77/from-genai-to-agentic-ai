import { expect, type Page, test } from "@playwright/test";
import { fillUntilEnabled } from "./support/form";
import { errorReply, jsonReply, mapEvents, mockApi, streamReply } from "./support/mock-api";

// Plan C14, C19, Req 5.3, 5.7: the /requirements screen end to end. The page is rendered by the
// real server; every browser call goes through `mockApi` and gets what the Route Handlers produced.

const OVERVIEW = "社内の問い合わせを自動で振り分けるチャットボット";
const SESSION_ID = "00000000-0000-4000-8000-000000000001";
const MESSAGES = "/api/requirements/sessions/[id]/messages" as const;

function alerts(page: Page) {
	return page.getByRole("alert").filter({ hasText: /\S/ });
}

async function startInterview(page: Page): Promise<void> {
	await fillUntilEnabled(
		page.getByLabel("プロダクトの概要", { exact: true }),
		OVERVIEW,
		page.getByRole("button", { name: "面接を始める" }),
	);
	await page.getByRole("button", { name: "面接を始める" }).click();
}

async function answerFirstQuestion(page: Page, text = "問い合わせの分類に時間がかかります。") {
	const field = page.getByLabel("今の振り分けで、いちばん時間がかかっているのはどの作業ですか。");
	await fillUntilEnabled(field, text, page.getByRole("button", { name: "回答を送信" }));
	await page.getByRole("button", { name: "回答を送信" }).click();
}

const preview = (page: Page) => page.getByRole("region", { name: "要件プレビュー" });
const verdict = (page: Page) => page.getByRole("region", { name: "十分性の判定" });
const downloadName = "requirements.md をダウンロード";

test("requirements: an interview asks persona-specific questions and the answer updates the preview", async ({
	page,
}) => {
	const api = await mockApi(page, {
		"/api/requirements/sessions": jsonReply("requirements-session"),
		[MESSAGES]: streamReply("requirements"),
	});
	await page.goto("/requirements");

	// Before the interview: no persona, no question.
	await expect(page.getByRole("button", { name: "面接を始める" })).toBeDisabled();
	await startInterview(page);

	// Questions are grouped under their persona's name and role.
	await expect(page.getByRole("heading", { name: "第 1 ラウンド" })).toBeVisible();
	for (const [name, question] of [
		["田中さん", "今の振り分けで、いちばん時間がかかっているのはどの作業ですか。"],
		["佐藤さん", "問い合わせるときに、どんな情報がすぐに分かると助かりますか。"],
		["鈴木さん", "このボットを導入するとき、守らなければならない社内のルールはありますか。"],
	] as const) {
		const group = page.getByRole("group", { name });
		await expect(group).toBeVisible();
		await expect(group.getByLabel(question)).toBeVisible();
	}
	await expect(page.getByRole("group", { name: "田中さん" })).toContainText("総務部の担当者");

	// Nothing is sent before an answer exists.
	await expect(page.getByRole("button", { name: "回答を送信" })).toBeDisabled();
	await expect(preview(page)).toContainText("まだ要件はありません");
	await expect(verdict(page)).toContainText("まだ判定されていません");

	// Both regions are polite live regions, so a changed preview or verdict is announced.
	await expect(preview(page)).toHaveAttribute("aria-live", "polite");
	await expect(verdict(page)).toHaveAttribute("aria-live", "polite");

	await answerFirstQuestion(page);

	// The preview now lists the extracted requirements, each with its persona.
	await expect(preview(page)).toContainText("第 1 ラウンドの回答を反映しました。");
	const functional = preview(page).getByRole("region", { name: "機能要件", exact: true });
	await expect(functional).toContainText("2 件");
	await expect(functional).toContainText(
		"問い合わせの内容から担当部署を自動で判定して振り分ける （出所: 田中さん）",
	);
	await expect(functional).toContainText("問い合わせの進み具合をチャットで確認できる");
	await expect(preview(page).getByRole("region", { name: "非機能要件" })).toContainText(
		"質問への応答が待たされない （出所: 佐藤さん）",
	);
	await expect(preview(page).getByRole("region", { name: "制約" })).toContainText(
		"社内ネットワークの外に情報を出さない （出所: 鈴木さん）",
	);

	// The verdict names what is still missing, and the next round brings new questions.
	await expect(verdict(page)).toContainText("第 1 ラウンド: 情報が不足しています。");
	const missing = verdict(page).getByRole("list", { name: "不足項目" });
	await expect(missing).toContainText("応答時間の目標値");
	await expect(missing).toContainText("運用にかけられる予算の上限");
	await expect(page.getByRole("heading", { name: "第 2 ラウンド" })).toBeVisible();
	await expect(
		page.getByLabel("導入と運用にかけられる予算の上限はどのくらいですか。"),
	).toBeVisible();

	// Start and round requests: the overview, then only the answered question of the session.
	expect(api.requests.find((entry) => entry.route === "/api/requirements/sessions")?.body).toEqual({
		overview: OVERVIEW,
	});
	const round = api.requests.find((entry) => entry.route === MESSAGES);
	expect(round?.path).toBe(`/api/requirements/sessions/${SESSION_ID}/messages`);
	expect(round?.body).toEqual({
		answers: [{ questionId: "q-1-1", text: "問い合わせの分類に時間がかかります。" }],
	});
	await expect(alerts(page)).toHaveCount(0);
});

test("requirements: the download stays disabled while the interview goes on", async ({ page }) => {
	await mockApi(page, {
		"/api/requirements/sessions": jsonReply("requirements-session"),
		[MESSAGES]: streamReply("requirements"),
	});
	await page.goto("/requirements");
	await startInterview(page);

	const button = page.getByRole("button", { name: downloadName });
	await expect(button).toBeDisabled();
	await expect(page.getByRole("link", { name: downloadName })).toHaveCount(0);
	await expect(page.getByText("要件定義書は面接が終わると作成され")).toBeVisible();

	await answerFirstQuestion(page);
	await expect(verdict(page)).toContainText("情報が不足しています");
	// An insufficient verdict does not make the document available.
	await expect(page.getByRole("button", { name: downloadName })).toBeDisabled();
	await expect(page.getByRole("link", { name: downloadName })).toHaveCount(0);
});

test("requirements: a sufficient verdict ends the interview and offers requirements.md", async ({
	page,
}) => {
	await mockApi(page, {
		"/api/requirements/sessions": jsonReply("requirements-session"),
		[MESSAGES]: streamReply("requirements", {
			// The variant that ends the interview: the same stream, with a sufficient verdict.
			transform: (events) =>
				mapEvents(
					events.filter((event) => event.type !== "data-requirements-questions"),
					"data-requirements-judgement",
					(event) => ({
						...event,
						data: { round: 1, sufficient: true, missing: [], forcedEnd: false },
					}),
				),
		}),
	});
	await page.goto("/requirements");
	await startInterview(page);
	await expect(page.getByRole("button", { name: downloadName })).toBeDisabled();
	await answerFirstQuestion(page);

	await expect(verdict(page)).toContainText(
		"第 1 ラウンド: 要件定義書を作るのに十分な情報が集まりました。",
	);
	await expect(verdict(page).getByRole("list", { name: "不足項目" })).toHaveCount(0);
	await expect(page.getByText("面接が完了しました。")).toBeVisible();

	// The disabled button is gone; a real link to the session's document, named requirements.md.
	await expect(page.getByRole("button", { name: downloadName })).toHaveCount(0);
	const link = page.getByRole("link", { name: downloadName });
	await expect(link).toHaveAttribute("href", `/api/requirements/sessions/${SESSION_ID}/document`);
	await expect(link).toHaveAttribute("download", "requirements.md");

	// Answers are no longer accepted.
	await expect(page.getByRole("button", { name: "回答を送信" })).toHaveCount(0);
	await expect(page.getByText("回答の受付は終了しました。")).toBeVisible();
});

test("requirements: an expired session shows the guidance and starting over returns to the overview", async ({
	page,
}) => {
	await mockApi(page, {
		"/api/requirements/sessions": jsonReply("requirements-session"),
		[MESSAGES]: errorReply(404, {
			code: "invalid-request",
			message: "面接のセッションが見つかりません。",
		}),
	});
	await page.goto("/requirements");
	await startInterview(page);
	await answerFirstQuestion(page);

	const expired = page.getByRole("alert").filter({ hasText: "面接の有効期限が切れました" });
	await expect(expired).toContainText("一定時間操作がなかったため、この面接は終了しました。");
	await expect(page.getByRole("button", { name: "回答を送信" })).toHaveCount(0);

	await expired.getByRole("button", { name: "新しい面接を始める" }).click();
	await expect(page.getByLabel("プロダクトの概要", { exact: true })).toHaveValue("");
	await expect(page.getByRole("button", { name: "面接を始める" })).toBeVisible();
});
