import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { runIfMain } from "./lib/cli.mjs";

const DEFAULT_DIRECTORY = "apps/web/.next/static";
const DEFAULT_SCHEMA = "packages/ai-core/src/config/env-schema.ts";
// `TOKEN` is a whole word (`GITHUB_TOKEN`): `AGENT_MAX_TOTAL_TOKENS` counts tokens, not a credential.
const SECRET_NAME = /(?:API_KEY|SECRET|PASSWORD|SALT|AUTH|ENCRYPTION_KEY|(?:^|_)TOKEN(?:$|_))/u;

/** Environment variable names in the config schema that hold secrets. */
export function secretEnvNames(schemaSource) {
	const names = [...schemaSource.matchAll(/^\s+([A-Z][A-Z0-9_]*):/gmu)].map((match) => match[1]);
	return [...new Set(names)].filter((name) => SECRET_NAME.test(name));
}

function listFiles(directory) {
	const files = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const full = path.join(directory, entry.name);
		if (entry.isDirectory()) files.push(...listFiles(full));
		else if (entry.isFile()) files.push(full);
	}
	return files;
}

/**
 * Looks for secret variable names and sentinel secret values in the client bundle. Fails when no
 * file was scanned, so a wrong directory cannot pass.
 */
export function inspectBundle({ directory, names, sentinels }) {
	const files = listFiles(directory);
	if (files.length === 0) throw new Error(`scanned 0 files in ${directory}`);
	const findings = [];
	for (const file of files) {
		const text = readFileSync(file, "utf8");
		for (const name of names) {
			if (text.includes(name))
				findings.push(`${path.relative(directory, file)}: variable name ${name}`);
		}
		for (const [index, sentinel] of sentinels.entries()) {
			if (text.includes(sentinel)) {
				findings.push(`${path.relative(directory, file)}: sentinel value #${index + 1}`);
			}
		}
	}
	return { scanned: files.length, findings };
}

function readFlags(argv) {
	const flags = { directory: undefined, schema: undefined, sentinels: [] };
	for (let index = 0; index < argv.length; index += 2) {
		const flag = argv[index];
		const value = argv[index + 1];
		if (value === undefined || value === "") throw new Error(`${flag} needs a value`);
		if (flag === "--dir") flags.directory = value;
		else if (flag === "--schema") flags.schema = value;
		else if (flag === "--sentinel") flags.sentinels.push(value);
		else throw new Error(`unknown option ${flag}`);
	}
	return flags;
}

export function main({ argv, cwd, stdout, stderr }) {
	try {
		const flags = readFlags(argv);
		const directory = path.resolve(cwd, flags.directory ?? DEFAULT_DIRECTORY);
		const schema = path.resolve(cwd, flags.schema ?? DEFAULT_SCHEMA);
		const names = secretEnvNames(readFileSync(schema, "utf8"));
		if (names.length === 0) throw new Error(`no secret variable names found in ${schema}`);
		const { scanned, findings } = inspectBundle({ directory, names, sentinels: flags.sentinels });
		if (findings.length > 0) {
			stderr.write(`check-client-bundle: secrets in the client bundle:\n${findings.join("\n")}\n`);
			return 1;
		}
		stdout.write(
			`Client bundle: scanned ${scanned} files for ${names.length} names and ${flags.sentinels.length} sentinels\n`,
		);
		return 0;
	} catch (error) {
		stderr.write(
			`check-client-bundle: ${error instanceof Error ? error.message : String(error)}\n`,
		);
		return 1;
	}
}

await runIfMain(import.meta.url, main);
