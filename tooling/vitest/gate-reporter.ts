import { readdirSync } from "node:fs";
import { join } from "node:path";
import type {
	Reporter,
	SerializedError,
	TestCase,
	TestModule,
	TestRunEndReason,
	Vitest,
} from "vitest/node";

const PG_TEST_PATTERN = /\.pg\.test\.[cm]?[jt]sx?$/u;
const IGNORED_DIRECTORIES = new Set([
	".git",
	".next",
	".turbo",
	"build",
	"coverage",
	"dist",
	"node_modules",
]);

// The root execution unit covers only `tooling/` and `scripts/`; each workspace is its own unit
// (plan C18「テストの実行単位」), so the root walk skips the workspace directories at its top level.
const WORKSPACE_DIRECTORIES = new Set(["apps", "packages"]);

type TestSuiteName = "gate" | "local" | "pg" | string;

export interface GateTestSummary {
	executed: number;
	failed: number;
	passed: number;
	skipped: number;
	skippedByReason: Record<string, number>;
}

interface GateReporterOptions {
	env?: NodeJS.ProcessEnv;
	root?: string;
	setExitCode?: (code: number) => void;
	write?: (message: string) => void;
}

function skipReason(test: TestCase): string {
	const result = test.result();
	if (result.state === "skipped" && result.note) return result.note;
	if (test.options.mode === "todo") return "todo";
	if (result.state === "pending") return "pending";
	return "static skip";
}

export function summarizeTestModules(testModules: readonly TestModule[]): GateTestSummary {
	let failed = 0;
	let passed = 0;
	let skipped = 0;
	const skippedByReason: Record<string, number> = {};

	for (const testModule of testModules) {
		for (const test of testModule.children.allTests()) {
			const state = test.result().state;
			if (state === "passed") {
				passed += 1;
			} else if (state === "failed") {
				failed += 1;
			} else {
				skipped += 1;
				const reason = skipReason(test);
				skippedByReason[reason] = (skippedByReason[reason] ?? 0) + 1;
			}
		}
	}

	return {
		executed: passed + failed,
		failed,
		passed,
		skipped,
		skippedByReason,
	};
}

export function formatGateSummary(summary: GateTestSummary, dbTestsNotRun: number): string {
	const lines = [
		`Gate test summary: executed=${summary.executed} passed=${summary.passed} failed=${summary.failed} skipped=${summary.skipped}`,
	];
	const skippedReasons = Object.entries(summary.skippedByReason).sort(([left], [right]) =>
		left < right ? -1 : left > right ? 1 : 0,
	);
	if (skippedReasons.length > 0) {
		lines.push("Skipped by reason:");
		for (const [reason, count] of skippedReasons) lines.push(`  ${reason}: ${count}`);
	}
	lines.push(`DB tests not run: ${dbTestsNotRun}`);
	return lines.join("\n");
}

function countPgTestsInDirectory(directory: string, isRoot: boolean): number {
	let count = 0;
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			const skipped =
				IGNORED_DIRECTORIES.has(entry.name) || (isRoot && WORKSPACE_DIRECTORIES.has(entry.name));
			if (!skipped) {
				count += countPgTestsInDirectory(join(directory, entry.name), false);
			}
		} else if (entry.isFile() && PG_TEST_PATTERN.test(entry.name)) {
			count += 1;
		}
	}
	return count;
}

export function countUnexecutedPgTests(root: string, suite: TestSuiteName): number {
	if (suite === "pg") return 0;
	try {
		return countPgTestsInDirectory(root, true);
	} catch (error) {
		// A missing root has no pg tests; any other I/O failure must not be reported as zero.
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
		throw error;
	}
}

export default class GateReporter implements Reporter {
	private readonly env: NodeJS.ProcessEnv;
	private root: string;
	private readonly setExitCode: (code: number) => void;
	private readonly write: (message: string) => void;

	constructor(options: GateReporterOptions = {}) {
		this.env = options.env ?? process.env;
		this.root = options.root ?? process.cwd();
		this.setExitCode = options.setExitCode ?? ((code) => (process.exitCode = code));
		this.write = options.write ?? console.log;
	}

	onInit(vitest: Vitest): void {
		this.root = vitest.config.root;
	}

	onTestRunEnd(
		testModules: readonly TestModule[],
		_unhandledErrors: readonly SerializedError[],
		_reason: TestRunEndReason,
	): void {
		const suite = this.env.AI_TEST_SUITE || "gate";
		const summary = summarizeTestModules(testModules);
		const dbTestsNotRun = countUnexecutedPgTests(this.root, suite);
		this.write(formatGateSummary(summary, dbTestsNotRun));

		if (suite === "gate" && summary.executed === 0) {
			this.setExitCode(1);
			this.write("Gate reporter error: no tests executed in the gate suite.");
		}
	}
}
