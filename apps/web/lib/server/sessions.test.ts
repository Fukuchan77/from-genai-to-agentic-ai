import { createFakeClock } from "@platform/ai-core/ports";
import { describe, expect, it, vi } from "vitest";
import {
	createSessionRegistry,
	getSessionRegistry,
	resetSessionRegistriesForTesting,
} from "./sessions";

const IDLE = 600_000;

function setup(onDispose?: (id: string, value: { name: string }) => void) {
	const clock = createFakeClock(1_000);
	const registry = createSessionRegistry<{ name: string }>({
		clock,
		idleTimeoutMs: IDLE,
		...(onDispose ? { onDispose } : {}),
	});
	return { clock, registry };
}

describe("createSessionRegistry", () => {
	it("returns the value it created, and nothing for an unknown id", () => {
		const { registry } = setup();

		const created = registry.create("s1", () => ({ name: "one" }));

		expect(created).toEqual({ name: "one" });
		expect(registry.get("s1")).toBe(created);
		expect(registry.get("other")).toBeUndefined();
		expect(registry.size()).toBe(1);
	});

	it("refuses to create a session under an id that is in use", () => {
		const { registry } = setup();
		registry.create("s1", () => ({ name: "one" }));

		expect(() => registry.create("s1", () => ({ name: "two" }))).toThrow(/s1|既に|already/u);
		expect(registry.get("s1")).toEqual({ name: "one" });
	});

	it("does not register a session whose factory throws", () => {
		const { registry } = setup();

		expect(() =>
			registry.create("s1", () => {
				throw new Error("boom");
			}),
		).toThrow("boom");

		expect(registry.get("s1")).toBeUndefined();
		expect(registry.size()).toBe(0);
		expect(registry.create("s1", () => ({ name: "again" }))).toEqual({ name: "again" });
	});

	describe("idle disposal", () => {
		it("keeps a session idle for exactly the timeout, and disposes it one millisecond later", () => {
			const onDispose = vi.fn();
			const { registry, clock } = setup(onDispose);
			registry.create("s1", () => ({ name: "one" }));

			clock.advanceBy(IDLE);
			expect(registry.get("s1")).toEqual({ name: "one" });
			expect(onDispose).not.toHaveBeenCalled();

			clock.advanceBy(1);
			expect(registry.get("s1")).toBeUndefined();
			expect(onDispose).toHaveBeenCalledTimes(1);
			expect(onDispose).toHaveBeenCalledWith("s1", { name: "one" });
			expect(registry.size()).toBe(0);
		});

		it("counts idleness from the last touch, and a plain get does not count as activity", () => {
			const { registry, clock } = setup();
			registry.create("s1", () => ({ name: "one" }));
			clock.advanceBy(IDLE - 10);
			registry.touch("s1");
			clock.advanceBy(IDLE);
			expect(registry.get("s1")).toBeDefined();

			clock.advanceBy(1);
			expect(registry.get("s1")).toBeUndefined();

			registry.create("s2", () => ({ name: "two" }));
			clock.advanceBy(IDLE - 10);
			registry.get("s2");
			clock.advanceBy(11);
			expect(registry.get("s2")).toBeUndefined();
		});

		it("ignores a touch for an unknown or already disposed session", () => {
			const { registry, clock } = setup();
			registry.create("s1", () => ({ name: "one" }));
			clock.advanceBy(IDLE + 1);
			registry.get("s1");

			expect(() => registry.touch("s1")).not.toThrow();
			expect(() => registry.touch("never-seen")).not.toThrow();
			expect(registry.get("s1")).toBeUndefined();
		});

		it("lets the same id be created again once the old session expired, disposing the old one once", () => {
			const onDispose = vi.fn();
			const { registry, clock } = setup(onDispose);
			registry.create("s1", () => ({ name: "old" }));
			clock.advanceBy(IDLE + 1);

			const fresh = registry.create("s1", () => ({ name: "new" }));

			expect(fresh).toEqual({ name: "new" });
			expect(onDispose).toHaveBeenCalledTimes(1);
			expect(onDispose).toHaveBeenCalledWith("s1", { name: "old" });
		});

		it("sweeps every expired session at once and reports their ids", () => {
			const onDispose = vi.fn();
			const { registry, clock } = setup(onDispose);
			registry.create("old-a", () => ({ name: "a" }));
			registry.create("old-b", () => ({ name: "b" }));
			clock.advanceBy(IDLE);
			registry.create("fresh", () => ({ name: "f" }));
			clock.advanceBy(1);

			expect(registry.sweep()).toEqual(["old-a", "old-b"]);
			expect(registry.get("fresh")).toBeDefined();
			expect(onDispose).toHaveBeenCalledTimes(2);
			expect(registry.sweep()).toEqual([]);
		});
	});

	describe("dispose", () => {
		it("removes the session, runs the hook once, and reports whether there was one", () => {
			const onDispose = vi.fn();
			const { registry } = setup(onDispose);
			registry.create("s1", () => ({ name: "one" }));

			expect(registry.dispose("s1")).toBe(true);
			expect(registry.dispose("s1")).toBe(false);
			expect(registry.dispose("never-seen")).toBe(false);

			expect(registry.get("s1")).toBeUndefined();
			expect(onDispose).toHaveBeenCalledTimes(1);
		});

		it("forgets the session even if the hook throws, and keeps sweeping the others", () => {
			const onDispose = vi.fn((id: string) => {
				if (id === "bad") throw new Error("hook failed");
			});
			const { registry, clock } = setup(onDispose);
			registry.create("bad", () => ({ name: "bad" }));
			registry.create("good", () => ({ name: "good" }));
			clock.advanceBy(IDLE + 1);

			expect(registry.sweep()).toEqual(["bad", "good"]);
			expect(registry.size()).toBe(0);
			expect(onDispose).toHaveBeenCalledTimes(2);

			registry.create("bad", () => ({ name: "bad" }));
			expect(() => registry.dispose("bad")).not.toThrow();
			expect(registry.get("bad")).toBeUndefined();
		});
	});

	it("rejects an empty id and a non-positive timeout", () => {
		const { registry } = setup();

		expect(() => registry.create("", () => ({ name: "x" }))).toThrow(RangeError);
		for (const idleTimeoutMs of [0, -1, Number.NaN]) {
			expect(() => createSessionRegistry({ clock: createFakeClock(), idleTimeoutMs })).toThrow(
				RangeError,
			);
		}
	});
});

describe("getSessionRegistry: one registry per name in the whole process", () => {
	const options = { clock: createFakeClock(), idleTimeoutMs: IDLE };

	it("returns the same registry for the same name and different ones for different names", () => {
		resetSessionRegistriesForTesting();
		try {
			const a = getSessionRegistry<{ n: number }>("interview", options);
			const again = getSessionRegistry<{ n: number }>("interview", options);
			const other = getSessionRegistry<{ n: number }>("other", options);

			expect(again).toBe(a);
			expect(other).not.toBe(a);
		} finally {
			resetSessionRegistriesForTesting();
		}
	});

	it("shares a session between two copies of the module, as when two routes are separate bundles", async () => {
		resetSessionRegistriesForTesting();
		try {
			const first = getSessionRegistry<{ n: number }>("interview", options);
			first.create("s1", () => ({ n: 1 }));

			vi.resetModules();
			const reloaded = await import("./sessions");
			const second = reloaded.getSessionRegistry<{ n: number }>("interview", options);

			expect(second.get("s1")).toEqual({ n: 1 });
			expect(second.dispose("s1")).toBe(true);
			expect(first.get("s1")).toBeUndefined();
		} finally {
			resetSessionRegistriesForTesting();
		}
	});
});
