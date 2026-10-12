import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { inspectBundle, main, secretEnvNames } from "./check-client-bundle.mjs";
import { memoryIo } from "./lib/memory-io.mjs";

const SCHEMA = `
const schema = z.object({
	ANTHROPIC_API_KEY: optionalString,
	LANGFUSE_PUBLIC_KEY: optionalString,
	LANGFUSE_SECRET_KEY: optionalString,
	POSTGRES_PASSWORD: optionalString,
	AGENT_MAX_STEPS: positiveInteger(8),
	OLLAMA_BASE_URL: z.string(),
});
`;

let root;
let bundle;

beforeEach(() => {
	root = mkdtempSync(path.join(tmpdir(), "client-bundle-"));
	bundle = path.join(root, "static");
	mkdirSync(path.join(bundle, "chunks"), { recursive: true });
	writeFileSync(path.join(root, "env-schema.ts"), SCHEMA);
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

function io(argv) {
	return memoryIo({
		argv: ["--dir", bundle, "--schema", path.join(root, "env-schema.ts"), ...argv],
		cwd: root,
	});
}

describe("secretEnvNames", () => {
	it("keeps secret-looking names and drops public and ordinary settings", () => {
		expect(secretEnvNames(SCHEMA)).toEqual([
			"ANTHROPIC_API_KEY",
			"LANGFUSE_SECRET_KEY",
			"POSTGRES_PASSWORD",
		]);
	});
});

describe("check-client-bundle", () => {
	it("passes a bundle with no secret names or values and reports the scan size", () => {
		writeFileSync(path.join(bundle, "chunks", "app.js"), "console.log('hello')");
		const run = io(["--sentinel", "changeme-sentinel-1"]);

		expect(main(run)).toBe(0);
		expect(run.stdoutText()).toBe("Client bundle: scanned 1 files for 3 names and 1 sentinels\n");
	});

	it("detects a secret variable name in any nested file", () => {
		writeFileSync(path.join(bundle, "chunks", "app.js"), "process.env.ANTHROPIC_API_KEY");
		const run = io([]);

		expect(main(run)).toBe(1);
		expect(run.stderrText()).toContain("chunks/app.js: variable name ANTHROPIC_API_KEY");
	});

	it("detects a sentinel secret value without echoing the value", () => {
		writeFileSync(path.join(bundle, "page.js"), 'const k = "changeme-sentinel-1";');
		const run = io(["--sentinel", "changeme-sentinel-1"]);

		expect(main(run)).toBe(1);
		expect(run.stderrText()).toContain("page.js: sentinel value #1");
		expect(run.stderrText()).not.toContain("changeme-sentinel-1");
	});

	it("fails when the directory holds no files, so a wrong path cannot pass", () => {
		expect(() => inspectBundle({ directory: bundle, names: ["X"], sentinels: [] })).toThrowError(
			"scanned 0 files",
		);
		const run = io([]);

		expect(main(run)).toBe(1);
		expect(run.stderrText()).toContain("scanned 0 files");
	});

	it("rejects unknown options, missing values, and a schema without secret names", () => {
		const unknown = io(["--bogus", "x"]);
		expect(main(unknown)).toBe(1);
		expect(unknown.stderrText()).toContain("unknown option --bogus");

		const missing = io(["--sentinel"]);
		expect(main(missing)).toBe(1);
		expect(missing.stderrText()).toContain("--sentinel needs a value");

		writeFileSync(path.join(root, "env-schema.ts"), "const schema = z.object({ A_B: x });");
		writeFileSync(path.join(bundle, "a.js"), "x");
		const empty = io([]);
		expect(main(empty)).toBe(1);
		expect(empty.stderrText()).toContain("no secret variable names");
	});
});
