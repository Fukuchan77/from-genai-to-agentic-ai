import { describe, expect, expectTypeOf, it } from "vitest";
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
		]);

		expectTypeOf<PlatformErrorCode>().toEqualTypeOf<
			"invalid-request" | "capability-unsupported" | "provider-unavailable" | "source-unavailable"
		>();
	});
});
