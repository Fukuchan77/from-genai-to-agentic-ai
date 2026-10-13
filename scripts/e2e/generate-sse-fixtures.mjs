import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Where the generated UI message streams live (plan C19). */
export const FIXTURE_DIRECTORY = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"apps",
	"web",
	"e2e",
	"fixtures",
);

export const WRITE_MODE_VARIABLE = "SSE_FIXTURES";

function firstDifference(expected, actual) {
	const left = expected.split("\n");
	const right = actual.split("\n");
	const length = Math.max(left.length, right.length);
	for (let index = 0; index < length; index += 1) {
		if (left[index] !== right[index]) {
			return `line ${index + 1}: expected ${JSON.stringify(left[index])}, got ${JSON.stringify(right[index])}`;
		}
	}
	return "no difference";
}

const FIXTURE_KINDS = Object.freeze({ ".sse": "SSE fixture", ".json": "JSON fixture" });

/**
 * The single place that touches the generated fixtures: `.sse` streams and `.json` bodies. The
 * Route Handler tests pass the stream (or the JSON text) a real handler produced in `mock` mode:
 * with `SSE_FIXTURES=write` (`mise run e2e:fixtures`) the fixture is written; otherwise it must
 * match byte for byte, so a stale fixture fails the test instead of silently feeding the E2E
 * specs an outdated response. Fixtures are never written by hand.
 */
export function verifyOrWriteFixture(
	name,
	text,
	{ write = process.env[WRITE_MODE_VARIABLE] === "write", directory = FIXTURE_DIRECTORY } = {},
) {
	const kind = Object.entries(FIXTURE_KINDS).find(([suffix]) => name.endsWith(suffix))?.[1];
	if (kind === undefined) throw new Error(`fixture name must end with .sse or .json: ${name}`);
	if (text.length === 0) throw new Error(`refusing to use an empty stream for ${name}`);
	const file = path.join(directory, name);
	if (write) {
		mkdirSync(directory, { recursive: true });
		writeFileSync(file, text);
		return "written";
	}
	let expected;
	try {
		expected = readFileSync(file, "utf8");
	} catch (error) {
		if (error?.code === "ENOENT") {
			throw new Error(`${kind} ${name} is missing; run \`mise run e2e:fixtures\``);
		}
		throw error;
	}
	if (expected !== text) {
		throw new Error(
			`${kind} ${name} is stale (${firstDifference(expected, text)}); run \`mise run e2e:fixtures\``,
		);
	}
	return "match";
}
