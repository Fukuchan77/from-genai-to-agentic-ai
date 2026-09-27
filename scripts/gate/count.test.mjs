import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { memoryIo } from "../lib/memory-io.mjs";
import { main as biomeMain, evaluateBiomeOutput, parseBiomeFileCount } from "./count-biome.mjs";
import { evaluateTscOutput, parseTscFileCounts, main as tscMain } from "./count-tsc.mjs";

const biomeOutput = JSON.stringify({
	summary: {
		changed: 2,
		unchanged: 3,
		skipped: 1,
	},
	diagnostics: [],
	command: "ci",
});

const CWD = "/repo";

// Each group lists lib, @types, and project files; only project files (inside the tsconfig's
// directory and outside node_modules) count.
const tscOutput = [
	"::tsconfig::tsconfig.json",
	"/repo/node_modules/.pnpm/typescript@7.1.0/node_modules/typescript/lib/lib.es5.d.ts",
	"/repo/node_modules/@types/node/index.d.ts",
	"/repo/vitest.config.ts",
	"tooling/vitest/setup.ts",
	"",
	"::tsconfig::packages/ai-core/tsconfig.json",
	"/repo/node_modules/typescript/lib/lib.dom.d.ts",
	"/repo/packages/ai-core/node_modules/zod/index.d.ts",
	"/repo/packages/shared/src/outside.ts",
	"/repo/packages/ai-core/src/index.ts",
	"",
].join("\n");

describe("Biome file counter", () => {
	it("extracts the scanned file count from Biome JSON output", () => {
		expect(parseBiomeFileCount(`\u001b[0m${biomeOutput}\u001b[0m`)).toBe(5);
		expect(evaluateBiomeOutput(biomeOutput)).toBe("Biome: 5 files");
	});

	it("fails when Biome scanned zero files", () => {
		const output = JSON.stringify({ summary: { changed: 0, unchanged: 0 } });

		expect(() => evaluateBiomeOutput(output)).toThrowError("Biome scanned 0 files");
	});
});

describe("TypeScript file counter", () => {
	it("counts only project files for every grouped tsconfig output", () => {
		expect(parseTscFileCounts(tscOutput, { cwd: CWD })).toEqual([
			{ config: "tsconfig.json", count: 2 },
			{ config: "packages/ai-core/tsconfig.json", count: 1 },
		]);
		expect(evaluateTscOutput(tscOutput, { cwd: CWD })).toBe(
			[
				"TypeScript tsconfig.json: 2 files",
				"TypeScript packages/ai-core/tsconfig.json: 1 files",
			].join("\n"),
		);
	});

	it("resolves the tsconfig directory against cwd, including absolute tsconfig paths", () => {
		const output = [
			"::tsconfig::/repo/apps/web/tsconfig.json",
			"/repo/apps/web/app/page.tsx",
			"apps/web/lib/server/env.ts",
			"/repo/apps/website/app/page.tsx",
		].join("\n");

		expect(parseTscFileCounts(output, { cwd: CWD })).toEqual([
			{ config: "/repo/apps/web/tsconfig.json", count: 2 },
		]);
	});

	it("fails when a tsconfig lists only lib and @types declarations", () => {
		const output = [
			"::tsconfig::packages/ai-core/tsconfig.json",
			"/repo/node_modules/typescript/lib/lib.es5.d.ts",
			"/repo/node_modules/@types/node/index.d.ts",
		].join("\n");

		expect(() => evaluateTscOutput(output, { cwd: CWD })).toThrowError(
			"TypeScript packages/ai-core/tsconfig.json scanned 0 files",
		);
	});

	it("fails the run when tsc reports an error line, naming the tsconfig", () => {
		const output = [
			"::tsconfig::tsconfig.json",
			"/repo/vitest.config.ts",
			"::tsconfig::packages/empty/tsconfig.json",
			"\u001b[91merror\u001b[0m\u001b[90m TS18003: \u001b[0mNo inputs were found in config file.",
			"/repo/packages/empty/src/index.ts",
		].join("\n");

		expect(() => evaluateTscOutput(output, { cwd: CWD })).toThrowError(
			/TypeScript packages\/empty\/tsconfig\.json reported an error: error TS18003/u,
		);
	});

	it("fails the run on a line that is not a file path", () => {
		const output = ["::tsconfig::tsconfig.json", "/repo/vitest.config.ts", "Found 1 error."].join(
			"\n",
		);

		expect(() => evaluateTscOutput(output, { cwd: CWD })).toThrowError(
			'TypeScript tsconfig.json output contained a line that is not a file path: "Found 1 error."',
		);
	});

	it("fails when any tsconfig output contains zero files", () => {
		const output = [
			"::tsconfig::tsconfig.json",
			"/repo/vitest.config.ts",
			"::tsconfig::packages/empty/tsconfig.json",
			"",
		].join("\n");

		expect(() => evaluateTscOutput(output, { cwd: CWD })).toThrowError(
			"TypeScript packages/empty/tsconfig.json scanned 0 files",
		);
	});

	it("requires the output to start with a tsconfig marker", () => {
		expect(() => evaluateTscOutput("/repo/vitest.config.ts", { cwd: CWD })).toThrowError(
			"TypeScript output must start with ::tsconfig::<path>",
		);
	});
});

describe("counter CLIs", () => {
	it("count-biome exits 0 and prints the count read from stdin", () => {
		const io = memoryIo({ stdin: biomeOutput });

		expect(biomeMain(io)).toBe(0);
		expect(io.stdoutText()).toBe("Biome: 5 files\n");
	});

	it.each([
		[JSON.stringify({ summary: { changed: 0, unchanged: 0 } }), "Biome scanned 0 files"],
		["not json", "Biome output did not contain JSON"],
	])("count-biome exits 1 for %s", (stdin, message) => {
		const io = memoryIo({ stdin });

		expect(biomeMain(io)).toBe(1);
		expect(io.stdoutText()).toBe("");
		expect(io.stderrText()).toBe(`count-biome: ${message}\n`);
	});

	it("count-tsc exits 0 and counts files relative to the working directory", () => {
		const io = memoryIo({ cwd: CWD, stdin: tscOutput });

		expect(tscMain(io)).toBe(0);
		expect(io.stdoutText()).toContain("TypeScript tsconfig.json: 2 files\n");
	});

	it("count-tsc exits 1 when a tsconfig scanned zero files", () => {
		const stdin = [
			"::tsconfig::tsconfig.json",
			"/repo/node_modules/typescript/lib/lib.es5.d.ts",
			"",
		].join("\n");
		const io = memoryIo({ cwd: CWD, stdin });

		expect(tscMain(io)).toBe(1);
		expect(io.stdoutText()).toBe("");
		expect(io.stderrText()).toBe("count-tsc: TypeScript tsconfig.json scanned 0 files\n");
	});

	it.each(["count-biome.mjs", "count-tsc.mjs"])(
		"%s runs main through runIfMain instead of reading process state itself",
		(fileName) => {
			const source = readFileSync(new URL(fileName, import.meta.url), "utf8");

			expect(source).toContain("await runIfMain(import.meta.url, main);");
			expect(source).not.toMatch(/process\.(argv|exitCode)|readFileSync\(0/u);
		},
	);
});
