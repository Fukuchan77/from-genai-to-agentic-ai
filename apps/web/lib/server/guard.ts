import { DEFAULT_INPUT_LIMITS } from "@platform/ai-core/config";
import type { RunMode } from "@platform/ai-core/models";
import type { Clock } from "@platform/ai-core/ports";
import { GuardError, toErrorResponse } from "./errors";

// RequestGuard (plan C14, Req 3.11): reject a request before any LLM call, cheapest check first.
// Order: body size (413) -> JSON + schema (400) -> message / text / image limits (400) ->
// rate limit (429, `live` only). A rejected request never spends rate-limit quota.

export interface InputLimits {
	readonly maxBodyBytes: number;
	readonly maxMessages: number;
	readonly maxTextCharacters: number;
	readonly maxImages: number;
	readonly maxImageBytes: number;
}

/**
 * The part of a Zod schema the guard needs. Structural, so `apps/web` does not need its own
 * `zod` dependency: `chatRequestSchema` and `agentRequestSchema` satisfy it as they are.
 */
export interface GuardSchema<T> {
	safeParse(data: unknown):
		| { readonly success: true; readonly data: T }
		| {
				readonly success: false;
				readonly error: { readonly issues: readonly { readonly path: readonly PropertyKey[] }[] };
		  };
}

export interface GuardPolicy<T> {
	/** Should be a strict object schema: the guard rejects whatever the schema rejects. */
	readonly schema: GuardSchema<T>;
	readonly limits: InputLimits;
	/** Content limits (message count, text length, images). Returns the rejection, if any. */
	readonly inspect: (body: T) => GuardError | undefined;
}

export type GuardResult<T> =
	| { readonly ok: true; readonly body: T }
	| { readonly ok: false; readonly error: GuardError; readonly response: Response };

export type RateLimitDecision =
	| { readonly allowed: true }
	| { readonly allowed: false; readonly retryAfterSeconds: number };

export interface RateLimiter {
	/** Counts one request against the current window, unless the window is already full. */
	check(): RateLimitDecision;
}

export interface GuardDeps {
	readonly limiter: RateLimiter;
	readonly mode: RunMode;
}

function formatBytes(bytes: number): string {
	if (bytes >= 1024 * 1024) return `${Number((bytes / (1024 * 1024)).toFixed(1))} MiB`;
	if (bytes >= 1024) return `${Number((bytes / 1024).toFixed(1))} KiB`;
	return `${bytes} バイト`;
}

function payloadTooLarge(limits: InputLimits): GuardError {
	return new GuardError(
		"payload-too-large",
		`リクエストの大きさが上限（${formatBytes(limits.maxBodyBytes)}）を超えています。`,
	);
}

function invalidRequest(message: string): GuardError {
	return new GuardError("invalid-request", message);
}

/** Reads the body up to `maxBytes`; stops at the first byte over the limit. */
async function readBodyBytes(
	request: Request,
	limits: InputLimits,
): Promise<Uint8Array | GuardError> {
	const declared = request.headers.get("content-length");
	if (declared !== null && /^\d+$/u.test(declared) && Number(declared) > limits.maxBodyBytes) {
		return payloadTooLarge(limits);
	}
	const reader = request.body?.getReader();
	if (!reader) return new Uint8Array();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > limits.maxBodyBytes) {
			await reader.cancel();
			return payloadTooLarge(limits);
		}
		chunks.push(value);
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

function parseJson(bytes: Uint8Array): unknown | GuardError {
	try {
		return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
	} catch {
		return invalidRequest("リクエスト本文を JSON として読み取れませんでした。");
	}
}

function reject<T>(error: GuardError): GuardResult<T> {
	return { ok: false, error, response: toErrorResponse(error) };
}

/**
 * Checks `request` against `policy` in the documented order. On success the parsed body is
 * returned; on failure `response` is the JSON error to send and `error` says why.
 */
export async function guardRequest<T>(
	request: Request,
	policy: GuardPolicy<T>,
	deps: GuardDeps,
): Promise<GuardResult<T>> {
	const bytes = await readBodyBytes(request, policy.limits);
	if (bytes instanceof GuardError) return reject(bytes);

	const json = parseJson(bytes);
	if (json instanceof GuardError) return reject(json);

	const parsed = policy.schema.safeParse(json);
	if (!parsed.success) {
		const path = parsed.error.issues[0]?.path.map(String).join(".");
		return reject(
			invalidRequest(
				path
					? `リクエストの形式が正しくありません（${path}）。`
					: "リクエストの形式が正しくありません。",
			),
		);
	}

	const violation = policy.inspect(parsed.data);
	if (violation) return reject(violation);

	if (deps.mode === "live") {
		const decision = deps.limiter.check();
		if (!decision.allowed) {
			return reject(
				new GuardError(
					"rate-limited",
					`リクエストの回数が上限に達しました。${decision.retryAfterSeconds} 秒後にもう一度お試しください。`,
					{ retryAfterSeconds: decision.retryAfterSeconds },
				),
			);
		}
	}

	return { ok: true, body: parsed.data };
}

// --- Conversation limits (POST /api/chat and /api/agent/tools) ---

export interface ConversationBody {
	readonly messages: readonly {
		readonly role: string;
		readonly parts: readonly { readonly type: string }[];
	}[];
}

function codePointLength(value: string): number {
	let count = 0;
	for (const _ of value) count += 1;
	return count;
}

/** Same predicate as `adaptHistoryForModel` and the routes: a bare `image` counts too. */
export function isImageMediaType(mediaType: string): boolean {
	return mediaType === "image" || mediaType.startsWith("image/");
}

/** Decoded size of a `data:` URL, or undefined for any other URL. Percent-encoded data counts as-is. */
function dataUrlBytes(url: string): number | undefined {
	if (!url.startsWith("data:")) return undefined;
	const comma = url.indexOf(",");
	if (comma === -1) return undefined;
	const data = url.slice(comma + 1);
	if (!url.slice(0, comma).endsWith(";base64")) return data.length;
	const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
	return Math.floor((data.length * 3) / 4) - padding;
}

/**
 * Message count, then the text length of each user message (assistant replies are written by the
 * server and bounded by the body size), then the total image count, then each image's size.
 */
export function inspectConversation(
	body: ConversationBody,
	limits: InputLimits,
): GuardError | undefined {
	if (body.messages.length > limits.maxMessages) {
		return new GuardError(
			"limit-exceeded",
			`メッセージが多すぎます（上限 ${limits.maxMessages} 件）。新しい会話を始めてください。`,
		);
	}
	const images: string[] = [];
	for (const message of body.messages) {
		let characters = 0;
		for (const part of message.parts) {
			const fields = part as Record<string, unknown>;
			if (message.role === "user" && part.type === "text" && typeof fields.text === "string") {
				characters += codePointLength(fields.text);
			}
			if (part.type === "file") {
				// Every file must be a data URL: only those can be measured here, and a remote URL
				// would be fetched by the SDK on the server's behalf.
				const url = typeof fields.url === "string" ? fields.url : "";
				if (!url.startsWith("data:")) {
					return invalidRequest("添付ファイルはデータ URL で送信してください。");
				}
				if (typeof fields.mediaType === "string" && isImageMediaType(fields.mediaType)) {
					images.push(url);
				}
			}
		}
		if (characters > limits.maxTextCharacters) {
			return new GuardError(
				"limit-exceeded",
				`1 件のメッセージは ${limits.maxTextCharacters} 文字までです。`,
			);
		}
	}
	if (images.length > limits.maxImages) {
		return new GuardError(
			"limit-exceeded",
			`添付できる画像は 1 回のリクエストで ${limits.maxImages} 枚までです。`,
		);
	}
	for (const url of images) {
		const bytes = dataUrlBytes(url);
		if (bytes === undefined) {
			return invalidRequest("画像はデータ URL で添付してください。");
		}
		if (bytes > limits.maxImageBytes) {
			return new GuardError(
				"limit-exceeded",
				`画像は 1 枚あたり ${formatBytes(limits.maxImageBytes)} までです。`,
			);
		}
	}
	return undefined;
}

/** The policy of `POST /api/chat` and `POST /api/agent/tools`. */
export function createConversationPolicy<T extends ConversationBody>(
	schema: GuardSchema<T>,
	limits: InputLimits = DEFAULT_INPUT_LIMITS,
): GuardPolicy<T> {
	return { schema, limits, inspect: (body) => inspectConversation(body, limits) };
}

// --- Rate limiter ---

export interface RateLimiterOptions {
	readonly limit: number;
	readonly windowMs: number;
	readonly clock: Pick<Clock, "now">;
}

/**
 * A process-local fixed-window counter: one shared bucket for every LLM-calling route (cost
 * control for a single-process learning app; distributed limiting is out of scope). The window
 * opens at the first check and closes `windowMs` later; denied checks are not counted.
 */
export function createRateLimiter({ limit, windowMs, clock }: RateLimiterOptions): RateLimiter {
	if (!Number.isInteger(limit) || limit < 1) {
		throw new RangeError("limit must be a positive integer");
	}
	if (!Number.isFinite(windowMs) || windowMs <= 0) {
		throw new RangeError("windowMs must be a positive finite number");
	}
	let windowStart = Number.NEGATIVE_INFINITY;
	let count = 0;
	return {
		check() {
			const now = clock.now();
			if (now - windowStart >= windowMs) {
				windowStart = now;
				count = 0;
			}
			if (count >= limit) {
				return {
					allowed: false,
					retryAfterSeconds: Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000)),
				};
			}
			count += 1;
			return { allowed: true };
		},
	};
}
