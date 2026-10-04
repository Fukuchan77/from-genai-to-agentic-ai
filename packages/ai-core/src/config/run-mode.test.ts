import { describe, expect, it } from "vitest";
import { resolveRunMode } from "./run-mode";

describe("resolveRunMode", () => {
	it("defaults to mock inside the test runner and honors only the test override", () => {
		expect(resolveRunMode({ VITEST: "true", AI_RUN_MODE: "live" })).toBe("mock");
		expect(resolveRunMode({ VITEST: "true", AI_RUN_MODE: "live", AI_TEST_RUN_MODE: "local" })).toBe(
			"local",
		);
	});

	it("defaults to local outside the test runner and honors the application override", () => {
		expect(resolveRunMode({})).toBe("local");
		expect(resolveRunMode({ AI_RUN_MODE: "live", AI_TEST_RUN_MODE: "mock" })).toBe("live");
	});

	it("treats empty run-mode values as unset", () => {
		expect(resolveRunMode({ AI_RUN_MODE: "" })).toBe("local");
		expect(resolveRunMode({ VITEST: "true", AI_TEST_RUN_MODE: "" })).toBe("mock");
	});

	it("rejects invalid selected run modes", () => {
		expect(() => resolveRunMode({ AI_RUN_MODE: "invalid" })).toThrow();
		expect(() => resolveRunMode({ VITEST: "true", AI_TEST_RUN_MODE: "invalid" })).toThrow();
	});
});
