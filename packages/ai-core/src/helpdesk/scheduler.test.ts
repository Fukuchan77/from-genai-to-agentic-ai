import { describe, expect, it } from "vitest";
import type { Plan } from "./plan-schema";
import { nextRunnable } from "./scheduler";

function plan(...tasks: readonly [id: string, dependsOn?: readonly string[]][]): Plan {
	return {
		tasks: tasks.map(([id, dependsOn = []]) => ({
			id,
			description: `説明 ${id}`,
			dependsOn: [...dependsOn],
		})),
	};
}

describe("nextRunnable", () => {
	it("returns the first task when nothing is done and it has no dependency", () => {
		expect(nextRunnable(plan(["a"], ["b", ["a"]]), new Set())?.id).toBe("a");
	});

	it("follows dependency order, not list order", () => {
		const p = plan(["c", ["b"]], ["b", ["a"]], ["a"]);
		const done = new Set<string>();
		const order: string[] = [];
		for (let task = nextRunnable(p, done); task; task = nextRunnable(p, done)) {
			order.push(task.id);
			done.add(task.id);
		}
		expect(order).toEqual(["a", "b", "c"]);
	});

	it("picks the first of several runnable tasks, in plan order", () => {
		const p = plan(["a"], ["b"], ["c", ["a", "b"]]);
		expect(nextRunnable(p, new Set())?.id).toBe("a");
		expect(nextRunnable(p, new Set(["a"]))?.id).toBe("b");
	});

	it("does not return a task whose dependency is only partly done", () => {
		const p = plan(["a"], ["b"], ["c", ["a", "b"]]);
		expect(nextRunnable(p, new Set(["a", "b"]))?.id).toBe("c");
		expect(nextRunnable(plan(["c", ["a", "b"]], ["a"], ["b"]), new Set(["a"]))?.id).toBe("b");
	});

	it("never returns a task that is already completed", () => {
		const p = plan(["a"], ["b"]);
		expect(nextRunnable(p, new Set(["a"]))?.id).toBe("b");
	});

	it("returns undefined when every task is completed", () => {
		expect(nextRunnable(plan(["a"], ["b", ["a"]]), new Set(["a", "b"]))).toBeUndefined();
	});

	it("returns undefined when the only tasks left wait on something that never completes", () => {
		const p = plan(["a"], ["b", ["x"]], ["c", ["b"]]);
		expect(nextRunnable(p, new Set(["a"]))).toBeUndefined();
	});

	it("returns undefined for an empty plan", () => {
		expect(nextRunnable(plan(), new Set())).toBeUndefined();
	});

	it("does not change the plan or the completed set", () => {
		const p = plan(["a"], ["b", ["a"]]);
		const done = new Set(["a"]);
		const before = JSON.stringify(p);
		nextRunnable(p, done);
		expect(JSON.stringify(p)).toBe(before);
		expect([...done]).toEqual(["a"]);
	});
});
