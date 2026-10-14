import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MethodSwitches, type RagSettings, type SettingsLimits } from "./MethodSwitches";

afterEach(cleanup);

const LIMITS: SettingsLimits = {
	topK: { min: 1, max: 20 },
	minSimilarity: { min: -1, max: 1 },
};

const VALUE: RagSettings = {
	topK: 4,
	minSimilarity: 0.2,
	methods: { hyde: false, multiQuery: false, hybrid: false, rerank: false },
	agentic: false,
};

interface Overrides {
	value?: RagSettings;
	rerank?: { available: boolean; reason?: "api-key-missing" };
	disabled?: boolean;
}

function setup(overrides: Overrides = {}) {
	const onChange = vi.fn();
	const onValidityChange = vi.fn();
	render(
		<MethodSwitches
			value={overrides.value ?? VALUE}
			onChange={onChange}
			onValidityChange={onValidityChange}
			limits={LIMITS}
			rerank={overrides.rerank ?? { available: true }}
			disabled={overrides.disabled ?? false}
		/>,
	);
	return { onChange, onValidityChange };
}

const topK = () => screen.getByLabelText(/取得件数/) as HTMLInputElement;
const similarity = () => screen.getByLabelText(/類似度の閾値/) as HTMLInputElement;

describe("MethodSwitches", () => {
	it("offers the four retrieval methods and Agentic RAG as labelled checkboxes", () => {
		setup();

		for (const name of ["HyDE", "Multi-Query", "ハイブリッド検索", "Rerank", "Agentic RAG"]) {
			const box = screen.getByRole("checkbox", { name: new RegExp(name) }) as HTMLInputElement;
			expect(box.checked).toBe(false);
		}
	});

	it.each([
		["HyDE", "hyde"],
		["Multi-Query", "multiQuery"],
		["ハイブリッド検索", "hybrid"],
		["Rerank", "rerank"],
	] as const)("passes %s on as a change of that one method", (name, key) => {
		const { onChange } = setup();

		fireEvent.click(screen.getByRole("checkbox", { name: new RegExp(name) }));

		expect(onChange).toHaveBeenCalledTimes(1);
		expect(onChange).toHaveBeenCalledWith({
			...VALUE,
			methods: { ...VALUE.methods, [key]: true },
		});
	});

	it("passes the Agentic RAG switch on without touching the other settings", () => {
		const { onChange } = setup();

		fireEvent.click(screen.getByRole("checkbox", { name: /Agentic RAG/ }));

		expect(onChange).toHaveBeenCalledWith({ ...VALUE, agentic: true });
	});

	it("shows the current state of the switches", () => {
		setup({
			value: { ...VALUE, methods: { hyde: true, multiQuery: false, hybrid: true, rerank: false } },
		});

		expect((screen.getByRole("checkbox", { name: /HyDE/ }) as HTMLInputElement).checked).toBe(true);
		expect(
			(screen.getByRole("checkbox", { name: /Multi-Query/ }) as HTMLInputElement).checked,
		).toBe(false);
		expect(
			(screen.getByRole("checkbox", { name: /ハイブリッド/ }) as HTMLInputElement).checked,
		).toBe(true);
	});

	it("turns the retrieval settings off while Agentic RAG decides how to search", () => {
		setup({ value: { ...VALUE, agentic: true } });

		for (const name of ["HyDE", "Multi-Query", "ハイブリッド検索", "Rerank"]) {
			expect(
				(screen.getByRole("checkbox", { name: new RegExp(name) }) as HTMLInputElement).disabled,
			).toBe(true);
		}
		expect(topK().disabled).toBe(true);
		expect(similarity().disabled).toBe(true);
		expect(
			(screen.getByRole("checkbox", { name: /Agentic RAG/ }) as HTMLInputElement).disabled,
		).toBe(false);
		expect(screen.getByText(/エージェントが検索の回数と内容を決めます/)).toBeTruthy();
	});

	it("disables everything while a run is in progress", () => {
		setup({ disabled: true });

		for (const box of screen.getAllByRole("checkbox")) {
			expect((box as HTMLInputElement).disabled).toBe(true);
		}
		expect(topK().disabled).toBe(true);
	});

	it("notes that Rerank is skipped without an API key, and still lets the learner switch it on", () => {
		const { onChange } = setup({ rerank: { available: false, reason: "api-key-missing" } });

		expect(screen.getByText(/API キー.*未設定.*スキップ/)).toBeTruthy();
		fireEvent.click(screen.getByRole("checkbox", { name: /Rerank/ }));
		expect(onChange).toHaveBeenCalledTimes(1);
	});

	it("shows no Rerank note when Rerank can run", () => {
		setup({ rerank: { available: true } });

		expect(screen.queryByText(/スキップ/)).toBeNull();
	});
});

describe("MethodSwitches numeric inputs", () => {
	it("shows the current values", () => {
		setup();

		expect(topK().value).toBe("4");
		expect(similarity().value).toBe("0.2");
	});

	it.each(["1", "6", "20"])("passes a valid number of results (%s)", (text) => {
		const { onChange, onValidityChange } = setup();

		fireEvent.change(topK(), { target: { value: text } });

		expect(onChange).toHaveBeenCalledWith({ ...VALUE, topK: Number(text) });
		expect(onValidityChange).toHaveBeenLastCalledWith(true);
		expect(screen.queryByRole("alert")).toBeNull();
	});

	it.each(["0", "21", "1.5", "-3", ""])("does not pass %j as the number of results", (text) => {
		const { onChange, onValidityChange } = setup();

		fireEvent.change(topK(), { target: { value: text } });

		expect(onChange).not.toHaveBeenCalled();
		expect(onValidityChange).toHaveBeenLastCalledWith(false);
		expect(screen.getByRole("alert").textContent).toContain("1 以上 20 以下の整数");
		expect(topK().getAttribute("aria-invalid")).toBe("true");
	});

	it.each(["-1", "0", "0.35", "1"])("passes a valid similarity threshold (%s)", (text) => {
		const { onChange, onValidityChange } = setup();

		fireEvent.change(similarity(), { target: { value: text } });

		expect(onChange).toHaveBeenCalledWith({ ...VALUE, minSimilarity: Number(text) });
		expect(onValidityChange).toHaveBeenLastCalledWith(true);
	});

	it.each(["-1.01", "1.01", "5", ""])("does not pass %j as the similarity threshold", (text) => {
		const { onChange, onValidityChange } = setup();

		fireEvent.change(similarity(), { target: { value: text } });

		expect(onChange).not.toHaveBeenCalled();
		expect(onValidityChange).toHaveBeenLastCalledWith(false);
		expect(screen.getByRole("alert").textContent).toContain("-1 以上 1 以下");
	});

	it("clears the error and reports valid again once the value is back in range", () => {
		const { onChange, onValidityChange } = setup();

		fireEvent.change(topK(), { target: { value: "99" } });
		expect(screen.getByRole("alert")).toBeTruthy();
		fireEvent.change(topK(), { target: { value: "5" } });

		expect(screen.queryByRole("alert")).toBeNull();
		expect(onChange).toHaveBeenLastCalledWith({ ...VALUE, topK: 5 });
		expect(onValidityChange).toHaveBeenLastCalledWith(true);
	});

	it("stays invalid while either field is invalid", () => {
		const { onValidityChange } = setup();

		fireEvent.change(topK(), { target: { value: "99" } });
		fireEvent.change(similarity(), { target: { value: "0.5" } });

		expect(onValidityChange).toHaveBeenLastCalledWith(false);
	});

	it("stays invalid when the other field is fixed first", () => {
		const { onValidityChange } = setup();

		fireEvent.change(similarity(), { target: { value: "9" } });
		fireEvent.change(topK(), { target: { value: "5" } });

		expect(onValidityChange).toHaveBeenLastCalledWith(false);
	});

	it("exposes the allowed range to the browser as well", () => {
		setup();

		expect(topK().min).toBe("1");
		expect(topK().max).toBe("20");
		expect(similarity().min).toBe("-1");
		expect(similarity().max).toBe("1");
	});
});
