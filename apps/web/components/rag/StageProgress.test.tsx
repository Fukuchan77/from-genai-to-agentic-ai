import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StageProgress, type StageState } from "./StageProgress";

afterEach(cleanup);

const ALL_OFF = { hyde: false, multiQuery: false, hybrid: false, rerank: false };
const ALL_ON = { hyde: true, multiQuery: true, hybrid: true, rerank: true };

function items() {
	return within(screen.getByRole("list", { name: "段階" })).getAllByRole("listitem");
}

describe("StageProgress", () => {
	it("is a polite live region so a screen reader hears the progress", () => {
		render(<StageProgress stages={[]} methods={ALL_OFF} />);

		const region = screen.getByRole("region", { name: "段階の進行" });
		expect(region.getAttribute("aria-live")).toBe("polite");
	});

	it("draws no list before the first stage event", () => {
		render(<StageProgress stages={[]} methods={ALL_OFF} />);

		expect(screen.queryByRole("list", { name: "段階" })).toBeNull();
	});

	it("labels each stage and its status in Japanese", () => {
		const stages: StageState[] = [
			{ stage: "multi-query", status: "done" },
			{ stage: "vector-search", status: "running" },
			{
				stage: "rerank",
				status: "skipped",
				detail: "Rerank の API キーが未設定のためスキップしました",
			},
		];
		render(<StageProgress stages={stages} methods={ALL_ON} />);

		const [multi, vector, rerank] = items();
		expect(multi?.textContent).toContain("サブクエリの生成");
		expect(multi?.textContent).toContain("完了");
		expect(vector?.textContent).toContain("ベクトル検索");
		expect(vector?.textContent).toContain("実行中");
		expect(rerank?.textContent).toContain("Rerank");
		expect(rerank?.textContent).toContain("スキップ");
	});

	it("draws a stage without a reason as just its name and status", () => {
		render(<StageProgress stages={[{ stage: "fusion", status: "done" }]} methods={ALL_OFF} />);

		expect(items()[0]?.children).toHaveLength(2);
	});

	it("shows why a stage was skipped", () => {
		render(
			<StageProgress
				stages={[
					{
						stage: "rerank",
						status: "skipped",
						detail: "Rerank の API キーが未設定のためスキップしました",
					},
				]}
				methods={ALL_ON}
			/>,
		);

		expect(screen.getByText("Rerank の API キーが未設定のためスキップしました")).toBeTruthy();
	});

	it("shows the newest status when a stage is updated", () => {
		const { rerender } = render(
			<StageProgress stages={[{ stage: "fusion", status: "running" }]} methods={ALL_ON} />,
		);
		expect(items()[0]?.textContent).toContain("実行中");

		rerender(<StageProgress stages={[{ stage: "fusion", status: "done" }]} methods={ALL_ON} />);

		expect(items()).toHaveLength(1);
		expect(items()[0]?.textContent).toContain("完了");
		expect(items()[0]?.textContent).not.toContain("実行中");
	});

	it("lists the stages in pipeline order whatever order the events arrived in", () => {
		const stages: StageState[] = [
			{ stage: "generate", status: "running" },
			{ stage: "fusion", status: "done" },
			{ stage: "vector-search", status: "done" },
			{ stage: "hyde", status: "done" },
		];
		render(<StageProgress stages={stages} methods={ALL_ON} />);

		expect(items().map((item) => item.getAttribute("data-stage"))).toEqual([
			"hyde",
			"vector-search",
			"fusion",
			"generate",
		]);
	});

	it("does not show the stages of methods that are switched off", () => {
		const stages: StageState[] = [
			{ stage: "hyde", status: "skipped", detail: "無効" },
			{ stage: "multi-query", status: "skipped", detail: "無効" },
			{ stage: "vector-search", status: "done" },
			{ stage: "full-text-search", status: "skipped", detail: "無効" },
			{ stage: "rerank", status: "skipped", detail: "無効" },
		];
		render(<StageProgress stages={stages} methods={ALL_OFF} />);

		expect(items().map((item) => item.getAttribute("data-stage"))).toEqual(["vector-search"]);
	});

	it("shows a stage of an enabled method even when it was skipped", () => {
		const stages: StageState[] = [
			{ stage: "hyde", status: "skipped", detail: "ナレッジベースが空です" },
			{ stage: "full-text-search", status: "skipped", detail: "検索できる語がありません" },
		];
		render(<StageProgress stages={stages} methods={{ ...ALL_OFF, hyde: true, hybrid: true }} />);

		expect(items().map((item) => item.getAttribute("data-stage"))).toEqual([
			"hyde",
			"full-text-search",
		]);
	});

	it("always shows the answer generation and fusion stages", () => {
		const stages: StageState[] = [
			{ stage: "fusion", status: "skipped", detail: "統合する検索結果が 1 つだけです" },
			{ stage: "generate", status: "done" },
		];
		render(<StageProgress stages={stages} methods={ALL_OFF} />);

		expect(items().map((item) => item.getAttribute("data-stage"))).toEqual(["fusion", "generate"]);
	});
});
