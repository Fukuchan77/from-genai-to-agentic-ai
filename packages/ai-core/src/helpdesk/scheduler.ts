import type { Plan, PlanTask } from "./plan-schema";

/**
 * Picks the task to run next (Req 2.2): the first task in plan order that is not completed and
 * whose dependencies are all completed. Returns `undefined` when everything is done, or when the
 * tasks left wait on something that never completes. A pure function.
 */
export function nextRunnable(plan: Plan, completed: ReadonlySet<string>): PlanTask | undefined {
	return plan.tasks.find(
		(task) => !completed.has(task.id) && task.dependsOn.every((id) => completed.has(id)),
	);
}
