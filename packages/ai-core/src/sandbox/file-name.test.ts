import { describe, expect, it } from "vitest";
import { PlatformError } from "../errors";
import { assertSandboxFileName } from "./file-name";

describe("assertSandboxFileName", () => {
	it.each(["data.csv", "売上.xlsx", "a", "report-2026_01.xls", ".hidden"])("accepts %s", (name) => {
		expect(() => assertSandboxFileName(name)).not.toThrow();
	});

	it("accepts a name of exactly 100 bytes, counting UTF-8 bytes rather than characters", () => {
		expect(() => assertSandboxFileName("a".repeat(100))).not.toThrow();
		expect(() => assertSandboxFileName(`${"あ".repeat(33)}a`)).not.toThrow();
		expect(() => assertSandboxFileName("あ".repeat(34))).toThrow(PlatformError);
	});

	it.each([
		["", "empty"],
		[".", "the current directory"],
		["..", "the parent directory"],
		["dir/data.csv", "a relative path"],
		["/work/data.csv", "an absolute path"],
		["..\\data.csv", "a backslash path"],
		["a\0b", "a NUL byte"],
		["a".repeat(101), "a name over 100 bytes"],
	])("rejects %s (%s) with invalid-request", (name) => {
		expect(() => assertSandboxFileName(name)).toThrow(PlatformError);
		try {
			assertSandboxFileName(name);
		} catch (error) {
			expect((error as PlatformError).code).toBe("invalid-request");
		}
	});
});
