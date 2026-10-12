import { runIfMain } from "../lib/cli.mjs";

function collectTests(node, tests = []) {
	for (const spec of node.specs ?? []) {
		for (const test of spec.tests ?? []) tests.push(test);
	}
	for (const child of node.suites ?? []) collectTests(child, tests);
	return tests;
}

/** Tests that ran: everything except those Playwright reports as skipped. */
function summarise(report) {
	if (!Array.isArray(report?.suites)) {
		throw new Error("Playwright JSON report has no suites array");
	}
	const byProject = new Map();
	for (const test of collectTests({ suites: report.suites })) {
		const project = test.projectName ?? "(none)";
		const entry = byProject.get(project) ?? { executed: 0, skipped: 0 };
		if (test.status === "skipped") entry.skipped += 1;
		else entry.executed += 1;
		byProject.set(project, entry);
	}
	return byProject;
}

/**
 * Fails on a Playwright result that proves nothing: no tests collected, every test skipped, or a
 * required project (engine) that ran nothing. Returns a one-line summary otherwise.
 */
export function evaluatePlaywrightReport(text, { requiredProjects = [] } = {}) {
	const start = text.indexOf("{");
	if (start === -1) throw new Error("Playwright output did not contain a JSON report");
	const byProject = summarise(JSON.parse(text.slice(start)));

	let executed = 0;
	let skipped = 0;
	for (const entry of byProject.values()) {
		executed += entry.executed;
		skipped += entry.skipped;
	}
	if (executed + skipped === 0) throw new Error("Playwright collected 0 tests");
	if (executed === 0) throw new Error(`Playwright skipped all ${skipped} tests`);
	for (const project of requiredProjects) {
		if ((byProject.get(project)?.executed ?? 0) === 0) {
			throw new Error(`Playwright project "${project}" executed 0 tests`);
		}
	}
	const projects = [...byProject].map(([name, entry]) => `${name}=${entry.executed}`).join(" ");
	return `Playwright: executed=${executed} skipped=${skipped} (${projects})`;
}

export function main({ argv, readStdin, stdout, stderr }) {
	try {
		const flag = argv.indexOf("--projects");
		const requiredProjects =
			flag === -1 ? [] : (argv[flag + 1] ?? "").split(",").filter((name) => name !== "");
		if (flag !== -1 && requiredProjects.length === 0) {
			throw new Error("--projects needs a comma-separated list");
		}
		stdout.write(`${evaluatePlaywrightReport(readStdin(), { requiredProjects })}\n`);
		return 0;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		stderr.write(`assert-playwright-nonempty: ${message}\n`);
		return 1;
	}
}

await runIfMain(import.meta.url, main);
