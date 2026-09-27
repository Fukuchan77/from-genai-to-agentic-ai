import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const GROUP_PREFIX = "::tsconfig::";

export function parseTscFileCounts(output) {
	const groups = [];
	let current;

	for (const rawLine of output.split(/\r?\n/u)) {
		const line = rawLine.trim();
		if (line.startsWith(GROUP_PREFIX)) {
			const config = line.slice(GROUP_PREFIX.length).trim();
			if (!config) {
				throw new Error("TypeScript output contained an unnamed tsconfig group");
			}
			current = { config, count: 0 };
			groups.push(current);
			continue;
		}
		if (!line) {
			continue;
		}
		if (!current) {
			throw new Error(`TypeScript output must start with ${GROUP_PREFIX}<path>`);
		}
		current.count += 1;
	}

	if (groups.length === 0) {
		throw new Error("TypeScript output contained no tsconfig groups");
	}
	return groups;
}

export function evaluateTscOutput(output) {
	const groups = parseTscFileCounts(output);
	for (const { config, count } of groups) {
		if (count === 0) {
			throw new Error(`TypeScript ${config} scanned 0 files`);
		}
	}
	return groups.map(({ config, count }) => `TypeScript ${config}: ${count} files`).join("\n");
}

function run() {
	try {
		process.stdout.write(`${evaluateTscOutput(readFileSync(0, "utf8"))}\n`);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		process.stderr.write(`count-tsc: ${message}\n`);
		process.exitCode = 1;
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	run();
}
