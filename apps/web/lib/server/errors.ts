import { PlatformError, type PlatformErrorCode } from "@platform/ai-core/errors";

// Conversion of errors into what the browser may see (plan C14, "HTTP API", Error Handling).
// Only `code`, a Japanese `message`, and (for source-unavailable) a closed `reason` / `status` leave
// the server: stack traces, error names and `PlatformError.details` never do (constitution
// principle 7). No `server-only` import here: the pure `parseStreamErrorText` is meant for the UI.

/** Rejections raised by the RequestGuard before any LLM call (Req 3.11). */
export const GUARD_ERROR_CODES = ["limit-exceeded", "payload-too-large", "rate-limited"] as const;

export type GuardErrorCode = (typeof GUARD_ERROR_CODES)[number];

/** A malformed request is `invalid-request` (a `PlatformErrorCode`), raised by the guard too. */
export type GuardRejectionCode = GuardErrorCode | "invalid-request";

/** Anything that is not a `PlatformError` or `GuardError`; the message is a fixed text. */
export type UnexpectedErrorCode = "unexpected";

export type HttpErrorCode = GuardErrorCode | PlatformErrorCode | UnexpectedErrorCode;

/** HTTP status of a failure that happens before the response stream starts. */
export const HTTP_STATUS_BY_CODE: Readonly<Record<HttpErrorCode, number>> = Object.freeze({
	"invalid-request": 400,
	"capability-unsupported": 400,
	"provider-unavailable": 503,
	"source-unavailable": 422,
	"output-invalid": 502,
	"limit-exceeded": 400,
	"payload-too-large": 413,
	"rate-limited": 429,
	unexpected: 500,
});

export const UNEXPECTED_ERROR_MESSAGE =
	"予期しないエラーが発生しました。しばらくしてからもう一度お試しください。";

/** A request rejected by `guardRequest`. `message` is Japanese and holds no request content. */
export class GuardError extends Error {
	readonly code: GuardRejectionCode;
	readonly retryAfterSeconds: number | undefined;

	constructor(
		code: GuardRejectionCode,
		message: string,
		options: { readonly retryAfterSeconds?: number } = {},
	) {
		super(message);
		this.name = "GuardError";
		this.code = code;
		this.retryAfterSeconds = options.retryAfterSeconds;
	}
}

/** The only `details` keys that may reach the browser (plan "HTTP API": `source-unavailable`). */
export interface PublicErrorDetails {
	readonly reason?: string;
	readonly status?: number;
	/** What to set up, for a `provider-unavailable` error (for example a disabled sandbox). Fixed text. */
	readonly guidance?: string;
}

export interface PublicError {
	readonly code: HttpErrorCode;
	readonly message: string;
	readonly details?: PublicErrorDetails;
}

export interface StreamError {
	readonly code: HttpErrorCode;
	readonly message: string;
}

const REASON_PATTERN = /^[a-z][a-z-]{0,31}$/u;
const KNOWN_CODES: ReadonlySet<string> = new Set(Object.keys(HTTP_STATUS_BY_CODE));

function publicDetails(details: Readonly<Record<string, unknown>>): PublicErrorDetails | undefined {
	const { reason, status } = details;
	const safeReason =
		typeof reason === "string" && REASON_PATTERN.test(reason) ? { reason } : undefined;
	const safeStatus =
		typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599
			? { status }
			: undefined;
	return safeReason || safeStatus ? { ...safeReason, ...safeStatus } : undefined;
}

// Machine-readable reasons of `invalid-request` the UI acts on (e.g. offering `reset`). Other
// reasons (model selection, for one) stay server-side.
const PUBLIC_INVALID_REQUEST_REASONS: ReadonlySet<string> = new Set([
	"embedding-model-changed",
	"too-many-files",
	"invalid-file-name",
	// The two 409s of the requirements interview: finished for good, or a round still in flight.
	"completed",
	"busy",
]);

function invalidRequestDetails(
	details: Readonly<Record<string, unknown>>,
): PublicErrorDetails | undefined {
	const { reason } = details;
	return typeof reason === "string" && PUBLIC_INVALID_REQUEST_REASONS.has(reason)
		? { reason }
		: undefined;
}

const MAX_GUIDANCE_CHARACTERS = 500;

/**
 * A `provider-unavailable` error may carry `guidance`: the fixed sentence that tells the learner
 * what to set up (Req 3.8). It is built by the platform from names of settings and tasks, never from
 * an error's own text.
 */
function unavailableDetails(
	details: Readonly<Record<string, unknown>>,
): PublicErrorDetails | undefined {
	const { guidance } = details;
	return typeof guidance === "string" &&
		guidance.length > 0 &&
		[...guidance].length <= MAX_GUIDANCE_CHARACTERS
		? { guidance }
		: undefined;
}

/** The browser-safe view of any thrown value. */
export function toPublicError(error: unknown): PublicError {
	if (error instanceof GuardError) return { code: error.code, message: error.message };
	if (error instanceof PlatformError) {
		const details =
			error.code === "source-unavailable"
				? publicDetails(error.details)
				: error.code === "invalid-request"
					? invalidRequestDetails(error.details)
					: error.code === "provider-unavailable"
						? unavailableDetails(error.details)
						: undefined;
		return {
			code: error.code,
			message: error.message,
			...(details ? { details } : {}),
		};
	}
	return { code: "unexpected", message: UNEXPECTED_ERROR_MESSAGE };
}

/** A JSON `{ error: { code, message } }` response for a failure before the stream starts. */
export function toErrorResponse(error: unknown): Response {
	const publicError = toPublicError(error);
	const headers = new Headers({ "content-type": "application/json; charset=utf-8" });
	if (
		error instanceof GuardError &&
		error.retryAfterSeconds !== undefined &&
		Number.isInteger(error.retryAfterSeconds) &&
		error.retryAfterSeconds > 0
	) {
		headers.set("retry-after", String(error.retryAfterSeconds));
	}
	return new Response(JSON.stringify({ error: publicError }), {
		status: HTTP_STATUS_BY_CODE[publicError.code],
		headers,
	});
}

/**
 * A missing resource: 404 with the shared JSON error shape. The code stays `invalid-request` (the
 * closed vocabulary has no `not-found`), so a client reads it like any other rejected request. The
 * message must not echo the request, only the resource's own name.
 */
export function toNotFoundResponse(message: string): Response {
	return new Response(JSON.stringify({ error: { code: "invalid-request", message } }), {
		status: 404,
		headers: { "content-type": "application/json; charset=utf-8" },
	});
}

/**
 * The `onError` text for a stream that fails after it has started. The AI SDK sends one string,
 * so `code` and `message` travel as JSON; `parseStreamErrorText` reads it back in the UI.
 */
export function toStreamErrorText(error: unknown): string {
	const { code, message } = toPublicError(error);
	return JSON.stringify({ code, message } satisfies StreamError);
}

const UNEXPECTED_STREAM_ERROR: StreamError = Object.freeze({
	code: "unexpected",
	message: UNEXPECTED_ERROR_MESSAGE,
});

/** Reads `toStreamErrorText` output; anything else becomes the fixed unexpected error. */
export function parseStreamErrorText(text: string): StreamError {
	try {
		const parsed: unknown = JSON.parse(text);
		if (typeof parsed === "object" && parsed !== null) {
			const { code, message } = parsed as Record<string, unknown>;
			if (typeof code === "string" && KNOWN_CODES.has(code) && typeof message === "string") {
				return { code: code as HttpErrorCode, message };
			}
		}
	} catch {
		// Not JSON: fall through to the fixed error.
	}
	return UNEXPECTED_STREAM_ERROR;
}
