import { readdirSync, readFileSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import { isMainModule } from "./lib/cli.mjs";
import { isGeneratedDirectory } from "./lib/scan-exclusions.mjs";

const CODE_EXTENSIONS = new Set([".mjs", ".ts", ".tsx"]);
/** Repository-relative paths where model ID literals are allowed anywhere (plan C20). */
const ALLOWED_FILES = new Set([
	"packages/ai-core/src/models/catalog.ts",
	"scripts/check-model-ids.mjs",
	"scripts/check-model-ids.test.mjs",
]);
/** The env schema may hold model ID literals only as `.default(...)` arguments (plan C4). */
const ENV_SCHEMA_FILE = "packages/ai-core/src/config/env-schema.ts";

function compareText(left, right) {
	return left < right ? -1 : left > right ? 1 : 0;
}

// Variant words that turn a common-word family into a model ID (`mistral-small`, `llama-guard3`).
const VARIANT_WORDS =
	"small|medium|large|nemo|tiny|mini|nano|plus|pro|instruct|embedding|embed|code|coder|vision|guard|moe|latest";
// A family that is also an ordinary word must be followed by a version digit, or by `-` / `:`
// and a version or variant token (`phi3`, `phi-4`, `gemma3:4b`, `mistral-small`).
const VERSIONED = String.raw`(?:\d|[-:](?:\d|(?:${VARIANT_WORDS})(?![a-z])))`;

/**
 * Model families detected by the check, kept in sync with the catalog's providers
 * (anthropic, openai, azure, google, ollama; plan C5 / C6) and their embedding models.
 * `pattern` is the regex source that must follow the ID's left boundary.
 */
export const MODEL_ID_FAMILIES = Object.freeze([
	{ prefix: "claude-", pattern: "claude-" },
	// `gpt-tokenizer` is a package, so `gpt-` needs a version digit or a known model line.
	{
		prefix: "gpt-",
		pattern: String.raw`gpt-(?=\d|(?:oss|image|realtime|audio)(?![A-Za-z]))`,
	},
	{ prefix: "chatgpt-", pattern: "chatgpt-" },
	// o-series IDs stand alone (`o3`) or take a variant (`o3-mini`); `o3lint` and `foo3` do not match.
	{ prefix: "o", pattern: "o[1-9](?:-(?=[a-z])|(?![A-Za-z0-9]))" },
	{ prefix: "text-embedding-", pattern: "text-embedding-" },
	{ prefix: "gemini-", pattern: "gemini-" },
	{ prefix: "embeddinggemma", pattern: "embeddinggemma" },
	{ prefix: "gemma", pattern: `gemma${VERSIONED}` },
	{ prefix: "llama", pattern: `llama${VERSIONED}` },
	{ prefix: "qwen", pattern: `qwen${VERSIONED}` },
	{ prefix: "granite", pattern: `granite${VERSIONED}` },
	{ prefix: "mistral", pattern: `mistral${VERSIONED}` },
	{ prefix: "mixtral", pattern: "mixtral" },
	{ prefix: "codestral", pattern: "codestral" },
	{ prefix: "phi", pattern: `phi${VERSIONED}` },
	{ prefix: "deepseek-", pattern: "deepseek-" },
	{ prefix: "command-r", pattern: "command-r(?![A-Za-z])" },
	{ prefix: "jamba-", pattern: "jamba-" },
	{ prefix: "nova-", pattern: "nova-" },
	{ prefix: "nomic-embed-", pattern: "nomic-embed-" },
	{ prefix: "mxbai-embed-", pattern: "mxbai-embed-" },
	{ prefix: "snowflake-arctic-embed", pattern: "snowflake-arctic-embed" },
]);

export const MODEL_ID_PREFIXES = Object.freeze(MODEL_ID_FAMILIES.map(({ prefix }) => prefix));

const MODEL_ID_PATTERN = new RegExp(
	`(?<![A-Za-z0-9])(?:${MODEL_ID_FAMILIES.map(({ pattern }) => pattern).join("|")})(?:[A-Za-z0-9._:/-]*[A-Za-z0-9])?`,
	"gu",
);

// A string literal right after one of these is a module specifier (a package name), not a model ID.
const MODULE_SPECIFIER_CONTEXT = /(?:\bfrom|\bimport|\bimport\s*\(|\brequire\s*\()\s*$/u;

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
				if (entry.isDirectory()) {
					return isGeneratedDirectory(entry.name) ? [] : listFiles(filePath);
				}
				return entry.isFile() ? [filePath] : [];
			});
	} catch (error) {
		if (error?.code === "ENOENT") return [];
		throw error;
	}
}

function repositoryPath(root, filePath) {
	return relative(root, filePath).split(sep).join("/");
}

function collectEligibleFiles(root) {
	const codeFiles = ["apps", "packages", "scripts", "tooling"].flatMap((directory) =>
		listFiles(join(root, directory)).filter(
			(filePath) =>
				CODE_EXTENSIONS.has(extension(filePath)) &&
				!ALLOWED_FILES.has(repositoryPath(root, filePath)),
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

function lineStartIndex(source) {
	const starts = [0];
	for (let position = source.indexOf("\n"); position !== -1; ) {
		starts.push(position + 1);
		position = source.indexOf("\n", position + 1);
	}
	return starts;
}

function lineNumberAt(lineStarts, index) {
	let low = 0;
	let high = lineStarts.length - 1;
	while (low < high) {
		const middle = Math.ceil((low + high) / 2);
		if (lineStarts[middle] <= index) low = middle;
		else high = middle - 1;
	}
	return low + 1;
}

function modelMatches(value) {
	return [...value.matchAll(MODEL_ID_PATTERN)].map((match) => ({
		index: match.index ?? 0,
		modelId: match[0],
	}));
}

function isModuleSpecifier(source, literalStart) {
	return MODULE_SPECIFIER_CONTEXT.test(source.slice(Math.max(0, literalStart - 40), literalStart));
}

function isEnvSchemaDefault(source, literalStart) {
	const prefix = source.slice(Math.max(0, literalStart - 100), literalStart);
	return /\.default\(\s*$/u.test(prefix);
}

function fileViolations(root, filePath) {
	const source = readFileSync(filePath, "utf8");
	const relativePath = repositoryPath(root, filePath);
	const lineStarts = lineStartIndex(source);
	if (extension(filePath) === ".md") {
		return modelMatches(source).map(({ index, modelId }) => ({
			file: relativePath,
			line: lineNumberAt(lineStarts, index),
			modelId,
		}));
	}

	return codeStringLiterals(source).flatMap(({ literalStart, value, valueStart }) => {
		if (isModuleSpecifier(source, literalStart)) return [];
		if (relativePath === ENV_SCHEMA_FILE && isEnvSchemaDefault(source, literalStart)) {
			return [];
		}
		return modelMatches(value).map(({ index, modelId }) => ({
			file: relativePath,
			line: lineNumberAt(lineStarts, valueStart + index),
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

if (isMainModule(import.meta.url)) runCli();
