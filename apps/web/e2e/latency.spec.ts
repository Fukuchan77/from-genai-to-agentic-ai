import { expect, type Page, test } from "@playwright/test";
import { installLatencyProbe, readLatencies } from "./support/latency-probe";
import { loadFixture, mockApi, streamReply } from "./support/mock-api";

// NFR-04 (ストリーミング応答性): in `mock` mode the chat screen shows a response chunk within
// 100 ms of receiving it. The probe stamps each chunk when the page's fetch reader receives it and
// stamps the moment the conversation's text contains that chunk, both with `performance.now()`.

const MAX_LATENCY_MS = 100;
// Chunks arrive one at a time, 40 ms apart, as they would from a model that streams steadily.
const PACE_MS = 40;
const ROUNDS = 3;
const LOG = '[role="log"][aria-label="会話"]';
// The newest message: earlier rounds repeat the same text and must not satisfy a later chunk.
const NEWEST_MESSAGE = `${LOG} > ol > li:last-child`;

const TEXT_DELTAS = loadFixture("chat-greeting").filter((event) => event.type === "text-delta");

async function sendGreeting(page: Page): Promise<void> {
	await page.getByLabel("メッセージ").fill("こんにちは");
	await page.getByRole("button", { name: "送信" }).click();
}

test("chat: every chunk of a paced stream reaches the DOM within 100 ms", async ({ page }) => {
	await mockApi(page, { "/api/chat": streamReply("chat-greeting", { paceMs: PACE_MS }) });
	await installLatencyProbe(page, { target: NEWEST_MESSAGE });
	await page.goto("/chat");

	for (let round = 1; round <= ROUNDS; round += 1) {
		await sendGreeting(page);
		await expect(page.locator(`${LOG} > ol > li`)).toHaveCount(round * 2);
		await expect(page.getByRole("button", { name: "停止" })).toHaveCount(0);
	}

	const chunks = await readLatencies(page);
	// Not vacuous: every text chunk of every round was seen and reflected.
	expect(chunks).toHaveLength(TEXT_DELTAS.length * ROUNDS);
	const slow = chunks.filter(
		(chunk) => chunk.latencyMs === null || chunk.latencyMs > MAX_LATENCY_MS,
	);
	expect(slow, `chunks over ${MAX_LATENCY_MS} ms: ${JSON.stringify(slow)}`).toEqual([]);
	test.info().annotations.push({
		type: "latency-ms",
		description: JSON.stringify(chunks.map((chunk) => chunk.latencyMs)),
	});
});

test("chat: the chunks of the real route reach the DOM within 100 ms", async ({ page }) => {
	// No `page.route`: the real Route Handler streams the `m1-2/chat` scenario of the mock model.
	await installLatencyProbe(page, { target: NEWEST_MESSAGE });
	await page.goto("/chat");

	await sendGreeting(page);
	await expect(page.getByRole("log", { name: "会話" })).toContainText(
		"モックモードから決定論的に応答しています。",
	);

	const chunks = await readLatencies(page);
	expect(chunks.length).toBeGreaterThan(0);
	const slow = chunks.filter(
		(chunk) => chunk.latencyMs === null || chunk.latencyMs > MAX_LATENCY_MS,
	);
	expect(slow, `chunks over ${MAX_LATENCY_MS} ms: ${JSON.stringify(slow)}`).toEqual([]);
	test.info().annotations.push({
		type: "latency-ms",
		description: JSON.stringify(chunks.map((chunk) => chunk.latencyMs)),
	});
});
