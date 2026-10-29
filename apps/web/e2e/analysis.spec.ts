import { expect, type Page, test } from "@playwright/test";
import { fillUntilEnabled } from "./support/form";
import { jsonReply, mockApi, multipartField, streamReply } from "./support/mock-api";

// Plan C14, C19, Req 3.4, 3.5, 3.6, 3.8: the /analysis screen end to end. The page is rendered by
// the real server (mock sandbox); every browser call goes through `mockApi`.

const INSTRUCTION = "月ごとの売上を集計して、棒グラフにしてください";
const CSV = "date,sales\n2026-01-05,120000\n2026-02-05,98000\n2026-03-05,134000\n";

function alerts(page: Page) {
	return page.getByRole("alert").filter({ hasText: /\S/ });
}

async function analyse(page: Page, instruction = INSTRUCTION): Promise<void> {
	await page.getByLabel("分析するファイル").setInputFiles({
		name: "sales.csv",
		mimeType: "text/csv",
		buffer: Buffer.from(CSV),
	});
	await fillUntilEnabled(
		page.getByLabel("分析の指示"),
		instruction,
		page.getByRole("button", { name: "分析する", exact: true }),
	);
	await page.getByRole("button", { name: "分析する", exact: true }).click();
}

const history = (page: Page) => page.getByRole("region", { name: "試行履歴" });

test("analysis: a run shows its attempt, the figure with alt text, the table and the explanation", async ({
	page,
}) => {
	const api = await mockApi(page, { "/api/analysis": streamReply("analysis") });
	await page.goto("/analysis");
	await expect(page.getByRole("status").filter({ hasText: "コードの実行環境" })).toContainText(
		"疑似サンドボックス（mock モード）",
	);
	await analyse(page);

	await expect(page.getByRole("status", { name: "実行の状態" })).toHaveText("分析が完了しました");

	// Attempt history: one successful run, not a fix, with its code and standard output.
	await expect(history(page)).toHaveAttribute("aria-live", "polite");
	await expect(history(page)).toContainText("修正回数: 0 回");
	const attempt = history(page).getByRole("listitem");
	await expect(attempt).toHaveCount(1);
	await expect(attempt).toContainText("試行 1");
	await expect(attempt).toContainText("通常の実行");
	await expect(attempt).toContainText("成功");
	await expect(attempt.getByRole("region", { name: "試行 1 のコード" })).toContainText(
		"import pandas as pd",
	);
	await expect(attempt.getByRole("region", { name: "試行 1 の標準出力" })).toContainText(
		"sales peaked in 2026-03",
	);

	// The figure is a real image with its alt text.
	const figure = page.getByRole("img", { name: "Monthly sales bar chart" });
	await expect(figure).toBeVisible();
	await expect
		.poll(() => figure.evaluate((image: HTMLImageElement) => image.naturalWidth))
		.toBeGreaterThan(0);

	// The table, with its caption and how many of its rows are shown.
	const table = page.getByRole("table", { name: "Monthly sales" });
	await expect(table.getByRole("row")).toHaveCount(4);
	await expect(table).toContainText("2026-03");
	await expect(table).toContainText("134000");
	await expect(page.getByText("3 件中 3 件を表示")).toBeVisible();

	await expect(page.getByText("月ごとの売上を集計しました。")).toBeVisible();
	await expect(alerts(page)).toHaveCount(0);

	// The upload is multipart: the file, the instruction and the session id travel in fields.
	const request = api.requests.find((entry) => entry.route === "/api/analysis");
	expect(multipartField(request?.body, "instruction")).toBe(INSTRUCTION);
	expect(multipartField(request?.body, "sessionId")).toMatch(/^[0-9a-f-]{36}$/);
	expect(multipartField(request?.body, "modelId")).toBe("mock:general-v1");
	expect(request?.body).toContain('name="file"; filename="sales.csv"');
	// Playwright's WebKit records a multipart body without the bytes of the file part.
	if (test.info().project.name !== "webkit") {
		expect(multipartField(request?.body, "file")).toContain("2026-02-05,98000");
	}
});

test("analysis: a table longer than the row limit is cut and says how many rows there were", async ({
	page,
}) => {
	await mockApi(page, {
		"/api/analysis": streamReply("analysis", {
			transform: (events) =>
				events.map((event) =>
					event.type === "data-analysis-table"
						? {
								...event,
								data: {
									caption: "Many rows",
									columns: ["n"],
									rows: Array.from({ length: 250 }, (_, index) => [index]),
									totalRows: 5000,
								},
							}
						: event,
				),
		}),
	});
	await page.goto("/analysis");
	await analyse(page);

	const table = page.getByRole("table", { name: "Many rows" });
	await expect(table).toBeVisible();
	await expect(page.getByText("5000 件中 200 件を表示")).toBeVisible();
	// The header row plus the 200-row limit; never all 250 that were sent.
	await expect(table.getByRole("row")).toHaveCount(201);
});

test("analysis: after the fixes are used up the run stops, with every attempt and the last one marked", async ({
	page,
}) => {
	await mockApi(page, { "/api/analysis": streamReply("analysis-attempt-limit") });
	await page.goto("/analysis");
	await analyse(page);

	await expect(history(page).getByRole("alert")).toContainText(
		"修正回数の上限に達したため停止しました",
	);
	await expect(history(page)).toContainText("修正回数: 3 回");
	const attempts = history(page).getByRole("list", { name: "試行の履歴" }).getByRole("listitem");
	await expect(attempts).toHaveCount(4);
	await expect(attempts.nth(0)).toContainText("通常の実行");
	await expect(attempts.nth(1)).toContainText("修正 1 回目");
	await expect(attempts.nth(3)).toContainText("修正 3 回目");
	await expect(attempts.nth(3)).toContainText("KeyError: 'revenue'");
	await expect(attempts.nth(3)).toContainText("最後のコードとエラー");
	await expect(attempts.nth(2)).not.toContainText("最後のコードとエラー");
	await expect(attempts.nth(3).getByRole("region", { name: "試行 4 のエラー出力" })).toContainText(
		"Traceback",
	);
	await expect(
		page.getByText("コードの修正を 3 回まで試しましたが、成功しませんでした。"),
	).toBeVisible();
	await expect(page.getByRole("img")).toHaveCount(0);
});

test("analysis: ending the session sends DELETE for the session id used by the upload", async ({
	page,
}) => {
	const api = await mockApi(page, {
		"/api/analysis": streamReply("analysis"),
		"/api/analysis/sessions/[id]": jsonReply({ ended: true }),
	});
	// The recorded requests carry no method, so the verb is read off the page's own requests.
	const verbs: string[] = [];
	page.on("request", (request) => {
		if (new URL(request.url()).pathname.startsWith("/api/analysis/sessions/")) {
			verbs.push(request.method());
		}
	});
	await page.goto("/analysis");
	await analyse(page);
	await expect(page.getByRole("status", { name: "実行の状態" })).toHaveText("分析が完了しました");
	const uploaded = multipartField(
		api.requests.find((entry) => entry.route === "/api/analysis")?.body,
		"sessionId",
	);

	await page.getByRole("button", { name: "セッションを終了" }).click();

	await expect(page.getByRole("status", { name: "セッションの状態" })).toHaveText(
		"セッションを終了しました。サンドボックスを閉じました。",
	);
	const ended = api.requests.filter((entry) => entry.route === "/api/analysis/sessions/[id]");
	expect(ended).toHaveLength(1);
	expect(ended[0]?.path).toBe(`/api/analysis/sessions/${uploaded}`);
	expect(verbs).toEqual(["DELETE"]);
	// The screen is empty again and the next analysis starts a new session.
	await expect(history(page)).toHaveCount(0);
	await expect(page.getByRole("img")).toHaveCount(0);
});

test("analysis: a failed session end is reported", async ({ page }) => {
	await mockApi(page, {
		"/api/analysis/sessions/[id]": jsonReply(
			{ error: { code: "unexpected", message: "失敗しました。" } },
			500,
		),
	});
	await page.goto("/analysis");
	await page.getByRole("button", { name: "セッションを終了" }).click();

	await expect(alerts(page)).toContainText("セッションを終了できませんでした");
});

test("analysis: when the sandbox is disabled the screen says why, what to set up, and locks the form", async ({
	page,
}) => {
	const REASON = "コードを実行するサンドボックスが設定されていません。";
	const GUIDANCE = "Docker を起動するか、E2B の API キーを設定してください。";
	// `GET /api/analysis/status` is read on the server while the page renders, so the browser
	// makes no call to mock: the status the server rendered into the document is replaced instead.
	await page.route("**/analysis", async (route) => {
		if (route.request().resourceType() !== "document") {
			await route.fallback();
			return;
		}
		const response = await route.fetch();
		const html = await response.text();
		const pattern = /\\"sandbox\\":\{\\"kind\\":\\"[a-z0-9]+\\"\}/;
		if (!pattern.test(html)) throw new Error("no sandbox status in the /analysis document");
		const disabled = JSON.stringify({ kind: "disabled", reason: REASON, guidance: GUIDANCE });
		const {
			"content-encoding": _encoding,
			"content-length": _length,
			...headers
		} = response.headers();
		await route.fulfill({
			status: response.status(),
			headers,
			body: html.replace(pattern, () => `\\"sandbox\\":${disabled.replaceAll('"', '\\"')}`),
		});
	});
	await mockApi(page, {});
	await page.goto("/analysis");

	const notice = page.getByRole("status").filter({ hasText: "分析エージェントは無効です" });
	await expect(notice).toContainText(REASON);
	await expect(notice).toContainText(GUIDANCE);
	await expect(page.getByLabel("分析するファイル")).toBeDisabled();
	await expect(page.getByLabel("分析の指示")).toBeDisabled();
	await expect(page.getByRole("button", { name: "分析する", exact: true })).toBeDisabled();
	await expect(page.getByRole("button", { name: "セッションを終了" })).toHaveCount(0);
});
