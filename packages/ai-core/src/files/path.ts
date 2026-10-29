import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";

/** Why a path was not accepted. A closed vocabulary: the tools map each kind to a result. */
export type PathError = "relative" | "outside-root" | "not-found" | "invalid";

export type Result<T, E> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly error: E };

const MAX_PATH_CHARACTERS = 4096;

function isInside(root: string, candidate: string): boolean {
	if (candidate === root) return true;
	// Compare whole path segments: `/work/root-evil` shares the prefix `/work/root` but is not inside it.
	const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
	return candidate.startsWith(prefix);
}

function errorCode(error: unknown): string | undefined {
	if (typeof error !== "object" || error === null) return undefined;
	const code = (error as { code?: unknown }).code;
	return typeof code === "string" ? code : undefined;
}

/**
 * The real path of `target`, resolving symbolic links in the part that exists. When the tail does not
 * exist yet, the nearest existing ancestor is resolved and the missing segments are appended, so an
 * escape through a missing path is still seen as an escape.
 */
async function resolveExistingPrefix(
	target: string,
): Promise<{ readonly real: string; readonly exists: boolean }> {
	const missing: string[] = [];
	let current = target;
	for (;;) {
		try {
			const real = await realpath(current);
			return { real: join(real, ...missing.reverse()), exists: missing.length === 0 };
		} catch (error) {
			const code = errorCode(error);
			if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
			const parent = dirname(current);
			if (parent === current) throw error;
			missing.push(current.slice(parent.length === 1 ? 1 : parent.length + 1));
			current = parent;
		}
	}
}

/**
 * Accepts only an absolute path whose real path (symbolic links resolved) is the allowed root or
 * inside it, judged per path segment (Req 1.4, 1.5). A relative path is rejected before the file
 * system is touched. A path that escapes the root is `outside-root` even when it does not exist,
 * so the answer never reveals what exists outside the root.
 */
export async function resolveWorkspacePath(
	root: string,
	input: string,
): Promise<Result<string, PathError>> {
	if (typeof input !== "string" || input.length === 0 || input.includes("\0")) {
		return { ok: false, error: "invalid" };
	}
	if (input.length > MAX_PATH_CHARACTERS) return { ok: false, error: "invalid" };
	if (!isAbsolute(input)) return { ok: false, error: "relative" };

	let realRoot: string;
	try {
		realRoot = await realpath(root);
	} catch {
		return { ok: false, error: "invalid" };
	}

	try {
		const { real, exists } = await resolveExistingPrefix(resolve(input));
		if (!isInside(realRoot, real)) return { ok: false, error: "outside-root" };
		return exists ? { ok: true, value: real } : { ok: false, error: "not-found" };
	} catch {
		// EACCES, ELOOP, ENAMETOOLONG and the like: the path cannot be used, and the cause stays out of the result.
		return { ok: false, error: "invalid" };
	}
}
