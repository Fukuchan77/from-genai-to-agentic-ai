import type { AgentRunSummary } from "@platform/ai-core/agents";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RunSummaryBadge } from "./RunSummaryBadge";

afterEach(cleanup);

const RUN: AgentRunSummary = {
	stopReason: "completed",
	steps: 3,
	totalTokens: { input: 1200, output: 80, cacheRead: 0, reasoning: 0 },
	elapsedMs: 2345,
	toolsCalled: ["weather", "calculator", "weather"],
	error: undefined,
};

describe("RunSummaryBadge", () => {
	it("shows stop reason, steps, tokens, elapsed time and the called tools in order (Req 5.6, 6.2)", () => {
		render(<RunSummaryBadge run={RUN} />);

		expect(screen.getByText("完了")).toBeTruthy();
		expect(screen.getByText("3")).toBeTruthy();
		expect(screen.getByText("入力 1,200 / 出力 80")).toBeTruthy();
		expect(screen.getByText("2.3 秒")).toBeTruthy();
		const tools = within(screen.getByRole("list", { name: "呼び出したツール" })).getAllByRole(
			"listitem",
		);
		expect(tools.map((item) => item.textContent)).toEqual(["weather", "calculator", "weather"]);
	});

	it.each([
		["step-limit", "ステップ数の上限"],
		["token-budget", "トークン予算の上限"],
		["timeout", "実行時間の上限"],
		["aborted", "中断"],
		["error", "エラー"],
	] as const)("labels the %s stop reason in Japanese", (stopReason, label) => {
		render(
			<RunSummaryBadge
				run={{
					...RUN,
					stopReason,
					error: stopReason === "error" ? { code: "unexpected", message: "固定の文言" } : undefined,
				}}
			/>,
		);

		expect(screen.getByText(label)).toBeTruthy();
	});

	it("shows cache-read and reasoning tokens only when they are non-zero", () => {
		render(
			<RunSummaryBadge
				run={{ ...RUN, totalTokens: { input: 10, output: 2, cacheRead: 7, reasoning: 4 } }}
			/>,
		);

		expect(screen.getByText("キャッシュ読み出し 7")).toBeTruthy();
		expect(screen.getByText("推論 4")).toBeTruthy();
	});

	it("shows the fixed error message for an errored run", () => {
		render(
			<RunSummaryBadge
				run={{
					...RUN,
					stopReason: "error",
					error: {
						code: "provider-unavailable",
						message: "エージェントの実行中にエラーが発生しました。",
					},
				}}
			/>,
		);

		expect(screen.getByText("エージェントの実行中にエラーが発生しました。")).toBeTruthy();
	});

	it("shows milliseconds for a short run and 'なし' for no tool calls", () => {
		render(<RunSummaryBadge run={{ ...RUN, elapsedMs: 420, toolsCalled: [] }} />);

		expect(screen.getByText("420 ミリ秒")).toBeTruthy();
		expect(screen.getByText("なし")).toBeTruthy();
		expect(screen.queryByRole("list", { name: "呼び出したツール" })).toBeNull();
	});

	it("shows an interrupted display when the run summary never arrived (abort)", () => {
		render(<RunSummaryBadge run={undefined} outcome="interrupted" />);

		expect(screen.getByText("中断")).toBeTruthy();
		expect(screen.getByText(/実行サマリは届いていません/u)).toBeTruthy();
		expect(screen.queryByText("ステップ数")).toBeNull();
	});

	it("shows an error display when the run summary never arrived (error)", () => {
		render(<RunSummaryBadge run={undefined} outcome="error" />);

		expect(screen.getByText("エラー")).toBeTruthy();
		expect(screen.getByText(/実行サマリは届いていません/u)).toBeTruthy();
	});

	it("announces the result politely", () => {
		render(<RunSummaryBadge run={RUN} />);

		expect(screen.getByRole("status")).toBeTruthy();
	});
});
