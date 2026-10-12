import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { type ChatMessage, MessageList } from "./MessageList";

afterEach(cleanup);

const user: ChatMessage = {
	id: "u1",
	role: "user",
	parts: [{ type: "text", text: "こんにちは" }],
};

const assistant: ChatMessage = {
	id: "a1",
	role: "assistant",
	parts: [
		{ type: "reasoning", text: "まず挨拶を返します。", state: "done" },
		{ type: "text", text: "こんにちは。ご用件は何ですか。", state: "done" },
	],
};

describe("MessageList", () => {
	it("renders text parts per message with an accessible author label (Req 3.1)", () => {
		render(<MessageList messages={[user, assistant]} status="ready" />);

		const log = screen.getByRole("log", { name: "会話" });
		const items = within(log).getAllByRole("listitem");
		expect(items).toHaveLength(2);
		expect(within(items[0] as HTMLElement).getByText("あなた")).toBeTruthy();
		expect(within(items[0] as HTMLElement).getByText("こんにちは")).toBeTruthy();
		expect(within(items[1] as HTMLElement).getByText("アシスタント")).toBeTruthy();
		expect(
			within(items[1] as HTMLElement).getByText("こんにちは。ご用件は何ですか。"),
		).toBeTruthy();
	});

	it("collapses reasoning by default and opens it from a keyboard-operable summary (Req 3.4)", () => {
		render(<MessageList messages={[assistant]} status="ready" />);

		const summary = screen.getByText("推論を表示");
		expect(summary.tagName).toBe("SUMMARY");
		const details = summary.closest("details") as HTMLDetailsElement;
		expect(details.open).toBe(false);

		fireEvent.click(summary);

		expect(details.open).toBe(true);
		expect(within(details).getByText("まず挨拶を返します。")).toBeTruthy();
	});

	it("shows image file parts with alternative text and ignores unknown part types", () => {
		const withImage: ChatMessage = {
			id: "u2",
			role: "user",
			parts: [
				{
					type: "file",
					mediaType: "image/png",
					filename: "cat.png",
					url: "data:image/png;base64,AAAA",
				},
				{ type: "step-start" },
				{ type: "text", text: "これは何ですか" },
			],
		};

		render(<MessageList messages={[withImage]} status="ready" />);

		const image = screen.getByRole("img", { name: "添付画像: cat.png" }) as HTMLImageElement;
		expect(image.src).toBe("data:image/png;base64,AAAA");
		expect(screen.getByText("これは何ですか")).toBeTruthy();
	});

	it("announces that an answer is being generated while submitted or streaming", () => {
		const { rerender } = render(<MessageList messages={[user]} status="submitted" />);
		expect(screen.getByText("回答を生成しています")).toBeTruthy();

		rerender(<MessageList messages={[user, assistant]} status="streaming" />);
		expect(screen.getByText("回答を生成しています")).toBeTruthy();

		rerender(<MessageList messages={[user, assistant]} status="ready" />);
		expect(screen.queryByText("回答を生成しています")).toBeNull();
	});

	it("shows an empty-state hint when there are no messages", () => {
		render(<MessageList messages={[]} status="ready" />);

		expect(screen.getByText("メッセージを送信すると会話が始まります。")).toBeTruthy();
	});

	it("shows the model name and tokens under assistant answers only (Req 3.7)", () => {
		const answered: ChatMessage = {
			...assistant,
			metadata: {
				modelId: "mock:general-v1",
				modelName: "Deterministic Mock Model",
				provider: "mock",
				personaId: "general-assistant",
				personaVersion: "1.0.0",
				disabledTools: [],
				usage: { inputTokens: 12, outputTokens: 5 },
			},
		};

		render(<MessageList messages={[user, answered]} status="ready" />);

		expect(screen.getAllByText("Deterministic Mock Model")).toHaveLength(1);
		expect(screen.getByText("入力 12 トークン")).toBeTruthy();
	});
});
