import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { isMainModule } from "./cli.mjs";
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
