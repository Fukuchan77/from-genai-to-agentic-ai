import { dirname, isAbsolute, relative, resolve } from "node:path";
import { runIfMain } from "../lib/cli.mjs";

const GROUP_PREFIX = "::tsconfig::";
// biome-ignore lint/suspicious/noControlCharactersInRegex: strips ANSI colour codes from tsc output.
const ANSI_ESCAPE = /\u001b\[[0-9;]*m/gu;
const TSC_ERROR = /error TS\d+/u;
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?|json)$/u;

/**
 * A listed file is a project file when it lies inside the tsconfig's directory and outside
 * every `node_modules` segment (which also excludes the TypeScript lib `.d.ts` files).
 */
function isProjectFile(configDirectory, filePath, cwd) {
	const pathFromConfig = relative(configDirectory, resolve(cwd, filePath));
	if (pathFromConfig === "" || isAbsolute(pathFromConfig)) return false;
	const segments = pathFromConfig.split(/[\\/]/u);
	return segments[0] !== ".." && !segments.includes("node_modules");
}

export function parseTscFileCounts(output, { cwd = process.cwd() } = {}) {
	const groups = [];
	let current;

	for (const rawLine of output.split(/\r?\n/u)) {
		const line = rawLine.replace(ANSI_ESCAPE, "").trim();
		if (line.startsWith(GROUP_PREFIX)) {
			const config = line.slice(GROUP_PREFIX.length).trim();
			if (!config) {
				throw new Error("TypeScript output contained an unnamed tsconfig group");
			}
			current = { config, configDirectory: dirname(resolve(cwd, config)), count: 0 };
			groups.push(current);
			continue;
		}
		if (!line) {
			continue;
		}
		if (!current) {
			throw new Error(`TypeScript output must start with ${GROUP_PREFIX}<path>`);
		}
		const errorMatch = TSC_ERROR.exec(line);
		if (errorMatch) {
			throw new Error(
				`TypeScript ${current.config} reported an error: ${line.slice(errorMatch.index)}`,
			);
		}
		if (!SOURCE_FILE.test(line)) {
			throw new Error(
				`TypeScript ${current.config} output contained a line that is not a file path: "${line}"`,
			);
		}
		if (isProjectFile(current.configDirectory, line, cwd)) current.count += 1;
	}

	if (groups.length === 0) {
		throw new Error("TypeScript output contained no tsconfig groups");
	}
	return groups.map(({ config, count }) => ({ config, count }));
}

export function evaluateTscOutput(output, options) {
	const groups = parseTscFileCounts(output, options);
	for (const { config, count } of groups) {
		if (count === 0) {
			throw new Error(`TypeScript ${config} scanned 0 files`);
		}
	}
	return groups.map(({ config, count }) => `TypeScript ${config}: ${count} files`).join("\n");
}

export function main({ cwd, readStdin, stdout, stderr }) {
	try {
		stdout.write(`${evaluateTscOutput(readStdin(), { cwd })}\n`);
		return 0;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		stderr.write(`count-tsc: ${message}\n`);
		return 1;
	}
}

await runIfMain(import.meta.url, main);
