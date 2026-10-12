import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_RAG } from "../../config/defaults";
import { PlatformError } from "../../errors";
import { buildTextPdf } from "../../testing/pdf-builder";
import { isSkippedFile, loadKnowledgeFile, type SkippedFile } from "./loader";

let sandbox: string;
let root: string;
let outside: string;

beforeEach(async () => {
	sandbox = await realpath(await mkdtemp(join(tmpdir(), "ingest-loader-")));
	root = join(sandbox, "knowledge");
	outside = join(sandbox, "outside");
	await mkdir(root);
	await mkdir(outside);
});

afterEach(async () => {
	await rm(sandbox, { recursive: true, force: true });
});

function skipped(file: string, reason: SkippedFile["reason"]): SkippedFile {
	return { file, reason };
}

describe("loadKnowledgeFile: loading", () => {
	it("loads a Markdown file with title, tags and heading sections", async () => {
		await writeFile(
			join(root, "guide.md"),
			"---\ntags: [rag, search]\n---\n# RAG の基礎\n導入。\n## 検索\n本文。\n",
		);

		const result = await loadKnowledgeFile(root, "guide.md");

		expect(result).toEqual({
			file: "guide.md",
			title: "RAG の基礎",
			sourceType: "markdown",
			tags: ["rag", "search"],
			sections: [
				{ headingPath: ["RAG の基礎"], body: "導入。" },
				{ headingPath: ["RAG の基礎", "検索"], body: "本文。" },
			],
		});
	});

	it("accepts the .markdown and upper-case extensions", async () => {
		await writeFile(join(root, "a.markdown"), "# A\ntext");
		await writeFile(join(root, "B.MD"), "# B\ntext");

		expect(await loadKnowledgeFile(root, "a.markdown")).toMatchObject({ sourceType: "markdown" });
		expect(await loadKnowledgeFile(root, "B.MD")).toMatchObject({ sourceType: "markdown" });
	});

	it("falls back to the file name without extension when there is no heading", async () => {
		await writeFile(join(root, "plain-notes.md"), "just text, no heading");

		expect(await loadKnowledgeFile(root, "plain-notes.md")).toMatchObject({
			title: "plain-notes",
			sections: [{ headingPath: [], body: "just text, no heading" }],
		});
	});

	it("strips a UTF-8 BOM", async () => {
		await writeFile(join(root, "bom.md"), "﻿# Title\nbody");

		expect(await loadKnowledgeFile(root, "bom.md")).toMatchObject({ title: "Title" });
	});

	it("loads a PDF as pages with no tags", async () => {
		await writeFile(join(root, "paper.pdf"), buildTextPdf(["page one text", "page two text"]));

		const result = await loadKnowledgeFile(root, "paper.pdf");

		expect(isSkippedFile(result)).toBe(false);
		expect(result).toMatchObject({
			file: "paper.pdf",
			title: "paper",
			sourceType: "pdf",
			tags: [],
		});
		if (!isSkippedFile(result) && result.sourceType === "pdf") {
			expect(result.pages.map((page) => page.trim())).toEqual(["page one text", "page two text"]);
		}
	});

	it("follows a symlink that stays inside the root", async () => {
		await writeFile(join(root, "real.md"), "# Real\nbody");
		await symlink(join(root, "real.md"), join(root, "alias.md"));

		expect(await loadKnowledgeFile(root, "alias.md")).toMatchObject({ title: "Real" });
	});

	it("works when the root itself is reached through a symlink", async () => {
		await writeFile(join(root, "doc.md"), "# Doc\nbody");
		const linkedRoot = join(sandbox, "linked-root");
		await symlink(root, linkedRoot);

		expect(await loadKnowledgeFile(linkedRoot, "doc.md")).toMatchObject({ title: "Doc" });
	});

	it("accepts a file exactly at the size limit", async () => {
		await writeFile(join(root, "edge.md"), `# T\n${"a".repeat(96)}`);

		const result = await loadKnowledgeFile(root, "edge.md", { maxBytes: 100 });

		expect(isSkippedFile(result)).toBe(false);
	});
});

describe("loadKnowledgeFile: file name validation", () => {
	const invalidNames: [string, string][] = [
		["parent directory", ".."],
		["current directory", "."],
		["relative traversal", "../secret.md"],
		["deep traversal", "../../etc/passwd"],
		["nested path", "sub/doc.md"],
		["absolute path", "/etc/passwd"],
		["backslash separator", "sub\\doc.md"],
		["backslash traversal", "..\\secret.md"],
		["percent-encoded separator", "%2e%2e/secret.md"],
		["hidden file", ".hidden.md"],
		["dot env file", ".env"],
		["NUL byte", "doc\u0000.md"],
		["NUL byte before extension check", "doc.md\u0000.txt"],
		["empty name", ""],
	];

	it.each(invalidNames)("rejects %s with invalid-request", async (_label, name) => {
		await writeFile(join(root, "doc.md"), "# Doc\nbody");

		const error = await loadKnowledgeFile(root, name).catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(PlatformError);
		expect(error).toMatchObject({
			code: "invalid-request",
			details: { reason: "invalid-file-name" },
		});
	});

	it("rejects an invalid name before touching the file system", async () => {
		const missingRoot = join(sandbox, "does-not-exist");

		await expect(loadKnowledgeFile(missingRoot, "../x.md")).rejects.toMatchObject({
			code: "invalid-request",
		});
	});

	it("rejects a hidden file even when it exists", async () => {
		await writeFile(join(root, ".secret.md"), "# Secret\nbody");

		await expect(loadKnowledgeFile(root, ".secret.md")).rejects.toMatchObject({
			code: "invalid-request",
		});
	});

	it("rejects a symlink that points to a file outside the root", async () => {
		await writeFile(join(outside, "secret.md"), "# Secret\nleaked");
		await symlink(join(outside, "secret.md"), join(root, "escape.md"));

		const error = await loadKnowledgeFile(root, "escape.md").catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(PlatformError);
		expect(error).toMatchObject({ code: "invalid-request", details: { reason: "outside-root" } });
	});

	it("rejects a symlink to a directory outside the root", async () => {
		await symlink(outside, join(root, "dir-escape.md"));

		await expect(loadKnowledgeFile(root, "dir-escape.md")).rejects.toMatchObject({
			code: "invalid-request",
		});
	});

	it("rejects an escaping symlink even when its extension is unsupported", async () => {
		await writeFile(join(outside, "secret.txt"), "leaked");
		await symlink(join(outside, "secret.txt"), join(root, "escape.txt"));

		await expect(loadKnowledgeFile(root, "escape.txt")).rejects.toMatchObject({
			code: "invalid-request",
		});
	});

	it("rejects a symlink chain that ends outside the root", async () => {
		await writeFile(join(outside, "secret.md"), "# Secret\nleaked");
		await symlink(join(outside, "secret.md"), join(root, "hop-1.md"));
		await symlink(join(root, "hop-1.md"), join(root, "hop-2.md"));

		await expect(loadKnowledgeFile(root, "hop-2.md")).rejects.toMatchObject({
			code: "invalid-request",
		});
	});
});

describe("loadKnowledgeFile: skipped files", () => {
	it("reports a missing file as not-found", async () => {
		expect(await loadKnowledgeFile(root, "missing.md")).toEqual(skipped("missing.md", "not-found"));
	});

	it("reports a missing root as not-found for the file", async () => {
		const result = await loadKnowledgeFile(join(sandbox, "no-such-root"), "doc.md");

		expect(result).toEqual(skipped("doc.md", "not-found"));
	});

	it("reports a directory as not-found", async () => {
		await mkdir(join(root, "folder.md"));

		expect(await loadKnowledgeFile(root, "folder.md")).toEqual(skipped("folder.md", "not-found"));
	});

	it("reports a dangling symlink as not-found", async () => {
		await symlink(join(root, "gone.md"), join(root, "dangling.md"));

		expect(await loadKnowledgeFile(root, "dangling.md")).toEqual(
			skipped("dangling.md", "not-found"),
		);
	});

	it("reports a symlink loop as not-found", async () => {
		await symlink(join(root, "loop-b.md"), join(root, "loop-a.md"));
		await symlink(join(root, "loop-a.md"), join(root, "loop-b.md"));

		expect(await loadKnowledgeFile(root, "loop-a.md")).toEqual(skipped("loop-a.md", "not-found"));
	});

	it.each(["notes.txt", "image.png", "archive.md.zip", "README", "page.html"])(
		"reports %s as unsupported-format",
		async (name) => {
			await writeFile(join(root, name), "content");

			expect(await loadKnowledgeFile(root, name)).toEqual(skipped(name, "unsupported-format"));
		},
	);

	it("reports a file over the size limit as too-large", async () => {
		await writeFile(join(root, "big.md"), `# T\n${"a".repeat(200)}`);

		expect(await loadKnowledgeFile(root, "big.md", { maxBytes: 100 })).toEqual(
			skipped("big.md", "too-large"),
		);
	});

	it("applies DEFAULT_RAG.maxIngestFileBytes by default", async () => {
		await writeFile(join(root, "huge.md"), Buffer.alloc(DEFAULT_RAG.maxIngestFileBytes + 1, 97));

		expect(await loadKnowledgeFile(root, "huge.md")).toEqual(skipped("huge.md", "too-large"));
	});

	it("checks the size before parsing, so an oversized broken PDF is too-large", async () => {
		await writeFile(join(root, "big.pdf"), Buffer.alloc(300, 0));

		expect(await loadKnowledgeFile(root, "big.pdf", { maxBytes: 100 })).toEqual(
			skipped("big.pdf", "too-large"),
		);
	});

	it.each([
		["an empty file", ""],
		["a whitespace-only file", "  \n\t\n"],
		["headings without any body text", "# One\n## Two\n### Three\n"],
	])("reports %s as no-text", async (_label, content) => {
		await writeFile(join(root, "empty.md"), content);

		expect(await loadKnowledgeFile(root, "empty.md")).toEqual(skipped("empty.md", "no-text"));
	});

	it("reports a PDF whose pages are all empty as no-text", async () => {
		await writeFile(join(root, "scan.pdf"), buildTextPdf(["", ""]));

		expect(await loadKnowledgeFile(root, "scan.pdf")).toEqual(skipped("scan.pdf", "no-text"));
	});

	it("reports bytes that are not a PDF as parse-failed", async () => {
		await writeFile(join(root, "broken.pdf"), "this is not a pdf");

		expect(await loadKnowledgeFile(root, "broken.pdf")).toEqual(
			skipped("broken.pdf", "parse-failed"),
		);
	});

	it("reports invalid UTF-8 Markdown as parse-failed", async () => {
		await writeFile(join(root, "latin1.md"), Buffer.from([0x23, 0x20, 0xc3, 0x28, 0x0a, 0x78]));

		expect(await loadKnowledgeFile(root, "latin1.md")).toEqual(
			skipped("latin1.md", "parse-failed"),
		);
	});

	it("produces all five skip reasons", async () => {
		await writeFile(join(root, "a.txt"), "x");
		await writeFile(join(root, "b.md"), "");
		await writeFile(join(root, "c.pdf"), "nope");
		await writeFile(join(root, "d.md"), "x".repeat(DEFAULT_RAG.maxIngestFileBytes + 1));

		const results = await Promise.all(
			["a.txt", "b.md", "c.pdf", "d.md", "e.md"].map((name) => loadKnowledgeFile(root, name)),
		);

		expect(results.map((result) => (isSkippedFile(result) ? result.reason : "loaded"))).toEqual([
			"unsupported-format",
			"no-text",
			"parse-failed",
			"too-large",
			"not-found",
		]);
	});
});

describe("isSkippedFile", () => {
	it("tells skipped files from loaded documents", async () => {
		await writeFile(join(root, "ok.md"), "# Ok\nbody");

		expect(isSkippedFile(await loadKnowledgeFile(root, "ok.md"))).toBe(false);
		expect(isSkippedFile(await loadKnowledgeFile(root, "no.md"))).toBe(true);
	});
});

describe("loadKnowledgeFile: file system edge cases (review F-1, F-4)", () => {
	it("reports a file the process cannot read as parse-failed instead of throwing", async () => {
		await writeFile(join(root, "locked.md"), "# 本文\n\nあります");
		await chmod(join(root, "locked.md"), 0o000);
		try {
			if (process.getuid?.() === 0) return; // root can read anything; nothing to assert
			expect(await loadKnowledgeFile(root, "locked.md")).toEqual(
				skipped("locked.md", "parse-failed"),
			);
		} finally {
			await chmod(join(root, "locked.md"), 0o644);
		}
	});

	it("names the document after the file on disk, not after the requested spelling", async () => {
		await writeFile(join(root, "guide.md"), "# 手引き\n\n本文");
		const upper = await loadKnowledgeFile(root, "GUIDE.md");
		if (isSkippedFile(upper)) return; // case-sensitive file system: GUIDE.md does not exist

		expect(upper.file).toBe("guide.md");
	});

	it("names a symlink's document after its target inside the root", async () => {
		await writeFile(join(root, "real.md"), "# 本体\n\n本文");
		await symlink(join(root, "real.md"), join(root, "alias.md"));

		const result = await loadKnowledgeFile(root, "alias.md");

		expect(isSkippedFile(result) ? undefined : result.file).toBe("real.md");
	});
});
