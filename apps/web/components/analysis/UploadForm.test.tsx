import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UploadForm } from "./UploadForm";

afterEach(cleanup);

const LIMITS = { maxBytes: 20 * 1024 * 1024, accepts: [".csv", ".xlsx", ".xls"] } as const;

function renderForm(props: { disabled?: boolean; pending?: boolean } = {}) {
	const onSubmit = vi.fn();
	render(<UploadForm upload={LIMITS} onSubmit={onSubmit} {...props} />);
	return onSubmit;
}

const fileField = () => screen.getByLabelText("分析するファイル") as HTMLInputElement;
const instructionField = () => screen.getByLabelText("分析の指示") as HTMLTextAreaElement;
const submitButton = () => screen.getByRole("button", { name: "分析する" }) as HTMLButtonElement;

function choose(file: File) {
	fireEvent.change(fileField(), { target: { files: [file] } });
}

describe("UploadForm", () => {
	it("shows the accepted formats and the size limit from the server (Req 3.9)", () => {
		renderForm();

		const hint = screen.getByText(/対応形式/u);
		expect(hint.textContent).toContain(".csv");
		expect(hint.textContent).toContain(".xlsx");
		expect(hint.textContent).toContain(".xls");
		expect(hint.textContent).toContain("20 MB");
		expect(fileField().getAttribute("accept")).toBe(".csv,.xlsx,.xls");
	});

	it("derives the shown limit from the number it is given, not from a constant", () => {
		render(
			<UploadForm upload={{ maxBytes: 5 * 1024 * 1024, accepts: [".csv"] }} onSubmit={vi.fn()} />,
		);

		const hint = screen.getByText(/対応形式/u);
		expect(hint.textContent).toContain("5 MB");
		expect(hint.textContent).not.toContain("20 MB");
		expect(hint.textContent).not.toContain(".xlsx");
	});

	it("shows a fractional limit with one decimal", () => {
		render(
			<UploadForm upload={{ maxBytes: 1.5 * 1024 * 1024, accepts: [".csv"] }} onSubmit={vi.fn()} />,
		);

		expect(screen.getByText(/対応形式/u).textContent).toContain("1.5 MB");
	});

	it("ties the format hint to the file field for assistive technology", () => {
		renderForm();

		const hintId = fileField().getAttribute("aria-describedby");
		expect(hintId).toBeTruthy();
		expect(document.getElementById(hintId as string)?.textContent).toContain("対応形式");
	});

	it("keeps submit disabled until a file and an instruction are both given", () => {
		renderForm();
		expect(submitButton().disabled).toBe(true);

		choose(new File(["a,b\n1,2\n"], "sales.csv", { type: "text/csv" }));
		expect(submitButton().disabled).toBe(true);

		fireEvent.change(instructionField(), { target: { value: "   " } });
		expect(submitButton().disabled).toBe(true);

		fireEvent.change(instructionField(), { target: { value: "月別の合計を出して" } });
		expect(submitButton().disabled).toBe(false);
	});

	it("submits the chosen file and the trimmed instruction", () => {
		const onSubmit = renderForm();
		const file = new File(["a,b\n1,2\n"], "sales.csv", { type: "text/csv" });
		choose(file);
		fireEvent.change(instructionField(), { target: { value: "  月別の合計を出して  " } });

		fireEvent.click(submitButton());

		expect(onSubmit).toHaveBeenCalledTimes(1);
		expect(onSubmit).toHaveBeenCalledWith({ file, instruction: "月別の合計を出して" });
	});

	it("leaves the file's type and size to the server: any chosen file is passed on (Req 3.9)", () => {
		const onSubmit = renderForm();
		const file = new File(["x"], "notes.txt", { type: "text/plain" });
		choose(file);
		fireEvent.change(instructionField(), { target: { value: "見て" } });

		fireEvent.click(submitButton());

		expect(onSubmit).toHaveBeenCalledWith({ file, instruction: "見て" });
	});

	it("submits with the form's own submit (Enter in a field), once", () => {
		const onSubmit = renderForm();
		choose(new File(["a"], "a.csv"));
		fireEvent.change(instructionField(), { target: { value: "x" } });

		fireEvent.submit(submitButton().closest("form") as HTMLFormElement);

		expect(onSubmit).toHaveBeenCalledTimes(1);
	});

	it("does not submit an incomplete form, even through the form's submit event", () => {
		const onSubmit = renderForm();
		fireEvent.change(instructionField(), { target: { value: "x" } });

		fireEvent.submit(submitButton().closest("form") as HTMLFormElement);

		expect(onSubmit).not.toHaveBeenCalled();
	});

	it("disables every input when the sandbox is disabled, and submits nothing (Req 3.8)", () => {
		const onSubmit = renderForm({ disabled: true });

		expect(fileField().disabled).toBe(true);
		expect(instructionField().disabled).toBe(true);
		expect(submitButton().disabled).toBe(true);

		fireEvent.submit(submitButton().closest("form") as HTMLFormElement);
		expect(onSubmit).not.toHaveBeenCalled();
	});

	it.each([
		["pending", { pending: true }],
		["disabled", { disabled: true }],
	] as const)("a filled form cannot be sent once it is %s", (_label, locked) => {
		const onSubmit = vi.fn();
		const { rerender } = render(<UploadForm upload={LIMITS} onSubmit={onSubmit} />);
		choose(new File(["a"], "a.csv"));
		fireEvent.change(instructionField(), { target: { value: "x" } });
		expect(submitButton().disabled).toBe(false);

		rerender(<UploadForm upload={LIMITS} onSubmit={onSubmit} {...locked} />);

		expect(fileField().disabled).toBe(true);
		expect(instructionField().disabled).toBe(true);
		expect(submitButton().disabled).toBe(true);
		fireEvent.submit(submitButton().closest("form") as HTMLFormElement);
		expect(onSubmit).not.toHaveBeenCalled();
	});

	it("enables the inputs by default", () => {
		renderForm();

		expect(fileField().disabled).toBe(false);
		expect(instructionField().disabled).toBe(false);
	});

	it("is operable by keyboard: native controls in reading order, none removed from the tab order", () => {
		renderForm();
		choose(new File(["a"], "a.csv"));
		fireEvent.change(instructionField(), { target: { value: "x" } });

		const order = [fileField(), instructionField(), submitButton()];
		for (const control of order) {
			control.focus();
			expect(document.activeElement).toBe(control);
			expect(control.tabIndex).toBe(0);
		}
		const all = Array.from(document.querySelectorAll("input, textarea, button"));
		expect(all).toEqual(order);
		expect(submitButton().type).toBe("submit");
	});
});
