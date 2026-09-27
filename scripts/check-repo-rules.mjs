import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { isMainModule } from "./lib/cli.mjs";
import { isGeneratedDirectory } from "./lib/scan-exclusions.mjs";

const CHECKER_FILES = new Set([
	"scripts/check-repo-rules.mjs",
	"scripts/check-repo-rules.test.mjs",
]);

export const RULE_NAMES = [
	"no-deprecated-object-api",
	"guarded-agent-only",
	"ai-core-no-ui-deps",
	"no-dynamic-eval",
	"tool-risk-declared",
	"actions-pinned",
	"frozen-lockfile",
	"allow-builds-reasoned",
	"no-sensitive-logging",
];

export class RepoRuleError extends Error {
	constructor(message, result) {
		super(message);
		this.name = "RepoRuleError";
		this.result = result;
	}
}

function normalize(relativePath) {
	return relativePath.split(path.sep).join("/");
}

function isCheckerFile(relativePath) {
	return CHECKER_FILES.has(normalize(relativePath));
}

async function fileExists(absolutePath) {
	try {
		await readFile(absolutePath);
		return true;
	} catch (error) {
		if (error?.code === "ENOENT") return false;
		throw error;
	}
}

async function collectFiles(root, directories, extensions) {
	const files = [];
	async function visit(directory) {
		let entries;
		try {
			entries = await readdir(directory, { withFileTypes: true });
		} catch (error) {
			if (error?.code === "ENOENT") return;
			throw error;
		}
		for (const entry of entries) {
			const absolutePath = path.join(directory, entry.name);
			if (entry.isDirectory()) {
				if (!isGeneratedDirectory(entry.name)) await visit(absolutePath);
			} else if (entry.isFile() && extensions.has(path.extname(entry.name))) {
				const relativePath = normalize(path.relative(root, absolutePath));
				if (!isCheckerFile(relativePath)) files.push(relativePath);
			}
		}
	}
	for (const directory of directories) await visit(path.join(root, directory));
	return files.sort();
}

const REGEX_PREFIX_PUNCTUATORS = new Set([
	"(",
	"[",
	"{",
	"}",
	",",
	";",
	":",
	"?",
	"=",
	"==",
	"===",
	"!=",
	"!==",
	"<",
	">",
	"<=",
	">=",
	"+",
	"-",
	"*",
	"**",
	"%",
	"&",
	"|",
	"^",
	"!",
	"~",
	"<<",
	">>",
	">>>",
	"&&",
	"||",
	"??",
	"=>",
	"+=",
	"-=",
	"*=",
	"**=",
	"/=",
	"%=",
	"&=",
	"|=",
	"^=",
	"<<=",
	">>=",
	">>>=",
	"&&=",
	"||=",
	"??=",
	"...",
	"${",
]);

const REGEX_PREFIX_KEYWORDS = new Set([
	"return",
	"typeof",
	"instanceof",
	"in",
	"of",
	"new",
	"delete",
	"void",
	"throw",
	"case",
	"do",
	"else",
	"yield",
	"await",
]);

// Longest first so that the lexer always takes the longest operator.
const PUNCTUATORS = [
	">>>=",
	"===",
	"!==",
	"**=",
	"<<=",
	">>=",
	">>>",
	"&&=",
	"||=",
	"??=",
	"...",
	"=>",
	"==",
	"!=",
	"<=",
	">=",
	"&&",
	"||",
	"??",
	"++",
	"--",
	"+=",
	"-=",
	"*=",
	"/=",
	"%=",
	"&=",
	"|=",
	"^=",
	"**",
	"<<",
	">>",
];

function canStartRegex(tokens) {
	const previous = tokens.at(-1);
	if (!previous) return true;
	if (previous.type === "punctuator") return REGEX_PREFIX_PUNCTUATORS.has(previous.value);
	if (previous.type !== "identifier" || !REGEX_PREFIX_KEYWORDS.has(previous.value)) return false;
	// `obj.return / 2` is a property access, not a keyword.
	const beforeKeyword = tokens.at(-2)?.value;
	return beforeKeyword !== "." && beforeKeyword !== "?.";
}

/**
 * Tokenizes JavaScript / TypeScript source into identifiers, strings, and punctuators.
 * Comments, regex literals, and the literal parts of template strings are dropped; the code
 * inside `${ ... }` substitutions is tokenized like any other code.
 */
function tokenize(source) {
	const tokens = [];
	// One entry per open `{` or `${`, so that `}` knows whether it resumes a template.
	const braces = [];
	let index = 0;
	let line = 1;
	const advance = () => {
		if (source[index] === "\n") line += 1;
		index += 1;
	};
	const push = (type, value, tokenLine = line) => tokens.push({ type, value, line: tokenLine });
	// Consumes template characters up to the closing backtick or the next `${`.
	const scanTemplate = () => {
		while (index < source.length) {
			if (source[index] === "\\") {
				advance();
				if (index < source.length) advance();
				continue;
			}
			if (source[index] === "`") {
				advance();
				push("template", "`");
				return;
			}
			if (source[index] === "$" && source[index + 1] === "{") {
				push("punctuator", "${");
				advance();
				advance();
				braces.push("template");
				return;
			}
			advance();
		}
	};
	while (index < source.length) {
		const character = source[index];
		if (/\s/u.test(character)) {
			advance();
			continue;
		}
		if (character === "/" && source[index + 1] === "/") {
			while (index < source.length && source[index] !== "\n") advance();
			continue;
		}
		if (character === "/" && source[index + 1] === "*") {
			advance();
			advance();
			while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
				advance();
			}
			if (index < source.length) {
				advance();
				advance();
			}
			continue;
		}
		if (character === '"' || character === "'") {
			const quote = character;
			const tokenLine = line;
			let value = "";
			advance();
			while (index < source.length && source[index] !== quote && source[index] !== "\n") {
				if (source[index] === "\\") {
					advance();
					if (index < source.length) {
						value += source[index];
						advance();
					}
				} else {
					value += source[index];
					advance();
				}
			}
			if (source[index] === quote) advance();
			push("string", value, tokenLine);
			continue;
		}
		if (character === "`") {
			push("template", "`");
			advance();
			scanTemplate();
			continue;
		}
		if (character === "{") {
			braces.push("brace");
			push("punctuator", "{");
			advance();
			continue;
		}
		if (character === "}") {
			advance();
			if (braces.pop() === "template") {
				scanTemplate();
			} else {
				push("punctuator", "}");
			}
			continue;
		}
		if (character === "/" && canStartRegex(tokens)) {
			advance();
			let inClass = false;
			// A regex literal never spans lines; stop there so a misread `/` cannot swallow code.
			while (index < source.length && source[index] !== "\n") {
				if (source[index] === "\\") {
					advance();
					if (index < source.length) advance();
					continue;
				}
				if (source[index] === "[") inClass = true;
				if (source[index] === "]") inClass = false;
				if (source[index] === "/" && !inClass) {
					advance();
					while (/[a-z]/iu.test(source[index] ?? "")) advance();
					break;
				}
				advance();
			}
			push("regex", "/");
			continue;
		}
		const word = source.slice(index).match(/^(?:[A-Za-z_$][\w$]*|\d[\w$.]*|\.\d[\w$]*)/u)?.[0];
		if (word) {
			push(/^[\d.]/u.test(word) ? "number" : "identifier", word);
			index += word.length;
			continue;
		}
		if (character === "?" && source[index + 1] === "." && !/\d/u.test(source[index + 2] ?? "")) {
			push("punctuator", "?.");
			index += 2;
			continue;
		}
		const punctuator = PUNCTUATORS.find((value) => source.startsWith(value, index)) ?? character;
		push("punctuator", punctuator);
		index += punctuator.length;
	}
	return tokens;
}

function statementEnd(tokens, start) {
	let cursor = start + 1;
	while (cursor < tokens.length && tokens[cursor].value !== ";") cursor += 1;
	return cursor;
}

/** Parses the local bindings of `import <clause> from "x"` between `start` and `fromIndex`. */
function importBindings(tokens, start, fromIndex) {
	const bindings = { namespaces: [], named: [] };
	let cursor = start + 1;
	if (tokens[cursor]?.value === "type") cursor += 1;
	while (cursor < fromIndex) {
		const token = tokens[cursor];
		if (token.value === "*" && tokens[cursor + 1]?.value === "as") {
			bindings.namespaces.push(tokens[cursor + 2]?.value);
			cursor += 3;
		} else if (token.value === "{") {
			cursor += 1;
			while (cursor < fromIndex && tokens[cursor].value !== "}") {
				if (tokens[cursor].value === "type" && tokens[cursor + 1]?.type === "identifier") {
					cursor += 1;
				}
				const imported = tokens[cursor].value;
				let local = imported;
				if (tokens[cursor + 1]?.value === "as") {
					local = tokens[cursor + 2]?.value;
					cursor += 2;
				}
				bindings.named.push({ imported, local });
				cursor += 1;
				if (tokens[cursor]?.value === ",") cursor += 1;
			}
			cursor += 1;
		} else if (token.type === "identifier") {
			// A default import binds the module object in the same way as a namespace here.
			bindings.namespaces.push(token.value);
			cursor += 1;
		} else {
			cursor += 1;
		}
	}
	return bindings;
}

function moduleImports(tokens) {
	const imports = [];
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (token.type !== "identifier") continue;
		if (tokens[index - 1]?.value === "." || tokens[index - 1]?.value === "?.") continue;
		const callsString = tokens[index + 1]?.value === "(" && tokens[index + 2]?.type === "string";
		if (token.value === "require" && callsString) {
			imports.push({
				kind: "dynamic",
				source: tokens[index + 2].value,
				start: index,
				end: index + 2,
			});
			continue;
		}
		if (token.value === "import") {
			if (tokens[index + 1]?.type === "string") {
				imports.push({
					kind: "static",
					source: tokens[index + 1].value,
					start: index,
					end: index + 1,
				});
				continue;
			}
			if (callsString) {
				imports.push({
					kind: "dynamic",
					source: tokens[index + 2].value,
					start: index,
					end: index + 2,
				});
				continue;
			}
		}
		if (token.value === "import" || token.value === "export") {
			const end = statementEnd(tokens, index);
			for (let cursor = index + 1; cursor < end; cursor += 1) {
				if (tokens[cursor].value === "from" && tokens[cursor + 1]?.type === "string") {
					imports.push({
						kind: "static",
						source: tokens[cursor + 1].value,
						start: index,
						end: cursor + 1,
						bindings: token.value === "import" ? importBindings(tokens, index, cursor) : undefined,
					});
					break;
				}
			}
		}
	}
	return imports;
}

/** Returns the index just past a `<...>` type argument list that starts at `start`. */
function skipTypeArguments(tokens, start) {
	if (tokens[start]?.value !== "<") return start;
	let depth = 0;
	for (let cursor = start; cursor < tokens.length; cursor += 1) {
		const value = tokens[cursor].value;
		if (/^<+$/u.test(value)) depth += value.length;
		if (/^>+$/u.test(value)) depth -= value.length;
		if (value === ";" || value === "{") return start;
		if (depth <= 0) return cursor + 1;
	}
	return start;
}

/** Splits an identifier into lower-case words at camelCase, acronym, and snake_case boundaries. */
function identifierWords(identifier) {
	// `_` and `$` never match a word, so snake_case splits on them as well.
	return (identifier.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+|\d+/gu) ?? []).map((word) =>
		word.toLowerCase(),
	);
}

const SENSITIVE_WORDS = new Set(["prompt", "prompts", "messages", "input", "inputs", "apikey"]);
// Words that turn a sensitive noun into allowed metadata (counts, sizes, schemas, identifiers).
const METADATA_WORDS = new Set([
	"token",
	"tokens",
	"count",
	"length",
	"size",
	"bytes",
	"chars",
	"schema",
	"id",
	"ids",
	"ms",
]);

function isSensitiveIdentifier(identifier) {
	const words = identifierWords(identifier);
	for (let index = 0; index < words.length; index += 1) {
		const isApiKey = words[index] === "api" && words[index + 1] === "key";
		if (!isApiKey && !SENSITIVE_WORDS.has(words[index])) continue;
		const next = words[index + (isApiKey ? 2 : 1)];
		if (!METADATA_WORDS.has(next)) return true;
	}
	return false;
}

// Count-like properties whose value is a number, so `messages.length` logs no content (N-6).
const COUNT_PROPERTIES = new Set(["length", "size", "count"]);

function isCountAccess(tokens, index) {
	const accessor = tokens[index + 1]?.value;
	return (accessor === "." || accessor === "?.") && COUNT_PROPERTIES.has(tokens[index + 2]?.value);
}

async function readCodeFiles(root, files) {
	return Promise.all(
		files.map(async (relativePath) => {
			const source = await readFile(path.join(root, relativePath), "utf8");
			return { relativePath, source, tokens: tokenize(source) };
		}),
	);
}

function violation(relativePath, line, detail) {
	return `${relativePath}:${line}: ${detail}`;
}

async function codeFiles(root, directories, extensions = new Set([".ts", ".tsx"])) {
	const files = await collectFiles(root, directories, extensions);
	return { files, code: await readCodeFiles(root, files) };
}

const DEPRECATED_OBJECT_APIS = new Set(["generateObject", "streamObject"]);
const WORKFLOW_EXTENSIONS = new Set([".yml", ".yaml"]);

function isMemberAccess(tokens, index, objects) {
	const accessor = tokens[index + 1]?.value;
	return (
		objects.has(tokens[index]?.value) &&
		tokens[index - 1]?.value !== "." &&
		tokens[index - 1]?.value !== "?." &&
		(accessor === "." || accessor === "?.")
	);
}

function aiImports(tokens) {
	const imports = moduleImports(tokens).filter(({ source }) => source === "ai");
	return {
		imports,
		namespaces: new Set(imports.flatMap(({ bindings }) => bindings?.namespaces ?? [])),
		named: imports.flatMap(({ bindings }) => bindings?.named ?? []),
		dynamic: imports.some(({ kind }) => kind === "dynamic"),
	};
}

function stripShellComment(command) {
	return command.replace(/(?:^|\s)#.*$/u, "");
}

/** Extracts the shell text of every `run:` step (inline and block scalars) with its line number. */
function workflowRunCommands(lines) {
	const commands = [];
	for (let index = 0; index < lines.length; index += 1) {
		const match = lines[index].match(/^(\s*)(?:-\s+)?run\s*:\s*(.*)$/u);
		if (!match) continue;
		const keyIndent = match[1].length;
		const value = match[2].trim();
		if (/^[|>][-+0-9]*\s*(?:#.*)?$/u.test(value)) {
			for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
				const text = lines[cursor];
				if (text.trim() === "") continue;
				if (text.length - text.trimStart().length <= keyIndent) break;
				commands.push({ line: cursor + 1, command: stripShellComment(text.trim()) });
				index = cursor;
			}
		} else {
			const unquoted = value.replace(/^(["'])(.*)\1\s*(?:#.*)?$/u, "$2");
			commands.push({ line: index + 1, command: stripShellComment(unquoted) });
		}
	}
	return commands;
}

const PNPM_OPTIONS_WITH_VALUE = new Set(["--filter", "-F", "--dir", "-C"]);

/**
 * Classifies each dependency installation in a shell command: `frozen` for
 * `pnpm install --frozen-lockfile`, and a short description for every other install.
 */
function dependencyInstalls(command) {
	const installs = [];
	for (const segment of command.split(/&&|\|\||[;|&]/u)) {
		const words = segment.trim().split(/\s+/u).filter(Boolean);
		const index = words.findIndex((word) => ["pnpm", "npm", "yarn", "bun"].includes(word));
		if (index < 0) continue;
		const tool = words[index];
		let cursor = index + 1;
		while (words[cursor]?.startsWith("-")) {
			cursor += PNPM_OPTIONS_WITH_VALUE.has(words[cursor]) ? 2 : 1;
		}
		const subcommand = words[cursor];
		if (tool === "pnpm" && (subcommand === "install" || subcommand === "i")) {
			const options = words.slice(index + 1);
			const frozen =
				options.some((option) => /^--frozen-lockfile(?:=true)?$/u.test(option)) &&
				!options.some((option) => /^--(?:no-frozen-lockfile|frozen-lockfile=false)$/u.test(option));
			installs.push(frozen ? "frozen" : "pnpm install without --frozen-lockfile");
		} else if (
			(tool === "npm" && ["install", "i", "ci"].includes(subcommand)) ||
			(tool === "yarn" && (subcommand === undefined || subcommand === "install")) ||
			(tool === "bun" && (subcommand === "install" || subcommand === "i"))
		) {
			installs.push(`${tool} ${subcommand ?? ""}`.trim());
		}
	}
	return installs;
}

const TOML_STRING = /"""([\s\S]*?)"""|'''([\s\S]*?)'''|"((?:\\.|[^"\\\n])*)"|'([^'\n]*)'/gu;

/** Returns the line and run commands of the `[tasks.setup]` table in mise.toml, or undefined. */
function miseSetupCommands(source) {
	const lines = source.split(/\r?\n/u);
	const start = lines.findIndex((line) =>
		/^\[tasks\.(?:setup|"setup"|'setup')\]\s*(?:#.*)?$/u.test(line),
	);
	if (start < 0) return undefined;
	let end = start + 1;
	while (end < lines.length && !/^\[/u.test(lines[end])) end += 1;
	const body = lines.slice(start + 1, end);
	const runStart = body.findIndex((line) => /^run\s*=/u.test(line));
	if (runStart < 0) return { line: start + 1, commands: [] };
	let runEnd = runStart + 1;
	while (runEnd < body.length && !/^[A-Za-z_"'][^=]*=/u.test(body[runEnd])) runEnd += 1;
	const run = body
		.slice(runStart, runEnd)
		.join("\n")
		.replace(/^run\s*=/u, "");
	const commands = [];
	for (const literal of run.matchAll(TOML_STRING)) {
		const text = literal[1] ?? literal[2] ?? literal[3] ?? literal[4] ?? "";
		commands.push(...text.split(/\r?\n/u).map(stripShellComment));
	}
	return { line: start + 1, commands };
}

const runners = {
	async "no-deprecated-object-api"(root) {
		const { files, code } = await codeFiles(root, ["apps", "packages"]);
		const violations = [];
		for (const file of code) {
			const { tokens } = file;
			const ai = aiImports(tokens);
			if (ai.imports.length === 0) continue;
			const report = (token) =>
				violations.push(
					violation(file.relativePath, token.line, `deprecated ai import ${token.value}`),
				);
			const insideImport = (index) =>
				ai.imports.some(({ start, end }) => index >= start && index <= end);
			for (let index = 0; index < tokens.length; index += 1) {
				const token = tokens[index];
				if (!DEPRECATED_OBJECT_APIS.has(token.value)) continue;
				if (insideImport(index)) {
					if (token.type === "identifier") report(token);
					continue;
				}
				const viaNamespace =
					token.type === "identifier" && isMemberAccess(tokens, index - 2, ai.namespaces);
				const viaIndex =
					token.type === "string" &&
					tokens[index - 1]?.value === "[" &&
					ai.namespaces.has(tokens[index - 2]?.value);
				// A dynamic import has no static binding list, so any use in the file counts.
				const viaDynamic = ai.dynamic && token.type === "identifier";
				if (viaNamespace || viaIndex || viaDynamic) report(token);
			}
		}
		return { fileCount: files.length, violations };
	},

	async "guarded-agent-only"(root) {
		const { files, code } = await codeFiles(root, ["apps", "packages"]);
		const violations = [];
		for (const file of code) {
			if (file.relativePath === "packages/ai-core/src/agents/guarded-agent.ts") continue;
			const { tokens } = file;
			const ai = aiImports(tokens);
			const constructors = new Set([
				"ToolLoopAgent",
				...ai.named
					.filter(({ imported }) => imported === "ToolLoopAgent")
					.map(({ local }) => local),
			]);
			for (let index = 0; index < tokens.length - 1; index += 1) {
				if (tokens[index].value !== "new") continue;
				const target = tokens[index + 1];
				const direct = target.type === "identifier" && constructors.has(target.value);
				const viaNamespace =
					isMemberAccess(tokens, index + 1, ai.namespaces) &&
					tokens[index + 3]?.value === "ToolLoopAgent";
				if (direct || viaNamespace) {
					violations.push(
						violation(file.relativePath, tokens[index].line, "ToolLoopAgent must be guarded"),
					);
				}
			}
		}
		return { fileCount: files.length, violations };
	},

	async "ai-core-no-ui-deps"(root) {
		const packagePath = "packages/ai-core/package.json";
		const sourceFiles = await collectFiles(root, ["packages/ai-core/src"], new Set([".ts"]));
		const files = (await fileExists(path.join(root, packagePath)))
			? [packagePath, ...sourceFiles]
			: sourceFiles;
		const violations = [];
		const forbidden = ["react", "react-dom", "next", "@ai-sdk/react"];
		if (files.includes(packagePath)) {
			try {
				const manifest = JSON.parse(await readFile(path.join(root, packagePath), "utf8"));
				for (const section of [
					"dependencies",
					"devDependencies",
					"peerDependencies",
					"optionalDependencies",
				]) {
					for (const dependency of Object.keys(manifest[section] ?? {})) {
						if (forbidden.includes(dependency)) {
							violations.push(violation(packagePath, 1, `forbidden UI dependency ${dependency}`));
						}
					}
				}
			} catch (error) {
				violations.push(violation(packagePath, 1, `invalid package.json: ${error.message}`));
			}
		}
		for (const file of await readCodeFiles(root, sourceFiles)) {
			for (const imported of moduleImports(file.tokens)) {
				if (
					forbidden.some(
						(name) => imported.source === name || imported.source.startsWith(`${name}/`),
					)
				) {
					violations.push(
						violation(
							file.relativePath,
							file.tokens[imported.start].line,
							`forbidden UI import ${imported.source}`,
						),
					);
				}
			}
		}
		return { fileCount: files.length, violations };
	},

	async "no-dynamic-eval"(root) {
		const { files, code } = await codeFiles(
			root,
			["apps", "packages", "scripts", "tooling"],
			new Set([".ts", ".tsx", ".mjs"]),
		);
		const violations = [];
		for (const file of code) {
			const { tokens } = file;
			for (let index = 0; index < tokens.length - 1; index += 1) {
				const token = tokens[index];
				if (token.type !== "identifier") continue;
				const previous = tokens[index - 1]?.value;
				const calls = tokens[index + 1].value === "(";
				if (token.value === "eval" && calls) {
					violations.push(violation(file.relativePath, token.line, "dynamic eval is forbidden"));
				}
				if (token.value === "new" && tokens[index + 1].value === "Function") {
					if (tokens[index + 2]?.value === "(") {
						violations.push(violation(file.relativePath, token.line, "new Function is forbidden"));
					}
					index += 1;
					continue;
				}
				if (token.value === "Function" && calls && previous !== "." && previous !== "?.") {
					violations.push(
						violation(file.relativePath, token.line, "Function constructor is forbidden"),
					);
				}
			}
			for (const imported of moduleImports(tokens)) {
				if (imported.source === "child_process" || imported.source === "node:child_process") {
					violations.push(
						violation(
							file.relativePath,
							tokens[imported.start].line,
							`${imported.source} import is forbidden`,
						),
					);
				}
			}
		}
		return { fileCount: files.length, violations };
	},

	async "tool-risk-declared"(root) {
		const allFiles = await collectFiles(root, ["packages/ai-core/src/aci"], new Set([".ts"]));
		const files = allFiles.filter((file) => file.startsWith("packages/ai-core/src/aci/"));
		const violations = [];
		for (const file of await readCodeFiles(root, files)) {
			const { tokens } = file;
			for (let index = 0; index < tokens.length - 1; index += 1) {
				if (tokens[index].value !== "defineAciTool" || tokens[index].type !== "identifier") {
					continue;
				}
				const open = skipTypeArguments(tokens, index + 1);
				if (tokens[open]?.value !== "(") continue;
				let parenthesisDepth = 0;
				let objectDepth = 0;
				let hasRisk = false;
				let cursor = open;
				for (; cursor < tokens.length; cursor += 1) {
					const value = tokens[cursor].value;
					if (value === "(") parenthesisDepth += 1;
					if (value === "{") objectDepth += 1;
					if (
						value === "risk" &&
						tokens[cursor].type === "identifier" &&
						parenthesisDepth === 1 &&
						objectDepth === 1 &&
						[",", "{"].includes(tokens[cursor - 1]?.value) &&
						[":", ",", "}"].includes(tokens[cursor + 1]?.value)
					) {
						hasRisk = true;
					}
					if (value === "}") objectDepth -= 1;
					if (value === ")") parenthesisDepth -= 1;
					if (parenthesisDepth === 0) break;
				}
				if (!hasRisk) {
					violations.push(
						violation(
							file.relativePath,
							tokens[index].line,
							"defineAciTool call must declare risk",
						),
					);
				}
				index = cursor;
			}
		}
		return { fileCount: files.length, violations };
	},

	async "actions-pinned"(root) {
		const files = await collectFiles(root, [".github/workflows"], WORKFLOW_EXTENSIONS);
		const violations = [];
		for (const relativePath of files) {
			const source = await readFile(path.join(root, relativePath), "utf8");
			const lines = source.split(/\r?\n/u);
			for (let index = 0; index < lines.length; index += 1) {
				const uses = lines[index].match(/^\s*(?:-\s*)?uses:\s*["']?([^\s#"']+)/u)?.[1];
				if (uses && !/@[0-9a-f]{40}$/iu.test(uses)) {
					violations.push(
						violation(relativePath, index + 1, `uses must pin a 40-character commit SHA: ${uses}`),
					);
				}
				const permissions = lines[index].match(/^(\s*)permissions\s*:\s*(.*?)\s*(?:#.*)?$/u);
				if (!permissions) continue;
				const [, indent, value] = permissions;
				// M1 needs no write scope, so `write-all` and every `<scope>: write` are rejected.
				if (/^["']?write-all["']?$/u.test(value)) {
					violations.push(
						violation(relativePath, index + 1, "permissions: write-all is forbidden"),
					);
				}
				for (const scope of value.matchAll(/([\w-]+)\s*:\s*["']?write\b/gu)) {
					violations.push(
						violation(relativePath, index + 1, `permissions ${scope[1]}: write is forbidden`),
					);
				}
				if (value !== "") continue;
				for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
					const text = lines[cursor];
					if (text.trim() === "" || /^\s*#/u.test(text)) continue;
					if (text.length - text.trimStart().length <= indent.length) break;
					const scope = text.match(/^\s*([\w-]+)\s*:\s*["']?write["']?\s*(?:#.*)?$/u)?.[1];
					if (scope) {
						violations.push(
							violation(relativePath, cursor + 1, `permissions ${scope}: write is forbidden`),
						);
					}
				}
			}
			const workflowPermissions = lines.some((line) => /^permissions\s*:/u.test(line));
			if (!workflowPermissions) {
				const jobsIndex = lines.findIndex((line) => /^jobs\s*:/u.test(line));
				if (jobsIndex >= 0) {
					for (let index = jobsIndex + 1; index < lines.length; index += 1) {
						const job = lines[index].match(/^ {2}([^\s#][^:]*):\s*(?:#.*)?$/u)?.[1];
						if (!job) continue;
						let end = index + 1;
						while (end < lines.length && !/^ {0,2}\S/u.test(lines[end])) end += 1;
						const hasPermissions = lines
							.slice(index + 1, end)
							.some((line) => /^ {4}permissions\s*:/u.test(line));
						if (!hasPermissions) {
							violations.push(
								violation(relativePath, index + 1, `job ${job} must declare permissions`),
							);
						}
						index = end - 1;
					}
				}
			}
		}
		return { fileCount: files.length, violations };
	},

	async "frozen-lockfile"(root) {
		const workflows = await collectFiles(root, [".github/workflows"], WORKFLOW_EXTENSIONS);
		const misePath = "mise.toml";
		const hasMise = await fileExists(path.join(root, misePath));
		const files = hasMise ? [...workflows, misePath] : workflows;
		const violations = [];
		const message = "dependency installation must use a frozen lockfile or mise run setup";
		for (const relativePath of workflows) {
			const lines = (await readFile(path.join(root, relativePath), "utf8")).split(/\r?\n/u);
			for (const { line, command } of workflowRunCommands(lines)) {
				for (const install of dependencyInstalls(command)) {
					if (install !== "frozen") {
						violations.push(violation(relativePath, line, `${message} (${install})`));
					}
				}
			}
		}
		// Workflows delegate to `mise run setup`, so the setup task itself must install frozen.
		const setup = hasMise
			? miseSetupCommands(await readFile(path.join(root, misePath), "utf8"))
			: undefined;
		if (!setup) {
			violations.push(violation(misePath, 1, "mise.toml must define the setup task [tasks.setup]"));
		} else {
			const installs = setup.commands.flatMap(dependencyInstalls);
			for (const install of installs.filter((entry) => entry !== "frozen")) {
				violations.push(
					violation(misePath, setup.line, `setup task must use a frozen lockfile (${install})`),
				);
			}
			if (!installs.includes("frozen")) {
				violations.push(
					violation(misePath, setup.line, "setup task must run pnpm install --frozen-lockfile"),
				);
			}
		}
		return { fileCount: files.length, violations };
	},

	async "allow-builds-reasoned"(root) {
		const relativePath = "pnpm-workspace.yaml";
		const files = (await fileExists(path.join(root, relativePath))) ? [relativePath] : [];
		const violations = [];
		const unsupported = (index) =>
			violations.push(
				violation(
					relativePath,
					index + 1,
					"unsupported allowBuilds format; use block style with a reason comment before each entry",
				),
			);
		if (files.length === 1) {
			const lines = (await readFile(path.join(root, relativePath), "utf8")).split(/\r?\n/u);
			const start = lines.findIndex((line) => /^allowBuilds\s*:/u.test(line));
			if (start >= 0) {
				if (!/^allowBuilds\s*:\s*(?:#.*)?$/u.test(lines[start])) unsupported(start);
				let entryIndent;
				for (let index = start + 1; index < lines.length; index += 1) {
					const text = lines[index];
					if (text.trim() === "" || /^\s*#/u.test(text)) continue;
					if (/^\S/u.test(text)) break;
					const indent = text.match(/^[ \t]*/u)[0];
					entryIndent ??= indent;
					// Only `<indent>key: scalar` entries at one consistent space indentation are supported.
					const entry = /^ +(?:"[^"]+"|'[^']+'|[^\s#"'{[-][^:#]*?)\s*:\s*[^\s#{[|>&*!][^#]*$/u.test(
						text,
					);
					if (!entry || indent !== entryIndent) {
						unsupported(index);
						continue;
					}
					const previous = lines[index - 1] ?? "";
					if (!/^\s*#/u.test(previous)) {
						violations.push(
							violation(
								relativePath,
								index + 1,
								"allowBuilds entry needs an immediate reason comment",
							),
						);
					}
				}
			}
		}
		return { fileCount: files.length, violations };
	},

	async "no-sensitive-logging"(root) {
		const { files, code } = await codeFiles(root, ["apps", "packages"]);
		const violations = [];
		for (const file of code) {
			for (let index = 0; index < file.tokens.length - 3; index += 1) {
				if (!new Set(["console", "logger"]).has(file.tokens[index].value)) continue;
				if (file.tokens[index + 1].value !== "." && file.tokens[index + 1].value !== "?.") continue;
				if (file.tokens[index + 3]?.value !== "(") continue;
				let depth = 0;
				for (let cursor = index + 3; cursor < file.tokens.length; cursor += 1) {
					const token = file.tokens[cursor];
					if (token.value === "(") depth += 1;
					if (token.value === ")") depth -= 1;
					if (
						depth > 0 &&
						token.type === "identifier" &&
						isSensitiveIdentifier(token.value) &&
						!isCountAccess(file.tokens, cursor)
					) {
						violations.push(
							violation(
								file.relativePath,
								token.line,
								`sensitive identifier ${token.value} must not be logged`,
							),
						);
					}
					if (depth === 0) {
						index = cursor;
						break;
					}
				}
			}
		}
		return { fileCount: files.length, violations };
	},
};

export function parseArgs(args) {
	if (args.length === 0) return { only: [...RULE_NAMES] };
	if (args.length !== 2 || args[0] !== "--only" || !args[1]) {
		throw new Error("Usage: node scripts/check-repo-rules.mjs [--only <rule,...>]");
	}
	const only = args[1]
		.split(",")
		.map((rule) => rule.trim())
		.filter(Boolean);
	if (only.length === 0) {
		throw new Error(
			"Usage: node scripts/check-repo-rules.mjs [--only <rule,...>] (no rule selected)",
		);
	}
	const unknown = only.filter((rule) => !RULE_NAMES.includes(rule));
	if (unknown.length > 0) throw new Error(`Unknown repository rule(s): ${unknown.join(", ")}`);
	return { only: [...new Set(only)] };
}

export async function checkRepoRules({ root = process.cwd(), only = RULE_NAMES } = {}) {
	if (only.length === 0) throw new Error("No repository rules selected");
	const unknown = only.filter((rule) => !RULE_NAMES.includes(rule));
	if (unknown.length > 0) throw new Error(`Unknown repository rule(s): ${unknown.join(", ")}`);
	const reports = [];
	for (const rule of only) {
		const result = await runners[rule](root);
		reports.push({ rule, ...result });
	}
	const output = reports
		.map(({ rule, fileCount }) => `${rule}: scanned ${fileCount} FILES`)
		.join("\n");
	const failures = reports.flatMap(({ rule, fileCount, violations }) => [
		...(fileCount === 0 ? [`${rule}: scanned 0 FILES`] : []),
		...violations.map((entry) => `${rule}: ${entry}`),
	]);
	const result = { output, reports };
	if (failures.length > 0) {
		throw new RepoRuleError(`${output}\n${failures.join("\n")}`, result);
	}
	return result;
}

async function main() {
	try {
		const result = await checkRepoRules({ only: parseArgs(process.argv.slice(2)).only });
		console.log(result.output);
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}

if (isMainModule(import.meta.url)) {
	await main();
}
