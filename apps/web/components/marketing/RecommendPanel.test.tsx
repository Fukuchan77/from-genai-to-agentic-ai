import { recommendRequestSchema } from "@platform/ai-core/marketing";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { readUIMessageStream, type UIMessage, type UIMessageChunk } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prepareRecommendRequest, RecommendPanel, selectProfile } from "./RecommendPanel";

const chat = vi.hoisted(() => ({
	state: {
		messages: [] as unknown[],
		status: "ready" as string,
		error: undefined as Error | undefined,
	},
	sendMessage: vi.fn(async () => {}),
	stop: vi.fn(async () => {}),
	clearError: vi.fn(),
	regenerate: vi.fn(async () => {}),
}));

vi.mock("@ai-sdk/react", () => ({
	useChat: () => ({
		...chat.state,
		sendMessage: chat.sendMessage,
		stop: chat.stop,
		clearError: chat.clearError,
		regenerate: chat.regenerate,
	}),
}));

beforeEach(() => {
	chat.state.messages = [];
	chat.state.status = "ready";
	chat.state.error = undefined;
	chat.sendMessage.mockClear();
	chat.stop.mockClear();
	chat.clearError.mockClear();
	chat.regenerate.mockClear();
});
afterEach(cleanup);

const LIMIT = 100;
const PROFILE = { interests: ["キャンプ"], budgetYen: 8000, concerns: ["重さ"] };

function user(id: string, text: string): UIMessage {
	return { id, role: "user", parts: [{ type: "text", text }] };
}

/** The chunks `/api/marketing/recommend` writes, in the order it writes them. */
function recommendChunks(
	over: { dropped?: number; items?: unknown[]; summary?: string } = {},
): UIMessageChunk[] {
	const items = over.items ?? [
		{
			productId: "P-001",
			name: "軽量テント",
			priceYen: 12000,
			reason: "軽くて持ち運びやすいためです",
			overBudget: true,
		},
		{
			productId: "P-002",
			name: "ミニランタン",
			priceYen: 3000,
			reason: "予算内で使えます",
			overBudget: false,
		},
	];
	return [
		{ type: "start" },
		{ type: "start-step" },
		{ type: "data-marketing-profile", id: "profile", data: PROFILE },
		{
			type: "data-marketing-recommendation",
			id: "recommendation",
			data: { items, dropped: over.dropped ?? 0 },
		},
		{ type: "text-start", id: "summary" },
		{ type: "text-delta", id: "summary", delta: over.summary ?? "2 件をおすすめします。" },
		{ type: "text-end", id: "summary" },
		{ type: "finish-step" },
		{ type: "finish" },
	] as UIMessageChunk[];
}

/**
 * An assistant message folded from real stream chunks, as `useChat` builds it. The route's `start`
 * chunk carries no message id, so `useChat` seeds the message with a generated one; so does this.
 */
let assistantCount = 0;
async function assistantFromStream(chunks: UIMessageChunk[]): Promise<UIMessage> {
	assistantCount += 1;
	const seed: UIMessage = { id: `assistant-${assistantCount}`, role: "assistant", parts: [] };
	const stream = new ReadableStream<UIMessageChunk>({
		start(controller) {
			for (const chunk of chunks) controller.enqueue(chunk);
			controller.close();
		},
	});
	let last: UIMessage | undefined;
	for await (const message of readUIMessageStream({ message: seed, stream })) last = message;
	if (!last) throw new Error("the stream produced no message");
	return last;
}

function renderPanel() {
	return render(<RecommendPanel messageMaxLength={LIMIT} />);
}

describe("RecommendPanel input", () => {
	it("sends the message with no profile on the first turn and clears the field", () => {
		renderPanel();
		const field = screen.getByLabelText("メッセージ") as HTMLTextAreaElement;
		fireEvent.change(field, { target: { value: "キャンプ用品を探しています" } });
		fireEvent.click(screen.getByRole("button", { name: "送信" }));
		expect(chat.sendMessage).toHaveBeenCalledTimes(1);
		expect(chat.sendMessage).toHaveBeenCalledWith(
			{ text: "キャンプ用品を探しています" },
			{ body: {} },
		);
		expect(field.value).toBe("");
	});

	it("keeps send disabled for a blank message", () => {
		renderPanel();
		fireEvent.change(screen.getByLabelText("メッセージ"), { target: { value: "   " } });
		expect((screen.getByRole("button", { name: "送信" }) as HTMLButtonElement).disabled).toBe(true);
	});

	it("accepts exactly the limit and refuses one character more", () => {
		renderPanel();
		const field = screen.getByLabelText("メッセージ");
		fireEvent.change(field, { target: { value: "あ".repeat(LIMIT) } });
		expect((screen.getByRole("button", { name: "送信" }) as HTMLButtonElement).disabled).toBe(
			false,
		);
		expect(screen.getByText(`${LIMIT} / ${LIMIT} 文字`)).not.toBeNull();
		fireEvent.change(field, { target: { value: "あ".repeat(LIMIT + 1) } });
		expect((screen.getByRole("button", { name: "送信" }) as HTMLButtonElement).disabled).toBe(true);
		expect(screen.getByRole("alert").textContent).toContain(
			`メッセージは ${LIMIT} 文字までです（現在 ${LIMIT + 1} 文字）。`,
		);
		expect(field.getAttribute("aria-invalid")).toBe("true");
	});

	it("counts characters, not UTF-16 units", () => {
		renderPanel();
		fireEvent.change(screen.getByLabelText("メッセージ"), {
			target: { value: "😀".repeat(LIMIT) },
		});
		expect((screen.getByRole("button", { name: "送信" }) as HTMLButtonElement).disabled).toBe(
			false,
		);
	});

	it("disables send and offers stop while generating", () => {
		chat.state.status = "streaming";
		renderPanel();
		fireEvent.change(screen.getByLabelText("メッセージ"), { target: { value: "こんにちは" } });
		expect((screen.getByRole("button", { name: "送信" }) as HTMLButtonElement).disabled).toBe(true);
		fireEvent.click(screen.getByRole("button", { name: "停止" }));
		expect(chat.stop).toHaveBeenCalledTimes(1);
		expect(screen.getByRole("status", { name: "実行の状態" }).textContent).toContain(
			"おすすめを考えています",
		);
	});
});

describe("RecommendPanel recommendation (Generative UI)", () => {
	it("shows the product id, the reason, the budget note and the fixed summary", async () => {
		chat.state.messages = [
			user("u1", "テントがほしい"),
			await assistantFromStream(recommendChunks()),
		];
		renderPanel();
		const first = screen.getByRole("article", { name: "P-001 軽量テント" });
		expect(within(first).getByText("P-001")).not.toBeNull();
		expect(within(first).getByText("12,000 円")).not.toBeNull();
		expect(within(first).getByText("軽くて持ち運びやすいためです")).not.toBeNull();
		expect(within(first).getByText("予算を超えています")).not.toBeNull();
		const second = screen.getByRole("article", { name: "P-002 ミニランタン" });
		expect(within(second).queryByText("予算を超えています")).toBeNull();
		expect(screen.getByText("2 件をおすすめします。")).not.toBeNull();
	});

	it("shows how many ids the catalog check removed, only when some were", async () => {
		chat.state.messages = [
			user("u1", "x"),
			await assistantFromStream(recommendChunks({ dropped: 2 })),
		];
		const view = renderPanel();
		expect(screen.getByText("カタログにない商品 ID を 2 件除去しました")).not.toBeNull();
		cleanup();
		chat.state.messages = [
			user("u1", "x"),
			await assistantFromStream(recommendChunks({ dropped: 0 })),
		];
		view.unmount();
		renderPanel();
		expect(screen.queryByText(/件除去しました/)).toBeNull();
	});

	it("shows the removal count and the fixed text when nothing is recommended", async () => {
		chat.state.messages = [
			user("u1", "x"),
			await assistantFromStream(
				recommendChunks({
					items: [],
					dropped: 1,
					summary: "条件に合う商品が見つかりませんでした。",
				}),
			),
		];
		renderPanel();
		expect(screen.queryByRole("article")).toBeNull();
		expect(screen.getByText("カタログにない商品 ID を 1 件除去しました")).not.toBeNull();
		expect(screen.getByText("条件に合う商品が見つかりませんでした。")).not.toBeNull();
	});

	it("announces the conversation politely and shows the profile", async () => {
		chat.state.messages = [user("u1", "テント"), await assistantFromStream(recommendChunks())];
		renderPanel();
		expect(screen.getByRole("log", { name: "会話" }).getAttribute("aria-live")).toBe("polite");
		const profile = screen.getByRole("region", { name: "お客様のプロファイル" });
		expect(within(profile).getByText("キャンプ")).not.toBeNull();
		expect(within(profile).getByText("8,000 円")).not.toBeNull();
		expect(within(profile).getByText("重さ")).not.toBeNull();
	});
});

describe("second turn (W6 carry-over)", () => {
	it("sends the profile the stream delivered with the next message", async () => {
		chat.state.messages = [user("u1", "テント"), await assistantFromStream(recommendChunks())];
		renderPanel();
		fireEvent.change(screen.getByLabelText("メッセージ"), {
			target: { value: "もっと安いものは？" },
		});
		fireEvent.click(screen.getByRole("button", { name: "送信" }));
		expect(chat.sendMessage).toHaveBeenCalledWith(
			{ text: "もっと安いものは？" },
			{ body: { profile: PROFILE } },
		);
	});

	it("builds a request the server schema accepts from an assistant message of real stream parts", async () => {
		const assistant = await assistantFromStream(recommendChunks({ dropped: 1 }));
		const messages = [user("u1", "テント"), assistant, user("u2", "もっと安いものは？")];
		const prepared = prepareRecommendRequest({
			id: "chat-1",
			messages,
			body: { profile: PROFILE },
			trigger: "submit-message",
			messageId: undefined,
		});
		expect(prepared.api).toBe("/api/marketing/recommend");
		const parsed = recommendRequestSchema.safeParse(prepared.body);
		expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
		expect(parsed.data?.profile).toEqual(PROFILE);
		expect(parsed.data?.messages).toHaveLength(3);
	});

	it("omits the profile before the first turn", () => {
		const prepared = prepareRecommendRequest({
			id: "chat-1",
			messages: [user("u1", "テント")],
			body: {},
			trigger: "submit-message",
			messageId: undefined,
		});
		expect(recommendRequestSchema.safeParse(prepared.body).success).toBe(true);
		expect(prepared.body).not.toHaveProperty("profile");
	});
});

describe("selectProfile", () => {
	it("returns the newest profile part across all assistant messages", async () => {
		const first = await assistantFromStream(recommendChunks());
		const newer = await assistantFromStream(
			recommendChunks().map((chunk) =>
				chunk.type === "data-marketing-profile"
					? { ...chunk, data: { ...PROFILE, budgetYen: 5000 } }
					: chunk,
			),
		);
		expect(selectProfile([user("u1", "a"), first, user("u2", "b"), newer])?.budgetYen).toBe(5000);
	});

	it("keeps the earlier profile when a later turn learned nothing", async () => {
		const first = await assistantFromStream(recommendChunks());
		const quiet = await assistantFromStream(
			recommendChunks().filter((chunk) => chunk.type !== "data-marketing-profile"),
		);
		expect(selectProfile([user("u1", "a"), first, user("u2", "b"), quiet])).toEqual(PROFILE);
	});

	it("is undefined before any profile arrived", () => {
		expect(selectProfile([user("u1", "a")])).toBeUndefined();
	});
});

describe("errors", () => {
	it("shows the seed:samples guidance when the server says the catalog is not seeded", () => {
		chat.state.messages = [user("u1", "テント")];
		chat.state.error = new Error(
			JSON.stringify({
				error: {
					code: "provider-unavailable",
					message:
						"商品カタログとペルソナが未投入です。`mise run seed:samples` でサンプルデータを投入してから、もう一度実行してください。",
				},
			}),
		);
		renderPanel();
		const guidance = screen.getByRole("alert");
		expect(guidance.textContent).toContain("サンプルデータが投入されていません");
		expect(within(guidance).getByText("mise run seed:samples")).not.toBeNull();
		fireEvent.click(within(guidance).getByRole("button", { name: "再送信" }));
		expect(chat.clearError).toHaveBeenCalled();
	});

	it("shows an ordinary error with the retry button for other failures", () => {
		chat.state.messages = [user("u1", "テント")];
		chat.state.error = new Error(
			JSON.stringify({ error: { code: "rate-limited", message: "しばらく待ってください" } }),
		);
		renderPanel();
		expect(screen.getByText("しばらく待ってください")).not.toBeNull();
		expect(screen.queryByText("mise run seed:samples")).toBeNull();
		expect(screen.getByRole("button", { name: "再送信" })).not.toBeNull();
	});

	it("does not treat a 503 without the seed message as unseeded", () => {
		chat.state.messages = [user("u1", "テント")];
		chat.state.error = new Error(
			JSON.stringify({ error: { code: "provider-unavailable", message: "モデルが使えません" } }),
		);
		renderPanel();
		expect(screen.queryByText("mise run seed:samples")).toBeNull();
		expect(screen.getByText("モデルが使えません")).not.toBeNull();
	});
});

describe("retry (review F-15)", () => {
	it("regenerates with the profile instead of sending the failed message a second time", async () => {
		chat.state.messages = [
			user("u1", "テントを探しています"),
			await assistantFromStream(recommendChunks()),
			user("u2", "もう少し安いもの"),
		];
		chat.state.error = new Error(
			JSON.stringify({ error: { code: "rate-limited", message: "しばらく待ってください" } }),
		);
		renderPanel();
		fireEvent.click(screen.getByRole("button", { name: "再送信" }));
		expect(chat.clearError).toHaveBeenCalled();
		expect(chat.sendMessage).not.toHaveBeenCalled();
		expect(chat.regenerate).toHaveBeenCalledTimes(1);
		expect(chat.regenerate).toHaveBeenCalledWith({ body: { profile: PROFILE } });
	});

	it("regenerates with an empty body before any profile exists", () => {
		chat.state.messages = [user("u1", "テント")];
		chat.state.error = new Error(
			JSON.stringify({ error: { code: "rate-limited", message: "しばらく待ってください" } }),
		);
		renderPanel();
		fireEvent.click(screen.getByRole("button", { name: "再送信" }));
		expect(chat.regenerate).toHaveBeenCalledWith({ body: {} });
	});
});
