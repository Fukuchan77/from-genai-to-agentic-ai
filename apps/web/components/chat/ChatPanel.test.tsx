import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatPanel } from "./ChatPanel";

// useChat is replaced so the test controls status and messages without a network.
const chat = vi.hoisted(() => ({
	state: {
		messages: [] as unknown[],
		status: "ready" as string,
		error: undefined as Error | undefined,
	},
	sendMessage: vi.fn(async () => {}),
	stop: vi.fn(async () => {}),
	regenerate: vi.fn(async () => {}),
	clearError: vi.fn(),
}));

vi.mock("@ai-sdk/react", () => ({
	useChat: () => ({
		...chat.state,
		sendMessage: chat.sendMessage,
		stop: chat.stop,
		regenerate: chat.regenerate,
		clearError: chat.clearError,
	}),
}));

const MODELS = [
	{
		id: "mock:general-v1",
		displayName: "Deterministic Mock Model",
		provider: "mock",
		contextWindow: 131072,
		capabilities: {
			tools: true,
			structuredOutput: true,
			reasoning: true,
			imageInput: true,
			embedding: false,
			promptCache: "none",
		},
	},
	{
		id: "text-only",
		displayName: "Text Only",
		provider: "ollama",
		contextWindow: 1000,
		capabilities: {
			tools: false,
			structuredOutput: false,
			reasoning: false,
			imageInput: false,
			embedding: false,
			promptCache: "none",
		},
	},
] as const;
const PERSONAS = [{ id: "general-assistant", title: "汎用アシスタント" }] as const;

function renderPanel() {
	return render(
		<ChatPanel
			models={MODELS}
			defaultModelId="mock:general-v1"
			personas={PERSONAS}
			defaultPersonaId="general-assistant"
		/>,
	);
}

beforeAll(() => {
	Element.prototype.hasPointerCapture ??= () => false;
	Element.prototype.releasePointerCapture ??= () => {};
	Element.prototype.setPointerCapture ??= () => {};
	Element.prototype.scrollIntoView ??= () => {};
});

async function attachImage(container: HTMLElement) {
	const input = container.querySelector('input[type="file"]') as HTMLInputElement;
	fireEvent.change(input, {
		target: { files: [new File([new Uint8Array([1])], "cat.png", { type: "image/png" })] },
	});
	await screen.findByText("cat.png");
}

beforeEach(() => {
	chat.state = { messages: [], status: "ready", error: undefined };
	vi.clearAllMocks();
});
afterEach(cleanup);

describe("ChatPanel", () => {
	it("sends the typed text with the selected model and persona, then clears the field (Req 3.1)", () => {
		renderPanel();
		const input = screen.getByLabelText("メッセージ") as HTMLTextAreaElement;

		fireEvent.change(input, { target: { value: "こんにちは" } });
		fireEvent.click(screen.getByRole("button", { name: "送信" }));

		expect(chat.sendMessage).toHaveBeenCalledWith(
			{ text: "こんにちは" },
			{ body: { modelId: "mock:general-v1", personaId: "general-assistant" } },
		);
		expect(input.value).toBe("");
	});

	it("does not send an empty or whitespace-only message", () => {
		renderPanel();

		fireEvent.change(screen.getByLabelText("メッセージ"), { target: { value: "   " } });

		expect((screen.getByRole("button", { name: "送信" }) as HTMLButtonElement).disabled).toBe(true);
		expect(chat.sendMessage).not.toHaveBeenCalled();
	});

	it("shows a stop button only while generating and calls stop() (Req 3.5)", () => {
		const { rerender } = renderPanel();
		expect(screen.queryByRole("button", { name: "停止" })).toBeNull();

		chat.state.status = "streaming";
		rerender(
			<ChatPanel
				models={MODELS}
				defaultModelId="mock:general-v1"
				personas={PERSONAS}
				defaultPersonaId="general-assistant"
			/>,
		);
		const stop = screen.getByRole("button", { name: "停止" }) as HTMLButtonElement;
		expect(stop.type).toBe("button");
		fireEvent.click(stop);

		expect(chat.stop).toHaveBeenCalledTimes(1);
		expect((screen.getByRole("button", { name: "送信" }) as HTMLButtonElement).disabled).toBe(true);
	});

	it("sends an attached image with the message and clears the attachment (Req 3.9)", async () => {
		const { container } = renderPanel();
		await attachImage(container);

		fireEvent.change(screen.getByLabelText("メッセージ"), { target: { value: "これは何?" } });
		fireEvent.click(screen.getByRole("button", { name: "送信" }));

		expect(chat.sendMessage).toHaveBeenCalledWith(
			{
				text: "これは何?",
				files: [
					{
						type: "file",
						mediaType: "image/png",
						filename: "cat.png",
						url: "data:image/png;base64,AQ==",
					},
				],
			},
			{ body: { modelId: "mock:general-v1", personaId: "general-assistant" } },
		);
		expect(screen.queryByText("cat.png")).toBeNull();
	});

	it("sends the newly selected model and drops an image the new model cannot take (Req 3.2, 3.9)", async () => {
		const { container } = renderPanel();
		await attachImage(container);

		fireEvent.keyDown(screen.getByRole("combobox", { name: "モデル" }), { key: "ArrowDown" });
		fireEvent.keyDown(screen.getByRole("option", { name: /Text Only/u }), { key: "Enter" });

		await waitFor(() => expect(screen.queryByText("cat.png")).toBeNull());
		expect((screen.getByRole("button", { name: "画像を添付" }) as HTMLButtonElement).disabled).toBe(
			true,
		);
		fireEvent.change(screen.getByLabelText("メッセージ"), { target: { value: "続き" } });
		fireEvent.click(screen.getByRole("button", { name: "送信" }));
		expect(chat.sendMessage).toHaveBeenCalledWith(
			{ text: "続き" },
			{ body: { modelId: "text-only", personaId: "general-assistant" } },
		);
	});

	it("shows the error with a retry that regenerates without losing messages (Req 3.6)", () => {
		chat.state.error = new Error(
			JSON.stringify({ code: "provider-unavailable", message: "モデルに接続できません。" }),
		);
		chat.state.messages = [
			{ id: "u1", role: "user", parts: [{ type: "text", text: "残るメッセージ" }] },
		];
		renderPanel();

		expect(screen.getByRole("alert").textContent).toContain("モデルに接続できません。");
		expect(screen.getByText("残るメッセージ")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "再送信" }));

		expect(chat.clearError).toHaveBeenCalled();
		expect(chat.regenerate).toHaveBeenCalledWith({
			body: { modelId: "mock:general-v1", personaId: "general-assistant" },
		});
	});

	it("locks the selectors while an answer is generating", () => {
		chat.state.status = "streaming";
		renderPanel();

		for (const name of ["モデル", "ペルソナ"]) {
			expect((screen.getByRole("combobox", { name }) as HTMLButtonElement).disabled).toBe(true);
		}
	});
});
