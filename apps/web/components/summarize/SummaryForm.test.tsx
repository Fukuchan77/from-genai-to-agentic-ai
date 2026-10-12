import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SummaryForm } from "./SummaryForm";

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
] as const;

beforeAll(() => {
	Element.prototype.hasPointerCapture ??= () => false;
	Element.prototype.releasePointerCapture ??= () => {};
	Element.prototype.setPointerCapture ??= () => {};
	Element.prototype.scrollIntoView ??= () => {};
});

afterEach(cleanup);

function renderForm(props: { disabled?: boolean } = {}) {
	const onSubmit = vi.fn();
	render(
		<SummaryForm
			models={MODELS}
			modelId="mock:general-v1"
			onModelChange={() => {}}
			onSubmit={onSubmit}
			{...props}
		/>,
	);
	return onSubmit;
}

describe("SummaryForm", () => {
	it("offers the three input kinds as a labelled radio group, article first", () => {
		renderForm();

		const group = screen.getByRole("radiogroup", { name: "入力の種類" });
		const radios = Array.from(group.querySelectorAll('input[type="radio"]')) as HTMLInputElement[];
		expect(radios.map((radio) => radio.labels?.[0]?.textContent)).toEqual([
			"記事の URL",
			"YouTube の URL",
			"字幕テキスト",
		]);
		expect(radios[0]?.checked).toBe(true);
	});

	it("keeps the submit button disabled until the input has content", () => {
		renderForm();
		const submit = screen.getByRole("button", { name: "要約する" }) as HTMLButtonElement;
		expect(submit.disabled).toBe(true);

		fireEvent.change(screen.getByLabelText("記事の URL（http / https）"), {
			target: { value: "https://example.test/a" },
		});
		expect(submit.disabled).toBe(false);

		fireEvent.change(screen.getByLabelText("記事の URL（http / https）"), {
			target: { value: "   " },
		});
		expect(submit.disabled).toBe(true);
	});

	it("submits the trimmed value as the selected kind", () => {
		const onSubmit = renderForm();

		fireEvent.click(screen.getByRole("radio", { name: "YouTube の URL" }));
		fireEvent.change(screen.getByLabelText("YouTube 動画の URL"), {
			target: { value: " https://www.youtube.com/watch?v=abc " },
		});
		fireEvent.submit(screen.getByRole("button", { name: "要約する" }).closest("form") as Element);

		expect(onSubmit).toHaveBeenCalledWith({
			kind: "youtube",
			url: "https://www.youtube.com/watch?v=abc",
		});
	});

	it("uses a multi-line field for the transcript", () => {
		renderForm();

		fireEvent.click(screen.getByRole("radio", { name: "字幕テキスト" }));

		expect(screen.getByLabelText("字幕テキストを貼り付け")).toBeTruthy();
	});

	it("does not submit and disables its fields while a summary is being generated", () => {
		const onSubmit = renderForm({ disabled: true });

		const field = screen.getByLabelText("記事の URL（http / https）") as HTMLInputElement;
		expect(field.disabled).toBe(true);
		fireEvent.submit(screen.getByRole("button", { name: "要約する" }).closest("form") as Element);
		expect(onSubmit).not.toHaveBeenCalled();
	});
});
