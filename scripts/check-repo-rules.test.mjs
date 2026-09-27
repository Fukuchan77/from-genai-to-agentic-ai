import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { checkRepoRules, main, parseArgs } from "./check-repo-rules.mjs";
import { memoryIo } from "./lib/memory-io.mjs";

const roots = [];

async function fixture(files) {
	const root = await mkdtemp(path.join(tmpdir(), "repo-rules-"));
	roots.push(root);
	for (const [relativePath, content] of Object.entries(files)) {
		const absolutePath = path.join(root, relativePath);
		await mkdir(path.dirname(absolutePath), { recursive: true });
		await writeFile(absolutePath, content, "utf8");
	}
	return root;
}

async function run(root, rule) {
	return checkRepoRules({ root, only: [rule] });
}

// The error message always contains `<rule>: scanned N FILES`, so a bare `toThrow(message)` also
// passes on a zero-scan rejection. Assert on the structured report instead.
async function expectViolation(rule, files, message) {
	const root = await fixture(files);
	const error = await run(root, rule).then(
		() => expect.unreachable(`${rule} accepted the fixture`),
		(rejection) => rejection,
	);
	const [report] = error.result.reports;
	expect(report.rule).toBe(rule);
	expect(report.fileCount).toBeGreaterThan(0);
	expect(report.violations).toEqual(expect.arrayContaining([expect.stringContaining(message)]));
}

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("repository rule violations", () => {
	test.each([
		[
			"no-deprecated-object-api",
			{ "apps/web/src/route.ts": 'import { generateObject } from "ai";\n' },
			"generateObject",
		],
		[
			"guarded-agent-only",
			{ "packages/feature/src/agent.ts": "const agent = new ToolLoopAgent({});\n" },
			"ToolLoopAgent",
		],
		[
			"ai-core-no-ui-deps",
			{
				"packages/ai-core/package.json": '{"dependencies":{"react":"1.0.0"}}\n',
				"packages/ai-core/src/index.ts": "export {};\n",
			},
			"react",
		],
		[
			"no-dynamic-eval",
			{ "scripts/unsafe.mjs": "const result = eval(source);\n" },
			"dynamic eval is forbidden",
		],
		[
			"tool-risk-declared",
			{ "packages/ai-core/src/aci/tool.ts": "defineAciTool({ description: 'safe' });\n" },
			"defineAciTool call must declare risk",
		],
		[
			"actions-pinned",
			{
				".github/workflows/ci.yml":
					"permissions:\n  contents: read\njobs:\n  gate:\n    steps:\n      - uses: actions/checkout@v4\n",
			},
			"40-character commit SHA",
		],
		[
			"frozen-lockfile",
			{
				".github/workflows/ci.yml":
					"permissions:\n  contents: read\njobs:\n  gate:\n    steps:\n      - run: pnpm install\n",
			},
			"frozen lockfile",
		],
		[
			"allow-builds-reasoned",
			{ "pnpm-workspace.yaml": "allowBuilds:\n  esbuild: true\n" },
			"reason comment",
		],
		[
			"no-sensitive-logging",
			{ "apps/web/src/log.ts": "console.info(userPrompt);\n" },
			"userPrompt",
		],
	])("detects %s", async (rule, files, message) => {
		await expectViolation(rule, files, message);
	});

	test("allows the guarded agent constructor only in its declared file", async () => {
		const root = await fixture({
			"packages/ai-core/src/agents/guarded-agent.ts":
				"export const agent = new ToolLoopAgent({});\n",
		});
		await expect(run(root, "guarded-agent-only")).resolves.toMatchObject({
			reports: [{ fileCount: 1, rule: "guarded-agent-only" }],
		});
	});

	test("requires risk to be a top-level defineAciTool option", async () => {
		await expectViolation(
			"tool-risk-declared",
			{
				"packages/ai-core/src/aci/tool.ts": 'defineAciTool({ metadata: { risk: "read-only" } });\n',
			},
			"defineAciTool call must declare risk",
		);
	});

	test("checks ai-core source imports as well as package dependencies", async () => {
		await expectViolation(
			"ai-core-no-ui-deps",
			{
				"packages/ai-core/package.json": '{"dependencies":{}}\n',
				"packages/ai-core/src/server.ts": 'import "next/server";\n',
			},
			"next/server",
		);
	});

	test("requires permissions for every job when workflow permissions are absent", async () => {
		await expectViolation(
			"actions-pinned",
			{
				".github/workflows/ci.yml":
					"jobs:\n  safe:\n    permissions:\n      contents: read\n    steps: []\n  unsafe:\n    steps: []\n",
			},
			"unsafe",
		);
	});
});

describe("scan semantics", () => {
	test("ignores matches in strings, template contents, comments, and regex literals", async () => {
		const root = await fixture({
			"apps/web/src/safe.ts": [
				'const text = "eval(source) new ToolLoopAgent generateObject console.log(userPrompt)";',
				"const template = `new Function(source) $" + "{safeValue}`;",
				"// eval(source)",
				"/* console.log(messages) */",
				// After `;` a `/` lexes as a regex, which would hide a broken block-comment scan; a
				// multi-line comment and one after an operand exercise the comment path itself.
				"/*",
				"console.log(messages)",
				"*/",
				"const total = 1 /* eval(source) */;",
				"const pattern = /new ToolLoopAgent\\(.*\\)/;",
				"export { text, template, pattern, total };",
			].join("\n"),
		});
		for (const rule of ["no-dynamic-eval", "guarded-agent-only", "no-sensitive-logging"]) {
			await expect(run(root, rule)).resolves.toMatchObject({
				reports: [{ rule, fileCount: 1, violations: [] }],
			});
		}
	});

	test("excludes the checker and its test from every code scan", async () => {
		const root = await fixture({
			"scripts/check-repo-rules.mjs": "eval(source);\n",
			"scripts/check-repo-rules.test.mjs": "eval(source);\n",
			"scripts/safe.mjs": "export {};\n",
		});
		await expect(run(root, "no-dynamic-eval")).resolves.toMatchObject({
			reports: [{ fileCount: 1 }],
		});
	});

	test("uses exact scan targets and excludes out-of-scope extensions", async () => {
		const root = await fixture({
			"docs/unsafe.ts": "eval(source);\n",
			"apps/web/src/safe.ts": "export {};\n",
			"apps/web/src/ignored.js": "eval(source);\n",
		});
		await expect(run(root, "no-dynamic-eval")).resolves.toMatchObject({
			reports: [{ fileCount: 1 }],
		});
	});

	test("fails a selected rule when it scans zero files", async () => {
		const root = await fixture({ "README.md": "empty target\n" });
		await expect(run(root, "tool-risk-declared")).rejects.toThrow(
			"tool-risk-declared: scanned 0 FILES",
		);
	});

	test("prints the scanned FILE count for each selected rule", async () => {
		const root = await fixture({
			"apps/web/src/a.ts": "export {};\n",
			"packages/example/src/b.tsx": "export const B = () => null;\n",
		});
		const result = await run(root, "no-sensitive-logging");
		expect(result.output).toContain("no-sensitive-logging: scanned 2 FILES");
	});

	test("limits execution with --only and accepts comma-separated rules", async () => {
		expect(parseArgs(["--only", "no-dynamic-eval,actions-pinned"])).toEqual({
			only: ["no-dynamic-eval", "actions-pinned"],
		});
		const root = await fixture({ "scripts/safe.mjs": "export {};\n" });
		await expect(
			checkRepoRules({ root, only: parseArgs(["--only", "no-dynamic-eval"]).only }),
		).resolves.toMatchObject({ reports: [{ rule: "no-dynamic-eval" }] });
	});
});

const SHA = "3d3c42e5aac5ba805825da76410c181273ba90b1";
const FROZEN_MISE =
	'[tasks.setup]\nrun = [\n  "pnpm install --frozen-lockfile",\n  "git config core.hooksPath .githooks",\n]\n';

function workflow(run) {
	return `permissions:\n  contents: read\njobs:\n  gate:\n    steps:\n      - uses: actions/checkout@${SHA}\n      - run: ${run}\n`;
}

describe("no-dynamic-eval (H-6)", () => {
	test.each([
		["new Function", "const run = new Function(src);\n", "new Function is forbidden"],
		["Function call", "const run = Function(src);\n", "Function constructor is forbidden"],
		[
			"named node:child_process import",
			'import { exec } from "node:child_process";\n',
			"node:child_process import is forbidden",
		],
		["default child_process import", 'import cp from "child_process";\n', "child_process import"],
		[
			"dynamic node:child_process import",
			'const cp = await import("node:child_process");\n',
			"node:child_process import is forbidden",
		],
		[
			"require of child_process",
			'const cp = require("child_process");\n',
			"child_process import is forbidden",
		],
		[
			"re-export from node:child_process",
			'export { exec } from "node:child_process";\n',
			"node:child_process import is forbidden",
		],
	])("detects %s", async (_name, source, message) => {
		await expectViolation("no-dynamic-eval", { "scripts/unsafe.mjs": source }, message);
	});
});

describe("frozen-lockfile (M-2)", () => {
	test.each([
		["unfrozen pnpm install", "pnpm install"],
		["pnpm i", "pnpm i"],
		["recursive pnpm install", "pnpm -r install"],
		["explicitly disabled frozen lockfile", "pnpm install --frozen-lockfile=false"],
		["negated frozen lockfile", "pnpm install --no-frozen-lockfile"],
		["frozen lockfile overridden later", "pnpm install --frozen-lockfile --no-frozen-lockfile"],
		["npm install", "npm install"],
		["npm i", "npm i"],
		["npm ci", "npm ci"],
		["bare yarn", "yarn"],
		["yarn install", "yarn install --immutable"],
		["bun install", "bun install"],
		["chained install", "mise run setup && pnpm install"],
		["block scalar install", "|\n          echo start\n          pnpm install"],
	])("rejects %s in a workflow", async (_name, run) => {
		await expectViolation(
			"frozen-lockfile",
			{ ".github/workflows/ci.yml": workflow(run), "mise.toml": FROZEN_MISE },
			"frozen lockfile",
		);
	});

	test("rejects unfrozen installs in .yaml workflows", async () => {
		await expectViolation(
			"frozen-lockfile",
			{ ".github/workflows/deploy.yaml": workflow("npm ci"), "mise.toml": FROZEN_MISE },
			"deploy.yaml",
		);
	});

	test("accepts mise run setup and frozen pnpm installs and scans workflows plus mise.toml", async () => {
		const root = await fixture({
			".github/workflows/ci.yml": workflow("mise run setup"),
			".github/workflows/release.yaml": workflow("pnpm install --frozen-lockfile"),
			"mise.toml": FROZEN_MISE,
		});
		await expect(run(root, "frozen-lockfile")).resolves.toMatchObject({
			reports: [{ fileCount: 3, violations: [] }],
		});
	});

	test("ignores install words outside run steps", async () => {
		const root = await fixture({
			".github/workflows/ci.yml":
				"permissions:\n  contents: read\njobs:\n  gate:\n    steps:\n      - name: pnpm install via mise\n        run: mise run setup\n",
			"mise.toml": FROZEN_MISE,
		});
		await expect(run(root, "frozen-lockfile")).resolves.toBeDefined();
	});

	test.each([
		["missing setup task", '[tasks.gate]\nrun = "pnpm install --frozen-lockfile"\n', "setup task"],
		["unfrozen setup task", '[tasks.setup]\nrun = "pnpm install"\n', "frozen lockfile"],
		[
			"setup task without an install",
			'[tasks.setup]\nrun = "git config core.hooksPath .githooks"\n',
			"setup task",
		],
		[
			"setup task that disables the frozen lockfile",
			'[tasks.setup]\nrun = ["pnpm install --frozen-lockfile=false"]\n',
			"frozen lockfile",
		],
	])("rejects mise.toml with %s", async (_name, mise, message) => {
		await expectViolation(
			"frozen-lockfile",
			{ ".github/workflows/ci.yml": workflow("mise run setup"), "mise.toml": mise },
			message,
		);
	});

	test("rejects a repository whose mise.toml is missing", async () => {
		await expectViolation(
			"frozen-lockfile",
			{ ".github/workflows/ci.yml": workflow("mise run setup") },
			"mise.toml",
		);
	});
});

describe("actions-pinned (M-3)", () => {
	test.each([
		[
			"workflow-level write-all",
			`permissions: write-all\njobs:\n  gate:\n    steps:\n      - uses: actions/checkout@${SHA}\n`,
			"write-all",
		],
		[
			"a workflow-level write scope",
			`permissions:\n  contents: write\njobs:\n  gate:\n    steps:\n      - uses: actions/checkout@${SHA}\n`,
			"contents: write",
		],
		[
			"a job-level write scope",
			`jobs:\n  gate:\n    permissions:\n      contents: read\n      pull-requests: write\n    steps:\n      - uses: actions/checkout@${SHA}\n`,
			"pull-requests: write",
		],
		[
			"a job-level write-all",
			`jobs:\n  gate:\n    permissions: "write-all"\n    steps: []\n`,
			"write-all",
		],
		[
			"a flow-style write scope",
			`permissions: { contents: write }\njobs:\n  gate:\n    steps: []\n`,
			"contents: write",
		],
	])("rejects %s", async (_name, source, message) => {
		await expectViolation("actions-pinned", { ".github/workflows/ci.yml": source }, message);
	});

	test("rejects an unpinned uses in a .yaml workflow", async () => {
		await expectViolation(
			"actions-pinned",
			{
				".github/workflows/deploy.yaml":
					"permissions:\n  contents: read\njobs:\n  deploy:\n    steps:\n      - uses: actions/checkout@v4\n",
			},
			"deploy.yaml:6: uses must pin a 40-character commit SHA",
		);
	});

	test("accepts read-only permissions with pinned actions", async () => {
		const root = await fixture({
			".github/workflows/ci.yml": `permissions:\n  contents: read\njobs:\n  gate:\n    steps:\n      - uses: actions/checkout@${SHA} # v7\n`,
			".github/workflows/nightly.yaml": `jobs:\n  gate:\n    permissions:\n      contents: read\n    steps:\n      - uses: actions/checkout@${SHA}\n`,
		});
		await expect(run(root, "actions-pinned")).resolves.toMatchObject({
			reports: [{ fileCount: 2, violations: [] }],
		});
	});
});

describe("lexer (M-5)", () => {
	test("scans code inside template substitutions", async () => {
		await expectViolation(
			"no-dynamic-eval",
			{ "scripts/unsafe.mjs": "const value = `$" + "{eval(src)}`;\n" },
			"dynamic eval is forbidden",
		);
	});

	test("scans identifiers in template substitutions passed to a logger", async () => {
		await expectViolation(
			"no-sensitive-logging",
			{ "apps/web/src/log.ts": "console.log(`p=$" + "{prompt}`);\n" },
			"sensitive identifier prompt",
		);
	});

	test("scans nested templates and object literals inside substitutions", async () => {
		await expectViolation(
			"no-dynamic-eval",
			{
				"scripts/unsafe.mjs":
					"const value = `a $" +
					"{`b $" +
					"{ { k: 1 }.k } c`} d $" +
					"{eval(src)}`;\nconst safe = `}`;\n",
			},
			"scripts/unsafe.mjs:1: dynamic eval is forbidden",
		);
	});

	test.each([
		["after +", 'const ok = x + /"/.test(y);\n'],
		["after ===", 'const ok = x === /"/.test(y);\n'],
		["after ??", 'const ok = x ?? /"/.test(y);\n'],
		["after typeof", 'const ok = typeof /"/;\n'],
		["after }", 'if (x) {} /"/.test(y);\n'],
	])("recognizes a regex literal %s", async (_name, source) => {
		await expectViolation(
			"no-dynamic-eval",
			// Same line on purpose: a misread regex opens a string that swallows the import.
			{ "scripts/unsafe.mjs": `${source.trimEnd()} import cp from "node:child_process";\n` },
			"node:child_process import is forbidden",
		);
	});

	test("keeps division after identifiers, closing parentheses, and postfix operators", async () => {
		const root = await fixture({
			"scripts/safe.mjs": [
				"const a = total / count / 2;",
				"const b = (a + 1) / 2;",
				"let c = 0;",
				"c++ / 2;",
				'const d = "eval(source)";',
				"export { a, b, c, d };",
			].join("\n"),
		});
		await expect(run(root, "no-dynamic-eval")).resolves.toBeDefined();
	});
});

describe("no-sensitive-logging (M-6)", () => {
	test.each([
		"prompt",
		"messages",
		"input",
		"apiKey",
		"userPrompt",
		"toolInput",
		"api_key",
		"OPENAI_API_KEY",
		"promptText",
	])("flags %s", async (identifier) => {
		await expectViolation(
			"no-sensitive-logging",
			{ "apps/web/src/log.ts": `console.info(${identifier});\n` },
			`sensitive identifier ${identifier}`,
		);
	});

	test("allows numeric metadata such as token counts and schema names", async () => {
		const root = await fixture({
			"apps/web/src/log.ts": [
				"console.info(usage.inputTokens, usage.promptTokens);",
				"logger.debug(inputSchema, messagesCount, promptTokenCount);",
				"console.error(error.message);",
			].join("\n"),
		});
		await expect(run(root, "no-sensitive-logging")).resolves.toBeDefined();
	});

	test("allows a count property of a sensitive value (review N-6)", async () => {
		const root = await fixture({
			"apps/web/src/log.ts": "console.info(messages.length, prompt?.length, inputs.size);\n",
		});
		await expect(run(root, "no-sensitive-logging")).resolves.toBeDefined();
	});

	test.each([
		["messages.map((message) => message.text)", "messages"],
		["messages[0]", "messages"],
		["prompt.text", "prompt"],
	])("still flags %s", async (argument, identifier) => {
		await expectViolation(
			"no-sensitive-logging",
			{ "apps/web/src/log.ts": `console.info(${argument});\n` },
			`sensitive identifier ${identifier}`,
		);
	});
});

describe("W2/W3 rule evasions (M-13)", () => {
	test.each([
		["namespace import", 'import * as ai from "ai";\nai.generateObject({});\n', "generateObject"],
		[
			"optional namespace access",
			'import * as sdk from "ai";\nsdk?.streamObject({});\n',
			"streamObject",
		],
		[
			"aliased named import",
			'import { generateObject as g } from "ai";\ng({});\n',
			"generateObject",
		],
		[
			"dynamic import",
			'const { streamObject } = await import("ai");\nstreamObject({});\n',
			"streamObject",
		],
	])("no-deprecated-object-api detects %s", async (_name, source, message) => {
		await expectViolation("no-deprecated-object-api", { "apps/web/src/route.ts": source }, message);
	});

	test("no-deprecated-object-api ignores unrelated generateObject helpers", async () => {
		const root = await fixture({
			"apps/web/src/route.ts":
				'import { streamText } from "ai";\nimport * as local from "./local";\nlocal.generateObject();\n',
		});
		await expect(run(root, "no-deprecated-object-api")).resolves.toBeDefined();
	});

	test.each([
		["aliased import", 'import { ToolLoopAgent as A } from "ai";\nconst agent = new A({});\n'],
		["namespace import", 'import * as ai from "ai";\nconst agent = new ai.ToolLoopAgent({});\n'],
	])("guarded-agent-only detects %s", async (_name, source) => {
		await expectViolation(
			"guarded-agent-only",
			{ "packages/feature/src/agent.ts": source },
			"ToolLoopAgent must be guarded",
		);
	});

	test("tool-risk-declared checks calls with type arguments", async () => {
		await expectViolation(
			"tool-risk-declared",
			{
				"packages/ai-core/src/aci/tool.ts":
					"defineAciTool<Input, Output<Map<string, number>>>({ description: 'x' });\n",
			},
			"defineAciTool call must declare risk",
		);
	});

	test("tool-risk-declared accepts explicit, shorthand, and generic declarations", async () => {
		const root = await fixture({
			"packages/ai-core/src/aci/tool.ts": [
				'defineAciTool({ description: "a", risk: "read-only" });',
				'defineAciTool({ risk, description: "b" });',
				'defineAciTool({ description: "c", risk });',
				'defineAciTool<Input, Output<Map<string, number>>>({ risk: "write" });',
			].join("\n"),
		});
		await expect(run(root, "tool-risk-declared")).resolves.toMatchObject({
			reports: [{ violations: [] }],
		});
	});
});

describe("--only parsing (L-1)", () => {
	test.each([[[","]], [[" , "]], [[""]]])("rejects an empty selection %j", (values) => {
		expect(() => parseArgs(["--only", ...values])).toThrow("Usage");
	});

	test("rejects unknown rule names", () => {
		expect(() => parseArgs(["--only", "no-dynamic-eval,nope"])).toThrow("Unknown repository rule");
	});

	test("rejects an empty rule list passed to checkRepoRules", async () => {
		const root = await fixture({ "scripts/safe.mjs": "export {};\n" });
		await expect(checkRepoRules({ root, only: [] })).rejects.toThrow("No repository rules");
	});
});

describe("allow-builds-reasoned (L-3)", () => {
	test.each([
		["flow mapping", "allowBuilds: { esbuild: true }\n"],
		["flow sequence", "allowBuilds: [esbuild]\n"],
		["block sequence", "allowBuilds:\n  # reason\n  - esbuild\n"],
		["nested mapping", "allowBuilds:\n  # reason\n  esbuild:\n    enabled: true\n"],
		[
			"mixed indentation",
			"allowBuilds:\n  # reason\n  esbuild: true\n    # reason\n    sharp: true\n",
		],
	])("rejects the unsupported %s format", async (_name, source) => {
		await expectViolation(
			"allow-builds-reasoned",
			{ "pnpm-workspace.yaml": source },
			"unsupported allowBuilds format",
		);
	});

	test("parses four-space block entries", async () => {
		await expectViolation(
			"allow-builds-reasoned",
			{
				"pnpm-workspace.yaml":
					"allowBuilds:\n    # esbuild ships a native binary.\n    esbuild: true\n    sharp: true\n",
			},
			"pnpm-workspace.yaml:4: allowBuilds entry needs an immediate reason comment",
		);
	});

	test("accepts reasoned block entries at any consistent indentation", async () => {
		const root = await fixture({
			"pnpm-workspace.yaml":
				'packages:\n  - "apps/*"\nallowBuilds:\n    # esbuild ships a native binary.\n    esbuild: true\n    # Biome needs no lifecycle script.\n    "@biomejs/biome": false\noverrides: {}\n',
		});
		await expect(run(root, "allow-builds-reasoned")).resolves.toBeDefined();
	});
});

describe("generated directories (L-4)", () => {
	test("skips generated directories during the walk", async () => {
		const root = await fixture({
			"apps/web/.next/x.ts": "eval(source);\n",
			"packages/x/dist/y.ts": "eval(source);\n",
			"packages/x/node_modules/z/index.mjs": "eval(source);\n",
			"packages/x/coverage/c.ts": "eval(source);\n",
			"packages/x/src/safe.ts": "export {};\n",
		});
		await expect(run(root, "no-dynamic-eval")).resolves.toMatchObject({
			reports: [{ fileCount: 1, violations: [] }],
		});
	});
});

describe("check-repo-rules CLI", () => {
	test("exits 0 and prints the per-rule scan counts", async () => {
		const root = await fixture({ "scripts/safe.mjs": "export {};\n" });
		const io = memoryIo({ argv: ["--only", "no-dynamic-eval"], cwd: root });

		await expect(main(io)).resolves.toBe(0);
		expect(io.stdoutText()).toBe("no-dynamic-eval: scanned 1 FILES\n");
		expect(io.stderrText()).toBe("");
	});

	test("exits 1 and reports the violation", async () => {
		const root = await fixture({ "scripts/unsafe.mjs": "eval(source);\n" });
		const io = memoryIo({ argv: ["--only", "no-dynamic-eval"], cwd: root });

		await expect(main(io)).resolves.toBe(1);
		expect(io.stdoutText()).toBe("");
		expect(io.stderrText()).toContain("scripts/unsafe.mjs:1: dynamic eval is forbidden");
	});

	test("exits 1 when a selected rule scans zero files", async () => {
		const root = await fixture({ "README.md": "empty\n" });
		const io = memoryIo({ argv: ["--only", "tool-risk-declared"], cwd: root });

		await expect(main(io)).resolves.toBe(1);
		expect(io.stderrText()).toContain("tool-risk-declared: scanned 0 FILES");
	});

	test("exits 1 on invalid arguments", async () => {
		const io = memoryIo({ argv: ["--only"], cwd: await fixture({}) });

		await expect(main(io)).resolves.toBe(1);
		expect(io.stderrText()).toContain("Usage: node scripts/check-repo-rules.mjs");
	});

	test("runs main through runIfMain instead of reading process state itself", () => {
		const source = readFileSync(new URL("check-repo-rules.mjs", import.meta.url), "utf8");

		expect(source).toContain("await runIfMain(import.meta.url, main);");
		expect(source).not.toMatch(/process\.(argv|exitCode)/u);
	});
});
