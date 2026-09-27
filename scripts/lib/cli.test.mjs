import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { isMainModule, runIfMain } from "./cli.mjs";
import { memoryIo } from "./memory-io.mjs";
import { GENERATED_DIRECTORY_NAMES, isGeneratedDirectory } from "./scan-exclusions.mjs";

const roots = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("isMainModule", () => {
	it("matches the module when argv[1] is its physical path", async () => {
		const root = await mkdtemp(join(tmpdir(), "cli-main-"));
		roots.push(root);
		const file = join(root, "tool.mjs");
		await writeFile(file, "");

		expect(isMainModule(pathToFileURL(file).href, file)).toBe(true);
	});

	it("matches the module when argv[1] reaches it through a symlink", async () => {
		const root = await mkdtemp(join(tmpdir(), "cli-link-"));
		roots.push(root);
		const file = join(root, "tool.mjs");
		const link = join(root, "linked.mjs");
		await writeFile(file, "");
		await symlink(file, link);

		expect(isMainModule(pathToFileURL(file).href, link)).toBe(true);
	});

	it("does not match another file or a missing argv[1]", async () => {
		const root = await mkdtemp(join(tmpdir(), "cli-other-"));
		roots.push(root);
		const file = join(root, "tool.mjs");
		const other = join(root, "other.mjs");
		await writeFile(file, "");
		await writeFile(other, "");

		expect(isMainModule(pathToFileURL(file).href, other)).toBe(false);
		expect(isMainModule(pathToFileURL(file).href, undefined)).toBe(false);
		expect(isMainModule(pathToFileURL(file).href, join(root, "missing.mjs"))).toBe(false);
	});
});

describe("runIfMain", () => {
	async function entryFile() {
		const root = await mkdtemp(join(tmpdir(), "cli-run-"));
		roots.push(root);
		const file = join(root, "tool.mjs");
		await writeFile(file, "");
		return file;
	}

	function fakeProcess(entry, args = []) {
		const io = memoryIo();
		return {
			io,
			proc: {
				argv: ["node", entry, ...args],
				cwd: () => "/work",
				exitCode: undefined,
				stderr: io.stderr,
				stdout: io.stdout,
			},
		};
	}

	it.each([0, 1])("sets the process exit code to the %i that main returns", async (code) => {
		const file = await entryFile();
		const { proc } = fakeProcess(file);

		await runIfMain(pathToFileURL(file).href, async () => code, proc);

		expect(proc.exitCode).toBe(code);
	});

	it("passes the arguments after the entry path and the working directory to main", async () => {
		const file = await entryFile();
		const { proc } = fakeProcess(file, ["--only", "a"]);
		let received;

		await runIfMain(
			pathToFileURL(file).href,
			(io) => {
				received = { argv: io.argv, cwd: io.cwd };
				return 0;
			},
			proc,
		);

		expect(received).toEqual({ argv: ["--only", "a"], cwd: "/work" });
	});

	it("exits 1 and reports the message when main throws", async () => {
		const file = await entryFile();
		const { io, proc } = fakeProcess(file);

		await runIfMain(
			pathToFileURL(file).href,
			() => {
				throw new Error("boom");
			},
			proc,
		);

		expect(proc.exitCode).toBe(1);
		expect(io.stderrText()).toBe("boom\n");
	});

	it("does not run main when the module is not the entry point", async () => {
		const file = await entryFile();
		const { proc } = fakeProcess(join(file, "..", "other.mjs"));
		let called = false;

		await runIfMain(
			pathToFileURL(file).href,
			() => {
				called = true;
				return 1;
			},
			proc,
		);

		expect(called).toBe(false);
		expect(proc.exitCode).toBeUndefined();
	});
});

describe("memoryIo", () => {
	it("captures writes and serves the given stdin", () => {
		const io = memoryIo({ argv: ["x"], cwd: "/root", stdin: "input" });
		io.stdout.write("a");
		io.stdout.write("b");
		io.stderr.write("c");

		expect(io).toMatchObject({ argv: ["x"], cwd: "/root" });
		expect(io.readStdin()).toBe("input");
		expect(io.stdoutText()).toBe("ab");
		expect(io.stderrText()).toBe("c");
	});
});

describe("generated directory exclusions", () => {
	it.each([
		"node_modules",
		".git",
		".next",
		".turbo",
		"coverage",
		"dist",
		".stryker-tmp",
		"playwright-report",
		"test-results",
	])("excludes %s", (name) => {
		expect(isGeneratedDirectory(name)).toBe(true);
		expect(GENERATED_DIRECTORY_NAMES).toContain(name);
	});

	it("keeps source directories", () => {
		expect(isGeneratedDirectory("src")).toBe(false);
		expect(isGeneratedDirectory("lib")).toBe(false);
	});
});
