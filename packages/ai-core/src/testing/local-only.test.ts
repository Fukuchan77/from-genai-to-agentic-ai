import { describe, expect, inject, it, vi } from "vitest";
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

// Bodies record that they ran; the suite at the end of this file checks the record
// against the injected availability, so a skip regression fails in every run mode.
const executedLocalBodies: string[] = [];

describeLocal("describeLocal public integration", (localIt) => {
	localIt("runs its body when local models are available", () => {
		executedLocalBodies.push("describeLocal");
	});
});

itLocal("itLocal public integration runs when local models are available", () => {
	executedLocalBodies.push("itLocal");
});

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

	it("falls back to a default skip reason when none is provided", () => {
		let registeredTest: ((context: { skip(reason: string): void }) => unknown) | undefined;
		const api = createLocalTestApi(
			{ available: false, reason: null },
			{
				describe: vi.fn(),
				it: (_name, test) => {
					registeredTest = test as typeof registeredTest;
				},
				beforeEach: vi.fn(),
			},
		);
		const skip = vi.fn();

		api.itLocal("local test", vi.fn());
		expect(registeredTest).toBeTypeOf("function");
		registeredTest?.({ skip });

		expect(skip).toHaveBeenCalledWith("Local model is unavailable.");
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

// Must stay after the public integration tests: Vitest runs a file's tests in definition order.
describe("local-only public integration outcome", () => {
	it("runs local bodies only when local models are available", () => {
		const { available } = inject("localAvailability");

		expect(executedLocalBodies).toEqual(available ? ["describeLocal", "itLocal"] : []);
	});
});
