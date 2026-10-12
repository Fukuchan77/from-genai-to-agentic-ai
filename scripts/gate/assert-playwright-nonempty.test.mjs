import { describe, expect, it } from "vitest";

import { memoryIo } from "../lib/memory-io.mjs";
import { evaluatePlaywrightReport, main } from "./assert-playwright-nonempty.mjs";

function test(projectName, status) {
	return { projectName, status, results: [] };
}

function report(...tests) {
	return JSON.stringify({
		suites: [{ title: "a.spec.ts", specs: [], suites: [{ title: "group", specs: [{ tests }] }] }],
	});
}

describe("assert-playwright-nonempty", () => {
	it("summarises executed and skipped tests per project, including nested suites", () => {
		const text = report(
			test("chromium", "expected"),
			test("firefox", "unexpected"),
			test("firefox", "skipped"),
		);

		expect(evaluatePlaywrightReport(text)).toBe(
			"Playwright: executed=2 skipped=1 (chromium=1 firefox=1)",
		);
	});

	it("ignores text before the JSON (reporter banners)", () => {
		expect(
			evaluatePlaywrightReport(`Running 1 test\n${report(test("chromium", "expected"))}`),
		).toContain("executed=1");
	});

	it("fails when no test was collected", () => {
		expect(() => evaluatePlaywrightReport(JSON.stringify({ suites: [] }))).toThrowError(
			"Playwright collected 0 tests",
		);
	});

	it("fails when every test was skipped", () => {
		const text = report(test("chromium", "skipped"), test("webkit", "skipped"));

		expect(() => evaluatePlaywrightReport(text)).toThrowError("Playwright skipped all 2 tests");
	});

	it("fails when a required project executed nothing", () => {
		const text = report(test("chromium", "expected"), test("webkit", "skipped"));

		expect(() =>
			evaluatePlaywrightReport(text, { requiredProjects: ["chromium", "webkit"] }),
		).toThrowError('Playwright project "webkit" executed 0 tests');
		expect(() => evaluatePlaywrightReport(text, { requiredProjects: ["firefox"] })).toThrowError(
			'Playwright project "firefox" executed 0 tests',
		);
	});

	it("rejects text without a JSON report or without suites", () => {
		expect(() => evaluatePlaywrightReport("nothing here")).toThrowError(
			"did not contain a JSON report",
		);
		expect(() => evaluatePlaywrightReport("{}")).toThrowError("no suites array");
	});

	it("main reads stdin, honours --projects, and reports failures on stderr with exit 1", () => {
		const ok = memoryIo({
			argv: ["--projects", "chromium,firefox"],
			stdin: report(test("chromium", "expected"), test("firefox", "expected")),
		});
		expect(main(ok)).toBe(0);
		expect(ok.stdoutText()).toBe("Playwright: executed=2 skipped=0 (chromium=1 firefox=1)\n");

		const empty = memoryIo({ stdin: JSON.stringify({ suites: [] }) });
		expect(main(empty)).toBe(1);
		expect(empty.stderrText()).toBe("assert-playwright-nonempty: Playwright collected 0 tests\n");

		const missingList = memoryIo({
			argv: ["--projects"],
			stdin: report(test("chromium", "expected")),
		});
		expect(main(missingList)).toBe(1);
		expect(missingList.stderrText()).toContain("--projects needs");
	});
});
