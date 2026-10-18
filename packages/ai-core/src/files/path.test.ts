import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type PathError, resolveWorkspacePath } from "./path";

let sandbox: string;
let root: string;
let sibling: string;
let outside: string;

beforeAll(async () => {
	// realpath: macOS reports /var/folders as /private/var/folders, and the checks compare real paths.
	sandbox = await realpath(await mkdtemp(join(tmpdir(), "files-path-")));
	root = join(sandbox, "root");
	sibling = join(sandbox, "root-evil");
	outside = join(sandbox, "outside");
	await mkdir(join(root, "docs"), { recursive: true });
	await mkdir(sibling);
	await mkdir(outside);
	await writeFile(join(root, "notes.txt"), "inside");
	await writeFile(join(root, "docs", "a.md"), "a");
	await writeFile(join(sibling, "secret.txt"), "sibling");
	await writeFile(join(outside, "secret.txt"), "outside");
	await symlink(outside, join(root, "link-out"));
	await symlink(join(sibling, "secret.txt"), join(root, "link-sibling-file"));
	await symlink(join(root, "notes.txt"), join(root, "link-in"));
});

afterAll(async () => {
	await rm(sandbox, { recursive: true, force: true });
});

function errorOf(result: Awaited<ReturnType<typeof resolveWorkspacePath>>): PathError {
	if (result.ok) throw new Error(`expected an error, received ${result.value}`);
	return result.error;
}

describe("resolveWorkspacePath", () => {
	it("accepts the root itself and returns its real path", async () => {
		const result = await resolveWorkspacePath(root, root);
		expect(result).toEqual({ ok: true, value: root });
	});

	it("accepts an absolute path inside the root", async () => {
		const result = await resolveWorkspacePath(root, join(root, "docs", "a.md"));
		expect(result).toEqual({ ok: true, value: join(root, "docs", "a.md") });
	});

	it("normalises a path that contains `..` but stays inside the root", async () => {
		const result = await resolveWorkspacePath(root, `${root}/docs/../notes.txt`);
		expect(result).toEqual({ ok: true, value: join(root, "notes.txt") });
	});

	it("accepts a symbolic link that stays inside the root and returns the real target", async () => {
		const result = await resolveWorkspacePath(root, join(root, "link-in"));
		expect(result).toEqual({ ok: true, value: join(root, "notes.txt") });
	});

	it.each([
		["a bare name", "notes.txt"],
		["a dot-relative path", "./notes.txt"],
		["a parent-relative path", "../outside/secret.txt"],
		["the empty-looking dot", "."],
		["a tilde path", "~/notes.txt"],
	])("rejects %s as relative", async (_label, input) => {
		expect(errorOf(await resolveWorkspacePath(root, input))).toBe("relative");
	});

	it("rejects an absolute path whose `..` segments leave the root", async () => {
		const input = `${root}/docs/../../outside/secret.txt`;
		expect(errorOf(await resolveWorkspacePath(root, input))).toBe("outside-root");
	});

	it("rejects a sibling directory that shares the root's prefix", async () => {
		expect(errorOf(await resolveWorkspacePath(root, join(sibling, "secret.txt")))).toBe(
			"outside-root",
		);
		expect(errorOf(await resolveWorkspacePath(root, sibling))).toBe("outside-root");
	});

	it("rejects a symbolic link that points to a directory outside the root", async () => {
		const input = join(root, "link-out", "secret.txt");
		expect(errorOf(await resolveWorkspacePath(root, input))).toBe("outside-root");
	});

	it("rejects a symbolic link that points to a file in a prefix-sharing sibling", async () => {
		expect(errorOf(await resolveWorkspacePath(root, join(root, "link-sibling-file")))).toBe(
			"outside-root",
		);
	});

	it("reports a path that does not exist inside the root as not-found", async () => {
		expect(errorOf(await resolveWorkspacePath(root, join(root, "missing.txt")))).toBe("not-found");
		expect(errorOf(await resolveWorkspacePath(root, join(root, "no-dir", "x.txt")))).toBe(
			"not-found",
		);
	});

	it("rejects an escape through a missing path before it reports not-found", async () => {
		// The path does not exist, but its lexical form already leaves the root: the answer must not
		// reveal whether files outside the root exist.
		expect(errorOf(await resolveWorkspacePath(root, join(sibling, "missing.txt")))).toBe(
			"outside-root",
		);
	});

	it("reports a broken symbolic link that is inside the root as not-found", async () => {
		await symlink(join(root, "gone.txt"), join(root, "link-broken"));
		expect(errorOf(await resolveWorkspacePath(root, join(root, "link-broken")))).toBe("not-found");
	});

	it.each([
		["an empty string", ""],
		["a NUL byte", `${root}/notes\0.txt`],
		["a very long path", `${root}/${"a".repeat(5000)}`],
	])("reports %s as invalid", async (_label, input) => {
		expect(errorOf(await resolveWorkspacePath(root, input))).toBe("invalid");
	});

	it("reports a non-string input as invalid", async () => {
		expect(errorOf(await resolveWorkspacePath(root, 42 as unknown as string))).toBe("invalid");
	});

	it("treats a path below a regular file as not-found, and below a link to an outside file as an escape", async () => {
		await symlink(join(outside, "secret.txt"), join(root, "link-out-file"));
		expect(errorOf(await resolveWorkspacePath(root, join(root, "notes.txt", "x")))).toBe(
			"not-found",
		);
		expect(errorOf(await resolveWorkspacePath(root, join(root, "link-out-file", "x")))).toBe(
			"outside-root",
		);
	});

	it("reports a root that does not exist as invalid", async () => {
		expect(errorOf(await resolveWorkspacePath(join(sandbox, "nope"), join(sandbox, "nope")))).toBe(
			"invalid",
		);
	});

	it("treats a trailing slash on the root the same as without", async () => {
		const result = await resolveWorkspacePath(`${root}/`, join(root, "notes.txt"));
		expect(result).toEqual({ ok: true, value: join(root, "notes.txt") });
	});
});
