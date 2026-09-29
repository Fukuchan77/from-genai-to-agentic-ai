import { describe, expect, it, vi } from "vitest";
import aiCoreVitestConfig from "../../vitest.config";
import { createFakeClock, describeLocal, itLocal } from "./index";
import { createLocalTestApi } from "./local-only";

describe("testing exports", () => {
	it("re-exports the fake clock", () => {
		const clock = createFakeClock(100);
		clock.advanceBy(25);
		expect(clock.now()).toBe(125);
	});
	it("registers the local availability global setup", () => {
		expect(aiCoreVitestConfig).toMatchObject({
			test: { globalSetup: ["../../tooling/vitest/global-setup-local.ts"] },
		});
	});
});

describeLocal("describeLocal public integration", (localIt) => {
	localIt("runs its body when local models are available", ({ expect: localExpect }) => {
		localExpect(true).toBe(true);
	});
});

itLocal(
	"itLocal public integration runs when local models are available",
	({ expect: localExpect }) => {
		localExpect(true).toBe(true);
	},
);

describe("createLocalTestApi", () => {
	it("skips local suites and tests with the unavailable reason", async () => {
		const describeRegistrar = vi.fn((_name: string, factory: () => void) => factory());
		let beforeEachHook: ((context: { skip(reason: string): void }) => void) | undefined;
		const beforeEachRegistrar = vi.fn(
			(hook: (context: { skip(reason: string): void }) => void) => (beforeEachHook = hook),
		);
		let registeredTest: ((context: { skip(reason: string): void }) => unknown) | undefined;
		const itRegistrar = vi.fn(
			(_name: string, test: (context: { skip(reason: string): void }) => unknown) =>
				(registeredTest = test),
		);
		const suiteBody = vi.fn();
		const testBody = vi.fn();
		const reason = "Ollama is unavailable.";
		const api = createLocalTestApi(
			{ available: false, reason },
			{ describe: describeRegistrar, it: itRegistrar, beforeEach: beforeEachRegistrar },
		);

		api.describeLocal("local suite", suiteBody);
		api.itLocal("local test", testBody);

		const skipSuite = vi.fn();
		beforeEachHook?.({ skip: skipSuite });
		const skipError = new Error("skipped");
		const skipTest = vi.fn(() => {
			throw skipError;
		});
		expect(() => registeredTest?.({ skip: skipTest })).toThrow(skipError);
		expect(skipSuite).toHaveBeenCalledWith(reason);
		expect(skipTest).toHaveBeenCalledWith(reason);
		expect(suiteBody).toHaveBeenCalledOnce();
		expect(testBody).not.toHaveBeenCalled();
	});

	it("runs local suites and tests when local models are available", async () => {
		const suiteBody = vi.fn();
		const testBody = vi.fn();
		const describeRegistrar = vi.fn((_name: string, factory: () => void) => factory());
		const itRegistrar = vi.fn(
			(_name: string, test: (context: { skip(reason: string): void }) => unknown) =>
				test({ skip: vi.fn() }),
		);
		const api = createLocalTestApi(
			{ available: true, reason: null },
			{ describe: describeRegistrar, it: itRegistrar, beforeEach: vi.fn() },
		);

		api.describeLocal("local suite", suiteBody);
		api.itLocal("local test", testBody);

		expect(suiteBody).toHaveBeenCalledOnce();
		expect(testBody).toHaveBeenCalledOnce();
	});
});
