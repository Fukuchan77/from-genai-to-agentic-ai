import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkModelIds } from "./check-model-ids.mjs";

const temporaryRoots = [];

function createRoot() {
	const root = mkdtempSync(join(tmpdir(), "check-model-ids-"));
	temporaryRoots.push(root);
	return root;
}

function writeFixture(root, relativePath, content) {
	const filePath = join(root, relativePath);
	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(filePath, content);
}

afterEach(() => {
	for (const root of temporaryRoots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe("checkModelIds", () => {
	it("scans every declared source and documentation location in deterministic order", () => {
		const root = createRoot();
		writeFixture(root, "apps/web/chat.ts", 'const model = "gpt-5";\n');
		writeFixture(root, "packages/ai-core/view.tsx", "const model = 'claude-sonnet';\n");
		writeFixture(root, "scripts/helper.mjs", "const model = `gemini-2.5-pro`;\n");
		writeFixture(root, "tooling/check.ts", 'const model = "llama3.2";\n');
		writeFixture(root, "docs/guide.md", "Use qwen3 for this example.\n");
		writeFixture(root, "README.md", "Do not hard-code mistral-small.\n");

		const result = checkModelIds(root);

		expect(result.scannedFiles).toBe(6);
		expect(result.violations).toEqual([
			{ file: "README.md", line: 1, modelId: "mistral-small" },
			{ file: "apps/web/chat.ts", line: 1, modelId: "gpt-5" },
			{ file: "docs/guide.md", line: 1, modelId: "qwen3" },
			{ file: "packages/ai-core/view.tsx", line: 1, modelId: "claude-sonnet" },
			{ file: "scripts/helper.mjs", line: 1, modelId: "gemini-2.5-pro" },
			{ file: "tooling/check.ts", line: 1, modelId: "llama3.2" },
		]);
	});

	it("allows catalog literals, env schema defaults, and the checker files", () => {
		const root = createRoot();
		writeFixture(root, "apps/web/clean.ts", 'const purpose = "chat";\n');
		writeFixture(root, "packages/ai-core/src/models/catalog.ts", 'const id = "gpt-5";\n');
		writeFixture(
			root,
			"packages/ai-core/src/config/env-schema.ts",
			'const schema = z.string().default("claude-sonnet");\n',
		);
		writeFixture(root, "scripts/check-model-ids.mjs", 'const sample = "gemini-2.5-pro";\n');
		writeFixture(root, "scripts/check-model-ids.test.mjs", 'const sample = "llama3.2";\n');
		writeFixture(root, "packages/ai-core/fixtures/cassette.json", '{"modelId":"qwen3"}\n');

		expect(checkModelIds(root)).toEqual({ scannedFiles: 2, violations: [] });
	});

	it("rejects model literals in env-schema.ts when they are not defaults", () => {
		const root = createRoot();
		writeFixture(
			root,
			"packages/ai-core/src/config/env-schema.ts",
			['const schema = z.string().default("gpt-5");', 'const hardCoded = "claude-sonnet";'].join(
				"\n",
			),
		);

		expect(checkModelIds(root).violations).toEqual([
			{
				file: "packages/ai-core/src/config/env-schema.ts",
				line: 2,
				modelId: "claude-sonnet",
			},
		]);
	});

	it("does not treat comments as string literals", () => {
		const root = createRoot();
		writeFixture(
			root,
			"apps/web/comments.ts",
			['// "gpt-5" is documentation.', '/* Use "claude-sonnet" only in the catalog. */'].join("\n"),
		);

		expect(checkModelIds(root)).toEqual({ scannedFiles: 1, violations: [] });
	});

	it("fails when no eligible files are scanned", () => {
		const root = createRoot();
		writeFixture(root, "scripts/check-model-ids.mjs", 'const sample = "gpt-5";\n');
		writeFixture(root, "packages/ai-core/src/models/catalog.ts", 'const id = "gpt-5";\n');
		writeFixture(root, "packages/ai-core/fixtures/cassette.json", '{"modelId":"gpt-5"}\n');

		expect(() => checkModelIds(root)).toThrowError("Model ID check scanned 0 files.");
	});
});
