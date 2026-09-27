import { runIfMain } from "../lib/cli.mjs";

function parseBiomeJson(output) {
	const start = output.indexOf("{");
	const end = output.lastIndexOf("}");
	if (start === -1 || end < start) {
		throw new Error("Biome output did not contain JSON");
	}

	return JSON.parse(output.slice(start, end + 1));
}

function readSummaryCount(summary, field) {
	const value = summary?.[field];
	if (!Number.isInteger(value) || value < 0) {
		throw new Error(`Biome JSON summary.${field} must be a non-negative integer`);
	}
	return value;
}

export function parseBiomeFileCount(output) {
	const report = parseBiomeJson(output);
	return (
		readSummaryCount(report.summary, "changed") + readSummaryCount(report.summary, "unchanged")
	);
}

export function evaluateBiomeOutput(output) {
	const count = parseBiomeFileCount(output);
	if (count === 0) {
		throw new Error("Biome scanned 0 files");
	}
	return `Biome: ${count} files`;
}

export function main({ readStdin, stdout, stderr }) {
	try {
		stdout.write(`${evaluateBiomeOutput(readStdin())}\n`);
		return 0;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		stderr.write(`count-biome: ${message}\n`);
		return 1;
	}
}

await runIfMain(import.meta.url, main);
