import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TestModule, Vitest } from "vitest/node";
import GateReporter, {
	countUnexecutedPgTests,
	formatGateSummary,
	summarizeTestModules,
} from "./gate-reporter";

type ResultState = "passed" | "failed" | "skipped" | "pending";

function moduleWithResults(
	results: readonly { mode?: "run" | "skip" | "todo"; note?: string; state: ResultState }[],
): TestModule {
	const tests = results.map(({ mode = "run", note, state }) => ({
		options: { mode },
		result: () => (note ? { state, note } : { state }),
	}));
	return {
		children: {
			*allTests() {
				yield* tests;
			},
		},
	} as unknown as TestModule;
}

const temporaryRoots: string[] = [];

afterEach(() => {
	for (const root of temporaryRoots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe("gate reporter", () => {
	it("counts executed results and groups skipped tests by stable reasons", () => {
		const summary = summarizeTestModules([
			moduleWithResults([
				{ state: "passed" },
				{ state: "failed" },
				{ state: "skipped", note: "Ollama is unavailable" },
				{ state: "skipped", mode: "skip" },
				{ state: "skipped", mode: "todo" },
				{ state: "pending" },
			]),
		]);

		expect(summary).toEqual({
			executed: 2,
			failed: 1,
			passed: 1,
			skipped: 4,
			skippedByReason: {
				"Ollama is unavailable": 1,
				pending: 1,
				"static skip": 1,
				todo: 1,
			},
		});
	});

	it("formats a deterministic summary including skipped reasons and DB count", () => {
		const output = formatGateSummary(
			{
				executed: 2,
				failed: 0,
				passed: 2,
				skipped: 2,
				skippedByReason: { zebra: 1, alpha: 1 },
			},
			3,
		);

		expect(output).toBe(
			[
				"Gate test summary: executed=2 passed=2 failed=0 skipped=2",
				"Skipped by reason:",
				"  alpha: 1",
				"  zebra: 1",
				"DB tests not run: 3",
			].join("\n"),
		);
	});

	it("fails only an empty gate execution unit", () => {
		const write = vi.fn();
		const setExitCode = vi.fn();
		const reporter = new GateReporter({
			env: { AI_TEST_SUITE: "gate" },
			root: process.cwd(),
			setExitCode,
			write,
		});

		reporter.onTestRunEnd([], [], "passed");

		expect(setExitCode).toHaveBeenCalledWith(1);
		expect(write).toHaveBeenCalledWith(expect.stringContaining("executed=0"));
		expect(write).toHaveBeenCalledWith("Gate reporter error: no tests executed in the gate suite.");
	});

	it.each(["local", "pg"] as const)("allows an empty %s execution unit", (suite) => {
		const setExitCode = vi.fn();
		const reporter = new GateReporter({
			env: { AI_TEST_SUITE: suite },
			setExitCode,
			write: vi.fn(),
		});

		reporter.onTestRunEnd([], [], "passed");

		expect(setExitCode).not.toHaveBeenCalled();
	});

	it("counts pg test files outside ignored directories and reports none in the pg suite", () => {
		const root = mkdtempSync(join(tmpdir(), "gate-reporter-"));
		temporaryRoots.push(root);
		mkdirSync(join(root, "scripts", "example"), { recursive: true });
		mkdirSync(join(root, "node_modules", "ignored"), { recursive: true });
		writeFileSync(join(root, "scripts", "example", "one.pg.test.ts"), "");
		writeFileSync(join(root, "scripts", "example", "two.pg.test.mts"), "");
		writeFileSync(join(root, "scripts", "example", "ordinary.test.ts"), "");
		writeFileSync(join(root, "node_modules", "ignored", "hidden.pg.test.ts"), "");

		expect(countUnexecutedPgTests(root, "gate")).toBe(2);
		expect(countUnexecutedPgTests(root, "local")).toBe(2);
		expect(countUnexecutedPgTests(root, "pg")).toBe(0);
	});

	it("fails a gate execution unit whose tests were all skipped", () => {
		const write = vi.fn();
		const setExitCode = vi.fn();
		const reporter = new GateReporter({
			env: { AI_TEST_SUITE: "gate" },
			root: process.cwd(),
			setExitCode,
			write,
		});

		reporter.onTestRunEnd(
			[
				moduleWithResults([
					{ state: "skipped", note: "Ollama is unavailable" },
					{ state: "skipped", mode: "skip" },
				]),
			],
			[],
			"passed",
		);

		expect(setExitCode).toHaveBeenCalledWith(1);
		expect(write).toHaveBeenCalledWith(expect.stringContaining("executed=0"));
		expect(write).toHaveBeenCalledWith("Gate reporter error: no tests executed in the gate suite.");
	});

	it.each([
		["gate", undefined],
		["gate", "gate"],
	])(
		"does not set an exit code when a %s unit executed tests (AI_TEST_SUITE=%s)",
		(_suite, env) => {
			const write = vi.fn();
			const setExitCode = vi.fn();
			const reporter = new GateReporter({
				env: env === undefined ? {} : { AI_TEST_SUITE: env },
				root: process.cwd(),
				setExitCode,
				write,
			});

			reporter.onTestRunEnd(
				[moduleWithResults([{ state: "passed" }, { state: "skipped", mode: "skip" }])],
				[],
				"passed",
			);

			expect(setExitCode).not.toHaveBeenCalled();
			expect(write).toHaveBeenCalledOnce();
			expect(write).toHaveBeenCalledWith(expect.stringContaining("executed=1"));
		},
	);

	it("does not count workspace pg tests in the root execution unit", () => {
		const root = mkdtempSync(join(tmpdir(), "gate-reporter-workspaces-"));
		temporaryRoots.push(root);
		for (const directory of [
			"apps/web/lib",
			"packages/ai-core/src",
			"scripts/db",
			"tooling/packages",
		]) {
			mkdirSync(join(root, directory), { recursive: true });
		}
		writeFileSync(join(root, "apps", "web", "lib", "web.pg.test.ts"), "");
		writeFileSync(join(root, "packages", "ai-core", "src", "store.pg.test.ts"), "");
		writeFileSync(join(root, "scripts", "db", "root.pg.test.ts"), "");
		writeFileSync(join(root, "tooling", "packages", "nested.pg.test.ts"), "");

		expect(countUnexecutedPgTests(root, "gate")).toBe(2);
		expect(countUnexecutedPgTests(join(root, "packages", "ai-core"), "gate")).toBe(1);
	});

	it("reports zero pg tests when the root does not exist", () => {
		expect(countUnexecutedPgTests(join(tmpdir(), "gate-reporter-missing-root-0f3a"), "gate")).toBe(
			0,
		);
	});

	it("rethrows file-system errors other than a missing root", () => {
		const root = mkdtempSync(join(tmpdir(), "gate-reporter-notdir-"));
		temporaryRoots.push(root);
		const file = join(root, "not-a-directory");
		writeFileSync(file, "");

		expect(() => countUnexecutedPgTests(file, "gate")).toThrowError(
			expect.objectContaining({ code: "ENOTDIR" }),
		);
	});

	it("uses the Vitest project root captured by onInit", () => {
		const root = mkdtempSync(join(tmpdir(), "gate-reporter-root-"));
		temporaryRoots.push(root);
		writeFileSync(join(root, "database.pg.test.ts"), "");
		const write = vi.fn();
		const reporter = new GateReporter({ env: { AI_TEST_SUITE: "local" }, write });
		reporter.onInit({ config: { root } } as unknown as Vitest);

		reporter.onTestRunEnd([moduleWithResults([{ state: "passed" }])], [], "passed");

		expect(write).toHaveBeenCalledWith(expect.stringContaining("DB tests not run: 1"));
	});
});
