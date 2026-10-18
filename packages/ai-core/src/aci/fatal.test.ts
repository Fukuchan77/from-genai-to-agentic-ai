import { describe, expect, it } from "vitest";
import { PlatformError } from "../errors";
import { classifyToolError, FATAL_ERROR_CODES, FatalLatch, FatalToolError } from "./fatal";

describe("FatalToolError", () => {
	it("carries a closed code and a learner-facing message, and a plain Error message", () => {
		const error = new FatalToolError("not-allowed", "許可されていないパスです。");

		expect(error).toBeInstanceOf(Error);
		expect(error.name).toBe("FatalToolError");
		expect(error.code).toBe("not-allowed");
		expect(error.learnerMessage).toBe("許可されていないパスです。");
		// Error.message is what logs may print: it names the code and never the learner text.
		expect(error.message).toBe("fatal tool error: not-allowed");
	});

	it("publishes the codes of the plan, and sandbox-unavailable added in W4", () => {
		expect(FATAL_ERROR_CODES).toEqual([
			"auth-failed",
			"config-missing",
			"not-allowed",
			"attempt-limit",
			"sandbox-unavailable",
		]);
	});
});

describe("FatalLatch", () => {
	it("starts empty", () => {
		expect(new FatalLatch().error).toBeUndefined();
	});

	it("keeps only the first error and ignores later ones", () => {
		const latch = new FatalLatch();
		const first = new FatalToolError("auth-failed", "first");
		const second = new FatalToolError("not-allowed", "second");

		latch.trip(first);
		latch.trip(second);

		expect(latch.error).toBe(first);
	});

	it("is independent per instance (one latch per run)", () => {
		const a = new FatalLatch();
		const b = new FatalLatch();
		a.trip(new FatalToolError("attempt-limit", "limit"));

		expect(b.error).toBeUndefined();
	});
});

describe("classifyToolError", () => {
	it("passes a FatalToolError through as fatal", () => {
		const error = new FatalToolError("config-missing", "設定がありません。");

		expect(classifyToolError(error)).toEqual({ kind: "fatal", error });
	});

	it.each([401, 403])("treats HTTP %i from a tool as fatal auth-failed", (status) => {
		const result = classifyToolError(Object.assign(new Error("Unauthorized"), { status }));

		expect(result.kind).toBe("fatal");
		if (result.kind !== "fatal") return;
		expect(result.error.code).toBe("auth-failed");
		expect(result.error.learnerMessage).toContain("認証");
	});

	it("reads statusCode as well as status", () => {
		const result = classifyToolError(Object.assign(new Error("x"), { statusCode: 403 }));

		expect(result).toMatchObject({ kind: "fatal", error: { code: "auth-failed" } });
	});

	it.each([404, 429, 500, 503])("treats HTTP %i as recoverable", (status) => {
		const result = classifyToolError(Object.assign(new Error("boom"), { status }));

		expect(result.kind).toBe("recoverable");
	});

	it("treats a timeout as recoverable with a next action", () => {
		const timeout = new DOMException("The operation timed out", "TimeoutError");
		const result = classifyToolError(timeout);

		expect(result.kind).toBe("recoverable");
		if (result.kind !== "recoverable") return;
		expect(result.summary).toContain("TimeoutError");
		expect(result.nextAction.length).toBeGreaterThan(0);
	});

	it("treats a transient network failure as recoverable", () => {
		const result = classifyToolError(new TypeError("fetch failed"));

		expect(result).toMatchObject({ kind: "recoverable" });
	});

	it("reuses a PlatformError's learner-facing message as the summary", () => {
		const result = classifyToolError(
			new PlatformError("source-unavailable", "取得に失敗しました。"),
		);

		expect(result).toMatchObject({ kind: "recoverable", summary: "取得に失敗しました。" });
	});

	it("never puts a stack trace, a raw message or a secret in the summary", () => {
		const secret = "sk-secret-value-123";
		const error = new Error(`request to https://x.example?key=${secret} failed`);
		const result = classifyToolError(error);

		expect(result.kind).toBe("recoverable");
		if (result.kind !== "recoverable") return;
		const text = `${result.summary} ${result.nextAction}`;
		expect(text).not.toContain(secret);
		expect(text).not.toContain("https://");
		expect(text).not.toMatch(/\n\s+at /u);
		expect(text).not.toContain(error.stack ?? "never");
	});

	it("handles non-Error throwables", () => {
		for (const thrown of ["text", 42, null, undefined, { status: 500 }]) {
			expect(classifyToolError(thrown).kind).toBe("recoverable");
		}
	});
});
