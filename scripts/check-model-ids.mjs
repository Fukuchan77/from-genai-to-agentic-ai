import { readdirSync, readFileSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const CODE_EXTENSIONS = new Set([".mjs", ".ts", ".tsx"]);
const EXCLUDED_FILE_NAMES = new Set([
	"catalog.ts",
	"check-model-ids.mjs",
	"check-model-ids.test.mjs",
]);
function compareText(left, right) {
	return left < right ? -1 : left > right ? 1 : 0;
}

const MODEL_ID_PATTERN =
	/(?<![A-Za-z0-9])(?:claude-|gpt-|gemini-|deepseek-|command-r|llama|qwen|gemma|granite|mistral|mixtral|codestral|phi|jamba-|nova-|o[134]-?)(?:[A-Za-z0-9._:/-]*[A-Za-z0-9])?/gu;

function extension(filePath) {
	const fileName = basename(filePath);
	const dotIndex = fileName.lastIndexOf(".");
	return dotIndex === -1 ? "" : fileName.slice(dotIndex);
}

function listFiles(directory) {
	try {
		return readdirSync(directory, { withFileTypes: true })
			.sort((left, right) => compareText(left.name, right.name))
			.flatMap((entry) => {
				const filePath = join(directory, entry.name);
				if (entry.isDirectory()) return listFiles(filePath);
				return entry.isFile() ? [filePath] : [];
			});
	} catch (error) {
		if (error?.code === "ENOENT") return [];
		throw error;
	}
}

function isExcluded(filePath) {
	return EXCLUDED_FILE_NAMES.has(basename(filePath));
}

function collectEligibleFiles(root) {
	const codeFiles = ["apps", "packages", "scripts", "tooling"].flatMap((directory) =>
		listFiles(join(root, directory)).filter(
			(filePath) => CODE_EXTENSIONS.has(extension(filePath)) && !isExcluded(filePath),
		),
	);
	const documentationFiles = listFiles(join(root, "docs")).filter(
		(filePath) => extension(filePath) === ".md",
	);
	const readmePath = join(root, "README.md");
	try {
		readFileSync(readmePath);
		documentationFiles.push(readmePath);
	} catch (error) {
		if (error?.code !== "ENOENT") throw error;
	}
	return [...codeFiles, ...documentationFiles].sort((left, right) =>
		compareText(relative(root, left), relative(root, right)),
	);
}

function skipQuoted(source, start, quote) {
	let index = start + 1;
	while (index < source.length) {
		if (source[index] === "\\") {
			index += 2;
			continue;
		}
		if (source[index] === quote) return index + 1;
		index += 1;
	}
	return source.length;
}

function codeStringLiterals(source) {
	const literals = [];
	let index = 0;
	while (index < source.length) {
		const character = source[index];
		const next = source[index + 1];
		if (character === "/" && next === "/") {
			const lineEnd = source.indexOf("\n", index + 2);
			index = lineEnd === -1 ? source.length : lineEnd + 1;
			continue;
		}
		if (character === "/" && next === "*") {
			const commentEnd = source.indexOf("*/", index + 2);
			index = commentEnd === -1 ? source.length : commentEnd + 2;
			continue;
		}
		if (character === '"' || character === "'" || character === "`") {
			const end = skipQuoted(source, index, character);
			literals.push({
				literalStart: index,
				value: source.slice(index + 1, Math.max(index + 1, end - 1)),
				valueStart: index + 1,
			});
			index = end;
			continue;
		}
		index += 1;
	}
	return literals;
}

function lineNumberAt(source, index) {
	let line = 1;
	for (let position = 0; position < index; position += 1) {
		if (source[position] === "\n") line += 1;
	}
	return line;
}

function modelMatches(value) {
	return [...value.matchAll(MODEL_ID_PATTERN)].map((match) => ({
		index: match.index ?? 0,
		modelId: match[0],
	}));
}

function isEnvSchemaDefault(source, literalStart) {
	const prefix = source.slice(Math.max(0, literalStart - 100), literalStart);
	return /\.default\(\s*$/u.test(prefix);
}

function fileViolations(root, filePath) {
	const source = readFileSync(filePath, "utf8");
	const relativePath = relative(root, filePath).split(sep).join("/");
	if (extension(filePath) === ".md") {
		return modelMatches(source).map(({ index, modelId }) => ({
			file: relativePath,
			line: lineNumberAt(source, index),
			modelId,
		}));
	}

	return codeStringLiterals(source).flatMap(({ literalStart, value, valueStart }) => {
		if (basename(filePath) === "env-schema.ts" && isEnvSchemaDefault(source, literalStart)) {
			return [];
		}
		return modelMatches(value).map(({ index, modelId }) => ({
			file: relativePath,
			line: lineNumberAt(source, valueStart + index),
			modelId,
		}));
	});
}

export function checkModelIds(root = process.cwd()) {
	const absoluteRoot = resolve(root);
	const files = collectEligibleFiles(absoluteRoot);
	if (files.length === 0) throw new Error("Model ID check scanned 0 files.");
	return {
		scannedFiles: files.length,
		violations: files.flatMap((filePath) => fileViolations(absoluteRoot, filePath)),
	};
}

function runCli() {
	try {
		const result = checkModelIds(process.argv[2] ?? process.cwd());
		process.stdout.write(`Model ID check: scanned ${result.scannedFiles} files.\n`);
		for (const violation of result.violations) {
			process.stderr.write(
				`${violation.file}:${violation.line}: model ID literal "${violation.modelId}" is not allowed.\n`,
			);
		}
		if (result.violations.length > 0) process.exitCode = 1;
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runCli();
