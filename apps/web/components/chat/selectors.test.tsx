import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ImageAttachButton } from "./ImageAttachButton";
import { ModelSelector } from "./ModelSelector";
import { PersonaSelector } from "./PersonaSelector";

// Radix Select expects pointer-capture and scroll APIs that jsdom lacks.
beforeAll(() => {
	Element.prototype.hasPointerCapture ??= () => false;
	Element.prototype.releasePointerCapture ??= () => {};
	Element.prototype.setPointerCapture ??= () => {};
	Element.prototype.scrollIntoView ??= () => {};
});
afterEach(cleanup);

const capabilities = {
	tools: true,
	structuredOutput: true,
	reasoning: true,
	embedding: false,
	promptCache: "none",
} as const;

const MODELS = [
	{
		id: "model-a",
		displayName: "モデル A",
		provider: "ollama",
		contextWindow: 1000,
		capabilities: { ...capabilities, imageInput: false },
	},
	{
		id: "model-b",
		displayName: "モデル B",
		provider: "anthropic",
		contextWindow: 1000,
		capabilities: { ...capabilities, imageInput: true },
	},
] as const;

const PERSONAS = [
	{ id: "general-assistant", title: "汎用アシスタント" },
	{ id: "python-mentor", title: "Python メンター" },
] as const;

/** Opens a Radix select from the keyboard and returns its listbox. */
function openWithKeyboard(name: string) {
	const trigger = screen.getByRole("combobox", { name });
	fireEvent.keyDown(trigger, { key: "ArrowDown" });
	return screen.getByRole("listbox");
}

describe("ModelSelector", () => {
	it("lists the available models and reports the chosen one (Req 3.2)", () => {
		const onValueChange = vi.fn();
		render(<ModelSelector models={MODELS} value="model-a" onValueChange={onValueChange} />);

		expect(screen.getByRole("combobox", { name: "モデル" }).textContent).toContain("モデル A");
		const listbox = openWithKeyboard("モデル");
		const options = within(listbox).getAllByRole("option");
		expect(options.map((option) => option.textContent)).toEqual([
			expect.stringContaining("モデル A"),
			expect.stringContaining("モデル B"),
		]);

		fireEvent.keyDown(options[1] as HTMLElement, { key: "Enter" });

		expect(onValueChange).toHaveBeenCalledWith("model-b");
	});

	it("can be disabled while an answer is being generated", () => {
		render(<ModelSelector models={MODELS} value="model-a" onValueChange={() => {}} disabled />);

		expect((screen.getByRole("combobox", { name: "モデル" }) as HTMLButtonElement).disabled).toBe(
			true,
		);
	});
});

describe("PersonaSelector", () => {
	it("lists the personas and reports the chosen one (Req 3.10)", () => {
		const onValueChange = vi.fn();
		render(
			<PersonaSelector
				personas={PERSONAS}
				value="general-assistant"
				onValueChange={onValueChange}
			/>,
		);

		expect(screen.getByRole("combobox", { name: "ペルソナ" }).textContent).toContain(
			"汎用アシスタント",
		);
		const options = within(openWithKeyboard("ペルソナ")).getAllByRole("option");
		expect(options).toHaveLength(2);

		fireEvent.keyDown(options[1] as HTMLElement, { key: "Enter" });

		expect(onValueChange).toHaveBeenCalledWith("python-mentor");
	});
});

describe("ImageAttachButton", () => {
	it("is disabled with a visible reason when the model has no image input (Req 3.9)", () => {
		render(
			<ImageAttachButton
				supported={false}
				attachment={undefined}
				onAttach={() => {}}
				onClear={() => {}}
			/>,
		);

		const button = screen.getByRole("button", { name: "画像を添付" }) as HTMLButtonElement;
		expect(button.disabled).toBe(true);
		expect(button.getAttribute("aria-describedby")).toBeTruthy();
		expect(screen.getByText("選択中のモデルは画像入力に対応していません。")).toBeTruthy();
	});

	it("reads a chosen image into a data URL and reports it (Req 3.9)", async () => {
		const onAttach = vi.fn();
		const { container } = render(
			<ImageAttachButton supported attachment={undefined} onAttach={onAttach} onClear={() => {}} />,
		);
		const input = container.querySelector('input[type="file"]') as HTMLInputElement;
		expect(input.accept).toBe("image/*");

		fireEvent.change(input, {
			target: { files: [new File([new Uint8Array([1, 2, 3])], "cat.png", { type: "image/png" })] },
		});

		await waitFor(() => expect(onAttach).toHaveBeenCalledTimes(1));
		expect(onAttach).toHaveBeenCalledWith({
			type: "file",
			mediaType: "image/png",
			filename: "cat.png",
			url: "data:image/png;base64,AQID",
		});
	});

	it("rejects a non-image file with an announced message", async () => {
		const onAttach = vi.fn();
		const { container } = render(
			<ImageAttachButton supported attachment={undefined} onAttach={onAttach} onClear={() => {}} />,
		);
		const input = container.querySelector('input[type="file"]') as HTMLInputElement;

		fireEvent.change(input, {
			target: { files: [new File(["x"], "notes.txt", { type: "text/plain" })] },
		});

		expect((await screen.findByRole("alert")).textContent).toContain(
			"画像ファイルを選択してください",
		);
		expect(onAttach).not.toHaveBeenCalled();
	});

	it("shows the attached file and lets the learner remove it", () => {
		const onClear = vi.fn();
		render(
			<ImageAttachButton
				supported
				attachment={{ type: "file", mediaType: "image/png", filename: "cat.png", url: "data:x" }}
				onAttach={() => {}}
				onClear={onClear}
			/>,
		);

		expect(screen.getByText("cat.png")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "添付を削除: cat.png" }));

		expect(onClear).toHaveBeenCalledTimes(1);
	});
});
