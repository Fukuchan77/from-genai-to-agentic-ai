// Capability observation (003 Req 3.3, plan C16): how often a real local model repairs analysis
// code that is deliberately wrong and still finishes the run, inside a REAL Docker sandbox. The
// instruction tells the model to run a snippet that reads a column the file does not have, so the
// first run always fails with a KeyError and the model has to read the traceback and fix it.
//
// It prints a results table (paste it into research.md) and asserts only invariants: every run
// ends with a known status and the numbers are finite. The completion rate itself is observed, not
// asserted. No cumulative cap on `fixes` is asserted: CL-26 counts fixes per failure, so a run
// that recovers twice legitimately has more than MAX_FIX_ATTEMPTS fixes in total.
//
// TODAY THIS TEST ALWAYS SKIPS. The `local` lane's network guard blocks the Docker socket on
// purpose (tooling/vitest/network-guard.ts allows it only for `AI_TEST_SUITE=container`), and the
// eval-suite has no container lane, so no lane allows both Ollama and Docker. Which lane should is
// a pending human decision. Without Ollama `describeLocal` skips it first.
import { readFileSync } from "node:fs";
import path from "node:path";
import { type AnalysisResult, runAnalysis } from "@platform/ai-core/analysis";
import { loadPlatformConfig } from "@platform/ai-core/config";
import { createModelGateway } from "@platform/ai-core/models";
import { systemClock } from "@platform/ai-core/ports";
import { createLocalDockerProvider, probeDockerEnvironment } from "@platform/ai-core/sandbox";
import { describeLocal } from "@platform/ai-core/testing";
import { expect } from "vitest";

const ATTEMPTS = 3;
const MAX_FIX_ATTEMPTS = 3;
const EXECUTION_TIMEOUT_MS = 60_000;
const SANDBOX_CREATE_TIMEOUT_MS = 120_000;
const RUN_TIMEOUT_MS = 300_000;
// The loop's own wall-clock limit is 300 s per run; leave room for container start and teardown.
const TEST_TIMEOUT_MS = ATTEMPTS * (RUN_TIMEOUT_MS + 60_000) + 60_000;

const CSV_BYTES = readFileSync(
	path.resolve(
		import.meta.dirname,
		"..",
		"..",
		"..",
		"ai-core",
		"fixtures",
		"analysis",
		"sales.csv",
	),
);

// The file has a `sales` column and no `revenue` column, so the snippet below raises KeyError.
const INSTRUCTION = [
	"まず次のコードをそのまま一度実行してください。",
	"```python",
	"import pandas as pd",
	'df = pd.read_csv("data.csv")',
	'monthly = df.groupby(df["date"].str[:7])["revenue"].sum()',
	"show_table(monthly.reset_index(), '月別売上')",
	"```",
	"エラーになったら、エラーの内容を読んでコードを直し、月別の売上合計を表で見せてください。",
].join("\n");

interface Row {
	readonly attempt: number;
	readonly status: string;
	readonly fixes: number;
	readonly runs: number;
	readonly tables: number;
	readonly seconds: number;
}

const KNOWN_STATUSES: readonly string[] = [
	"succeeded",
	"incomplete",
	"attempt-limit",
	"sandbox-unavailable",
	"stopped",
	"unreadable",
];

const rows: Row[] = [];

function formatTable(table: readonly Row[], completionRate: number): string {
	const header = "| attempt | status | fixes | runs | tables | seconds |";
	const divider = "| --- | --- | --- | --- | --- | --- |";
	const lines = table.map(
		(row) =>
			`| ${row.attempt} | ${row.status} | ${row.fixes} | ${row.runs} | ${row.tables} | ${row.seconds.toFixed(1)} |`,
	);
	const meanFixes = table.reduce((sum, row) => sum + row.fixes, 0) / Math.max(table.length, 1);
	return [
		`Analysis fix loop (maxFixAttempts=${MAX_FIX_ATTEMPTS}, N=${table.length})`,
		header,
		divider,
		...lines,
		`completion rate (status "succeeded" with a table): ${(completionRate * 100).toFixed(0)}%`,
		`mean fixes used: ${meanFixes.toFixed(2)}`,
	].join("\n");
}

describeLocal("analysis fix loop on a local model with a real sandbox", (it) => {
	it(
		"repairs deliberately wrong code within the fix limit and finishes the run",
		async (context) => {
			const config = loadPlatformConfig();
			expect(config.mode).toBe("local");

			const environment = await probeDockerEnvironment({
				env: { DOCKER_HOST: config.docker.host },
				image: config.docker.image,
			});
			if (!environment.reachable) {
				context.skip(
					"No Docker Engine answered. Start Docker and set DOCKER_HOST if needed. Note: the local lane blocks the Docker socket on purpose (tooling/vitest/network-guard.ts), so this check skips there unless a lane allows both Ollama and Docker.",
				);
			}
			if (!environment.imagePresent) {
				context.skip(
					`The sandbox image ${config.docker.image} is missing. Run mise run sandbox:build.`,
				);
			}

			const provider = createLocalDockerProvider({ environment, image: config.docker.image });
			const { model } = await createModelGateway({ config }).resolve({
				purpose: "chat",
				require: ["tools"],
			});

			let completed = 0;
			try {
				for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
					const started = Date.now();
					const session = await provider.create({ timeoutMs: SANDBOX_CREATE_TIMEOUT_MS });
					let result: AnalysisResult;
					try {
						result = await runAnalysis({
							sandbox: session,
							file: { name: "sales.csv", bytes: new Uint8Array(CSV_BYTES) },
							instruction: INSTRUCTION,
							model,
							options: {
								maxFixAttempts: MAX_FIX_ATTEMPTS,
								executionTimeoutMs: EXECUTION_TIMEOUT_MS,
							},
							clock: systemClock,
							signal: AbortSignal.timeout(RUN_TIMEOUT_MS + 30_000),
						});
					} finally {
						await session.close();
					}
					const seconds = (Date.now() - started) / 1000;
					const row: Row = {
						attempt,
						status: result.status,
						fixes: result.fixes,
						runs: result.attempts.length,
						tables: result.tables.length,
						seconds,
					};
					rows.push(row);
					if (result.status === "succeeded" && result.tables.length > 0) completed++;

					// Invariants only: the run ended with a known status and finite numbers. No cumulative
					// cap on fixes (CL-26 counts them per failure).
					expect(KNOWN_STATUSES).toContain(result.status);
					expect(Number.isInteger(result.fixes) && result.fixes >= 0).toBe(true);
					expect(Number.isFinite(seconds)).toBe(true);
					expect(Number.isInteger(result.attempts.length)).toBe(true);
				}
			} finally {
				const rate = rows.length === 0 ? 0 : completed / rows.length;
				console.info(`\n${formatTable(rows, rate)}\n`);
			}

			expect(rows).toHaveLength(ATTEMPTS);
			expect(completed / rows.length).toBeGreaterThanOrEqual(0);
			expect(completed / rows.length).toBeLessThanOrEqual(1);
		},
		TEST_TIMEOUT_MS,
	);
});
