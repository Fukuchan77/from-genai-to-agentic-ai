import { expect, type Page, test } from "@playwright/test";
import { fillUntilEnabled } from "./support/form";
import { errorReply, mockApi, streamReply } from "./support/mock-api";

// Plan C14, C19, Req 6.3, 6.4: the /marketing screen end to end. The page is rendered by the real
// server (in `mock` mode it seeds and reads the personas itself); every browser call goes through
// `mockApi` and gets a stream the Route Handler produced.

const DRAFT = "ステンレス保温ボトル 500ml。通勤の 1 杯を 6 時間あたたかく。";
const PERSONAS = ["厳しいマーケター", "購入を検討する生活者", "SEO 担当者"] as const;

function alerts(page: Page) {
	return page.getByRole("alert").filter({ hasText: /\S/ });
}

const timeline = (page: Page) => page.getByRole("log", { name: "合議の経過" });
const conversation = (page: Page) => page.getByRole("log", { name: "会話" });

async function startCouncil(page: Page): Promise<void> {
	await fillUntilEnabled(
		page.getByLabel("広告文案", { exact: true }),
		DRAFT,
		page.getByRole("button", { name: "合議を始める" }),
	);
	await page.getByRole("button", { name: "合議を始める" }).click();
}

async function say(page: Page, text: string): Promise<void> {
	await fillUntilEnabled(
		page.getByLabel("メッセージ", { exact: true }),
		text,
		page.getByRole("button", { name: "送信" }),
	);
	await page.getByRole("button", { name: "送信" }).click();
}

test("marketing council: statements carry the persona's name, rounds end with a verdict, and the result is shown", async ({
	page,
}) => {
	const api = await mockApi(page, {
		"/api/marketing/council": streamReply("marketing-council", { paceMs: 20 }),
	});
	await page.goto("/marketing");

	// The real server rendered the seeded personas, three of them ticked by default.
	for (const name of PERSONAS) await expect(page.getByRole("checkbox", { name })).toBeChecked();
	await expect(page.getByText("3 / 5 件を選択中")).toBeVisible();

	await startCouncil(page);
	await expect(timeline(page).getByText("合意に達したため終了しました")).toBeVisible();
	await expect(timeline(page)).toHaveAttribute("aria-live", "polite");

	// Round 1: three statements, each under its persona's name, then a verdict without agreement.
	const round1 = timeline(page).getByRole("region", { name: "ラウンド 1" });
	for (const name of PERSONAS) {
		await expect(round1.getByRole("heading", { name, level: 4 })).toHaveCount(1);
	}
	await expect(round1).toContainText("誰に何を訴えたいのかが見えません。");
	await expect(round1).toContainText("洗いやすさが書かれていないのが気になります。");
	await expect(round1).toContainText(
		"「保温ボトル」「ステンレス」を見出しに入れると探されやすくなります。",
	);
	await expect(round1).toContainText("合意に至っていません");
	await expect(round1).toContainText("価格の根拠と検索語句について、まだ意見がそろっていません。");
	const objections = round1.getByRole("list", { name: "残っている懸念" });
	await expect(objections).toContainText("2,480 円が妥当な理由が示されていない");
	await expect(objections).toContainText("検索されやすい語句が足りない");

	// Round 2 is a separate section; the council agreed, with nothing left to object to.
	const round2 = timeline(page).getByRole("region", { name: "ラウンド 2" });
	for (const name of PERSONAS) {
		await expect(round2.getByRole("heading", { name, level: 4 })).toHaveCount(1);
	}
	await expect(round2).toContainText("合意しました");
	await expect(round2).toContainText("三者とも改善後の文案の方向に賛成しており");
	await expect(round2.getByRole("list", { name: "残っている懸念" })).toHaveCount(0);
	await expect(timeline(page).getByRole("region", { name: /^ラウンド / })).toHaveCount(2);

	// The result: why it ended and the improved draft.
	const result = timeline(page).getByRole("region", { name: "合議の結果" });
	await expect(result).toContainText("合意に達したため終了しました");
	await expect(result.getByRole("heading", { name: "改善後の文案" })).toBeVisible();
	await expect(result).toContainText(
		"【保温ボトル】通勤の 1 杯を 6 時間あたたかく。洗いやすい広口のステンレス製 500ml、毎日使える 2,480 円（税込）。",
	);

	expect(api.requests.find((entry) => entry.route === "/api/marketing/council")?.body).toEqual({
		draft: DRAFT,
		personaIds: ["marketer-strict", "consumer", "seo-specialist"],
		maxRounds: 3,
	});
	await expect(alerts(page)).toHaveCount(0);
});

test("marketing council: a stream held mid-round shows the statements so far, and the end reason follows", async ({
	page,
}) => {
	const api = await mockApi(page, {
		"/api/marketing/council": streamReply("marketing-council", {
			holdAfter: { type: "data-council-verdict" },
		}),
	});
	await page.goto("/marketing");
	await startCouncil(page);
	await api.waitUntilHeld();

	await expect(page.getByRole("status", { name: "実行の状態" }).first()).toHaveText(
		"合議を進めています",
	);
	await expect(timeline(page).getByRole("region", { name: "ラウンド 1" })).toContainText(
		"合意に至っていません",
	);
	await expect(timeline(page).getByRole("region", { name: "ラウンド 2" })).toHaveCount(0);
	await expect(timeline(page).getByRole("region", { name: "合議の結果" })).toHaveCount(0);

	await api.release();
	await expect(timeline(page).getByRole("region", { name: "合議の結果" })).toContainText(
		"合意に達したため終了しました",
	);
});

test("marketing recommend: the profile and the recommendation update, with the removed count", async ({
	page,
}) => {
	const api = await mockApi(page, {
		"/api/marketing/recommend": streamReply("marketing-recommend"),
	});
	await page.goto("/marketing");

	const profile = page.getByRole("region", { name: "お客様のプロファイル" });
	await expect(profile).toHaveAttribute("aria-live", "polite");
	await expect(profile).toContainText("会話が始まると、ここに分かったことが表示されます");

	await say(page, "ランニングを始めたいです。予算は 1 万円です。");

	// The profile: interests and budget from the conversation, concerns still unknown.
	await expect(profile.getByRole("list", { name: "関心事" })).toContainText("ランニング");
	await expect(profile.getByRole("list", { name: "関心事" })).toContainText("シューズ");
	await expect(profile).toContainText("10,000 円");
	await expect(profile).toContainText("まだ分かっていません");

	// The recommendation: product IDs, prices, the over-budget mark and the removed count.
	await expect(conversation(page)).toContainText("2 件をおすすめします。");
	const shoes = conversation(page).getByRole("article", { name: "P-006 ランニングシューズ" });
	await expect(shoes).toContainText("12,800 円");
	await expect(shoes).toContainText("予算を超えています");
	await expect(shoes).toContainText("ランニングを始める方向けの定番のシューズです。");
	const mat = conversation(page).getByRole("article", {
		name: "P-010 ヨガマットとブロックのセット",
	});
	await expect(mat).toContainText("5,980 円");
	await expect(mat).not.toContainText("予算を超えています");
	await expect(conversation(page)).toContainText("カタログにない商品 ID を 1 件除去しました");

	expect(
		api.requests.find((entry) => entry.route === "/api/marketing/recommend")?.body,
	).toMatchObject({
		messages: [
			{
				role: "user",
				parts: [{ type: "text", text: "ランニングを始めたいです。予算は 1 万円です。" }],
			},
		],
	});
	await expect(alerts(page)).toHaveCount(0);
});

test("marketing recommend: the second turn sends the earlier assistant message back and is accepted", async ({
	page,
}) => {
	const api = await mockApi(page, {
		"/api/marketing/recommend": streamReply("marketing-recommend"),
	});
	await page.goto("/marketing");
	await say(page, "ランニングを始めたいです。");
	await expect(conversation(page)).toContainText("2 件をおすすめします。");
	await say(page, "もう少し安いものはありますか。");

	// The second answer is appended to the conversation: two replies, no error.
	await expect(conversation(page).getByText("2 件をおすすめします。")).toHaveCount(2);
	await expect(alerts(page)).toHaveCount(0);

	const bodies = api.requests
		.filter((entry) => entry.route === "/api/marketing/recommend")
		.map(
			(entry) =>
				entry.body as {
					messages: { role: string; parts: { type: string }[] }[];
					profile?: unknown;
				},
		);
	expect(bodies).toHaveLength(2);
	expect(bodies[1]?.messages.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
	// The earlier assistant message goes back with its data parts, and the screen's profile with it.
	const earlier = bodies[1]?.messages[1]?.parts.map((part) => part.type) ?? [];
	expect(earlier).toContain("data-marketing-recommendation");
	expect(bodies[1]?.profile).toEqual({
		interests: ["ランニング", "シューズ"],
		budgetYen: 10000,
		concerns: [],
	});
});

test("marketing recommend: an unseeded catalog shows the seed:samples guidance and retry works", async ({
	page,
}) => {
	const api = await mockApi(page, {
		"/api/marketing/recommend": [
			errorReply(503, {
				code: "provider-unavailable",
				message:
					"商品カタログとペルソナが未投入です。`mise run seed:samples` でサンプルデータを投入してから、もう一度実行してください。",
			}),
			streamReply("marketing-recommend"),
		],
	});
	await page.goto("/marketing");
	await say(page, "ランニングを始めたいです。");

	const guidance = page
		.getByRole("alert")
		.filter({ hasText: "サンプルデータが投入されていません" });
	await expect(guidance).toContainText("mise run seed:samples");
	await guidance.getByRole("button", { name: "再送信" }).click();

	await expect(conversation(page)).toContainText("2 件をおすすめします。");
	await expect(alerts(page)).toHaveCount(0);
	expect(api.requests.filter((entry) => entry.route === "/api/marketing/recommend")).toHaveLength(
		2,
	);
});

test("marketing recommend: a 503 that does not mention seed:samples shows the plain error banner", async ({
	page,
}) => {
	await mockApi(page, {
		"/api/marketing/recommend": errorReply(503, {
			code: "provider-unavailable",
			message: "モデルに接続できませんでした。設定を確認してください。",
		}),
	});
	await page.goto("/marketing");
	await say(page, "ランニングを始めたいです。");

	await expect(alerts(page)).toContainText("モデルに接続できませんでした。");
	await expect(page.getByText("サンプルデータが投入されていません")).toHaveCount(0);
});
