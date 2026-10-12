import type { ScoredChunk } from "../store";

/** Characters of a chunk body kept as a citation's excerpt (plan C8). */
export const CITATION_EXCERPT_CHARACTERS = 200;

/** Where in the source document a chunk came from. */
export type CitationLocator =
	| { readonly kind: "page"; readonly page: number }
	| { readonly kind: "heading"; readonly path: readonly string[] };

/** One retrieved chunk as the learner sees it; `label` is the 1-based ordinal used in `[n]`. */
export interface Citation {
	readonly chunkId: string;
	readonly label: number;
	readonly documentId: string;
	readonly documentTitle: string;
	readonly locator: CitationLocator;
	readonly excerpt: string;
	readonly similarity?: number;
	/** True when the (reconciled) answer has a footnote that points at this chunk. */
	readonly cited: boolean;
}

export interface ResolvedCitations {
	/** The answer without footnotes that point at no retrieved chunk. */
	readonly answer: string;
	/** Every retrieved chunk, in retrieval order. */
	readonly citations: Citation[];
	/** Out-of-range ordinals that were removed, once each, in order of first appearance. */
	readonly removedCitations: number[];
}

interface Range {
	readonly start: number;
	readonly end: number;
}

// "[1]", "[1, 2]" or "[1-3]", also full-width ("［１］", "［１、２］"); digits of either width. A link
// target "(" right after the brackets makes it a Markdown link, which is not a footnote.
const NUMBER = "[0-9０-９]{1,9}";
const FOOTNOTE = new RegExp(
	`[[［](${NUMBER}(?:\\s*[,，、\\-–～~]\\s*${NUMBER})*)[\\]］](?!\\()`,
	"gu",
);
// A range wider than this is not a footnote (`[1-99999]` is more likely an index or a year).
const MAX_RANGE_SPAN = 20;
const RANGE_DASH = /[-–～~]/u;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/u;
const FULL_WIDTH_ZERO = 0xff10;
const ASCII_ZERO = 0x30;
// Text that may follow a removed footnote directly, without the space that preceded it.
const CLOSING_TEXT = /^[\s.,;:!?)\]}、。，．！？）」』】]/u;

/**
 * The numbers a footnote group refers to, or `undefined` when the group is not a footnote
 * (a reversed or very wide range). "1, 2" lists numbers; "1-3" is the range 1..3.
 */
function parseGroup(group: string): number[] | undefined {
	const ordinals: number[] = [];
	for (const item of group.split(/\s*[,，、]\s*/u)) {
		const bounds = item.split(RANGE_DASH).map((part) => toOrdinal(part.trim()));
		const low = bounds[0];
		const high = bounds[1] ?? low;
		if (low === undefined || high === undefined || bounds.length > 2) return undefined;
		if (high < low || high - low > MAX_RANGE_SPAN) return undefined;
		for (let value = low; value <= high; value += 1) ordinals.push(value);
	}
	return ordinals;
}

function toOrdinal(digits: string): number {
	let value = 0;
	for (const digit of digits) {
		const code = digit.codePointAt(0) ?? ASCII_ZERO;
		value = value * 10 + (code >= FULL_WIDTH_ZERO ? code - FULL_WIDTH_ZERO : code - ASCII_ZERO);
	}
	return value;
}

/** Ranges of `` `inline code` `` inside one line: a backtick run closes with a run of equal length. */
function inlineCodeRanges(line: string, offset: number): Range[] {
	const ranges: Range[] = [];
	const runs = [...line.matchAll(/`+/gu)];
	for (let index = 0; index < runs.length; index += 1) {
		const open = runs[index];
		if (open === undefined) continue;
		const closeIndex = runs.findIndex(
			(run, candidate) => candidate > index && run[0].length === open[0].length,
		);
		const close = runs[closeIndex];
		if (close === undefined) continue;
		ranges.push({ start: offset + open.index, end: offset + close.index + close[0].length });
		index = closeIndex;
	}
	return ranges;
}

/**
 * Fenced code blocks (` ``` ` or `~~~`, closed by a fence of the same character that is at least
 * as long; an unterminated fence runs to the end) and inline code spans (per line).
 */
function findCodeRanges(text: string): Range[] {
	const ranges: Range[] = [];
	let fence: { readonly marker: string; readonly length: number; readonly start: number } | null =
		null;
	let position = 0;
	while (position < text.length) {
		const newline = text.indexOf("\n", position);
		const lineEnd = newline === -1 ? text.length : newline;
		const line = text.slice(position, lineEnd);
		if (fence === null) {
			const open = FENCE_OPEN.exec(line);
			const run = open?.[1];
			const isFence =
				run !== undefined &&
				!(run.startsWith("`") && line.slice(open?.[0].length ?? 0).includes("`"));
			if (isFence) {
				fence = { marker: run.charAt(0), length: run.length, start: position };
			} else {
				ranges.push(...inlineCodeRanges(line, position));
			}
		} else {
			const closing = FENCE_OPEN.exec(line);
			const run = closing?.[1];
			if (
				run?.startsWith(fence.marker) &&
				run.length >= fence.length &&
				line.slice(closing?.[0].length ?? 0).trim() === ""
			) {
				ranges.push({ start: fence.start, end: lineEnd });
				fence = null;
			}
		}
		position = lineEnd + 1;
	}
	if (fence !== null) ranges.push({ start: fence.start, end: text.length });
	return ranges;
}

function excerptOf(body: string): string {
	const characters = Array.from(body);
	return characters.length <= CITATION_EXCERPT_CHARACTERS
		? body
		: characters.slice(0, CITATION_EXCERPT_CHARACTERS).join("");
}

function toCitation({ chunk, similarity }: ScoredChunk, label: number, cited: boolean): Citation {
	return {
		chunkId: chunk.id,
		label,
		documentId: chunk.documentId,
		documentTitle: chunk.documentTitle,
		locator:
			chunk.page === null
				? { kind: "heading", path: [...chunk.headingPath] }
				: { kind: "page", page: chunk.page },
		excerpt: excerptOf(chunk.body),
		...(similarity === undefined ? {} : { similarity }),
		cited,
	};
}

/**
 * Reconciles the footnotes `[n]` of an answer with the chunks the answer was generated from
 * (plan C8, Req 1.5 / 1.11). `n` is the 1-based position in `chunks`. A footnote outside
 * `1..chunks.length` is removed from the answer and recorded in `removedCitations`; the others are
 * kept (full-width ones are written as `[n]`) and mark their chunk `cited`. Footnotes inside code
 * are not citations. Every chunk is returned, cited or not.
 */
export function resolveCitations(
	answerText: string,
	chunks: readonly ScoredChunk[],
): ResolvedCitations {
	const codeRanges = findCodeRanges(answerText);
	const cited = new Set<number>();
	const removed: number[] = [];
	let answer = "";
	let cursor = 0;
	// True right after a footnote was removed, so the next piece can close the gap it left.
	let gapOpen = false;

	const append = (piece: string): void => {
		if (piece === "") return;
		let next = piece;
		if (gapOpen) {
			if (answer === "" || answer.endsWith("\n")) next = next.replace(/^[ \t]+/u, "");
			else if (CLOSING_TEXT.test(next)) answer = answer.replace(/[ \t]+$/u, "");
			gapOpen = false;
		}
		answer += next;
	};

	for (const match of answerText.matchAll(FOOTNOTE)) {
		const start = match.index;
		const end = start + match[0].length;
		if (codeRanges.some((range) => start >= range.start && start < range.end)) continue;
		const ordinals = parseGroup(match[1] ?? "");
		if (ordinals === undefined) continue;
		append(answerText.slice(cursor, start));
		cursor = end;
		const kept = ordinals.filter((ordinal) => ordinal >= 1 && ordinal <= chunks.length);
		for (const ordinal of ordinals) {
			if (!kept.includes(ordinal) && !removed.includes(ordinal)) removed.push(ordinal);
		}
		if (kept.length > 0) {
			for (const ordinal of kept) cited.add(ordinal);
			append([...new Set(kept)].map((ordinal) => `[${ordinal}]`).join(""));
		} else {
			gapOpen = true;
		}
	}
	append(answerText.slice(cursor));
	if (gapOpen) answer = answer.replace(/[ \t]+$/u, "");

	return {
		answer,
		citations: chunks.map((scoredChunk, index) =>
			toCitation(scoredChunk, index + 1, cited.has(index + 1)),
		),
		removedCitations: removed,
	};
}
