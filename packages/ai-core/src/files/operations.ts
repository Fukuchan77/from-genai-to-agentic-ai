import { readdir, readFile, realpath, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { z } from "zod";
// This file, `server.ts` and `stdio.ts` run directly under Node's type stripping (CL-3), which cannot
// resolve extension-less specifiers. Their imports therefore carry the `.ts` extension and reach only
// dependency-free modules.
import { applyResponseFormat } from "../aci/response-format.ts";
import { ShortIdIndex } from "../aci/short-id.ts";
import type { ToolRisk } from "../aci/types.ts";
import { type PathError, resolveWorkspacePath } from "./path.ts";

export const FILE_TOOL_NAMES = Object.freeze({
	list: "listFiles",
	read: "readFile",
	search: "searchFiles",
	findAndRead: "findAndReadFiles",
	write: "writeFile",
	delete: "deleteFile",
});

/** The default of `DEFAULT_TOOLS.conciseMaxCharacters` (a test keeps them equal; this file cannot import `config`). */
export const DEFAULT_CONCISE_MAX_CHARACTERS = 1_000;

/** The largest file `readFile` returns. Bigger files are refused, whatever the format. */
export const MAX_READ_BYTES = 1024 * 1024;
const MAX_WRITE_CHARACTERS = 100_000;
const MAX_LIST_ENTRIES = 200;
const MAX_SEARCH_HITS = 20;
const MAX_SEARCH_FILES = 500;
const MAX_SEARCH_DEPTH = 8;
const SNIPPET_CHARACTERS = 120;
const BINARY_SNIFF_BYTES = 8_000;
const SKIPPED_DIRECTORIES = new Set([".git", "node_modules"]);

const FULL_TEXT_HINT =
	'全文が必要なときは format: "detailed" を指定して、もう一度呼び出してください。';

const formatField = z
	.enum(["concise", "detailed"])
	.optional()
	.describe("応答の詳しさ。concise（省略時）は上限で切り詰めた要約、detailed は省略しない全文。");
const pathField = (purpose: string) =>
	z.string().min(1).max(4096).describe(`${purpose}。許可ルートの内側の絶対パス。`);
const indexField = z
	.number()
	.int()
	.min(0)
	.optional()
	.describe(
		"直前の listFiles / searchFiles の結果に付いた 0 始まりの索引。path の代わりに使える。",
	);

const listInput = z.object({
	path: pathField("一覧するディレクトリ").optional().describe("省略すると許可ルートを一覧する。"),
	index: indexField,
	format: formatField,
});
const readInput = z
	.object({
		path: pathField("読み取るファイル").optional(),
		index: indexField,
		format: formatField,
	})
	.refine((value) => (value.path === undefined) !== (value.index === undefined), {
		message: "path か index のどちらか一方だけを指定してください。",
	});
const searchInput = z.object({
	query: z
		.string()
		.min(1)
		.max(200)
		.describe("探す語句。ファイル名と本文を大文字小文字を区別せず検索する。"),
	path: pathField("探し始めるディレクトリ").optional().describe("省略すると許可ルート全体を探す。"),
	format: formatField,
});
const findAndReadInput = searchInput.extend({
	maxFiles: z
		.number()
		.int()
		.min(1)
		.max(5)
		.optional()
		.describe("本文まで読むファイルの最大数（1〜5、省略時は 3）。"),
});
const writeInput = z.object({
	path: pathField("書き込むファイル"),
	content: z
		.string()
		.max(MAX_WRITE_CHARACTERS)
		.describe("ファイルに書き込む本文。既存の内容は置き換わる。"),
});
const deleteInput = z.object({ path: pathField("削除するファイル") });

/** An error the caller maps to its own error type: a retry can fix it (`recoverable`) or not (`fatal`). */
export class FileToolError extends Error {
	readonly kind: "recoverable" | "fatal";
	/** Learner-facing text. For a fatal error it is the message shown to the learner. */
	readonly summary: string;
	readonly nextAction: string | undefined;

	constructor(kind: "recoverable" | "fatal", summary: string, nextAction?: string | undefined) {
		super(summary);
		this.name = "FileToolError";
		this.kind = kind;
		this.summary = summary;
		this.nextAction = nextAction;
	}
}

export type FileFatalCode = "not-allowed" | "config-missing";

export class RecoverableFileError extends FileToolError {
	constructor(summary: string, options: { readonly nextAction?: string } = {}) {
		super("recoverable", summary, options.nextAction);
	}
}

/** Closed vocabulary of `FatalToolError` codes this layer can raise (C2). */
export class FatalFileError extends FileToolError {
	readonly code: FileFatalCode;

	constructor(code: FileFatalCode, learnerMessage: string) {
		super("fatal", learnerMessage);
		this.code = code;
	}
}

/** One file operation: what `tools.ts` turns into an ACI tool and `server.ts` into an MCP tool. */
export interface FileOperation {
	readonly name: string;
	readonly description: string;
	readonly inputSchema: z.ZodType;
	readonly risk: ToolRisk;
	/** Validates `input` against `inputSchema` again, so no caller can run it with an unchecked value. */
	run(input: unknown, signal: AbortSignal): Promise<string>;
}

interface OperationDefinition<INPUT> {
	readonly name: string;
	readonly description: string;
	readonly inputSchema: z.ZodType<INPUT>;
	readonly risk: ToolRisk;
	run(input: INPUT, signal: AbortSignal): Promise<string>;
}

const defineOperation = <INPUT>(definition: OperationDefinition<INPUT>): FileOperation => ({
	name: definition.name,
	description: definition.description,
	inputSchema: definition.inputSchema,
	risk: definition.risk,
	run: (input, signal) => definition.run(definition.inputSchema.parse(input), signal),
});

export interface CreateFileOperationsOptions {
	/** The allowed root. Resolved to a real path on first use; a missing root is a fatal config error. */
	readonly root: string;
	/** Upper bound of a `concise` response in characters. Defaults to `DEFAULT_CONCISE_MAX_CHARACTERS`. */
	readonly conciseMaxCharacters?: number | undefined;
}

interface IndexedEntry {
	readonly path: string;
	readonly label: string;
	readonly kind: "file" | "directory";
}

interface SearchHit {
	readonly path: string;
	readonly name: string;
	/** The first matching line, when the content matched. */
	readonly line?: { readonly number: number; readonly snippet: string; readonly more: number };
}

function isBinary(buffer: Uint8Array): boolean {
	return buffer.subarray(0, BINARY_SNIFF_BYTES).includes(0);
}

function shorten(value: string, limit = 120): string {
	const characters = Array.from(value);
	return characters.length <= limit ? value : `${characters.slice(0, limit).join("")}…`;
}

function compareNames(left: string, right: string): number {
	if (left === right) return 0;
	return left < right ? -1 : 1;
}

function formatEntry(index: number, label: string, detail: string): string {
	return `[${index}] ${label} (${detail})`;
}

function isNodeError(error: unknown, code: string): boolean {
	return typeof error === "object" && error !== null && (error as { code?: unknown }).code === code;
}

/** One set of file tools bound to one allowed root and one index of listed items. */
class FileToolContext {
	readonly #root: string;
	readonly maxCharacters: number;
	readonly #index = new ShortIdIndex<IndexedEntry>((entry) => entry.label);
	#assigned = 0;
	#realRoot: Promise<string> | undefined;

	constructor(options: CreateFileOperationsOptions) {
		const maxCharacters = options.conciseMaxCharacters ?? DEFAULT_CONCISE_MAX_CHARACTERS;
		if (!Number.isSafeInteger(maxCharacters) || maxCharacters <= 0) {
			throw new RangeError(
				`conciseMaxCharacters must be a positive integer (received ${maxCharacters}).`,
			);
		}
		this.maxCharacters = maxCharacters;
		this.#root = resolve(options.root);
	}

	/** The real path of the allowed root. A root that is missing is a fatal configuration error. */
	root(): Promise<string> {
		this.#realRoot ??= realpath(this.#root).catch(() => {
			this.#realRoot = undefined;
			throw new FatalFileError(
				"config-missing",
				`許可ルート（${this.#root}）が存在しません。環境変数 MCP_FS_ROOT を確認してください。`,
			);
		});
		return this.#realRoot;
	}

	/** Maps a rejected path to the error the model and the learner see (CL-1). */
	pathError(error: PathError, root: string, input: string): Error {
		switch (error) {
			case "outside-root":
				return new FatalFileError(
					"not-allowed",
					`許可されたルート（${root}）の外のパスにはアクセスできません。`,
				);
			case "relative": {
				const suggestion =
					input.includes("..") || input.includes("\0") ? "" : ` 例: ${join(root, input)}`;
				return new RecoverableFileError(`相対パス「${shorten(input)}」は使えません。`, {
					nextAction:
						`許可ルート ${root} から始まる絶対パスで指定してください。${suggestion}`.trimEnd(),
				});
			}
			case "not-found":
				return new RecoverableFileError(`パス「${shorten(input)}」は存在しません。`, {
					nextAction:
						"listFiles（引数なし）で存在するファイルを確認してから、もう一度指定してください。",
				});
			case "invalid":
				return new RecoverableFileError("パスの形式が正しくありません。", {
					nextAction: `許可ルート ${root} 配下の絶対パスを指定してください。`,
				});
		}
	}

	/** The real path of an absolute `path`, or of the item an `index` points at. */
	async target(input: {
		readonly path?: string | undefined;
		readonly index?: number | undefined;
	}): Promise<{ readonly root: string; readonly real: string }> {
		const root = await this.root();
		if (input.index !== undefined) {
			const entry = this.#index.resolve(input.index);
			if (entry === undefined) throw this.indexError(input.index);
			return { root, real: await this.#validated(root, entry.path) };
		}
		const path = input.path ?? root;
		return { root, real: await this.#validated(root, path) };
	}

	async #validated(root: string, path: string): Promise<string> {
		const result = await resolveWorkspacePath(root, path);
		if (!result.ok) throw this.pathError(result.error, root, path);
		return result.value;
	}

	indexError(index: number): RecoverableFileError {
		if (this.#assigned === 0) {
			return new RecoverableFileError(`索引 ${index} はまだ割り当てられていません。`, {
				nextAction: "先に listFiles か searchFiles を呼んで、結果の索引を使ってください。",
			});
		}
		return new RecoverableFileError(`索引 ${index} は直前の結果にありません。`, {
			nextAction: `直前の結果の有効な索引は 0〜${this.#assigned - 1} です。`,
		});
	}

	assign(entries: readonly IndexedEntry[]): void {
		this.#index.assign(entries);
		this.#assigned = entries.length;
	}

	respond(text: string, format: "concise" | "detailed" | undefined): string {
		return applyResponseFormat(text, {
			format: format ?? "concise",
			maxCharacters: this.maxCharacters,
			fullTextHint: FULL_TEXT_HINT,
		});
	}

	async readText(real: string, root: string, signal: AbortSignal): Promise<string> {
		const info = await stat(real);
		const name = relative(root, real) || ".";
		if (info.isDirectory()) {
			throw new RecoverableFileError(`「${name}」はディレクトリです。`, {
				nextAction:
					"listFiles の path か index にこのディレクトリを指定して中身を確認してください。",
			});
		}
		if (!info.isFile()) {
			throw new RecoverableFileError(`「${name}」は通常のファイルではありません。`);
		}
		if (info.size > MAX_READ_BYTES) {
			throw new RecoverableFileError(
				`「${name}」は大きすぎます（${info.size} バイト、上限 ${MAX_READ_BYTES} バイト）。`,
				{ nextAction: "searchFiles で必要な箇所を探すか、別のファイルを指定してください。" },
			);
		}
		const buffer = await readFile(real, { signal });
		if (buffer.length > MAX_READ_BYTES || isBinary(buffer)) {
			throw new RecoverableFileError(
				buffer.length > MAX_READ_BYTES
					? `「${name}」は大きすぎます。`
					: `「${name}」はテキストファイルではありません。`,
				{ nextAction: "テキストファイルを指定してください。" },
			);
		}
		return new TextDecoder("utf-8").decode(buffer);
	}

	/** Walks below `start` without following links; a link would lead out of the allowed root. */
	async search(
		root: string,
		start: string,
		query: string,
		signal: AbortSignal,
	): Promise<{ readonly hits: readonly SearchHit[]; readonly cut: boolean }> {
		const needle = query.toLowerCase();
		const hits: SearchHit[] = [];
		let scanned = 0;
		let cut = false;

		const visit = async (directory: string, depth: number): Promise<void> => {
			const entries = (await readdir(directory, { withFileTypes: true })).sort((left, right) =>
				compareNames(left.name, right.name),
			);
			for (const entry of entries) {
				if (cut) return;
				signal.throwIfAborted();
				const path = join(directory, entry.name);
				if (entry.isSymbolicLink()) continue;
				if (entry.isDirectory()) {
					if (depth < MAX_SEARCH_DEPTH && !SKIPPED_DIRECTORIES.has(entry.name)) {
						await visit(path, depth + 1);
					}
					continue;
				}
				if (!entry.isFile()) continue;
				if (scanned >= MAX_SEARCH_FILES || hits.length >= MAX_SEARCH_HITS) {
					cut = true;
					return;
				}
				scanned += 1;
				const hit = await this.#match(root, path, needle, signal);
				if (hit) hits.push(hit);
			}
		};
		await visit(start, 0);
		return { hits, cut };
	}

	async #match(
		root: string,
		path: string,
		needle: string,
		signal: AbortSignal,
	): Promise<SearchHit | undefined> {
		const name = relative(root, path);
		const nameMatches = name.toLowerCase().includes(needle);
		let text: string | undefined;
		try {
			const info = await stat(path);
			if (info.size <= MAX_READ_BYTES) {
				const buffer = await readFile(path, { signal });
				if (!isBinary(buffer)) text = new TextDecoder("utf-8").decode(buffer);
			}
		} catch (error) {
			signal.throwIfAborted();
			if (!isNodeError(error, "EACCES") && !isNodeError(error, "ENOENT")) throw error;
		}
		if (text !== undefined) {
			const lines = text.split(/\r?\n/u);
			const matching = lines.flatMap((line, offset) =>
				line.toLowerCase().includes(needle) ? [{ number: offset + 1, line }] : [],
			);
			const first = matching[0];
			if (first) {
				return {
					path,
					name,
					line: {
						number: first.number,
						snippet: shorten(first.line.trim(), SNIPPET_CHARACTERS),
						more: matching.length - 1,
					},
				};
			}
		}
		return nameMatches ? { path, name } : undefined;
	}
}

function describeHit(index: number, hit: SearchHit): string {
	if (!hit.line) return formatEntry(index, hit.name, "ファイル名が一致");
	const more = hit.line.more > 0 ? `（他 ${hit.line.more} 行）` : "";
	return `[${index}] ${hit.name}:${hit.line.number}: ${hit.line.snippet}${more}`;
}

const NO_MATCH = (query: string): string =>
	`「${shorten(query, 60)}」に一致するファイルはありません。語句を短くするか、listFiles で全体を確認してください。`;

/**
 * The file operations of module 3-1 (Req 1.4–1.6, 1.12, 1.13). Every path is checked against the allowed
 * root by `resolveWorkspacePath`: a relative path or a missing file is a recoverable error with a fix
 * guide, and a path that leaves the root is fatal (CL-1). `writeFile` and `deleteFile` are defined
 * for the MCP server to expose; no agent registers them before the approval gate (Req 1.17).
 */
export function createFileOperations(
	options: CreateFileOperationsOptions,
): readonly FileOperation[] {
	const context = new FileToolContext(options);

	const listFiles = defineOperation({
		name: FILE_TOOL_NAMES.list,
		description: [
			"許可ルートの内側のディレクトリにあるファイルとサブディレクトリを、0 始まりの索引付きで一覧する。",
			"使うとき: どんなファイルがあるか調べるとき、読みたいファイルの場所が分からないとき。path を省略すると許可ルートを一覧し、許可ルートのパスも分かる。",
			"使わないとき: ファイルの内容が必要なとき（readFile）、語句で探すとき（searchFiles）、許可ルートの外を調べるとき。",
			'例: {"format":"concise"}（許可ルートの一覧）、{"path":"<許可ルート>/docs"}',
		].join("\n"),
		inputSchema: listInput,
		risk: "read-only",
		run: async (input) => {
			const { root, real } = await context.target(input);
			const info = await stat(real);
			if (!info.isDirectory()) {
				throw new RecoverableFileError(
					`「${relative(root, real) || "."}」はディレクトリではありません。`,
					{
						nextAction: "ファイルの内容は readFile で読めます。",
					},
				);
			}
			const entries: IndexedEntry[] = [];
			const sizes = new Map<string, number>();
			let leftOut = 0;
			const dirents = (await readdir(real, { withFileTypes: true })).sort((left, right) =>
				compareNames(left.name, right.name),
			);
			for (const dirent of dirents) {
				const path = join(real, dirent.name);
				let resolved = path;
				if (dirent.isSymbolicLink()) {
					const link = await resolveWorkspacePath(root, path);
					if (!link.ok) {
						leftOut += 1;
						continue;
					}
					resolved = link.value;
				}
				const entryInfo = dirent.isSymbolicLink() ? await stat(resolved) : undefined;
				const isDirectory = entryInfo ? entryInfo.isDirectory() : dirent.isDirectory();
				entries.push({
					path: resolved,
					label: dirent.name,
					kind: isDirectory ? "directory" : "file",
				});
				if (!isDirectory && input.format === "detailed") {
					sizes.set(resolved, entryInfo ? entryInfo.size : (await stat(resolved)).size);
				}
			}
			entries.sort(
				(left, right) =>
					Number(right.kind === "directory") - Number(left.kind === "directory") ||
					compareNames(left.label, right.label),
			);
			const shown = entries.slice(0, MAX_LIST_ENTRIES);
			context.assign(shown);
			const lines = [`許可ルート: ${root}`, `ディレクトリ: ${real}`];
			if (shown.length === 0) lines.push("このディレクトリにファイルはありません。");
			shown.forEach((entry, index) => {
				const size = sizes.get(entry.path);
				const detail =
					entry.kind === "directory"
						? "ディレクトリ"
						: size === undefined
							? "ファイル"
							: `ファイル, ${size} バイト`;
				lines.push(formatEntry(index, entry.label, detail));
			});
			if (entries.length > shown.length) {
				lines.push(`（他 ${entries.length - shown.length} 件は一覧に含めていません。）`);
			}
			if (leftOut > 0) {
				lines.push(`（許可ルートの外を指すリンク ${leftOut} 件は表示していません。）`);
			}
			return context.respond(lines.join("\n"), input.format);
		},
	});

	const readFileTool = defineOperation({
		name: FILE_TOOL_NAMES.read,
		description: [
			"許可ルートの内側にある 1 つのテキストファイルの内容を返す。",
			"使うとき: 場所が分かっているファイルの中身を読むとき。path か、直前の一覧・検索結果の索引 index のどちらかを指定する。",
			"使わないとき: 場所が分からないとき（listFiles や searchFiles を先に使う）、語句で探して読みたいとき（findAndReadFiles）、画像などのバイナリ。",
			'例: {"index":2}、{"path":"<許可ルート>/notes.txt","format":"detailed"}',
		].join("\n"),
		inputSchema: readInput,
		risk: "read-only",
		run: async (input, abortSignal) => {
			const { root, real } = await context.target(input);
			const text = await context.readText(real, root, abortSignal);
			return context.respond(text === "" ? "（空のファイルです。）" : text, input.format);
		},
	});

	const searchFiles = defineOperation({
		name: FILE_TOOL_NAMES.search,
		description: [
			"許可ルートの内側のファイル名と本文から語句を探し、一致したファイルを 0 始まりの索引付きで返す。",
			"使うとき: 語句を手がかりに、どのファイルに書いてあるかを調べるとき。",
			"使わないとき: 場所が分かっているファイルを読むとき（readFile）、探して読むまでをまとめて行うとき（findAndReadFiles）、ファイルの一覧が欲しいとき（listFiles）。",
			'例: {"query":"締め切り"}、{"query":"TODO","path":"<許可ルート>/docs"}',
		].join("\n"),
		inputSchema: searchInput,
		risk: "read-only",
		run: async (input, abortSignal) => {
			const { root, real } = await context.target(input);
			const { hits, cut } = await context.search(root, real, input.query, abortSignal);
			context.assign(hits.map((hit) => ({ path: hit.path, label: hit.name, kind: "file" })));
			if (hits.length === 0) return NO_MATCH(input.query);
			const lines = [
				`許可ルート: ${root}`,
				`「${shorten(input.query, 60)}」の検索結果: ${hits.length} 件`,
				...hits.map((hit, index) => describeHit(index, hit)),
			];
			if (cut) lines.push("（探索の上限に達したため途中までの結果です。語句を絞ってください。）");
			return context.respond(lines.join("\n"), input.format);
		},
	});

	const findAndReadFiles = defineOperation({
		name: FILE_TOOL_NAMES.findAndRead,
		description: [
			"語句に一致するファイルを探し、先頭の数件の本文までを 1 回の呼び出しで返す高水準のツール。",
			"使うとき: 語句が書かれたファイルの内容をすぐ知りたいとき。searchFiles と readFile を続けて呼ぶ代わりに使う。",
			"使わないとき: 一致したファイルの一覧だけで足りるとき（searchFiles）、場所が分かっているファイルを読むとき（readFile）。",
			'例: {"query":"締め切り","maxFiles":2}',
		].join("\n"),
		inputSchema: findAndReadInput,
		risk: "read-only",
		run: async (input, abortSignal) => {
			const { root, real } = await context.target(input);
			const { hits, cut } = await context.search(root, real, input.query, abortSignal);
			context.assign(hits.map((hit) => ({ path: hit.path, label: hit.name, kind: "file" })));
			if (hits.length === 0) return NO_MATCH(input.query);
			const reading = hits.slice(0, input.maxFiles ?? 3);
			const lines = [
				`許可ルート: ${root}`,
				`「${shorten(input.query, 60)}」に一致したファイル: ${hits.length} 件（先頭 ${reading.length} 件を読みました）`,
			];
			for (const [index, hit] of reading.entries()) {
				lines.push("", `=== [${index}] ${hit.name} ===`);
				try {
					const text = await context.readText(hit.path, root, abortSignal);
					lines.push(text === "" ? "（空のファイルです。）" : text);
				} catch (error) {
					if (!(error instanceof RecoverableFileError)) throw error;
					lines.push(`（読み取れませんでした: ${error.summary}）`);
				}
			}
			if (hits.length > reading.length) {
				lines.push(
					"",
					`残り ${hits.length - reading.length} 件は読んでいません。readFile の index で読めます:`,
					...hits
						.slice(reading.length)
						.map((hit, offset) => `[${reading.length + offset}] ${hit.name}`),
				);
			}
			if (cut)
				lines.push("", "（探索の上限に達したため途中までの結果です。語句を絞ってください。）");
			return context.respond(lines.join("\n"), input.format);
		},
	});

	const writeFileTool = defineOperation({
		name: FILE_TOOL_NAMES.write,
		description: [
			"許可ルートの内側のファイルに本文を書き込む。同名のファイルがあれば内容を置き換える。",
			"使うとき: 承認を得たうえで、ファイルを新しく作るとき、内容を置き換えるとき。",
			"使わないとき: 読み取るだけのとき、許可ルートの外に書くとき、ディレクトリを作るとき。承認ゲート（M4）の実装までエージェントには登録されない。",
			'例: {"path":"<許可ルート>/memo.txt","content":"明日の予定"}',
		].join("\n"),
		inputSchema: writeInput,
		risk: "write",
		run: async (input) => {
			const root = await context.root();
			const existing = await resolveWorkspacePath(root, input.path);
			if (existing.ok) {
				if (!(await stat(existing.value)).isFile()) {
					throw new RecoverableFileError(
						`「${relative(root, existing.value)}」はファイルではありません。`,
					);
				}
				await writeFile(existing.value, input.content);
				return `${relative(root, existing.value)} に ${Array.from(input.content).length} 文字を書き込みました。`;
			}
			if (existing.error !== "not-found") throw context.pathError(existing.error, root, input.path);

			const normalized = resolve(input.path);
			const parent = await resolveWorkspacePath(root, dirname(normalized));
			if (!parent.ok) {
				throw parent.error === "not-found"
					? new RecoverableFileError(
							`書き込み先のディレクトリ「${shorten(dirname(normalized))}」が存在しません。`,
							{
								nextAction:
									"存在するディレクトリの中のパスを指定してください。ディレクトリは作成できません。",
							},
						)
					: context.pathError(parent.error, root, input.path);
			}
			const target = join(parent.value, basename(normalized));
			try {
				// "wx" never follows a link: a dangling link that points outside the root cannot be written through.
				await writeFile(target, input.content, { flag: "wx" });
			} catch (error) {
				if (!isNodeError(error, "EEXIST")) throw error;
				throw new RecoverableFileError("同じ名前のリンクがあるため書き込めません。", {
					nextAction: "別のファイル名を指定してください。",
				});
			}
			return `${relative(root, target)} を作成し、${Array.from(input.content).length} 文字を書き込みました。`;
		},
	});

	const deleteFileTool = defineOperation({
		name: FILE_TOOL_NAMES.delete,
		description: [
			"許可ルートの内側の 1 つのファイルを削除する。元に戻せない。",
			"使うとき: 承認を得たうえで、不要になったファイルを消すとき。",
			"使わないとき: 中身を確認するだけのとき、ディレクトリを消すとき、許可ルートの外のファイル。承認ゲート（M4）の実装までエージェントには登録されない。",
			'例: {"path":"<許可ルート>/old-memo.txt"}',
		].join("\n"),
		inputSchema: deleteInput,
		risk: "destructive",
		run: async (input) => {
			const { root, real } = await context.target(input);
			if (!(await stat(real)).isFile()) {
				throw new RecoverableFileError(
					`「${relative(root, real) || "."}」はファイルではありません。ディレクトリは削除できません。`,
				);
			}
			await unlink(real);
			return `${relative(root, real)} を削除しました。`;
		},
	});

	return [listFiles, readFileTool, searchFiles, findAndReadFiles, writeFileTool, deleteFileTool];
}
