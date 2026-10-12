import { expect, type Page, test } from "@playwright/test";
import {
	errorReply,
	type MockApi,
	mockApi,
	offerAlternativeModel,
	streamReply,
} from "./support/mock-api";

// Req 1.17, 3.1, 3.3, 3.5, 3.6, NFR-10: the chat screen against the generated `chat-greeting.sse`
// stream, served by `page.route` so that the moment each chunk arrives is under the test's control.

const FULL_ANSWER = "こんにちは。モックモードから決定論的に応答しています。";
// The first two `text-delta` events of the fixture.
const FIRST_TWO_DELTAS = "こんにちは。モックモードから決定";

const ALTERNATIVE_MODEL = { id: "mock:alternative-v1", displayName: "Alternative Mock Model" };

function conversation(page: Page) {
	return page.getByRole("log", { name: "会話" });
}

/** The error banner; the router announcer is a `role="alert"` too, so the title narrows it. */
function errorAlert(page: Page) {
	return page.getByRole("alert").filter({ hasText: "エラーが発生しました" });
}

async function send(page: Page, text: string): Promise<void> {
	await page.getByLabel("メッセージ").fill(text);
	await page.getByRole("button", { name: "送信" }).click();
}

/** The fields of a chat request body these specs read. */
interface ChatRequestBody {
	readonly modelId?: string;
	readonly personaId?: string;
	readonly messages?: readonly { readonly role: string }[];
}

function requestBody(api: MockApi, index: number): ChatRequestBody {
	const request = api.requests[index];
	if (!request || typeof request.body !== "object" || request.body === null) {
		throw new Error(`request #${index} has no JSON body`);
	}
	return request.body as ChatRequestBody;
}

test("chat: the answer appears chunk by chunk and finishes with the model name and usage", async ({
	page,
}) => {
	const api = await mockApi(page, {
		"/api/chat": streamReply("chat-greeting", { holdAfter: { type: "text-delta", count: 2 } }),
	});
	await page.goto("/chat");

	await send(page, "こんにちは");
	await api.waitUntilHeld();

	// Two chunks have arrived and the stream is still open: only their text is on screen.
	await expect(conversation(page)).toContainText(FIRST_TWO_DELTAS);
	await expect(conversation(page)).not.toContainText("応答しています。");
	await expect(page.getByRole("status")).toHaveText("回答を生成しています");
	await expect(page.getByRole("button", { name: "停止" })).toBeVisible();
	await expect(page.getByRole("button", { name: "送信" })).toBeDisabled();

	await api.release();

	await expect(conversation(page)).toContainText(FULL_ANSWER);
	await expect(page.getByRole("status")).toHaveCount(0);
	await expect(page.getByRole("button", { name: "停止" })).toHaveCount(0);
	const meta = conversation(page).getByRole("list", { name: "応答の情報" });
	await expect(meta).toContainText("Deterministic Mock Model");
	await expect(meta).toContainText("入力 0 トークン");
	await expect(meta).toContainText("出力 0 トークン");
	// The request carries the selected model and persona next to the conversation.
	expect(api.requests).toHaveLength(1);
	expect(requestBody(api, 0)).toMatchObject({
		modelId: "mock:general-v1",
		personaId: "general-assistant",
	});
});

test("chat: switching the model keeps the conversation and applies to the next message", async ({
	page,
}) => {
	const api = await mockApi(page, { "/api/chat": streamReply("chat-greeting") });
	// Mock mode lists a single chat model, so a second one is added to the page's model list.
	await offerAlternativeModel(page, "/chat", ALTERNATIVE_MODEL);
	await page.goto("/chat");

	await send(page, "こんにちは");
	await expect(conversation(page)).toContainText(FULL_ANSWER);

	await page.getByRole("combobox", { name: "モデル" }).click();
	await page.getByRole("option", { name: new RegExp(ALTERNATIVE_MODEL.displayName) }).click();
	await expect(page.getByRole("combobox", { name: "モデル" })).toContainText(
		ALTERNATIVE_MODEL.displayName,
	);
	// Switching changes nothing on screen: both turns of the first exchange are still there.
	await expect(conversation(page).getByText("こんにちは", { exact: true })).toBeVisible();
	await expect(conversation(page)).toContainText(FULL_ANSWER);

	await send(page, "こんにちは");
	await expect(conversation(page).getByText(FULL_ANSWER)).toHaveCount(2);

	expect(api.requests).toHaveLength(2);
	expect(requestBody(api, 0).modelId).toBe("mock:general-v1");
	expect(requestBody(api, 1).modelId).toBe(ALTERNATIVE_MODEL.id);
	// The second request carries the whole history: user, assistant, user.
	const roles = requestBody(api, 1).messages?.map((message) => message.role);
	expect(roles).toEqual(["user", "assistant", "user"]);
});

test("chat: stop ends the stream and keeps the text received so far", async ({ page }) => {
	const api = await mockApi(page, {
		"/api/chat": streamReply("chat-greeting", { holdAfter: { type: "text-delta", count: 2 } }),
	});
	await page.goto("/chat");
	await send(page, "こんにちは");
	await api.waitUntilHeld();
	await expect(conversation(page)).toContainText(FIRST_TWO_DELTAS);

	await page.getByRole("button", { name: "停止" }).click();

	await expect(page.getByRole("status")).toHaveCount(0);
	await expect(page.getByRole("button", { name: "停止" })).toHaveCount(0);
	// What was received stays, what was not received never appears, and it is not an error.
	await expect(conversation(page)).toContainText(FIRST_TWO_DELTAS);
	await expect(conversation(page)).not.toContainText("応答しています。");
	await expect(errorAlert(page)).toHaveCount(0);
	// The user message is kept as well.
	await expect(conversation(page).getByText("こんにちは", { exact: true })).toBeVisible();
});

test("chat: a failed request shows the error and resend answers without losing the message", async ({
	page,
}) => {
	const api = await mockApi(page, {
		"/api/chat": [
			errorReply(503, {
				code: "provider-unavailable",
				message: "モデルのプロバイダに接続できませんでした。",
			}),
			streamReply("chat-greeting"),
		],
	});
	await page.goto("/chat");

	await send(page, "こんにちは");

	const alert = errorAlert(page);
	await expect(alert).toContainText("エラーが発生しました");
	await expect(alert).toContainText("モデルのプロバイダに接続できませんでした。");
	// Req 3.6: the sent message is not lost.
	await expect(conversation(page).getByText("こんにちは", { exact: true })).toBeVisible();

	await alert.getByRole("button", { name: "再送信" }).click();

	await expect(conversation(page)).toContainText(FULL_ANSWER);
	await expect(errorAlert(page)).toHaveCount(0);
	expect(api.requests).toHaveLength(2);
	// Resending sends the same single user message again, not a duplicate.
	expect(requestBody(api, 1).messages).toHaveLength(1);
	await expect(conversation(page).getByText("こんにちは", { exact: true })).toHaveCount(1);
});
