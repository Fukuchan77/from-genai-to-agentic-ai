import { open, realpath, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, sep } from "node:path";
import { DEFAULT_RAG } from "../../config/defaults";
import { PlatformError } from "../../errors";
import type { LoadedDocument } from "./chunk";
import { readFrontMatterTags, splitMarkdown } from "./markdown";
import { extractPdfPages, PdfParseError } from "./pdf";

export const SKIP_REASONS = [
	"unsupported-format",
	"no-text",
	"parse-failed",
	"too-large",
	"not-found",
] as const;

export type SkipReason = (typeof SKIP_REASONS)[number];

/** A file that was not loaded for one of the expected reasons; the rest of the batch goes on. */
export interface SkippedFile {
	readonly file: string;
	readonly reason: SkipReason;
}

export interface LoadKnowledgeFileOptions {
	/** Size limit in bytes. Defaults to `DEFAULT_RAG.maxIngestFileBytes`. */
	readonly maxBytes?: number;
}

const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"]);
const PDF_EXTENSION = ".pdf";
const MISSING_PATH_CODES = new Set(["ENOENT", "ENOTDIR", "ELOOP"]);
/** The file exists but cannot be read; it is skipped like any other unreadable document. */
const UNREADABLE_CODES = new Set(["EACCES", "EPERM", "EIO", "EISDIR"]);

export function isSkippedFile(result: LoadedDocument | SkippedFile): result is SkippedFile {
	return "reason" in result;
}

function invalidName(reason: "invalid-file-name" | "outside-root"): PlatformError {
	return new PlatformError("invalid-request", "ファイル名が不正です。", { reason });
}

/** One path segment: not empty, no leading dot, no separator, no NUL. */
export function isSafeFileName(name: string): boolean {
	return name !== "" && !name.startsWith(".") && !/[/\\]/.test(name) && !name.includes("\0");
}

function assertSafeFileName(name: string): void {
	if (!isSafeFileName(name)) throw invalidName("invalid-file-name");
}

function isUnreadableError(error: unknown): boolean {
	return error instanceof Error && "code" in error && UNREADABLE_CODES.has(String(error.code));
}

function isMissingPathError(error: unknown): boolean {
	return error instanceof Error && "code" in error && MISSING_PATH_CODES.has(String(error.code));
}

async function resolveOrUndefined(path: string): Promise<string | undefined> {
	try {
		return await realpath(path);
	} catch (error) {
		if (isMissingPathError(error)) return undefined;
		throw error;
	}
}

function isInside(root: string, path: string): boolean {
	const relation = relative(root, path);
	return (
		relation !== "" &&
		relation !== ".." &&
		!relation.startsWith(`..${sep}`) &&
		!isAbsolute(relation)
	);
}

function stem(name: string): string {
	return name.slice(0, name.length - extname(name).length);
}

/** Reads at most `maxBytes` from a regular file; returns undefined when it grew past the limit. */
async function readWithinLimit(path: string, maxBytes: number): Promise<Uint8Array | undefined> {
	const handle = await open(path, "r");
	try {
		const info = await handle.stat();
		if (!info.isFile()) return undefined;
		if (info.size > maxBytes) return undefined;
		return await handle.readFile();
	} finally {
		await handle.close();
	}
}

function loadMarkdown(file: string, bytes: Uint8Array): LoadedDocument | SkippedFile {
	let text: string;
	try {
		text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		return { file, reason: "parse-failed" };
	}
	const sections = splitMarkdown(text);
	if (sections.every((section) => section.body === "")) return { file, reason: "no-text" };
	const title = sections.find((section) => section.headingPath.length > 0)?.headingPath[0];
	return {
		file,
		title: title ?? stem(file),
		sourceType: "markdown",
		tags: readFrontMatterTags(text),
		sections,
	};
}

async function loadPdf(file: string, bytes: Uint8Array): Promise<LoadedDocument | SkippedFile> {
	let pages: string[];
	try {
		pages = await extractPdfPages(bytes);
	} catch (error) {
		if (error instanceof PdfParseError) return { file, reason: "parse-failed" };
		throw error;
	}
	if (pages.every((page) => page.trim() === "")) return { file, reason: "no-text" };
	return { file, title: stem(file), sourceType: "pdf", tags: [], pages };
}

/**
 * Loads one document from `root` (plan C5). `name` must be a single path segment without a leading
 * dot, a separator or NUL, and its real path must stay inside `root`; violations throw
 * `invalid-request` before any content is read. Expected problems come back as a `SkippedFile`.
 */
export async function loadKnowledgeFile(
	root: string,
	name: string,
	options: LoadKnowledgeFileOptions = {},
): Promise<LoadedDocument | SkippedFile> {
	assertSafeFileName(name);
	const maxBytes = options.maxBytes ?? DEFAULT_RAG.maxIngestFileBytes;
	const notFound: SkippedFile = { file: name, reason: "not-found" };

	try {
		const realRoot = await resolveOrUndefined(root);
		if (realRoot === undefined) return notFound;
		// The paths are runtime input checked above; they are not files for the bundler to trace.
		const realPath = await resolveOrUndefined(join(/* turbopackIgnore: true */ realRoot, name));
		if (realPath === undefined) return notFound;
		if (!isInside(realRoot, realPath)) throw invalidName("outside-root");
		if (!(await stat(/* turbopackIgnore: true */ realPath)).isFile()) return notFound;

		const extension = extname(name).toLowerCase();
		const isMarkdown = MARKDOWN_EXTENSIONS.has(extension);
		if (!isMarkdown && extension !== PDF_EXTENSION) {
			return { file: name, reason: "unsupported-format" };
		}

		const bytes = await readWithinLimit(realPath, maxBytes);
		if (bytes === undefined) return { file: name, reason: "too-large" };
		// The on-disk spelling names the document, so `Guide.md` and `guide.md` are one document on a
		// case-insensitive file system.
		const file = basename(realPath);
		return isMarkdown ? loadMarkdown(file, bytes) : loadPdf(file, bytes);
	} catch (error) {
		if (isUnreadableError(error)) return { file: name, reason: "parse-failed" };
		throw error;
	}
}
