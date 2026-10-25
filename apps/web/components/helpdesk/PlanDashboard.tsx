import type { NextDecision, PlanDiff, PlanTaskView } from "@platform/ai-core/helpdesk";
import { type ReactNode, useId } from "react";
import { Badge } from "@/components/ui/badge";

/** The newest `data-helpdesk-plan` part (id `plan`). */
export interface HelpdeskPlanState {
	readonly revision: number;
	readonly tasks: readonly PlanTaskView[];
	/** Set on the part that carries a replan. */
	readonly diff?: PlanDiff;
}

/** The newest `data-helpdesk-progress` part (id `progress`). */
export interface HelpdeskProgressState {
	readonly stepsUsed: number;
	readonly maxSteps: number;
	readonly current?: string;
	readonly decision?: { readonly decision: NextDecision; readonly reason: string };
}

export interface PlanDashboardProps {
	readonly plan?: HelpdeskPlanState;
	readonly progress?: HelpdeskProgressState;
	/**
	 * The tasks of the plan before the replan in `plan.diff`. With them a removed or changed task
	 * shows what it was; without them only the ids are known.
	 */
	readonly previousTasks?: readonly PlanTaskView[];
}

const DECISION_LABELS: Readonly<Record<NextDecision, string>> = {
	continue: "計画どおり続行",
	replan: "残りのタスクを再計画",
	finish: "最終回答へ進む",
};

function dependencyText(task: PlanTaskView): string | null {
	return task.dependsOn.length > 0 ? `依存: ${task.dependsOn.join("、")}` : null;
}

function TaskItem({ task }: { readonly task: PlanTaskView }) {
	const dependencies = dependencyText(task);
	return (
		<li className="flex flex-col gap-0.5 text-sm">
			<span>
				<span className="font-mono font-medium">{task.id}</span> {task.description}
			</span>
			{dependencies === null ? null : (
				<span className="text-xs text-muted-foreground">{dependencies}</span>
			)}
		</li>
	);
}

function Panel({
	title,
	badge,
	children,
}: {
	readonly title: string;
	readonly badge?: string | undefined;
	readonly children: ReactNode;
}) {
	const headingId = useId();
	return (
		<section
			aria-labelledby={headingId}
			className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 text-card-foreground"
		>
			<div className="flex items-center gap-2">
				<h3 id={headingId} className="text-sm font-semibold">
					{title}
				</h3>
				{badge === undefined ? null : <Badge variant="secondary">{badge}</Badge>}
			</div>
			{children}
		</section>
	);
}

function Empty({ children }: { readonly children: string }) {
	return <p className="text-sm text-muted-foreground">{children}</p>;
}

function describe(tasks: readonly PlanTaskView[] | undefined, id: string): string | undefined {
	return tasks?.find((task) => task.id === id)?.description;
}

function PlanChanges({
	plan,
	previousTasks,
}: {
	readonly plan: HelpdeskPlanState;
	readonly previousTasks: readonly PlanTaskView[] | undefined;
}) {
	const { diff } = plan;
	if (diff === undefined) return <Empty>計画はまだ修正されていません</Empty>;
	const unchanged = diff.added.length + diff.removed.length + diff.changed.length === 0;
	return (
		<div className="flex flex-col gap-2">
			<p className="text-xs text-muted-foreground">改訂 {plan.revision}</p>
			{unchanged ? <Empty>変更はありませんでした</Empty> : null}
			{diff.added.length > 0 ? (
				<div className="flex flex-col gap-1">
					<p className="text-xs font-medium">追加</p>
					<ul aria-label="追加されたタスク" className="flex flex-col gap-1">
						{diff.added.map((id) => (
							<li key={id} className="text-sm">
								<span className="font-mono font-medium">{id}</span> {describe(plan.tasks, id)}
							</li>
						))}
					</ul>
				</div>
			) : null}
			{diff.removed.length > 0 ? (
				<div className="flex flex-col gap-1">
					<p className="text-xs font-medium">削除</p>
					<ul aria-label="削除されたタスク" className="flex flex-col gap-1">
						{diff.removed.map((id) => (
							<li key={id} className="text-sm line-through">
								<span className="font-mono font-medium">{id}</span> {describe(previousTasks, id)}
							</li>
						))}
					</ul>
				</div>
			) : null}
			{diff.changed.length > 0 ? (
				<div className="flex flex-col gap-1">
					<p className="text-xs font-medium">変更</p>
					<ul aria-label="変更されたタスク" className="flex flex-col gap-1">
						{diff.changed.map((id) => {
							const before = describe(previousTasks, id);
							return (
								<li key={id} className="flex flex-col gap-0.5 text-sm">
									<span className="font-mono font-medium">{id}</span>
									{before === undefined ? null : (
										<span className="text-muted-foreground">
											<span className="text-xs">変更前: </span>
											<span>{before}</span>
										</span>
									)}
									<span>
										{before === undefined ? null : <span className="text-xs">変更後: </span>}
										<span>{describe(plan.tasks, id)}</span>
									</span>
								</li>
							);
						})}
					</ul>
				</div>
			) : null}
		</div>
	);
}

/**
 * The help-desk dashboard (plan C14, Req 2.3 to 2.5): the current task, the completed tasks and the
 * revised plan with its before / after difference, the steps used and the replanner's decision.
 * It shows what the server streamed and decides nothing. The whole dashboard is one polite live
 * region, so a screen reader hears each state change.
 */
export function PlanDashboard({ plan, progress, previousTasks }: PlanDashboardProps) {
	const tasks = plan?.tasks ?? [];
	const running = tasks.filter((task) => task.state === "running");
	const waiting = tasks.filter((task) => task.state === "pending");
	const done = tasks.filter((task) => task.state === "done");
	return (
		<section aria-label="計画ダッシュボード" aria-live="polite" className="flex flex-col gap-3">
			{progress === undefined ? null : (
				<div className="flex flex-wrap items-start gap-x-6 gap-y-2">
					<fieldset className="flex items-center gap-2 text-sm">
						<legend className="float-left mr-2 font-medium">ステップ数</legend>
						<span>
							{progress.stepsUsed} / {progress.maxSteps}
						</span>
					</fieldset>
					{progress.decision === undefined ? null : (
						<fieldset className="flex flex-col gap-0.5 text-sm">
							<legend className="float-left mr-2 font-medium">判断</legend>
							<span>
								<Badge variant="outline">{DECISION_LABELS[progress.decision.decision]}</Badge>
							</span>
							<span className="text-muted-foreground">{progress.decision.reason}</span>
						</fieldset>
					)}
				</div>
			)}
			<div className="grid gap-3 md:grid-cols-3">
				<Panel title="現在のタスク">
					{running.length > 0 ? (
						<ul aria-label="実行中のタスク" className="flex flex-col gap-1">
							{running.map((task) => (
								<TaskItem key={task.id} task={task} />
							))}
						</ul>
					) : (
						<Empty>実行中のタスクはありません</Empty>
					)}
					{waiting.length > 0 ? (
						<div className="flex flex-col gap-1">
							<p className="text-xs font-medium text-muted-foreground">待機中</p>
							<ul aria-label="待機中のタスク" className="flex flex-col gap-1">
								{waiting.map((task) => (
									<TaskItem key={task.id} task={task} />
								))}
							</ul>
						</div>
					) : null}
				</Panel>
				<Panel
					title="完了タスク"
					badge={tasks.length > 0 ? `${done.length} / ${tasks.length}` : undefined}
				>
					{done.length > 0 ? (
						<ul className="flex flex-col gap-1">
							{done.map((task) => (
								<TaskItem key={task.id} task={task} />
							))}
						</ul>
					) : (
						<Empty>完了したタスクはありません</Empty>
					)}
				</Panel>
				<Panel title="修正された計画">
					{plan === undefined ? (
						<Empty>計画はまだ修正されていません</Empty>
					) : (
						<PlanChanges plan={plan} previousTasks={previousTasks} />
					)}
				</Panel>
			</div>
		</section>
	);
}
