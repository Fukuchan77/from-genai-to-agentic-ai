import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AttemptList } from "./AttemptList";

afterEach(cleanup);

const OK = { index: 1, code: "print('ok')", stdout: "ok\n", stderr: "" } as const;
const FAILED = (index: number) =>
	({
		index,
		code: `risky_${index}()`,
		stdout: "",
		stderr: `Traceback ${index}`,
		errorSummary: `NameError: name 'risky_${index}' is not defined`,
	}) as const;

describe("AttemptList", () => {
	it("renders nothing without attempts or a stop", () => {
		const { container } = render(<AttemptList attempts={[]} />);

		expect(container.innerHTML).toBe("");
	});

	it("shows each run's code, standard output and error output in order (Req 3.6)", () => {
		render(<AttemptList attempts={[FAILED(1), { ...OK, index: 2 }]} />);

		const items = within(screen.getByRole("list", { name: "試行の履歴" })).getAllByRole("listitem");
		expect(items).toHaveLength(2);
		const first = within(items[0] as HTMLElement);
		expect(first.getByText("試行 1")).toBeTruthy();
		expect(first.getByText("risky_1()")).toBeTruthy();
		expect(first.getByText("Traceback 1")).toBeTruthy();
		expect(first.getByText("NameError: name 'risky_1' is not defined")).toBeTruthy();
		const second = within(items[1] as HTMLElement);
		expect(second.getByText("試行 2")).toBeTruthy();
		expect(second.getByText("print('ok')")).toBeTruthy();
		expect(second.getByText(/^ok$/u)).toBeTruthy();
	});

	it("labels each stream and says when one is empty", () => {
		render(<AttemptList attempts={[{ index: 1, code: "pass", stdout: "", stderr: "" }]} />);

		const item = within(screen.getByRole("listitem"));
		expect(item.getByText("コード")).toBeTruthy();
		expect(item.getByText("標準出力")).toBeTruthy();
		expect(item.getByText("エラー出力")).toBeTruthy();
		expect(item.getAllByText("（出力なし）")).toHaveLength(2);
	});

	it("marks a run as succeeded or failed in words, not by color alone", () => {
		render(<AttemptList attempts={[FAILED(1), { ...OK, index: 2 }]} />);

		const [first, second] = screen.getAllByRole("listitem");
		expect(within(first as HTMLElement).getByText("エラー")).toBeTruthy();
		expect(within(first as HTMLElement).queryByText("成功")).toBeNull();
		expect(within(second as HTMLElement).getByText("成功")).toBeTruthy();
		expect(within(second as HTMLElement).queryByText("エラー")).toBeNull();
	});

	it("numbers the fixes: a run after a failed run is a fix, the first run and a run after a success are not", () => {
		render(
			<AttemptList attempts={[FAILED(1), FAILED(2), { ...OK, index: 3 }, { ...OK, index: 4 }]} />,
		);

		const [one, two, three, four] = screen.getAllByRole("listitem").map((item) => within(item));
		expect(one?.getByText("通常の実行")).toBeTruthy();
		expect(two?.getByText("修正 1 回目")).toBeTruthy();
		expect(three?.getByText("修正 2 回目")).toBeTruthy();
		expect(four?.getByText("通常の実行")).toBeTruthy();
		expect(four?.queryByText(/修正 \d 回目/u)).toBeNull();
		expect(screen.getByText("修正回数: 2 回")).toBeTruthy();
	});

	it("prefers the fix count the server reports", () => {
		render(<AttemptList attempts={[FAILED(1), { ...OK, index: 2 }]} fixes={7} />);

		expect(screen.getByText("修正回数: 7 回")).toBeTruthy();
	});

	it("announces new attempts politely", () => {
		render(<AttemptList attempts={[OK]} />);

		expect(screen.getByRole("region", { name: "試行履歴" }).getAttribute("aria-live")).toBe(
			"polite",
		);
	});

	it("on attempt-limit, says the run stopped and highlights the last code and error (Req 3.4)", () => {
		render(
			<AttemptList
				attempts={[FAILED(1), FAILED(2), FAILED(3), FAILED(4)]}
				status="attempt-limit"
				fixes={3}
			/>,
		);

		const alert = screen.getByRole("alert");
		expect(alert.textContent).toContain("修正回数の上限に達したため停止しました");
		const items = screen.getAllByRole("listitem");
		const last = within(items[3] as HTMLElement);
		expect(last.getByText("最後のコードとエラー")).toBeTruthy();
		expect(last.getByText("risky_4()")).toBeTruthy();
		expect(last.getByText("NameError: name 'risky_4' is not defined")).toBeTruthy();
		for (const item of items.slice(0, 3)) {
			expect(within(item).queryByText("最後のコードとエラー")).toBeNull();
		}
		expect(screen.getByText("修正回数: 3 回")).toBeTruthy();
	});

	it("still says the run stopped when the limit was reached with no run to show", () => {
		render(<AttemptList attempts={[]} status="attempt-limit" />);

		expect(screen.getByRole("alert").textContent).toContain(
			"修正回数の上限に達したため停止しました",
		);
	});

	it("highlights only the last run's frame on attempt-limit", () => {
		render(<AttemptList attempts={[FAILED(1), FAILED(2)]} status="attempt-limit" />);

		const [first, last] = screen.getAllByRole("listitem");
		expect(first?.className).not.toContain("border-destructive");
		expect(last?.className).toContain("border-destructive");
	});

	it("shows the error line and an error-colored badge only for a failed run", () => {
		render(<AttemptList attempts={[FAILED(1), { ...OK, index: 2 }]} />);

		const [failed, succeeded] = screen.getAllByRole("listitem") as HTMLElement[];
		expect(failed?.querySelector("p.text-destructive")?.textContent).toBe(
			"NameError: name 'risky_1' is not defined",
		);
		expect(within(failed as HTMLElement).getByText("エラー").className).toContain("bg-destructive");
		expect(succeeded?.querySelector("p.text-destructive")).toBeNull();
		expect(within(succeeded as HTMLElement).getByText("成功").className).not.toContain(
			"bg-destructive",
		);
	});

	it("shows the stop notice and no highlight when the status is not attempt-limit", () => {
		render(<AttemptList attempts={[FAILED(1)]} status="succeeded" />);

		expect(screen.queryByRole("alert")).toBeNull();
		expect(screen.queryByText("最後のコードとエラー")).toBeNull();
	});

	it("keeps long code and output reachable by keyboard", () => {
		render(<AttemptList attempts={[FAILED(1)]} />);

		const blocks = screen.getAllByRole("region", { name: /^試行 1 の/u });
		expect(blocks.map((block) => block.getAttribute("aria-label"))).toEqual([
			"試行 1 のコード",
			"試行 1 のエラー出力",
		]);
		for (const block of blocks) {
			block.focus();
			expect(document.activeElement).toBe(block);
			expect(block.tabIndex).toBe(0);
		}
	});

	it("renders code as text, never as markup", () => {
		render(<AttemptList attempts={[{ ...OK, code: "<img src=x onerror=alert(1)>" }]} />);

		expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeTruthy();
		expect(document.querySelector("img")).toBeNull();
	});
});
