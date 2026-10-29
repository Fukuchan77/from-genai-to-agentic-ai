import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type CompareResult, CompareView } from "./CompareView";

afterEach(cleanup);

const RESULT: CompareResult = {
	highLevel: { steps: 2, tokens: 400, stopReason: "completed", toolsCalled: ["findAndReadFiles"] },
	lowLevel: {
		steps: 4,
		tokens: 1000,
		stopReason: "completed",
		toolsCalled: ["searchFiles", "readFile"],
	},
	comparison: { steps: 2, tokens: 600, ratio: 0.4 },
};

const FAILED_HIGH: CompareResult = {
	highLevel: {
		steps: 5,
		tokens: 900,
		stopReason: "error",
		toolsCalled: ["findAndReadFiles"],
		failed: true,
		error: { code: "not-allowed", message: "許可されたワークスペースの外は読めません。" },
	},
	lowLevel: RESULT.lowLevel,
	comparison: { steps: -1, tokens: 100 },
};

const FAILED_LOW: CompareResult = {
	highLevel: RESULT.highLevel,
	lowLevel: {
		steps: 8,
		tokens: 3000,
		stopReason: "step-limit",
		toolsCalled: ["readFile"],
		failed: true,
	},
	comparison: { steps: 6, tokens: 2600 },
};

function setup(props: Partial<Parameters<typeof CompareView>[0]> = {}) {
	const onRun = vi.fn();
	render(<CompareView onRun={onRun} {...props} />);
	return { onRun };
}

const region = () => screen.getByRole("region", { name: "高水準と低レベルの比較" });
const runButton = () => screen.getByRole("button", { name: /比較を実行/ }) as HTMLButtonElement;

function cell(rowName: string, column: "高水準" | "低レベル") {
	const table = within(screen.getByRole("table"));
	const row = table.getByRole("row", { name: new RegExp(rowName) });
	return within(row).getAllByRole("cell")[column === "高水準" ? 0 : 1] as HTMLElement;
}

describe("CompareView before a run", () => {
	it("is a polite live region", () => {
		setup();

		expect(region().getAttribute("aria-live")).toBe("polite");
	});

	it("explains the two approaches and draws no table yet", () => {
		setup();

		expect(region().textContent).toContain("findAndReadFiles");
		expect(region().textContent).toContain("searchFiles");
		expect(region().textContent).toContain("readFile");
		expect(screen.queryByRole("table")).toBeNull();
	});

	it("runs the comparison from a button", () => {
		const { onRun } = setup();

		fireEvent.click(runButton());

		expect(onRun).toHaveBeenCalledTimes(1);
	});

	it("is a native button reachable with the keyboard", () => {
		setup();

		runButton().focus();

		expect(document.activeElement).toBe(runButton());
		expect(runButton().tabIndex).toBe(0);
	});
});

describe("CompareView while running", () => {
	it("disables the button and announces the wait", () => {
		setup({ running: true });

		expect(runButton().disabled).toBe(true);
		expect(screen.getByRole("status").textContent).toContain("比較を実行しています");
	});

	it("shows no wait message when idle", () => {
		setup();

		expect(screen.queryByRole("status")).toBeNull();
	});
});

describe("CompareView result", () => {
	it("names the table and its rows and columns for assistive technology", () => {
		setup({ result: RESULT });

		expect(screen.getByRole("table", { name: "高水準と低レベルの比較" })).toBeTruthy();
		expect(screen.getAllByRole("columnheader").map((head) => head.textContent)).toEqual([
			"",
			"高水準",
			"低レベル",
		]);
		expect(screen.getAllByRole("rowheader").map((head) => head.textContent)).toEqual([
			"ステップ数",
			"トークン数",
			"停止理由",
			"呼んだツール",
		]);
	});

	it("tabulates steps and tokens for both approaches", () => {
		setup({ result: RESULT });

		expect(cell("ステップ数", "高水準").textContent).toBe("2");
		expect(cell("ステップ数", "低レベル").textContent).toBe("4");
		expect(cell("トークン数", "高水準").textContent).toBe("400");
		expect(cell("トークン数", "低レベル").textContent).toBe("1000");
	});

	it("names the tools each approach called and why it stopped", () => {
		setup({ result: RESULT });

		expect(cell("呼んだツール", "高水準").textContent).toBe("findAndReadFiles");
		expect(cell("呼んだツール", "低レベル").textContent).toBe("searchFiles, readFile");
		expect(cell("停止理由", "高水準").textContent).toBe("完了");
	});

	it("says no tool was called when the list is empty", () => {
		setup({
			result: { ...RESULT, highLevel: { ...RESULT.highLevel, toolsCalled: [] } },
		});

		expect(cell("呼んだツール", "高水準").textContent).toBe("なし");
	});

	it("summarises the saving in steps and tokens", () => {
		setup({ result: RESULT });

		const summary = screen.getByRole("group", { name: "比較の要約" });
		expect(summary.textContent).toContain("ステップ数: 高水準のほうが 2 ステップ少ない");
		expect(summary.textContent).toContain("トークン数: 高水準のほうが 600 トークン少ない");
	});

	it("shows the ratio as a number and as a percentage", () => {
		setup({ result: RESULT });

		const summary = screen.getByRole("group", { name: "比較の要約" });
		expect(summary.textContent).toContain("比率（高水準 ÷ 低レベル）: 0.40");
		expect(summary.textContent).toContain("40%");
	});

	it("says so when the high-level tool cost more", () => {
		setup({
			result: {
				...RESULT,
				comparison: { steps: -1, tokens: -200, ratio: 1.2 },
			},
		});

		const summary = screen.getByRole("group", { name: "比較の要約" });
		expect(summary.textContent).toContain("高水準のほうが 1 ステップ多い");
		expect(summary.textContent).toContain("高水準のほうが 200 トークン多い");
		expect(summary.textContent).toContain("1.20");
	});

	it("says so when the steps or tokens are the same", () => {
		setup({ result: { ...RESULT, comparison: { steps: 0, tokens: 0, ratio: 1 } } });

		const summary = screen.getByRole("group", { name: "比較の要約" });
		expect(summary.textContent).toContain("ステップ数: 同じ");
		expect(summary.textContent).toContain("トークン数: 同じ");
	});

	it("explains a missing ratio when the low-level run used no tokens", () => {
		setup({ result: { ...RESULT, comparison: { steps: 2, tokens: 400 } } });

		expect(screen.getByRole("group", { name: "比較の要約" }).textContent).toContain(
			"低レベルのトークン数が 0 のため、比率は計算できません",
		);
	});
});

describe("CompareView failed side", () => {
	it("marks the failed side, with the stop reason and the vetted message", () => {
		setup({ result: FAILED_HIGH });

		const alert = screen.getByRole("alert");
		expect(alert.textContent).toContain("高水準の実行は完了しませんでした");
		expect(alert.textContent).toContain("エラー");
		expect(alert.textContent).toContain("許可されたワークスペースの外は読めません。");
		expect(alert.textContent).toContain("not-allowed");
		expect(cell("停止理由", "高水準").textContent).toContain("エラー");
	});

	it("marks the low-level side when that is the one that failed", () => {
		setup({ result: FAILED_LOW });

		const alert = screen.getByRole("alert");
		expect(alert.textContent).toContain("低レベルの実行は完了しませんでした");
		expect(alert.textContent).toContain("ステップ上限");
		expect(alert.textContent).not.toContain("高水準の実行は");
	});

	it("shows one alert per failed side when both failed", () => {
		setup({
			result: {
				highLevel: FAILED_HIGH.highLevel,
				lowLevel: FAILED_LOW.lowLevel,
				comparison: { steps: 3, tokens: 2100 },
			},
		});

		expect(screen.getAllByRole("alert")).toHaveLength(2);
	});

	it("computes no saving or ratio from a run that did not finish", () => {
		setup({ result: FAILED_HIGH });

		const summary = screen.getByRole("group", { name: "比較の要約" });
		expect(summary.textContent).toContain("失敗した実行があるため、差と比率は示しません");
		expect(summary.textContent).not.toContain("少ない");
		expect(summary.textContent).not.toContain("多い");
		expect(summary.textContent).not.toContain("比率（");
	});

	it("computes no saving or ratio when only the low-level run failed", () => {
		setup({ result: FAILED_LOW });

		const summary = screen.getByRole("group", { name: "比較の要約" });
		expect(summary.textContent).toContain("失敗した実行があるため、差と比率は示しません");
		expect(summary.textContent).not.toContain("少ない");
	});

	it("shows the measured numbers of a failed run all the same", () => {
		setup({ result: FAILED_HIGH });

		expect(cell("ステップ数", "高水準").textContent).toBe("5");
		expect(cell("トークン数", "高水準").textContent).toBe("900");
	});

	it("raises no alert when both runs finished", () => {
		setup({ result: RESULT });

		expect(screen.queryByRole("alert")).toBeNull();
	});

	it("labels every stop reason in Japanese", () => {
		const labels = [
			["completed", "完了"],
			["step-limit", "ステップ上限"],
			["token-budget", "トークン予算"],
			["timeout", "タイムアウト"],
			["aborted", "中断"],
			["error", "エラー"],
		] as const;
		for (const [stopReason, label] of labels) {
			cleanup();
			setup({ result: { ...RESULT, highLevel: { ...RESULT.highLevel, stopReason } } });
			expect(cell("停止理由", "高水準").textContent).toContain(label);
		}
	});
});

describe("CompareView request error", () => {
	it("shows the request error and retries the comparison", () => {
		const { onRun } = setup({
			error: new Error(
				JSON.stringify({
					error: {
						code: "provider-unavailable",
						message: "比較に使うファイルサーバーに接続できていません。",
					},
				}),
			),
		});

		expect(screen.getByRole("alert").textContent).toContain(
			"比較に使うファイルサーバーに接続できていません。",
		);
		fireEvent.click(screen.getByRole("button", { name: "再送信" }));
		expect(onRun).toHaveBeenCalledTimes(1);
	});
});
