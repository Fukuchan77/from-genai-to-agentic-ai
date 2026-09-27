import { realpathSync } from "node:fs";
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
