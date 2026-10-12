import { PLATFORM_ERROR_CODES, PlatformError } from "@platform/ai-core/errors";
import { SourceFetchError } from "@platform/ai-core/summarize";
import { describe, expect, it } from "vitest";
import {
	GUARD_ERROR_CODES,
	GuardError,
	HTTP_STATUS_BY_CODE,
	parseStreamErrorText,
	toErrorResponse,
	toPublicError,
	toStreamErrorText,
	UNEXPECTED_ERROR_MESSAGE,
} from "./errors";

const SECRET = "changeme-not-a-real-secret";

class LeakyError extends PlatformError {
	constructor(code: (typeof PLATFORM_ERROR_CODES)[number]) {
		super(code, "リクエストを処理できませんでした。", {
			apiKey: SECRET,
			baseUrl: `https://user:${SECRET}@internal.example/v1`,
			nested: { token: SECRET },
		});
	}
}

async function bodyOf(response: Response): Promise<unknown> {
	return JSON.parse(await response.text());
}

describe("HTTP_STATUS_BY_CODE", () => {
	it.each([
		["invalid-request", 400],
		["capability-unsupported", 400],
		["provider-unavailable", 503],
		["source-unavailable", 422],
		["output-invalid", 502],
		["limit-exceeded", 400],
		["payload-too-large", 413],
		["rate-limited", 429],
		["unexpected", 500],
	] as const)("maps %s to %i", (code, status) => {
		expect(HTTP_STATUS_BY_CODE[code]).toBe(status);
	});

	it("covers every PlatformError code and every guard code, and nothing else", () => {
		expect(Object.keys(HTTP_STATUS_BY_CODE).sort()).toEqual(
			[...PLATFORM_ERROR_CODES, ...GUARD_ERROR_CODES, "unexpected"].sort(),
		);
	});
});

describe("toErrorResponse", () => {
	it.each(PLATFORM_ERROR_CODES)(
		"returns the %s status with a JSON { error } body",
		async (code) => {
			const error = new LeakyError(code);

			const response = toErrorResponse(error);

			expect(response.status).toBe(HTTP_STATUS_BY_CODE[code]);
			expect(response.headers.get("content-type")).toMatch(/^application\/json/);
			expect(await bodyOf(response)).toEqual({
				error: { code, message: "リクエストを処理できませんでした。" },
			});
		},
	);

	it("never leaks the stack, the error name, or secret values from details", async () => {
		const error = new LeakyError("provider-unavailable");

		const text = await toErrorResponse(error).text();

		expect(text).not.toContain(SECRET);
		expect(text).not.toContain("internal.example");
		expect(text).not.toContain("apiKey");
		expect(text).not.toContain("LeakyError");
		expect(text).not.toContain("stack");
		expect(text).not.toContain(String(error.stack).split("\n")[1]?.trim() ?? "unreachable-stack");
	});

	it("keeps the public reason and status of a source-unavailable error", async () => {
		const response = toErrorResponse(new SourceFetchError("http-status", { status: 404 }));

		expect(response.status).toBe(422);
		expect(await bodyOf(response)).toEqual({
			error: {
				code: "source-unavailable",
				message: "記事を取得できませんでした（HTTP ステータス 404）。",
				details: { reason: "http-status", status: 404 },
			},
		});
	});

	it.each([
		["a reason with unsafe characters", { reason: `bad ${SECRET}` }],
		["a non-string reason", { reason: { nested: SECRET } }],
		["an overlong reason", { reason: "a".repeat(64) }],
		["a non-integer status", { status: 404.5 }],
		["an out-of-range status", { status: 99_999 }],
		["a string status", { status: SECRET }],
		["unlisted keys", { apiKey: SECRET, url: `https://x/?k=${SECRET}`, headers: { a: SECRET } }],
	])("drops details with %s", async (_label, details) => {
		const response = toErrorResponse(
			new PlatformError("source-unavailable", "取得できません。", details),
		);

		const text = await response.text();
		expect(JSON.parse(text)).toEqual({
			error: { code: "source-unavailable", message: "取得できません。" },
		});
		expect(text).not.toContain(SECRET);
	});

	it("maps a GuardError to its status and keeps only code and message", async () => {
		const response = toErrorResponse(
			new GuardError("payload-too-large", "リクエストが大きすぎます。"),
		);

		expect(response.status).toBe(413);
		expect(response.headers.has("retry-after")).toBe(false);
		expect(await bodyOf(response)).toEqual({
			error: { code: "payload-too-large", message: "リクエストが大きすぎます。" },
		});
	});

	it("maps a GuardError with the invalid-request code to 400", async () => {
		const response = toErrorResponse(new GuardError("invalid-request", "形式が正しくありません。"));

		expect(response.status).toBe(400);
		expect(await bodyOf(response)).toEqual({
			error: { code: "invalid-request", message: "形式が正しくありません。" },
		});
	});

	it("sends Retry-After for a rate-limited GuardError", () => {
		const response = toErrorResponse(
			new GuardError("rate-limited", "しばらくしてからお試しください。", { retryAfterSeconds: 17 }),
		);

		expect(response.status).toBe(429);
		expect(response.headers.get("retry-after")).toBe("17");
	});

	it.each([0, -3, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
		"omits Retry-After for the invalid value %s",
		(retryAfterSeconds) => {
			const response = toErrorResponse(
				new GuardError("rate-limited", "しばらくしてからお試しください。", { retryAfterSeconds }),
			);

			expect(response.headers.has("retry-after")).toBe(false);
		},
	);

	it.each([
		["an Error", new Error(`connect failed: Bearer ${SECRET}`)],
		["a TypeError", new TypeError(`bad ${SECRET}`)],
		["a string", `raw ${SECRET}`],
		["undefined", undefined],
		["an object", { message: SECRET }],
	])("turns %s into a fixed 500 unexpected response", async (_label, thrown) => {
		const response = toErrorResponse(thrown);

		const text = await response.text();
		expect(response.status).toBe(500);
		expect(JSON.parse(text)).toEqual({
			error: { code: "unexpected", message: UNEXPECTED_ERROR_MESSAGE },
		});
		expect(text).not.toContain(SECRET);
	});
});

describe("toPublicError", () => {
	it("returns the closed { code, message } shape for a PlatformError", () => {
		expect(toPublicError(new LeakyError("output-invalid"))).toEqual({
			code: "output-invalid",
			message: "リクエストを処理できませんでした。",
		});
	});
});

describe("stream error text", () => {
	it("encodes a PlatformError as JSON with only code and message", () => {
		const text = toStreamErrorText(new LeakyError("capability-unsupported"));

		expect(JSON.parse(text)).toEqual({
			code: "capability-unsupported",
			message: "リクエストを処理できませんでした。",
		});
		expect(text).not.toContain(SECRET);
	});

	it("does not include details even for a source-unavailable error", () => {
		const text = toStreamErrorText(new SourceFetchError("timeout"));

		expect(Object.keys(JSON.parse(text)).sort()).toEqual(["code", "message"]);
	});

	it("encodes an unexpected error with the fixed message", () => {
		const text = toStreamErrorText(new Error(`oops ${SECRET}`));

		expect(JSON.parse(text)).toEqual({ code: "unexpected", message: UNEXPECTED_ERROR_MESSAGE });
		expect(text).not.toContain(SECRET);
	});

	it("round-trips through parseStreamErrorText", () => {
		const error = new GuardError("rate-limited", "しばらくしてからお試しください。");

		expect(parseStreamErrorText(toStreamErrorText(error))).toEqual({
			code: "rate-limited",
			message: "しばらくしてからお試しください。",
		});
	});

	it.each([
		["plain text", "An error occurred."],
		["an unknown code", JSON.stringify({ code: "weird", message: "x" })],
		["a missing message", JSON.stringify({ code: "invalid-request" })],
		["a non-object", "42"],
		["invalid JSON", "{"],
	])("parses %s as the fixed unexpected error", (_label, text) => {
		expect(parseStreamErrorText(text)).toEqual({
			code: "unexpected",
			message: UNEXPECTED_ERROR_MESSAGE,
		});
	});
});
