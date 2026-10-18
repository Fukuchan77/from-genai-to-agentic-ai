import { z } from "zod";
import { defineAciTool } from "../aci/define-tool";
import { FatalToolError } from "../aci/fatal";
import type { AciTool } from "../aci/types";
import { PlatformError } from "../errors";
import type { SandboxRunResult, SandboxSession } from "../ports/sandbox";
import { type AnalysisAttempt, type AttemptLog, clipHead, clipTail } from "./attempts";
import {
	DEFAULT_OUTPUT_LIMITS,
	type Figure,
	type OutputLimits,
	parseSandboxOutput,
	type Table,
} from "./output-parser";
import { helpersImportLine } from "./prelude";

// The sandbox is reached only through the port type; this file imports nothing from `sandbox/`.

export const RUN_PYTHON_TOOL_NAME = "runPython";
export const RUN_PYTHON_CODE_MAX_CHARACTERS = 20_000;
/** What the learner can see of one run's output. */
const DISPLAY_TEXT_CHARACTERS = 20_000;
/** What the model is shown: the end of stderr (the traceback), the start of stdout. */
const MODEL_STDERR_CHARACTERS = 8000;
const MODEL_STDOUT_CHARACTERS = 6000;
const MODEL_FAILED_STDOUT_CHARACTERS = 2000;

/** What a run reports as it goes, for the stream (`data-analysis-*`). */
export type AnalysisEvent =
	| { readonly type: "attempt"; readonly attempt: AnalysisAttempt; readonly fixes: number }
	| { readonly type: "figure"; readonly figure: Figure }
	| { readonly type: "table"; readonly table: Table }
	| { readonly type: "rejected"; readonly reasons: readonly string[] };

export type RunPythonResult =
	| {
			readonly status: "ok";
			readonly stdout: string;
			readonly figures: readonly string[];
			readonly tables: readonly string[];
			readonly rejected?: readonly string[];
	  }
	| {
			readonly status: "error";
			readonly error: string;
			readonly stdout: string;
			readonly stderr: string;
			readonly fixesLeft: number;
	  };

export interface RunPythonToolParams {
	readonly session: SandboxSession;
	readonly log: AttemptLog;
	readonly executionTimeoutMs: number;
	readonly limits?: OutputLimits;
	readonly onEvent?: ((event: AnalysisEvent) => void) | undefined;
}

const inputSchema = z.object({
	code: z
		.string()
		.min(1)
		.max(RUN_PYTHON_CODE_MAX_CHARACTERS)
		.describe(
			`実行する Python コード（1 つのスクリプト全体、1〜${RUN_PYTHON_CODE_MAX_CHARACTERS} 文字）。アップロードされたファイルはカレントディレクトリにある`,
		),
});

type Input = z.output<typeof inputSchema>;

/**
 * `runPython`: runs the generated code in the learner's sandbox and tells the model what happened
 * (Req 3.1, 3.3). Its only effect is inside a sandbox that is thrown away, so it is `read-only`
 * (CL-21). The code, not the model, counts the fixes: when the last allowed fix fails it throws a
 * fatal `attempt-limit` error, which ends the run (Req 3.4), and a call after that does not run.
 */
export function createRunPythonTool(params: RunPythonToolParams): AciTool<Input, RunPythonResult> {
	const { session, log, executionTimeoutMs } = params;
	const limits: OutputLimits = {
		...(params.limits ?? DEFAULT_OUTPUT_LIMITS),
		maxTextCharacters: DISPLAY_TEXT_CHARACTERS,
	};
	const emit = (event: AnalysisEvent) => params.onEvent?.(event);

	return defineAciTool<Input, RunPythonResult>({
		name: RUN_PYTHON_TOOL_NAME,
		description: [
			"Python コードを隔離されたサンドボックスで実行し、標準出力・標準エラー・エラーを返す。pandas、matplotlib、openpyxl が使える。",
			"使うとき: アップロードされたファイルの読み込み、集計、グラフ化を行うとき。グラフは show_figure(alt)、表は show_table(df, caption) で学習者に見せる（読み込み済みで、import は不要）。",
			"使わないとき: コードを書かずに答えられるとき。ネットワークへの接続とファイルの削除はできない。",
			"例: code=\"import pandas as pd\\ndf = pd.read_csv('data.csv')\\nshow_table(df.describe().reset_index(), '要約統計')\"",
		].join("\n"),
		inputSchema,
		risk: "read-only",
		execute: async ({ code }) => {
			if (!log.canRun()) throw limitError(log);

			let result: SandboxRunResult;
			try {
				result = await session.runPython(`${helpersImportLine()}\n${code}`, {
					timeoutMs: executionTimeoutMs,
				});
			} catch (error) {
				// The sandbox itself is gone (closed, expired, Docker stopped): rewriting the code cannot
				// help, so the run ends instead of spending more model calls. The message is the
				// sandbox's own fixed learner-facing text.
				if (error instanceof PlatformError && error.code === "provider-unavailable") {
					throw new FatalToolError("sandbox-unavailable", error.message);
				}
				throw error;
			}
			const parsed = parseSandboxOutput(result.stdout, limits);
			const attempt = log.record({
				code,
				stdout: parsed.text,
				stderr: clipTail(result.stderr, DISPLAY_TEXT_CHARACTERS),
				error: result.error,
			});
			emit({ type: "attempt", attempt, fixes: log.fixes() });

			if (result.error) {
				if (log.exhausted()) throw limitError(log);
				return {
					status: "error",
					error: attempt.errorSummary ?? result.error.name,
					stdout: clipHead(parsed.text, MODEL_FAILED_STDOUT_CHARACTERS),
					stderr: clipTail(result.stderr, MODEL_STDERR_CHARACTERS),
					fixesLeft: Math.max(0, log.limit() - log.fixes()),
				};
			}

			for (const figure of parsed.figures) emit({ type: "figure", figure });
			for (const table of parsed.tables) emit({ type: "table", table });
			if (parsed.rejected.length > 0) emit({ type: "rejected", reasons: parsed.rejected });
			return {
				status: "ok",
				stdout: clipHead(parsed.text, MODEL_STDOUT_CHARACTERS),
				figures: parsed.figures.map((figure) => figure.alt),
				tables: parsed.tables.map((table) => table.caption),
				...(parsed.rejected.length > 0 ? { rejected: parsed.rejected } : {}),
			};
		},
	});
}

function limitError(log: AttemptLog): FatalToolError {
	return new FatalToolError(
		"attempt-limit",
		`コードの修正を ${log.limit()} 回まで試しましたが、成功しませんでした。最後のコードとエラーを確認してください。`,
	);
}
