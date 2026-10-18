import { PlatformError } from "../errors";

/** Closed vocabulary of errors that end a run (003 C2). */
export const FATAL_ERROR_CODES = [
	"auth-failed",
	"config-missing",
	"not-allowed",
	"attempt-limit",
	// The sandbox that runs the learner's code is gone (closed, expired, Docker stopped): no retry helps.
	"sandbox-unavailable",
] as const;
export type FatalErrorCode = (typeof FATAL_ERROR_CODES)[number];

const RECOVERABLE_NEXT_ACTION = "入力を見直して再試行するか、ツールを使わずに回答してください。";
const AUTH_FAILED_MESSAGE = "認証に失敗しました。トークンまたはキーの設定を確認してください。";

/**
 * An error a retry cannot fix: the run must stop (stop reason `error`). `learnerMessage` is the only
 * text meant for the learner; `message` names the code so a log line never carries it.
 */
export class FatalToolError extends Error {
	readonly code: FatalErrorCode;
	readonly learnerMessage: string;

	constructor(code: FatalErrorCode, learnerMessage: string) {
		super(`fatal tool error: ${code}`);
		this.name = "FatalToolError";
		this.code = code;
		this.learnerMessage = learnerMessage;
	}
}

/** Holds the first fatal error of one run; later errors are ignored. Create one per run. */
export class FatalLatch {
	#error: FatalToolError | undefined;

	get error(): FatalToolError | undefined {
		return this.#error;
	}

	trip(error: FatalToolError): void {
		this.#error ??= error;
	}
}

export type ToolErrorClassification =
	| { readonly kind: "recoverable"; readonly summary: string; readonly nextAction: string }
	| { readonly kind: "fatal"; readonly error: FatalToolError };

function httpStatus(error: unknown): number | undefined {
	if (typeof error !== "object" || error === null) return undefined;
	const record = error as { status?: unknown; statusCode?: unknown };
	const status = record.status ?? record.statusCode;
	return typeof status === "number" ? status : undefined;
}

/**
 * Splits a thrown value into "recoverable" (a summary and the next fix for the model) and "fatal".
 * The summary never contains the raw message or a stack trace: only the error's name, or the
 * learner-facing message of a `PlatformError`.
 */
export function classifyToolError(error: unknown): ToolErrorClassification {
	if (error instanceof FatalToolError) return { kind: "fatal", error };
	const status = httpStatus(error);
	if (status === 401 || status === 403) {
		return { kind: "fatal", error: new FatalToolError("auth-failed", AUTH_FAILED_MESSAGE) };
	}
	if (error instanceof PlatformError) {
		// PlatformError messages are learner-facing text without secrets by convention.
		return { kind: "recoverable", summary: error.message, nextAction: RECOVERABLE_NEXT_ACTION };
	}
	const name = error instanceof Error ? error.name : typeof error;
	return {
		kind: "recoverable",
		summary: `ツールの実行に失敗しました（${name}）。`,
		nextAction: RECOVERABLE_NEXT_ACTION,
	};
}
