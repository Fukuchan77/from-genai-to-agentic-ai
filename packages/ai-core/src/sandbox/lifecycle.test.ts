import { describe, expect, it } from "vitest";
import { PlatformError } from "../errors";
import { createFakeClock } from "../ports/clock";
import type { SandboxProvider, SandboxSession } from "../ports/sandbox";
import { createSandboxRegistry, type SandboxRegistry } from "./lifecycle";

const IDLE = 600_000;

interface FakeSession extends SandboxSession {
	alive: boolean;
	closeCalls: number;
}

function makeProvider() {
	const created: FakeSession[] = [];
	const provider: SandboxProvider = {
		kind: "mock",
		async create() {
			const session: FakeSession = {
				alive: true,
				closeCalls: 0,
				async writeFile() {},
				async runPython() {
					return { stdout: "", stderr: "" };
				},
				async isAlive() {
					return session.alive;
				},
				async close() {
					session.closeCalls += 1;
					session.alive = false;
				},
			};
			created.push(session);
			return session;
		},
	};
	return { provider, created };
}

/** Acquires and immediately finishes, like a request that has completed. */
async function use(registry: SandboxRegistry, sessionId: string): Promise<void> {
	(await registry.acquire(sessionId)).done();
}

function setup(maxSessions?: number) {
	const clock = createFakeClock(1_000);
	const { provider, created } = makeProvider();
	const registry = createSandboxRegistry({
		provider,
		clock,
		idleTimeoutMs: IDLE,
		...(maxSessions === undefined ? {} : { maxSessions }),
	});
	return { clock, created, registry, provider };
}

describe("createSandboxRegistry", () => {
	it("creates a sandbox on first acquire and reuses it for the same session", async () => {
		const { registry, created } = setup();

		const first = await registry.acquire("s1");
		const second = await registry.acquire("s1");

		expect(second.session).toBe(first.session);
		expect(first.recreated).toBe(false);
		expect(created).toHaveLength(1);
	});

	it("gives different sessions different sandboxes", async () => {
		const { registry, created } = setup();

		const a = await registry.acquire("a");
		const b = await registry.acquire("b");

		expect(a.session).not.toBe(b.session);
		expect(created).toHaveLength(2);
	});

	it("shares one creation between concurrent acquires of the same session", async () => {
		const { registry, created } = setup();

		const [a, b] = await Promise.all([registry.acquire("s1"), registry.acquire("s1")]);

		expect(a.session).toBe(b.session);
		expect(created).toHaveLength(1);
	});

	it("recreates once, and says so, when the sandbox is no longer alive", async () => {
		const { registry, created } = setup();
		const first = await registry.acquire("s1");
		const [firstSandbox] = created;
		if (firstSandbox) firstSandbox.alive = false;

		const second = await registry.acquire("s1");

		expect(second.session).not.toBe(first.session);
		expect(second.recreated).toBe(true);
		expect(created).toHaveLength(2);
		// The next acquire finds the new sandbox alive and does not recreate again.
		const third = await registry.acquire("s1");
		expect(third.recreated).toBe(false);
		expect(created).toHaveLength(2);
	});

	it("does not loop when the recreated sandbox is also dead: it returns it after one attempt", async () => {
		const { clock } = setup();
		let creations = 0;
		const provider: SandboxProvider = {
			kind: "mock",
			async create() {
				creations += 1;
				return {
					async writeFile() {},
					async runPython() {
						return { stdout: "", stderr: "" };
					},
					async isAlive() {
						return false;
					},
					async close() {},
				};
			},
		};
		const registry = createSandboxRegistry({ provider, clock, idleTimeoutMs: IDLE });

		await use(registry, "s1");
		await use(registry, "s1");

		// First acquire creates (1); the second finds it dead and recreates exactly once (2).
		expect(creations).toBe(2);
	});

	it("keeps the registry usable when creation fails", async () => {
		const clock = createFakeClock();
		let attempts = 0;
		const { provider } = makeProvider();
		const flaky: SandboxProvider = {
			kind: "mock",
			async create(options) {
				attempts += 1;
				if (attempts === 1) throw new Error("boom");
				return provider.create(options);
			},
		};
		const registry = createSandboxRegistry({ provider: flaky, clock, idleTimeoutMs: IDLE });

		await expect(registry.acquire("s1")).rejects.toThrow("boom");
		const retry = await registry.acquire("s1");

		expect(retry.recreated).toBe(false);
	});

	describe("sweep", () => {
		it("keeps a sandbox idle for exactly the timeout, and closes it one millisecond later", async () => {
			const { registry, clock, created } = setup();
			await use(registry, "s1");

			clock.advanceBy(IDLE);
			expect(await registry.sweep()).toEqual([]);
			expect(created[0]?.closeCalls).toBe(0);

			clock.advanceBy(1);
			expect(await registry.sweep()).toEqual(["s1"]);
			expect(created[0]?.closeCalls).toBe(1);
		});

		it("counts idleness from the last touch", async () => {
			const { registry, clock, created } = setup();
			await use(registry, "s1");
			clock.advanceBy(IDLE - 10);
			registry.touch("s1");
			clock.advanceBy(IDLE);

			expect(await registry.sweep()).toEqual([]);
			expect(created[0]?.closeCalls).toBe(0);

			clock.advanceBy(1);
			expect(await registry.sweep()).toEqual(["s1"]);
		});

		it("counts a fresh acquire as activity", async () => {
			const { registry, clock } = setup();
			await use(registry, "s1");
			clock.advanceBy(IDLE);
			await use(registry, "s1");
			clock.advanceBy(IDLE);

			expect(await registry.sweep()).toEqual([]);
		});

		it("never closes a session that is in use, however long the run takes", async () => {
			const { registry, clock, created } = setup();
			const lease = await registry.acquire("s1");
			clock.advanceBy(IDLE * 3);

			expect(await registry.sweep()).toEqual([]);
			expect(created[0]?.closeCalls).toBe(0);

			lease.done();
			// Finishing the run is activity: idleness is counted from now.
			expect(await registry.sweep()).toEqual([]);
			clock.advanceBy(IDLE + 1);
			expect(await registry.sweep()).toEqual(["s1"]);
		});

		it("keeps a session in use while another holder remains, even if one holder calls done twice", async () => {
			const { registry, clock, created } = setup();
			const first = await registry.acquire("s1");
			await registry.acquire("s1");
			first.done();
			first.done();
			clock.advanceBy(IDLE + 1);

			expect(await registry.sweep()).toEqual([]);
			expect(created[0]?.closeCalls).toBe(0);
		});

		it("closes a swept session once: the next sweep finds nothing to close", async () => {
			const { registry, clock, created } = setup();
			await use(registry, "s1");
			clock.advanceBy(IDLE + 1);

			expect(await registry.sweep()).toEqual(["s1"]);
			expect(await registry.sweep()).toEqual([]);
			expect(created[0]?.closeCalls).toBe(1);
		});

		it("closes only the idle sessions and leaves the active ones", async () => {
			const { registry, clock, created } = setup();
			await use(registry, "old");
			clock.advanceBy(IDLE);
			await use(registry, "fresh");
			clock.advanceBy(1);

			expect(await registry.sweep()).toEqual(["old"]);
			expect(created[0]?.closeCalls).toBe(1);
			expect(created[1]?.closeCalls).toBe(0);
		});

		it("creates a new sandbox for a session that was swept", async () => {
			const { registry, clock, created } = setup();
			await use(registry, "s1");
			clock.advanceBy(IDLE + 1);
			await registry.sweep();

			const again = await registry.acquire("s1");

			expect(created).toHaveLength(2);
			expect(again.session).toBe(created[1]);
		});
	});

	describe("release", () => {
		it("closes the sandbox and reports that it did", async () => {
			const { registry, created } = setup();
			await use(registry, "s1");

			expect(await registry.release("s1")).toBe(true);
			expect(created[0]?.closeCalls).toBe(1);
		});

		it("is idempotent: unknown and already released sessions are not an error", async () => {
			const { registry, created } = setup();
			await use(registry, "s1");

			expect(await registry.release("s1")).toBe(true);
			expect(await registry.release("s1")).toBe(false);
			expect(await registry.release("never-seen")).toBe(false);
			expect(created[0]?.closeCalls).toBe(1);
		});

		it("forgets the session even if closing throws", async () => {
			const clock = createFakeClock();
			const provider: SandboxProvider = {
				kind: "mock",
				async create() {
					return {
						async writeFile() {},
						async runPython() {
							return { stdout: "", stderr: "" };
						},
						async isAlive() {
							return true;
						},
						async close() {
							throw new Error("close failed");
						},
					};
				},
			};
			const registry = createSandboxRegistry({ provider, clock, idleTimeoutMs: IDLE });
			await use(registry, "s1");

			await expect(registry.release("s1")).resolves.toBe(true);
			expect(await registry.release("s1")).toBe(false);
		});

		it("lets sweep continue past a sandbox that fails to close", async () => {
			const clock = createFakeClock();
			const closed: string[] = [];
			const provider: SandboxProvider = {
				kind: "mock",
				async create() {
					const id = `n${closed.length}-${Math.random()}`;
					return {
						async writeFile() {},
						async runPython() {
							return { stdout: "", stderr: "" };
						},
						async isAlive() {
							return true;
						},
						async close() {
							closed.push(id);
							if (closed.length === 1) throw new Error("close failed");
						},
					};
				},
			};
			const registry = createSandboxRegistry({ provider, clock, idleTimeoutMs: IDLE });
			await use(registry, "a");
			await use(registry, "b");
			clock.advanceBy(IDLE + 1);

			expect(await registry.sweep()).toEqual(["a", "b"]);
			expect(closed).toHaveLength(2);
		});
	});

	describe("isBusy", () => {
		it("is true while a lease is open and false after it is done, or for an unknown session", async () => {
			const { registry } = setup();
			const lease = await registry.acquire("s1");

			expect(registry.isBusy("s1")).toBe(true);
			expect(registry.isBusy("never-seen")).toBe(false);
			lease.done();
			expect(registry.isBusy("s1")).toBe(false);
		});

		it("stays busy until every lease of the session is done", async () => {
			const { registry } = setup();
			const first = await registry.acquire("s1");
			const second = await registry.acquire("s1");

			first.done();
			expect(registry.isBusy("s1")).toBe(true);
			second.done();
			expect(registry.isBusy("s1")).toBe(false);
		});
	});

	describe("closeAll", () => {
		it("closes every session, in use or not, forgets them, and says which", async () => {
			const { registry, created } = setup();
			await registry.acquire("busy");
			await use(registry, "idle");

			expect(await registry.closeAll()).toEqual(["busy", "idle"]);

			expect(created.map((session) => session.closeCalls)).toEqual([1, 1]);
			expect(registry.isBusy("busy")).toBe(false);
			expect(await registry.sweep()).toEqual([]);
			expect(await registry.closeAll()).toEqual([]);
		});
	});

	describe("maxSessions", () => {
		it("evicts the idle session that was used longest ago when a new one would exceed the cap", async () => {
			const { registry, created, clock } = setup(2);
			await use(registry, "old");
			clock.advanceBy(10);
			await use(registry, "newer");
			clock.advanceBy(10);

			await use(registry, "third");

			expect(created[0]?.closeCalls).toBe(1);
			expect(created[1]?.closeCalls).toBe(0);
			expect(created).toHaveLength(3);
		});

		it("never evicts a session in use: when every session is busy the new one is refused", async () => {
			const { registry, created } = setup(2);
			await registry.acquire("a");
			await registry.acquire("b");

			const refusal = await registry.acquire("c").catch((error: unknown) => error);

			expect(refusal).toBeInstanceOf(PlatformError);
			expect((refusal as PlatformError).code).toBe("provider-unavailable");
			expect((refusal as Error).message).toContain("上限");
			expect(created).toHaveLength(2);
			expect(created.every((session) => session.closeCalls === 0)).toBe(true);
		});

		it("lets an existing session through when the registry is full", async () => {
			const { registry, created } = setup(1);
			await use(registry, "a");

			await use(registry, "a");

			expect(created).toHaveLength(1);
		});

		it("rejects a cap below 1", () => {
			const { provider } = makeProvider();
			expect(() =>
				createSandboxRegistry({
					provider,
					clock: createFakeClock(),
					idleTimeoutMs: IDLE,
					maxSessions: 0,
				}),
			).toThrow(RangeError);
		});
	});
});
