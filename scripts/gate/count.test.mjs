import { describe, expect, it } from "vitest";

import { evaluateBiomeOutput, parseBiomeFileCount } from "./count-biome.mjs";
import { evaluateTscOutput, parseTscFileCounts } from "./count-tsc.mjs";

const biomeOutput = JSON.stringify({
	summary: {
		changed: 2,
		unchanged: 3,
		skipped: 1,
	},
	diagnostics: [],
	command: "ci",
});

const tscOutput = [
	"::tsconfig::tsconfig.json",
	"/repo/node_modules/typescript/lib/lib.es5.d.ts",
	"/repo/vitest.config.ts",
	"",
	"::tsconfig::packages/ai-core/tsconfig.json",
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
	it("extracts and reports a count for every grouped tsconfig output", () => {
		expect(parseTscFileCounts(tscOutput)).toEqual([
			{ config: "tsconfig.json", count: 2 },
			{ config: "packages/ai-core/tsconfig.json", count: 1 },
		]);
		expect(evaluateTscOutput(tscOutput)).toBe(
			[
				"TypeScript tsconfig.json: 2 files",
				"TypeScript packages/ai-core/tsconfig.json: 1 files",
			].join("\n"),
		);
	});

	it("fails when any tsconfig output contains zero files", () => {
		const output = [
			"::tsconfig::tsconfig.json",
			"/repo/vitest.config.ts",
			"::tsconfig::packages/empty/tsconfig.json",
			"",
		].join("\n");

		expect(() => evaluateTscOutput(output)).toThrowError(
			"TypeScript packages/empty/tsconfig.json scanned 0 files",
		);
	});
});
