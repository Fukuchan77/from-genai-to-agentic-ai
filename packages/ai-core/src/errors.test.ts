import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { PLATFORM_ERROR_CODES, PlatformError, type PlatformErrorCode } from "./errors";

class ExamplePlatformError extends PlatformError {
	constructor(details: Readonly<Record<string, unknown>>) {
		super("invalid-request", "入力内容が正しくありません。", details);
	}
}

describe("PlatformError", () => {
	it("preserves the closed error code, Japanese message, and structured details", () => {
		const details = { field: "modelId", expected: "catalog entry" } as const;
		const error = new ExamplePlatformError(details);

		expect(error.code).toBe("invalid-request");
		expect(error.message).toBe("入力内容が正しくありません。");
		expect(error.details).toBe(details);
		expect(error.name).toBe("ExamplePlatformError");
	});

	it("supports discrimination with instanceof across the error hierarchy", () => {
		const error = new ExamplePlatformError({ feature: "chat" });

		expect(error).toBeInstanceOf(ExamplePlatformError);
		expect(error).toBeInstanceOf(PlatformError);
		expect(error).toBeInstanceOf(Error);
	});

	it("exposes the documented M1 PlatformErrorCode vocabulary", () => {
		expect(PLATFORM_ERROR_CODES).toEqual([
			"invalid-request",
			"capability-unsupported",
			"provider-unavailable",
			"source-unavailable",
			"output-invalid",
		]);

		expectTypeOf<PlatformErrorCode>().toEqualTypeOf<
			| "invalid-request"
			| "capability-unsupported"
			| "provider-unavailable"
			| "source-unavailable"
			| "output-invalid"
		>();
	});
});

describe("PlatformError across module copies", () => {
	// Next.js bundles a page and a Route Handler separately, so one process can hold two copies of
	// this module; an error thrown by one copy must still classify as a PlatformError in the other.
	async function loadCopy() {
		vi.resetModules();
		const errors = await import("./errors");
		const config = await import("./config/load");
		return { PlatformError: errors.PlatformError, ConfigError: config.ConfigError };
	}

	it("recognises a PlatformError and a subclass from another copy", async () => {
		const first = await loadCopy();
		const second = await loadCopy();
		expect(first.PlatformError).not.toBe(second.PlatformError);
		expect(new first.PlatformError("invalid-request", "x") instanceof second.PlatformError).toBe(
			true,
		);
		expect(new first.ConfigError("x") instanceof second.PlatformError).toBe(true);
	});

	it("keeps subclass checks exact and refuses plain errors and look-alikes", async () => {
		const first = await loadCopy();
		const second = await loadCopy();
		expect(new first.PlatformError("invalid-request", "x") instanceof second.ConfigError).toBe(
			false,
		);
		expect(new Error("x") instanceof second.PlatformError).toBe(false);
		expect({ code: "invalid-request", message: "x" } instanceof second.PlatformError).toBe(false);
		expect((null as unknown as object) instanceof second.PlatformError).toBe(false);
	});
});
