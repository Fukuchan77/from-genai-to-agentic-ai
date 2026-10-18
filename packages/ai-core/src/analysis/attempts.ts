import type { SandboxExecutionError } from "../ports/sandbox";

/** The longest code kept in an attempt (plan "アプリケーション側の型"). */
export const MAX_ATTEMPT_CODE_CHARACTERS = 8000;
export const MAX_ERROR_SUMMARY_CHARACTERS = 300;

/** One run of generated code, as the learner reviews it (Req 3.6). */
export interface AnalysisAttempt {
	/** 1 for the first run. */
	readonly index: number;
	readonly code: string;
	readonly stdout: string;
	readonly stderr: string;
	/** Set when the run failed: the error's name and the first line of its message. */
	readonly errorSummary?: string;
}

export interface AttemptInput {
	readonly code: string;
	readonly stdout: string;
	readonly stderr: string;
	readonly error?: SandboxExecutionError | undefined;
}

/** Keeps the first `limit` characters (code points) and says how many were left out. */
export function clipHead(text: string, limit: number): string {
	const characters = Array.from(text);
	if (characters.length <= limit) return text;
	return `${characters.slice(0, limit).join("")}\n…（以降 ${characters.length - limit} 文字を省略しました）`;
}

/** Keeps the last `limit` characters: for a traceback, the end names the error. */
export function clipTail(text: string, limit: number): string {
	const characters = Array.from(text);
	if (characters.length <= limit) return text;
	return `…（前の ${characters.length - limit} 文字を省略しました）\n${characters.slice(characters.length - limit).join("")}`;
}

function summaryOf(error: SandboxExecutionError): string {
	const firstLine = error.message.split("\n")[0] ?? "";
	return clipHead(`${error.name}: ${firstLine}`, MAX_ERROR_SUMMARY_CHARACTERS);
}

export interface AttemptLog {
	/** Records a finished run and returns it. */
	record(input: AttemptInput): AnalysisAttempt;
	attempts(): readonly AnalysisAttempt[];
	/** The number of fixes allowed (`maxFixAttempts`). */
	limit(): number;
	/** Runs made right after a failed run, over the whole analysis (for display). */
	fixes(): number;
	/** False once the allowed fixes are used up for the failure the last run is part of. */
	canRun(): boolean;
	/** True when the last run failed and its failure has no fix left (Req 3.4). */
	exhausted(): boolean;
}

/**
 * The record of one analysis's runs, and the count of fixes (Req 3.3). A fix is a run that follows
 * a failed run; the first run and a run after a success are not fixes. The allowance is per
 * failure: a success ends the failure, and a later failure starts with its full `maxFixAttempts`
 * (the analysis as a whole is bounded by the agent's step limit). With `maxFixAttempts` 3 one
 * failure gets at most four runs (the failing run and three fixes). The code counts, not the model.
 */
export function createAttemptLog(options: { readonly maxFixAttempts: number }): AttemptLog {
	const { maxFixAttempts } = options;
	if (!Number.isInteger(maxFixAttempts) || maxFixAttempts < 0) {
		throw new RangeError("maxFixAttempts must be a non-negative integer.");
	}
	const attempts: AnalysisAttempt[] = [];
	let fixes = 0;
	// Fixes made for the failure that is still open; a success closes it.
	let openFixes = 0;
	let lastFailed = false;

	const exhausted = () => lastFailed && openFixes >= maxFixAttempts;
	return {
		record(input) {
			if (lastFailed) {
				fixes += 1;
				openFixes += 1;
			}
			lastFailed = input.error !== undefined;
			if (!lastFailed) openFixes = 0;
			const attempt: AnalysisAttempt = {
				index: attempts.length + 1,
				code: clipHead(input.code, MAX_ATTEMPT_CODE_CHARACTERS),
				stdout: input.stdout,
				stderr: input.stderr,
				...(input.error ? { errorSummary: summaryOf(input.error) } : {}),
			};
			attempts.push(attempt);
			return attempt;
		},
		attempts: () => [...attempts],
		limit: () => maxFixAttempts,
		fixes: () => fixes,
		canRun: () => !exhausted(),
		exhausted,
	};
}
