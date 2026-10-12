import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { verifyOrWriteFixture } from "./generate-sse-fixtures.mjs";

let directory;

beforeEach(() => {
	directory = mkdtempSync(path.join(tmpdir(), "sse-fixtures-"));
});

afterEach(() => {
	rmSync(directory, { recursive: true, force: true });
});

describe("verifyOrWriteFixture", () => {
	it("writes the stream in write mode, creating the directory", () => {
		const nested = path.join(directory, "a", "b");

		expect(verifyOrWriteFixture("x.sse", "data: 1\n\n", { write: true, directory: nested })).toBe(
			"written",
		);
		expect(readFileSync(path.join(nested, "x.sse"), "utf8")).toBe("data: 1\n\n");
	});

	it("accepts an identical stream", () => {
		writeFileSync(path.join(directory, "x.sse"), "data: 1\n\n");

		expect(verifyOrWriteFixture("x.sse", "data: 1\n\n", { write: false, directory })).toBe("match");
	});

	it("fails on a stale stream and names the first differing line", () => {
		writeFileSync(path.join(directory, "x.sse"), "data: 1\n\ndata: 2\n\n");

		expect(() =>
			verifyOrWriteFixture("x.sse", "data: 1\n\ndata: 3\n\n", { write: false, directory }),
		).toThrowError(/stale \(line 3: expected "data: 2", got "data: 3"\)/u);
	});

	it("fails on a missing fixture and points at the generator", () => {
		expect(() =>
			verifyOrWriteFixture("x.sse", "data: 1\n\n", { write: false, directory }),
		).toThrowError("SSE fixture x.sse is missing; run `mise run e2e:fixtures`");
	});

	it("rejects names without .sse and empty streams, even in write mode", () => {
		expect(() => verifyOrWriteFixture("x.txt", "a", { write: true, directory })).toThrowError(
			"must end with .sse",
		);
		expect(() => verifyOrWriteFixture("x.sse", "", { write: true, directory })).toThrowError(
			"empty stream",
		);
	});
});
