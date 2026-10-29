import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

describe("the repository's sentinel configuration", () => {
	const repoRoot = path.resolve(import.meta.dirname, "..");
	const schemaSource = readFileSync(
		path.join(repoRoot, "packages/ai-core/src/config/env-schema.ts"),
		"utf8",
	);
	const mise = readFileSync(path.join(repoRoot, "mise.toml"), "utf8");
	const task = mise
		.split(/^\[tasks\./mu)
		.find((block) => block.startsWith('"check:client-bundle"]'));

	it("treats the M3 credentials as secret names", () => {
		const names = secretEnvNames(schemaSource);

		expect(names).toContain("E2B_API_KEY");
		expect(names).toContain("GITHUB_TOKEN");
		// A token budget is an ordinary setting, not a credential.
		expect(names).not.toContain("AGENT_MAX_TOTAL_TOKENS");
	});

	it.each(["ANTHROPIC_API_KEY", "TAVILY_API_KEY", "COHERE_API_KEY", "E2B_API_KEY", "GITHUB_TOKEN"])(
		"sets %s to a sentinel in the environment and passes the same value to --sentinel",
		(name) => {
			expect(task, "check:client-bundle task").toBeDefined();
			const value = new RegExp(`\\b${name} = "([^"]+)"`, "u").exec(task ?? "")?.[1];

			expect(value, `${name} sentinel in env`).toBeDefined();
			expect(task).toContain(`--sentinel ${value}`);
			expect(value).toMatch(/^changeme-/u);
		},
	);

	it("detects each new sentinel value in a bundle without echoing it", () => {
		for (const name of ["E2B_API_KEY", "GITHUB_TOKEN"]) {
			const value = new RegExp(`\\b${name} = "([^"]+)"`, "u").exec(task ?? "")?.[1] ?? "";
			writeFileSync(path.join(bundle, "leak.js"), `const k = "${value}";`);
			const run = io(["--sentinel", value]);

			expect(main(run)).toBe(1);
			expect(run.stderrText()).toContain("leak.js: sentinel value #1");
			expect(run.stderrText()).not.toContain(value);
		}
	});
});
