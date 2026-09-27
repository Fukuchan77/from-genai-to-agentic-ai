import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { checkRepoRules, parseArgs } from "./check-repo-rules.mjs";

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

async function expectViolation(rule, files, message) {
	const root = await fixture(files);
	await expect(run(root, rule)).rejects.toThrow(message);
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
		["no-dynamic-eval", { "scripts/unsafe.mjs": "const result = eval(source);\n" }, "eval"],
		[
			"tool-risk-declared",
			{ "packages/ai-core/src/aci/tool.ts": "defineAciTool({ description: 'safe' });\n" },
			"risk",
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
			"risk",
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
				"const pattern = /new ToolLoopAgent\\(.*\\)/;",
				"export { text, template, pattern };",
			].join("\n"),
		});
		await expect(run(root, "no-dynamic-eval")).resolves.toBeDefined();
		await expect(run(root, "guarded-agent-only")).resolves.toBeDefined();
		await expect(run(root, "no-sensitive-logging")).resolves.toBeDefined();
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
