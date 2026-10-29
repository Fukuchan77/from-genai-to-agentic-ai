import type { PlanDiff, PlanTaskView } from "@platform/ai-core/helpdesk";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { type HelpdeskPlanState, PlanDashboard } from "./PlanDashboard";

afterEach(cleanup);

const TASKS: PlanTaskView[] = [
	{ id: "t1", description: "FAQ から VPN の手順を探す", dependsOn: [], state: "done" },
	{ id: "t2", description: "手順書で接続設定を確認する", dependsOn: ["t1"], state: "running" },
	{ id: "t3", description: "回答の下書きを作る", dependsOn: ["t1", "t2"], state: "pending" },
	{ id: "t4", description: "担当部署を調べる", dependsOn: [], state: "pending" },
];

const PLAN: HelpdeskPlanState = { revision: 0, tasks: TASKS };

function region(name: string) {
	return screen.getByRole("region", { name });
}

function itemsOf(name: string) {
	return within(region(name))
		.queryAllByRole("listitem")
		.map((item) => item.textContent ?? "");
}

describe("PlanDashboard", () => {
	it("is a polite live region so a screen reader hears each state change", () => {
		render(<PlanDashboard plan={PLAN} />);

		expect(region("計画ダッシュボード").getAttribute("aria-live")).toBe("polite");
	});

	it("shows the three panels, each with a heading", () => {
		render(<PlanDashboard plan={PLAN} />);

		for (const name of ["現在のタスク", "完了タスク", "修正された計画"]) {
			expect(within(region(name)).getByRole("heading", { name })).toBeTruthy();
		}
	});

	it("shows the running task under the current task", () => {
		render(<PlanDashboard plan={PLAN} />);

		const current = within(region("現在のタスク")).getByRole("list", { name: "実行中のタスク" });
		const items = within(current).getAllByRole("listitem");
		expect(items).toHaveLength(1);
		expect(items[0]?.textContent).toContain("t2");
		expect(items[0]?.textContent).toContain("手順書で接続設定を確認する");
		expect(items[0]?.textContent).toContain("依存: t1");
	});

	it("lists the tasks still waiting, in plan order, with their dependencies", () => {
		render(<PlanDashboard plan={PLAN} />);

		const waiting = within(region("現在のタスク")).getByRole("list", { name: "待機中のタスク" });
		const items = within(waiting).getAllByRole("listitem");
		expect(items.map((item) => item.textContent)).toEqual([
			expect.stringContaining("t3"),
			expect.stringContaining("t4"),
		]);
		expect(items[0]?.textContent).toContain("依存: t1、t2");
		expect(items[1]?.textContent).not.toContain("依存");
	});

	it("shows only the finished tasks under the completed tasks, with their count", () => {
		render(<PlanDashboard plan={PLAN} />);

		expect(itemsOf("完了タスク")).toHaveLength(1);
		expect(itemsOf("完了タスク")[0]).toContain("FAQ から VPN の手順を探す");
		expect(region("完了タスク").textContent).toContain("1 / 4");
	});

	it("moves a task between the panels when its state changes", () => {
		const { rerender } = render(<PlanDashboard plan={PLAN} />);

		rerender(
			<PlanDashboard
				plan={{
					revision: 0,
					tasks: TASKS.map((task) =>
						task.id === "t2"
							? { ...task, state: "done" }
							: task.id === "t3"
								? { ...task, state: "running" }
								: task,
					),
				}}
			/>,
		);

		expect(itemsOf("完了タスク")).toHaveLength(2);
		const current = within(region("現在のタスク")).getByRole("list", { name: "実行中のタスク" });
		expect(within(current).getAllByRole("listitem")[0]?.textContent).toContain("t3");
		expect(region("完了タスク").textContent).toContain("2 / 4");
	});

	it("says so when nothing is running, nothing is done and nothing is waiting", () => {
		render(<PlanDashboard />);

		expect(region("現在のタスク").textContent).toContain("実行中のタスクはありません");
		expect(region("完了タスク").textContent).toContain("完了したタスクはありません");
		expect(region("修正された計画").textContent).toContain("計画はまだ修正されていません");
		expect(screen.queryByRole("list", { name: "待機中のタスク" })).toBeNull();
	});

	it("shows the steps used against the limit", () => {
		render(<PlanDashboard plan={PLAN} progress={{ stepsUsed: 3, maxSteps: 8 }} />);

		const steps = screen.getByRole("group", { name: "ステップ数" });
		expect(steps.textContent).toContain("3 / 8");
	});

	it("shows no step count before the first progress event", () => {
		render(<PlanDashboard plan={PLAN} />);

		expect(screen.queryByRole("group", { name: "ステップ数" })).toBeNull();
		expect(screen.queryByRole("group", { name: "判断" })).toBeNull();
	});

	it.each([
		["continue", "計画どおり続行"],
		["replan", "残りのタスクを再計画"],
		["finish", "最終回答へ進む"],
	] as const)("shows the %s decision and its reason", (decision, label) => {
		render(
			<PlanDashboard
				plan={PLAN}
				progress={{
					stepsUsed: 2,
					maxSteps: 8,
					decision: { decision, reason: "手順書に追加の条件があったため" },
				}}
			/>,
		);

		const group = screen.getByRole("group", { name: "判断" });
		expect(group.textContent).toContain(label);
		expect(group.textContent).toContain("手順書に追加の条件があったため");
	});

	it("shows no decision group while the progress has no decision", () => {
		render(<PlanDashboard plan={PLAN} progress={{ stepsUsed: 1, maxSteps: 8, current: "t1" }} />);

		expect(screen.queryByRole("group", { name: "判断" })).toBeNull();
	});

	describe("revised plan", () => {
		const BEFORE: PlanTaskView[] = [
			{ id: "t1", description: "FAQ を探す", dependsOn: [], state: "done" },
			{ id: "t2", description: "手順書を読む", dependsOn: ["t1"], state: "done" },
			{ id: "t3", description: "古い下書きを作る", dependsOn: ["t2"], state: "done" },
		];
		const AFTER: PlanTaskView[] = [
			{ id: "t1", description: "FAQ を探す", dependsOn: [], state: "done" },
			{
				id: "t2",
				description: "手順書を読んで条件を確認する",
				dependsOn: ["t1"],
				state: "running",
			},
			{ id: "t4", description: "例外の手順を調べる", dependsOn: ["t2"], state: "pending" },
		];
		const REPLANNED: HelpdeskPlanState = {
			revision: 1,
			tasks: AFTER,
			diff: { added: ["t4"], removed: ["t3"], changed: ["t2"] },
		};

		it("shows the revision number", () => {
			render(<PlanDashboard plan={REPLANNED} previousTasks={BEFORE} />);

			expect(region("修正された計画").textContent).toContain("改訂 1");
		});

		it("shows the added task with its new description", () => {
			render(<PlanDashboard plan={REPLANNED} previousTasks={BEFORE} />);

			const added = within(region("修正された計画")).getByRole("list", {
				name: "追加されたタスク",
			});
			expect(added.textContent).toContain("t4");
			expect(added.textContent).toContain("例外の手順を調べる");
		});

		it("shows the removed task with the description it had", () => {
			render(<PlanDashboard plan={REPLANNED} previousTasks={BEFORE} />);

			const removed = within(region("修正された計画")).getByRole("list", {
				name: "削除されたタスク",
			});
			expect(removed.textContent).toContain("t3");
			expect(removed.textContent).toContain("古い下書きを作る");
		});

		it("shows a changed task as before and after", () => {
			render(<PlanDashboard plan={REPLANNED} previousTasks={BEFORE} />);

			const changed = within(region("修正された計画")).getByRole("list", {
				name: "変更されたタスク",
			});
			const item = within(changed).getByRole("listitem");
			expect(within(item).getByText("手順書を読む")).toBeTruthy();
			expect(within(item).getByText("手順書を読んで条件を確認する")).toBeTruthy();
			expect(item.textContent).toContain("変更前");
			expect(item.textContent).toContain("変更後");
		});

		it("falls back to the ids when the earlier plan is not known", () => {
			render(<PlanDashboard plan={REPLANNED} />);

			const removed = within(region("修正された計画")).getByRole("list", {
				name: "削除されたタスク",
			});
			expect(removed.textContent).toContain("t3");
			expect(removed.textContent).not.toContain("古い下書きを作る");
			const changed = within(region("修正された計画")).getByRole("list", {
				name: "変更されたタスク",
			});
			expect(changed.textContent).toContain("t2");
			expect(changed.textContent).toContain("手順書を読んで条件を確認する");
			expect(changed.textContent).not.toContain("変更前");
		});

		it.each<[string, PlanDiff]>([
			["added", { added: ["t4"], removed: [], changed: [] }],
			["removed", { added: [], removed: ["t3"], changed: [] }],
			["changed", { added: [], removed: [], changed: ["t2"] }],
		])("draws only the %s list when only that kind of change happened", (kind, diff) => {
			render(<PlanDashboard plan={{ revision: 1, tasks: AFTER, diff }} previousTasks={BEFORE} />);

			const names = {
				added: "追加されたタスク",
				removed: "削除されたタスク",
				changed: "変更されたタスク",
			};
			for (const [other, name] of Object.entries(names)) {
				const list = screen.queryByRole("list", { name });
				if (other === kind) expect(list).toBeTruthy();
				else expect(list).toBeNull();
			}
			expect(region("修正された計画").textContent).not.toContain("変更はありませんでした");
		});

		it("says when the replan changed nothing", () => {
			render(
				<PlanDashboard
					plan={{ revision: 1, tasks: AFTER, diff: { added: [], removed: [], changed: [] } }}
					previousTasks={BEFORE}
				/>,
			);

			expect(region("修正された計画").textContent).toContain("変更はありませんでした");
			expect(region("修正された計画").textContent).not.toContain("計画はまだ修正されていません");
		});

		it("shows no revision while the plan has never been revised", () => {
			render(<PlanDashboard plan={PLAN} />);

			expect(region("修正された計画").textContent).not.toContain("改訂");
		});
	});

	describe("a run stopped by the step limit", () => {
		it("keeps the unfinished tasks listed as waiting", () => {
			render(
				<PlanDashboard
					plan={{
						revision: 0,
						tasks: TASKS.map((task) =>
							task.state === "running" ? { ...task, state: "pending" } : task,
						),
					}}
					progress={{ stepsUsed: 8, maxSteps: 8 }}
				/>,
			);

			const waiting = within(region("現在のタスク")).getByRole("list", { name: "待機中のタスク" });
			expect(within(waiting).getAllByRole("listitem")).toHaveLength(3);
			expect(region("現在のタスク").textContent).toContain("実行中のタスクはありません");
			expect(screen.getByRole("group", { name: "ステップ数" }).textContent).toContain("8 / 8");
		});
	});
});
