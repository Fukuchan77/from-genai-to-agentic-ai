import { mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FatalLatch } from "../aci/fatal";
import type { AnyAciTool, ToolOutcome } from "../aci/types";
import { DEFAULT_TOOLS } from "../config/defaults";
import { createFakeClock } from "../ports/clock";
import { createFileTools } from "./tools";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu;

let sandbox: string;
let root: string;
let outside: string;
let sibling: string;
let tools: readonly AnyAciTool[];

beforeAll(async () => {
	sandbox = await realpath(await mkdtemp(join(tmpdir(), "files-tools-")));
	root = join(sandbox, "root");
	sibling = join(sandbox, "root-evil");
	outside = join(sandbox, "outside");
	await mkdir(join(root, "docs"), { recursive: true });
	await mkdir(sibling);
	await mkdir(outside);
	await writeFile(join(outside, "secret.txt"), "TOP SECRET");
	await writeFile(join(sibling, "secret.txt"), "sibling secret");
});

afterAll(async () => {
	await rm(sandbox, { recursive: true, force: true });
});

beforeEach(async () => {
	// Every test starts from the same tree and new tools, so index state never leaks between tests.
	await rm(root, { recursive: true, force: true });
	await mkdir(join(root, "docs"), { recursive: true });
	await writeFile(join(root, "notes.txt"), "Alpha line\nsecond line with Needle inside\nthird");
	await writeFile(join(root, "docs", "guide.md"), "# Guide\nThe needle is documented here.\n");
	await writeFile(join(root, "docs", "needle-names.md"), "only the file name matches\n");
	await writeFile(join(root, "empty.txt"), "");
	tools = createFileTools({ root });
});

interface Call {
	readonly outcome: ToolOutcome<string>;
	readonly latch: FatalLatch;
}

async function call(name: string, input: unknown, toolList = tools): Promise<Call> {
	const aciTool = toolList.find((candidate) => candidate.name === name);
	if (!aciTool) throw new Error(`no tool named ${name}`);
	const latch = new FatalLatch();
	const execute = aciTool.toTool({
		clock: createFakeClock(),
		toolTimeoutMs: 5_000,
		fatal: latch,
	}).execute;
	if (!execute) throw new Error(`${name} must be executable`);
	const outcome = (await execute(input, {
		toolCallId: "call-1",
		messages: [],
		context: undefined,
	})) as ToolOutcome<string>;
	return { outcome, latch };
}

function textOf({ outcome }: Call): string {
	if (!outcome.ok) throw new Error(`expected success, received ${JSON.stringify(outcome.failure)}`);
	return outcome.data;
}

function recoverable({ outcome, latch }: Call) {
	expect(latch.error).toBeUndefined();
	if (outcome.ok) throw new Error(`expected a failure, received ${outcome.data}`);
	expect(outcome.failure.kind).toBe("recoverable");
	return outcome.failure;
}

describe("createFileTools — definitions", () => {
	it("defines the six tools with the planned names and risk classes", () => {
		expect(tools.map((aciTool) => [aciTool.name, aciTool.risk])).toEqual([
			["listFiles", "read-only"],
			["readFile", "read-only"],
			["searchFiles", "read-only"],
			["findAndReadFiles", "read-only"],
			["writeFile", "write"],
			["deleteFile", "destructive"],
		]);
	});

	it("rejects a concise limit that is not a positive integer", () => {
		expect(() => createFileTools({ root, conciseMaxCharacters: 0 })).toThrow(RangeError);
		expect(() => createFileTools({ root, conciseMaxCharacters: 1.5 })).toThrow(RangeError);
	});

	it("gives readFile exactly one of path and index", () => {
		const schema = tools.find((aciTool) => aciTool.name === "readFile")?.inputSchema;
		expect(schema?.safeParse({ path: join(root, "notes.txt") }).success).toBe(true);
		expect(schema?.safeParse({ index: 0 }).success).toBe(true);
		expect(schema?.safeParse({}).success).toBe(false);
		expect(schema?.safeParse({ path: join(root, "notes.txt"), index: 0 }).success).toBe(false);
		expect(schema?.safeParse({ index: -1 }).success).toBe(false);
	});
});

describe("listFiles", () => {
	it("lists the root when no path is given, with 0-based indexes and the allowed root", async () => {
		const text = textOf(await call("listFiles", {}));
		expect(text).toContain(`許可ルート: ${root}`);
		expect(text.split("\n")).toContain("[0] docs (ディレクトリ)");
		expect(text.split("\n")).toContain("[1] empty.txt (ファイル)");
		expect(text.split("\n")).toContain("[2] notes.txt (ファイル)");
		expect(text).not.toMatch(UUID);
	});

	it("shows sizes only in the detailed format", async () => {
		const concise = textOf(await call("listFiles", { format: "concise" }));
		const detailed = textOf(await call("listFiles", { format: "detailed" }));
		expect(concise).not.toContain("バイト");
		expect(detailed).toContain("[2] notes.txt (ファイル, 47 バイト)");
	});

	it("lists a sub-directory given by an absolute path and by an index", async () => {
		const byPath = textOf(await call("listFiles", { path: join(root, "docs") }));
		expect(byPath).toContain("[0] guide.md (ファイル)");
		expect(byPath).toContain("[1] needle-names.md (ファイル)");

		await call("listFiles", {});
		const byIndex = textOf(await call("listFiles", { index: 0 }));
		expect(byIndex).toContain("[0] guide.md (ファイル)");
	});

	it("says so when the directory is empty", async () => {
		await mkdir(join(root, "void"));
		expect(textOf(await call("listFiles", { path: join(root, "void") }))).toContain(
			"ファイルはありません",
		);
	});

	it("does not list a link that points outside the root, and says how many were left out", async () => {
		await symlink(outside, join(root, "link-out"));
		const text = textOf(await call("listFiles", {}));
		expect(text).not.toContain("link-out");
		expect(text).toContain("許可ルートの外を指すリンク 1 件は表示していません");
	});

	it("rejects a relative path as recoverable and names the allowed root in the guide", async () => {
		const failure = recoverable(await call("listFiles", { path: "docs" }));
		expect(failure.summary).toContain("相対パス");
		expect(failure.nextAction).toContain(root);
	});

	it("reports a missing directory as recoverable", async () => {
		const failure = recoverable(await call("listFiles", { path: join(root, "missing") }));
		expect(failure.summary).toContain("存在しません");
	});

	it("reports a file given as the directory as recoverable", async () => {
		const failure = recoverable(await call("listFiles", { path: join(root, "notes.txt") }));
		expect(failure.summary).toContain("ディレクトリではありません");
	});

	it("truncates a long concise listing and tells how to get all of it", async () => {
		const limited = createFileTools({ root, conciseMaxCharacters: 80 });
		for (let index = 0; index < 20; index += 1) {
			await writeFile(join(root, `file-number-${String(index).padStart(2, "0")}.txt`), "x");
		}
		const concise = textOf(await call("listFiles", {}, limited));
		expect(concise).toContain("省略しました");
		expect(concise).toContain('format: "detailed"');
		const detailed = textOf(await call("listFiles", { format: "detailed" }, limited));
		expect(detailed).not.toContain("省略しました");
		expect(detailed).toContain("file-number-19.txt");
	});
});

describe("readFile", () => {
	it("returns the whole text of a short file", async () => {
		expect(textOf(await call("readFile", { path: join(root, "notes.txt") }))).toBe(
			"Alpha line\nsecond line with Needle inside\nthird",
		);
	});

	it("returns an empty file as an explicit notice instead of an empty string", async () => {
		expect(textOf(await call("readFile", { path: join(root, "empty.txt") }))).toContain("空");
	});

	it("cuts a concise response at the configured limit and points at the detailed format", async () => {
		const long = "あ".repeat(DEFAULT_TOOLS.conciseMaxCharacters + 500);
		await writeFile(join(root, "long.txt"), long);
		const concise = textOf(await call("readFile", { path: join(root, "long.txt") }));
		expect(concise.startsWith("あ".repeat(DEFAULT_TOOLS.conciseMaxCharacters))).toBe(true);
		expect(concise).not.toContain("あ".repeat(DEFAULT_TOOLS.conciseMaxCharacters + 1));
		expect(concise).toContain("残り 500 文字を省略しました");
		expect(concise).toContain('format: "detailed"');
		expect(
			textOf(await call("readFile", { path: join(root, "long.txt"), format: "detailed" })),
		).toBe(long);
	});

	it("reads the file behind an index from the latest listing", async () => {
		await call("listFiles", {});
		expect(textOf(await call("readFile", { index: 2 }))).toContain("Alpha line");
	});

	it("explains the valid index range when the index is out of range", async () => {
		await call("listFiles", {});
		const failure = recoverable(await call("readFile", { index: 9 }));
		expect(failure.summary).toContain("索引 9");
		expect(failure.nextAction).toContain("0〜2");
	});

	it("asks for a listing first when no index has been assigned", async () => {
		const failure = recoverable(await call("readFile", { index: 0 }));
		expect(failure.nextAction).toContain("listFiles");
	});

	it("refuses to read a directory, a binary file and a file over the size limit", async () => {
		await writeFile(join(root, "image.bin"), Buffer.from([0x89, 0x50, 0x00, 0x47]));
		await writeFile(join(root, "huge.txt"), "x".repeat(1024 * 1024 + 1));
		expect(recoverable(await call("readFile", { path: join(root, "docs") })).summary).toContain(
			"ディレクトリ",
		);
		expect(
			recoverable(await call("readFile", { path: join(root, "image.bin") })).summary,
		).toContain("テキストファイルではありません");
		expect(recoverable(await call("readFile", { path: join(root, "huge.txt") })).summary).toContain(
			"大きすぎます",
		);
	});

	it("rejects a relative path and a missing path as recoverable", async () => {
		expect(recoverable(await call("readFile", { path: "notes.txt" })).nextAction).toContain(root);
		expect(
			recoverable(await call("readFile", { path: join(root, "missing.txt") })).summary,
		).toContain("存在しません");
	});
});

describe("leaving the allowed root is fatal (CL-1)", () => {
	async function expectFatal(name: string, input: unknown): Promise<void> {
		const { outcome, latch } = await call(name, input);
		expect(latch.error?.code).toBe("not-allowed");
		expect(latch.error?.learnerMessage).toContain(root);
		// The model gets the same short message; the content outside the root never appears.
		expect(JSON.stringify(outcome)).not.toContain("TOP SECRET");
		expect(JSON.stringify(outcome)).not.toContain("sibling secret");
	}

	it("trips the latch for a path with `..` that leaves the root", async () => {
		await expectFatal("readFile", { path: `${root}/docs/../../outside/secret.txt` });
	});

	it("trips the latch for the sibling directory that shares the root's prefix", async () => {
		await expectFatal("readFile", { path: join(sibling, "secret.txt") });
		await expectFatal("listFiles", { path: sibling });
	});

	it("trips the latch for a symbolic link that leaves the root", async () => {
		await symlink(outside, join(root, "link-out"));
		await expectFatal("readFile", { path: join(root, "link-out", "secret.txt") });
		await expectFatal("searchFiles", { query: "x", path: join(root, "link-out") });
	});

	it("trips the latch even when the escaping path does not exist", async () => {
		await expectFatal("readFile", { path: join(sibling, "missing.txt") });
	});
});

describe("searchFiles", () => {
	it("finds file contents and file names, ignoring case, with 0-based indexes", async () => {
		const text = textOf(await call("searchFiles", { query: "NEEDLE" }));
		expect(text).toContain("3 件");
		expect(text).toContain("[0] docs/guide.md:2: The needle is documented here.");
		expect(text).toContain("[1] docs/needle-names.md (ファイル名が一致)");
		expect(text).toContain("[2] notes.txt:2: second line with Needle inside");
		expect(text).not.toMatch(UUID);
	});

	it("lets readFile use the index of a hit", async () => {
		await call("searchFiles", { query: "needle" });
		expect(textOf(await call("readFile", { index: 0 }))).toContain("# Guide");
	});

	it("says there is no match instead of failing", async () => {
		expect(textOf(await call("searchFiles", { query: "absent-term" }))).toContain(
			"一致するファイルはありません",
		);
	});

	it("does not follow a symbolic link while searching", async () => {
		await symlink(outside, join(root, "link-out"));
		expect(textOf(await call("searchFiles", { query: "TOP SECRET" }))).toContain(
			"一致するファイルはありません",
		);
	});

	it("limits the query to 1-200 characters in its input schema", () => {
		const schema = tools.find((aciTool) => aciTool.name === "searchFiles")?.inputSchema;
		expect(schema?.safeParse({ query: "" }).success).toBe(false);
		expect(schema?.safeParse({ query: "x".repeat(201) }).success).toBe(false);
		expect(schema?.safeParse({ query: "x".repeat(200) }).success).toBe(true);
	});
});

describe("findAndReadFiles (the high-level tool, Req 1.12)", () => {
	it("lists and reads the matching files in one call", async () => {
		const text = textOf(await call("findAndReadFiles", { query: "needle" }));
		expect(text).toContain("[0] docs/guide.md");
		expect(text).toContain("The needle is documented here.");
		expect(text).toContain("[2] notes.txt");
		expect(text).toContain("second line with Needle inside");
		expect(text).not.toMatch(UUID);
	});

	it("reads at most maxFiles files and says how many matches were not read", async () => {
		const text = textOf(await call("findAndReadFiles", { query: "needle", maxFiles: 1 }));
		expect(text).toContain("The needle is documented here.");
		expect(text).not.toContain("second line with Needle inside");
		expect(text).toContain("残り 2 件");
	});

	it("reads nothing and says so when there is no match", async () => {
		expect(textOf(await call("findAndReadFiles", { query: "absent-term" }))).toContain(
			"一致するファイルはありません",
		);
	});

	it("applies the concise limit to the whole response", async () => {
		const limited = createFileTools({ root, conciseMaxCharacters: 60 });
		const text = textOf(await call("findAndReadFiles", { query: "needle" }, limited));
		expect(text).toContain("省略しました");
	});
});

describe("writeFile and deleteFile", () => {
	it("creates a new file inside the root and overwrites an existing one", async () => {
		const target = join(root, "docs", "new.txt");
		textOf(await call("writeFile", { path: target, content: "first" }));
		expect(await readFile(target, "utf8")).toBe("first");
		textOf(await call("writeFile", { path: target, content: "second" }));
		expect(await readFile(target, "utf8")).toBe("second");
	});

	it("does not create missing directories", async () => {
		const failure = recoverable(
			await call("writeFile", { path: join(root, "no-dir", "x.txt"), content: "x" }),
		);
		expect(failure.summary).toContain("存在しません");
	});

	it("is fatal outside the root and writes nothing there", async () => {
		const target = join(sibling, "planted.txt");
		const { latch } = await call("writeFile", { path: target, content: "x" });
		expect(latch.error?.code).toBe("not-allowed");
		await expect(stat(target)).rejects.toThrow();
	});

	it("does not write through a dangling link that points outside the root", async () => {
		const planted = join(outside, "planted.txt");
		await symlink(planted, join(root, "dangling"));
		const outcome = await call("writeFile", { path: join(root, "dangling"), content: "x" });
		expect(outcome.outcome.ok).toBe(false);
		await expect(stat(planted)).rejects.toThrow();
	});

	it("deletes a file inside the root and refuses a directory", async () => {
		const target = join(root, "notes.txt");
		textOf(await call("deleteFile", { path: target }));
		await expect(stat(target)).rejects.toThrow();
		expect(recoverable(await call("deleteFile", { path: join(root, "docs") })).summary).toContain(
			"ディレクトリ",
		);
	});

	it("is fatal outside the root and deletes nothing there", async () => {
		const { latch } = await call("deleteFile", { path: join(outside, "secret.txt") });
		expect(latch.error?.code).toBe("not-allowed");
		expect(await readFile(join(outside, "secret.txt"), "utf8")).toBe("TOP SECRET");
	});
});

describe("a root that does not exist", () => {
	it("is a fatal configuration error that names the root", async () => {
		const missing = join(sandbox, "no-such-root");
		const { latch } = await call("listFiles", {}, createFileTools({ root: missing }));
		expect(latch.error?.code).toBe("config-missing");
		expect(latch.error?.learnerMessage).toContain(missing);
	});
});
