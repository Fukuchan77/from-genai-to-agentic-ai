import { createHash } from "node:crypto";
import { DEFAULT_RAG } from "../../config/defaults";
import { PlatformError } from "../../errors";
import type { MarkdownSection } from "./markdown";

interface LoadedDocumentBase {
	/** File name inside the ingest root (one path segment). */
	readonly file: string;
	readonly title: string;
	readonly tags: readonly string[];
}

export interface LoadedMarkdownDocument extends LoadedDocumentBase {
	readonly sourceType: "markdown";
	readonly sections: readonly MarkdownSection[];
}

export interface LoadedPdfDocument extends LoadedDocumentBase {
	readonly sourceType: "pdf";
	/** Extracted text of each page; index 0 is page 1. Pages without text are empty strings. */
	readonly pages: readonly string[];
}

/** A document read from disk, before chunking (plan C5). */
export type LoadedDocument = LoadedMarkdownDocument | LoadedPdfDocument;

export interface Chunk {
	/** Content hash of document ID, heading path and body (ADR-5), plus `-2`, `-3` on repeats. */
	readonly id: string;
	/** Empty for PDF chunks. */
	readonly headingPath: readonly string[];
	readonly body: string;
	/** 1-based page number; present for PDF chunks only. */
	readonly page?: number;
}

export interface ChunkOptions {
	/** Full document ID (`kb:` or `eval:` prefix plus file name); it is part of every chunk ID. */
	readonly documentId: string;
	/** Maximum chunk size in code points. Defaults to `DEFAULT_RAG.chunkMaxCharacters`. */
	readonly maxCharacters?: number;
}

const PARAGRAPH_BREAK = /\n[ \t]*\n\s*/g;
const SENTENCE_END = /[。！？!?]+[」』）)"'”’]*\s*|\.\s+/g;

function codePointLength(text: string): number {
	return [...text].length;
}

/** Cuts `text` after each match of the global `separator`, keeping the separator on the left piece. */
function splitAfter(text: string, separator: RegExp): string[] {
	const pieces: string[] = [];
	let start = 0;
	for (const match of text.matchAll(separator)) {
		const end = match.index + match[0].length;
		pieces.push(text.slice(start, end));
		start = end;
	}
	if (start < text.length) pieces.push(text.slice(start));
	return pieces;
}

function hardSplit(text: string, max: number): string[] {
	const characters = [...text];
	const pieces: string[] = [];
	for (let offset = 0; offset < characters.length; offset += max) {
		const piece = characters
			.slice(offset, offset + max)
			.join("")
			.trim();
		if (piece !== "") pieces.push(piece);
	}
	return pieces;
}

/** Greedily joins consecutive units while the joined, trimmed text fits; splits oversized units. */
function packUnits(
	units: readonly string[],
	max: number,
	splitOversized: (unit: string) => string[],
): string[] {
	const chunks: string[] = [];
	let current = "";
	const flush = () => {
		const text = current.trim();
		if (text !== "") chunks.push(text);
		current = "";
	};
	for (const unit of units) {
		if (codePointLength(unit.trim()) > max) {
			flush();
			chunks.push(...splitOversized(unit));
			continue;
		}
		const candidate = current + unit;
		if (codePointLength(candidate.trim()) <= max) {
			current = candidate;
		} else {
			flush();
			current = unit;
		}
	}
	flush();
	return chunks;
}

function splitText(text: string, max: number): string[] {
	const trimmed = text.trim();
	if (trimmed === "") return [];
	if (codePointLength(trimmed) <= max) return [trimmed];
	return packUnits(splitAfter(trimmed, PARAGRAPH_BREAK), max, (paragraph) =>
		packUnits(splitAfter(paragraph.trim(), SENTENCE_END), max, (sentence) =>
			hardSplit(sentence, max),
		),
	);
}

function chunkId(documentId: string, headingPath: readonly string[], body: string): string {
	return createHash("sha256")
		.update(`${documentId}\n${headingPath.join(" > ")}\n${body}`)
		.digest("hex")
		.slice(0, 16);
}

function resolveMaxCharacters(value: number | undefined): number {
	const max = value ?? DEFAULT_RAG.chunkMaxCharacters;
	if (!Number.isInteger(max) || max < 1) {
		throw new PlatformError(
			"invalid-request",
			"チャンクの最大文字数は 1 以上の整数にしてください。",
		);
	}
	return max;
}

/**
 * Splits a document into chunks that never cross a heading section (Markdown) or a page (PDF).
 * A section longer than the limit is cut at paragraph boundaries, then sentence boundaries, then by
 * code points. Sections and pages with no text produce no chunk.
 */
export function chunkDocument(doc: LoadedDocument, options: ChunkOptions): Chunk[] {
	const max = resolveMaxCharacters(options.maxCharacters);
	const units: { headingPath: readonly string[]; text: string; page?: number }[] =
		doc.sourceType === "markdown"
			? doc.sections.map((section) => ({ headingPath: section.headingPath, text: section.body }))
			: doc.pages.map((text, index) => ({ headingPath: [], text, page: index + 1 }));

	const seen = new Map<string, number>();
	const chunks: Chunk[] = [];
	for (const unit of units) {
		for (const body of splitText(unit.text, max)) {
			const base = chunkId(options.documentId, unit.headingPath, body);
			const occurrence = (seen.get(base) ?? 0) + 1;
			seen.set(base, occurrence);
			chunks.push({
				id: occurrence === 1 ? base : `${base}-${occurrence}`,
				headingPath: unit.headingPath,
				body,
				...(unit.page === undefined ? {} : { page: unit.page }),
			});
		}
	}
	return chunks;
}
