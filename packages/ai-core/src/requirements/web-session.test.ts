import { describe, expect, it } from "vitest";
import { PlatformError } from "../errors";
import { createFakeClock } from "../ports";
import {
	getRequirementsSessions,
	REQUIREMENTS_MAX_SESSIONS,
	REQUIREMENTS_SESSION_IDLE_MS,
	REQUIREMENTS_SESSION_REGISTRY,
	type RequirementsSession,
	type SessionStoreFactory,
} from "./web-session";

describe("getRequirementsSessions", () => {
	it("asks for the shared registry named requirements with a 10 minute idle limit", () => {
		const clock = createFakeClock(0);
		const calls: { name: string; idleTimeoutMs: number; clock: unknown }[] = [];
		const fake: SessionStoreFactory = (name, options) => {
			calls.push({ name, idleTimeoutMs: options.idleTimeoutMs, clock: options.clock });
			return {
				get: () => undefined,
				create: () => ({}) as never,
				touch() {},
				dispose: () => false,
				sweep: () => [],
				size: () => 0,
			};
		};

		getRequirementsSessions(fake, clock);

		expect(REQUIREMENTS_SESSION_REGISTRY).toBe("requirements");
		expect(REQUIREMENTS_SESSION_IDLE_MS).toBe(600_000);
		expect(calls).toEqual([{ name: "requirements", idleTimeoutMs: 600_000, clock }]);
	});

	it("returns the store the factory built, typed for RequirementsSession", () => {
		const store = {
			get: (_id: string): RequirementsSession | undefined => undefined,
			create: (_id: string, f: () => RequirementsSession) => f(),
			touch() {},
			dispose: () => true,
			sweep: () => [],
			size: () => 0,
		};
		const wrapped = getRequirementsSessions(() => store as never, createFakeClock(0));
		expect(wrapped.get("x")).toBeUndefined();
		expect(wrapped.dispose("x")).toBe(true);
	});

	describe("sweep and size cap (W6 F-14)", () => {
		function fakeStore() {
			const ids = new Set<string>();
			const log: string[] = [];
			const store = {
				get: () => undefined,
				create: (id: string, f: () => RequirementsSession) => {
					log.push(`create:${id}`);
					ids.add(id);
					return f();
				},
				touch() {},
				dispose: () => false,
				sweep: () => {
					log.push("sweep");
					return [];
				},
				size: () => ids.size,
			};
			return { store, ids, log };
		}
		const factory = () => ({}) as RequirementsSession;

		it("sweeps expired sessions before it creates one", () => {
			const { store, log } = fakeStore();
			const sessions = getRequirementsSessions(() => store, createFakeClock(0));

			sessions.create("a", factory);

			expect(log).toEqual(["sweep", "create:a"]);
		});

		it("refuses a new session at the cap with provider-unavailable, and creates nothing", () => {
			const { store, ids } = fakeStore();
			const sessions = getRequirementsSessions(() => store, createFakeClock(0));
			for (let i = 0; i < REQUIREMENTS_MAX_SESSIONS; i += 1) sessions.create(`s${i}`, factory);

			const error = (() => {
				try {
					sessions.create("one-more", factory);
				} catch (caught) {
					return caught;
				}
			})();

			expect(error).toBeInstanceOf(PlatformError);
			expect((error as PlatformError).code).toBe("provider-unavailable");
			expect(ids.size).toBe(REQUIREMENTS_MAX_SESSIONS);
		});

		it("lets ensureCapacity fail early at the cap, after sweeping", () => {
			const { store, log } = fakeStore();
			const sessions = getRequirementsSessions(() => store, createFakeClock(0));
			sessions.ensureCapacity();
			expect(log).toEqual(["sweep"]);
			for (let i = 0; i < REQUIREMENTS_MAX_SESSIONS; i += 1) sessions.create(`s${i}`, factory);

			expect(() => sessions.ensureCapacity()).toThrow(PlatformError);
		});

		it("accepts a session again once the sweep has freed room", () => {
			const { store, ids } = fakeStore();
			store.sweep = () => {
				ids.clear();
				return [];
			};
			for (let i = 0; i < REQUIREMENTS_MAX_SESSIONS; i += 1) ids.add(`s${i}`);
			const sessions = getRequirementsSessions(() => store, createFakeClock(0));

			expect(() => sessions.create("fresh", factory)).not.toThrow();
		});
	});
});
