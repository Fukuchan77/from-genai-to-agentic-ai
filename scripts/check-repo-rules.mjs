import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

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
				await visit(absolutePath);
			} else if (entry.isFile() && extensions.has(path.extname(entry.name))) {
				const relativePath = normalize(path.relative(root, absolutePath));
				if (!isCheckerFile(relativePath)) files.push(relativePath);
			}
		}
	}
	for (const directory of directories) await visit(path.join(root, directory));
	return files.sort();
}

function canStartRegex(previous) {
	return (
		!previous ||
		new Set([
			"(",
			"[",
			"{",
			",",
			";",
			":",
			"=",
			"!",
			"?",
			"&&",
			"||",
			"=>",
			"return",
			"case",
			"throw",
		]).has(previous.value)
	);
}

function tokenize(source) {
	const tokens = [];
	let index = 0;
	let line = 1;
	const advance = () => {
		if (source[index] === "\n") line += 1;
		index += 1;
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
			while (index < source.length && source[index] !== quote) {
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
			tokens.push({ type: "string", value, line: tokenLine });
			continue;
		}
		if (character === "`") {
			advance();
			while (index < source.length && source[index] !== "`") {
				if (source[index] === "\\") advance();
				if (index < source.length) advance();
			}
			if (source[index] === "`") advance();
			continue;
		}
		if (character === "/" && canStartRegex(tokens.at(-1))) {
			advance();
			let inClass = false;
			while (index < source.length) {
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
			continue;
		}
		const identifier = source.slice(index).match(/^[A-Za-z_$][\w$]*/u)?.[0];
		if (identifier) {
			tokens.push({ type: "identifier", value: identifier, line });
			index += identifier.length;
			continue;
		}
		const punctuator = ["=>", "&&", "||", "?."].find((value) => source.startsWith(value, index));
		tokens.push({ type: "punctuator", value: punctuator ?? character, line });
		index += (punctuator ?? character).length;
	}
	return tokens;
}

function moduleImports(tokens) {
	const imports = [];
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (token.value === "import") {
			if (tokens[index + 1]?.type === "string") {
				imports.push({ source: tokens[index + 1].value, start: index, end: index + 1 });
				continue;
			}
			if (tokens[index + 1]?.value === "(" && tokens[index + 2]?.type === "string") {
				imports.push({ source: tokens[index + 2].value, start: index, end: index + 2 });
				continue;
			}
			for (
				let cursor = index + 1;
				cursor < tokens.length && tokens[cursor].value !== ";";
				cursor += 1
			) {
				if (tokens[cursor].value === "from" && tokens[cursor + 1]?.type === "string") {
					imports.push({ source: tokens[cursor + 1].value, start: index, end: cursor + 1 });
					break;
				}
			}
		}
		if (token.value === "export") {
			for (
				let cursor = index + 1;
				cursor < tokens.length && tokens[cursor].value !== ";";
				cursor += 1
			) {
				if (tokens[cursor].value === "from" && tokens[cursor + 1]?.type === "string") {
					imports.push({ source: tokens[cursor + 1].value, start: index, end: cursor + 1 });
					break;
				}
			}
		}
	}
	return imports;
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

const runners = {
	async "no-deprecated-object-api"(root) {
		const { files, code } = await codeFiles(root, ["apps", "packages"]);
		const violations = [];
		for (const file of code) {
			for (const imported of moduleImports(file.tokens).filter(({ source }) => source === "ai")) {
				for (const token of file.tokens.slice(imported.start, imported.end)) {
					if (token.value === "generateObject" || token.value === "streamObject") {
						violations.push(
							violation(file.relativePath, token.line, `deprecated ai import ${token.value}`),
						);
					}
				}
			}
		}
		return { fileCount: files.length, violations };
	},

	async "guarded-agent-only"(root) {
		const { files, code } = await codeFiles(root, ["apps", "packages"]);
		const violations = [];
		for (const file of code) {
			if (file.relativePath === "packages/ai-core/src/agents/guarded-agent.ts") continue;
			for (let index = 0; index < file.tokens.length - 1; index += 1) {
				if (
					file.tokens[index].value === "new" &&
					file.tokens[index + 1].value === "ToolLoopAgent"
				) {
					violations.push(
						violation(file.relativePath, file.tokens[index].line, "ToolLoopAgent must be guarded"),
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
			for (let index = 0; index < file.tokens.length - 1; index += 1) {
				const token = file.tokens[index];
				if (token.value === "eval" && file.tokens[index + 1].value === "(") {
					violations.push(violation(file.relativePath, token.line, "dynamic eval is forbidden"));
				}
				if (
					token.value === "new" &&
					file.tokens[index + 1].value === "Function" &&
					file.tokens[index + 2]?.value === "("
				) {
					violations.push(violation(file.relativePath, token.line, "new Function is forbidden"));
				}
			}
			for (const imported of moduleImports(file.tokens)) {
				if (imported.source === "child_process" || imported.source === "node:child_process") {
					violations.push(
						violation(
							file.relativePath,
							file.tokens[imported.start].line,
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
			for (let index = 0; index < file.tokens.length - 1; index += 1) {
				if (file.tokens[index].value !== "defineAciTool" || file.tokens[index + 1].value !== "(")
					continue;
				let parenthesisDepth = 0;
				let objectDepth = 0;
				let hasRisk = false;
				let cursor = index + 1;
				for (; cursor < file.tokens.length; cursor += 1) {
					const value = file.tokens[cursor].value;
					if (value === "(") parenthesisDepth += 1;
					if (value === "{") objectDepth += 1;
					if (
						value === "risk" &&
						parenthesisDepth === 1 &&
						objectDepth === 1 &&
						file.tokens[cursor + 1]?.value === ":"
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
							file.tokens[index].line,
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
		const files = await collectFiles(root, [".github/workflows"], new Set([".yml"]));
		const violations = [];
		for (const relativePath of files) {
			const source = await readFile(path.join(root, relativePath), "utf8");
			const lines = source.split(/\r?\n/u);
			for (let index = 0; index < lines.length; index += 1) {
				const uses = lines[index].match(/^\s*(?:-\s*)?uses:\s*([^\s#]+)/u)?.[1];
				if (uses && !/@[0-9a-f]{40}$/iu.test(uses)) {
					violations.push(
						violation(relativePath, index + 1, `uses must pin a 40-character commit SHA: ${uses}`),
					);
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
		const files = await collectFiles(root, [".github/workflows"], new Set([".yml"]));
		const violations = [];
		for (const relativePath of files) {
			const lines = (await readFile(path.join(root, relativePath), "utf8")).split(/\r?\n/u);
			for (let index = 0; index < lines.length; index += 1) {
				if (
					/\bpnpm\s+(?:install|i)\b/u.test(lines[index]) &&
					!/--frozen-lockfile\b/u.test(lines[index])
				) {
					violations.push(
						violation(
							relativePath,
							index + 1,
							"dependency installation must use a frozen lockfile or mise run setup",
						),
					);
				}
			}
		}
		return { fileCount: files.length, violations };
	},

	async "allow-builds-reasoned"(root) {
		const relativePath = "pnpm-workspace.yaml";
		const files = (await fileExists(path.join(root, relativePath))) ? [relativePath] : [];
		const violations = [];
		if (files.length === 1) {
			const lines = (await readFile(path.join(root, relativePath), "utf8")).split(/\r?\n/u);
			const start = lines.findIndex((line) => /^allowBuilds\s*:/u.test(line));
			if (start >= 0) {
				for (let index = start + 1; index < lines.length; index += 1) {
					if (/^\S/u.test(lines[index])) break;
					if (/^ {2}["']?[^\s#][^:]*["']?\s*:/u.test(lines[index])) {
						if (!/^\s*#/u.test(lines[index - 1] ?? "")) {
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
		}
		return { fileCount: files.length, violations };
	},

	async "no-sensitive-logging"(root) {
		const { files, code } = await codeFiles(root, ["apps", "packages"]);
		const violations = [];
		const sensitive = /(?:prompt|messages|input|apiKey)/iu;
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
					if (depth > 0 && token.type === "identifier" && sensitive.test(token.value)) {
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
	const unknown = only.filter((rule) => !RULE_NAMES.includes(rule));
	if (unknown.length > 0) throw new Error(`Unknown repository rule(s): ${unknown.join(", ")}`);
	return { only: [...new Set(only)] };
}

export async function checkRepoRules({ root = process.cwd(), only = RULE_NAMES } = {}) {
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await main();
}
