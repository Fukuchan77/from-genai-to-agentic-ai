import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

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

function run() {
	try {
		process.stdout.write(`${evaluateBiomeOutput(readFileSync(0, "utf8"))}\n`);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		process.stderr.write(`count-biome: ${message}\n`);
		process.exitCode = 1;
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	run();
}
