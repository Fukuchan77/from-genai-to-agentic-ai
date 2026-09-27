import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

function physicalPath(path) {
	try {
		return realpathSync(path);
	} catch {
		return undefined;
	}
}

/**
 * Reports whether the module at `moduleUrl` is the process entry point.
 * Compares physical paths so that a symlinked invocation still runs the CLI.
 */
export function isMainModule(moduleUrl, entryPath = process.argv[1]) {
	if (!entryPath) return false;
	const entry = physicalPath(entryPath);
	return entry !== undefined && entry === physicalPath(fileURLToPath(moduleUrl));
}

function processIo(proc) {
	return {
		argv: proc.argv.slice(2),
		cwd: proc.cwd(),
		readStdin: () => readFileSync(0, "utf8"),
		stderr: proc.stderr,
		stdout: proc.stdout,
	};
}

/**
 * Runs a script's `main(io)` when `moduleUrl` is the entry point, and sets the exit code to the
 * value `main` returns. A thrown error is reported on stderr and exits 1. Scripts keep all process
 * access here so that `main` can be tested in-process with `memoryIo`.
 */
export async function runIfMain(moduleUrl, main, proc = process) {
	if (!isMainModule(moduleUrl, proc.argv[1])) return;
	try {
		proc.exitCode = await main(processIo(proc));
	} catch (error) {
		proc.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		proc.exitCode = 1;
	}
}
