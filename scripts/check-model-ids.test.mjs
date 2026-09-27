import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkModelIds, MODEL_ID_PREFIXES } from "./check-model-ids.mjs";

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

	it("does not check module specifiers, but still checks other literals in the same file", () => {
		const root = createRoot();
		writeFixture(
			root,
			"packages/ai-core/src/summarize/tokens.ts",
			[
				'import { countTokens } from "gpt-tokenizer";',
				"import 'gpt-tokenizer/side-effect';",
				'export { encode } from "gpt-tokenizer/encoding/o200k_base";',
				'const lazy = await import("gpt-5-helper");',
				'const legacy = require( "claude-sdk-shim" );',
				'const id = "gpt-4o";',
				'const copy = Array.from("gpt-5");',
				'const loaded = reimport("gpt-4.1");',
			].join("\n"),
		);

		expect(checkModelIds(root).violations).toEqual([
			{ file: "packages/ai-core/src/summarize/tokens.ts", line: 6, modelId: "gpt-4o" },
			{ file: "packages/ai-core/src/summarize/tokens.ts", line: 7, modelId: "gpt-5" },
			{ file: "packages/ai-core/src/summarize/tokens.ts", line: 8, modelId: "gpt-4.1" },
		]);
	});

	it("allows exceptions only at their exact repository-relative paths", () => {
		const root = createRoot();
		writeFixture(root, "apps/web/lib/catalog.ts", 'const id = "gpt-5";\n');
		writeFixture(root, "packages/other/src/models/catalog.ts", 'const id = "claude-sonnet";\n');
		writeFixture(
			root,
			"apps/web/lib/env-schema.ts",
			'const schema = z.string().default("gemini-2.5-pro");\n',
		);
		writeFixture(root, "tooling/check-model-ids.mjs", 'const sample = "qwen3";\n');

		expect(checkModelIds(root)).toEqual({
			scannedFiles: 4,
			violations: [
				{ file: "apps/web/lib/catalog.ts", line: 1, modelId: "gpt-5" },
				{ file: "apps/web/lib/env-schema.ts", line: 1, modelId: "gemini-2.5-pro" },
				{ file: "packages/other/src/models/catalog.ts", line: 1, modelId: "claude-sonnet" },
				{ file: "tooling/check-model-ids.mjs", line: 1, modelId: "qwen3" },
			],
		});
	});

	it("exports the detected families, covering the catalog providers and embedding models", () => {
		expect(MODEL_ID_PREFIXES).toEqual(
			expect.arrayContaining([
				"claude-",
				"gpt-",
				"gemini-",
				"llama",
				"qwen",
				"gemma",
				"granite",
				"mistral",
				"phi",
				"command-r",
				"o",
				"text-embedding-",
				"nomic-embed-",
				"mxbai-embed-",
				"embeddinggemma",
			]),
		);
		expect(new Set(MODEL_ID_PREFIXES).size).toBe(MODEL_ID_PREFIXES.length);
	});

	it("detects embedding model IDs", () => {
		const root = createRoot();
		writeFixture(
			root,
			"packages/ai-core/src/rag/embed.ts",
			[
				'const openai = "text-embedding-3-small";',
				'const nomic = "nomic-embed-text";',
				'const gemma = "embeddinggemma:300m";',
				'const mxbai = "mxbai-embed-large";',
			].join("\n"),
		);

		expect(checkModelIds(root).violations.map(({ modelId }) => modelId)).toEqual([
			"text-embedding-3-small",
			"nomic-embed-text",
			"embeddinggemma:300m",
			"mxbai-embed-large",
		]);
	});

	it("requires a model-ID shape for families that are also common words", () => {
		const root = createRoot();
		writeFixture(
			root,
			"docs/prose.md",
			[
				"Our philosophy: run the command-runner before o3lint and foo3 checks.",
				"A llama, granite, a mistral wind, gemma, and qwen are just words here.",
				"We estimate tokens with gpt-tokenizer and ship via @ai-sdk/mistral.",
				"The ollama daemon serves models; phi is a Greek letter.",
			].join("\n"),
		);
		writeFixture(
			root,
			"docs/ids.md",
			[
				"phi3 and phi-4 and phi4-mini",
				"command-r-plus and command-r7b",
				"o3-mini and o4-mini",
				"llama3.2 and llama-guard3",
				"mistral-small and mistral:7b",
				"granite3.3:8b and gemma3:4b and qwen2.5-coder",
				"gpt-oss:20b",
				"o1 and o3 alone",
				"gpt-image-1, gpt-realtime and chatgpt-4o-latest",
			].join("\n"),
		);

		expect(checkModelIds(root).violations).toEqual(
			[
				[1, "phi3"],
				[1, "phi-4"],
				[1, "phi4-mini"],
				[2, "command-r-plus"],
				[2, "command-r7b"],
				[3, "o3-mini"],
				[3, "o4-mini"],
				[4, "llama3.2"],
				[4, "llama-guard3"],
				[5, "mistral-small"],
				[5, "mistral:7b"],
				[6, "granite3.3:8b"],
				[6, "gemma3:4b"],
				[6, "qwen2.5-coder"],
				[7, "gpt-oss:20b"],
				[8, "o1"],
				[8, "o3"],
				[9, "gpt-image-1"],
				[9, "gpt-realtime"],
				[9, "chatgpt-4o-latest"],
			].map(([line, modelId]) => ({ file: "docs/ids.md", line, modelId })),
		);
	});

	it("reports line numbers for violations on many lines", () => {
		const root = createRoot();
		const lines = Array.from({ length: 50 }, (_, index) =>
			index % 10 === 9 ? `const id${index} = "gpt-5";` : `const value${index} = ${index};`,
		);
		writeFixture(root, "apps/web/many.ts", `${lines.join("\r\n")}\r\n`);

		expect(checkModelIds(root).violations.map(({ line }) => line)).toEqual([10, 20, 30, 40, 50]);
	});

	it("skips generated directories entirely", () => {
		const root = createRoot();
		writeFixture(root, "apps/web/page.ts", 'const purpose = "chat";\n');
		writeFixture(root, "apps/web/.next/server/chunk.mjs", 'const id = "gpt-5";\n');
		writeFixture(root, "packages/ai-core/dist/index.mjs", 'const id = "claude-sonnet";\n');
		writeFixture(root, "packages/ai-core/coverage/report.ts", 'const id = "qwen3";\n');
		writeFixture(root, "packages/ai-core/node_modules/x/index.ts", 'const id = "llama3.2";\n');
		writeFixture(root, "docs/node_modules/readme.md", "gemini-2.5-pro\n");

		expect(checkModelIds(root)).toEqual({ scannedFiles: 1, violations: [] });
	});

	it("decides whether to run via isMainModule, not an argv[1] string match", () => {
		const source = readFileSync(new URL("check-model-ids.mjs", import.meta.url), "utf8");

		expect(source).toContain("if (isMainModule(import.meta.url))");
		expect(source).not.toContain("process.argv[1]");
	});
});
