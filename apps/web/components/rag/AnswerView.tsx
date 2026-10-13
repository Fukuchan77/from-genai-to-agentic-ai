import type { Citation } from "@platform/ai-core/rag";
import type { KeyboardEvent, MouseEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { citationCardId } from "./CitationList";

export interface AnswerViewProps {
	/** The streamed text, then the settled `answer` of `data-rag-result` once it arrives. */
	readonly text: string;
	/** Present once the server settled the result; footnotes link only to cards in this list. */
	readonly citations: readonly Citation[] | undefined;
	/** True when retrieval found nothing to answer from (`data-rag-result.noEvidence`). */
	readonly noEvidence?: boolean;
	/** Must match the `idPrefix` of the `CitationList` that shows the cards. */
	readonly idPrefix: string;
}

type Segment =
	| { readonly kind: "text"; readonly offset: number; readonly text: string }
	| { readonly kind: "code"; readonly offset: number; readonly text: string }
	| {
			readonly kind: "footnote";
			readonly offset: number;
			readonly text: string;
			readonly numbers: readonly number[];
	  };

// The footnote grammar of `resolveCitations` (ai-core/rag/answer/citations.ts): "[1]", "[1, 2]" or
// "[1-3]", also full-width, and not a Markdown link label. The server owns the rule; this copy only
// finds where to draw links, because the client cannot import the server-only `rag` subpath.
const NUMBER = "[0-9０-９]{1,9}";
const FOOTNOTE = new RegExp(
	`[[［](${NUMBER}(?:\\s*[,，、\\-–～~]\\s*${NUMBER})*)[\\]］](?!\\()`,
	"gu",
);
const MAX_RANGE_SPAN = 20;
const RANGE_DASH = /[-–～~]/u;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/u;
const FULL_WIDTH_ZERO = 0xff10;
const ASCII_ZERO = 0x30;

function toOrdinal(digits: string): number {
	let value = 0;
	for (const digit of digits) {
		const code = digit.codePointAt(0) ?? ASCII_ZERO;
		value = value * 10 + (code >= FULL_WIDTH_ZERO ? code - FULL_WIDTH_ZERO : code - ASCII_ZERO);
	}
	return value;
}

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

/** Splits one line into plain and `inline code` runs; a backtick run closes with an equal run. */
function splitInlineCode(line: string, offset: number): Segment[] {
	const segments: Segment[] = [];
	let plainStart = 0;
	let index = 0;
	while (index < line.length) {
		if (line[index] !== "`") {
			index += 1;
			continue;
		}
		let end = index;
		while (line[end] === "`") end += 1;
		const fence = line.slice(index, end);
		let close = -1;
		for (
			let search = line.indexOf(fence, end);
			search !== -1;
			search = line.indexOf(fence, search + 1)
		) {
			// A longer run does not close a shorter opener.
			if (line[search - 1] !== "`" && line[search + fence.length] !== "`") {
				close = search;
				break;
			}
		}
		if (close === -1) {
			index = end;
			continue;
		}
		if (index > plainStart) {
			segments.push({
				kind: "text",
				offset: offset + plainStart,
				text: line.slice(plainStart, index),
			});
		}
		const stop = close + fence.length;
		segments.push({ kind: "code", offset: offset + index, text: line.slice(index, stop) });
		plainStart = stop;
		index = stop;
	}
	if (plainStart < line.length) {
		segments.push({ kind: "text", offset: offset + plainStart, text: line.slice(plainStart) });
	}
	return segments;
}

/** Splits the text into plain, code (fenced or inline) and footnote segments. */
function tokenize(text: string): Segment[] {
	const segments: Segment[] = [];
	// The fence rules of `findCodeRanges` in ai-core: a backtick line with more backticks after the
	// run is not a fence, and a closer is itself a fence line (at most 3 spaces of indent) of the
	// same marker, at least as long, with nothing after it.
	let fence: { readonly marker: string; readonly length: number } | undefined;
	let offset = 0;
	for (const line of text.split(/(?<=\n)/u)) {
		const marker = FENCE_OPEN.exec(line);
		const run = marker?.[1];
		if (fence !== undefined) {
			segments.push({ kind: "code", offset, text: line });
			if (
				run?.startsWith(fence.marker) &&
				run.length >= fence.length &&
				line.slice(marker?.[0].length ?? 0).trim() === ""
			) {
				fence = undefined;
			}
		} else if (
			run !== undefined &&
			!(run.startsWith("`") && line.slice(marker?.[0].length ?? 0).includes("`"))
		) {
			fence = { marker: run.charAt(0), length: run.length };
			segments.push({ kind: "code", offset, text: line });
		} else {
			segments.push(...splitInlineCode(line, offset));
		}
		offset += line.length;
	}
	return segments.flatMap((segment) =>
		segment.kind === "text" ? splitFootnotes(segment) : [segment],
	);
}

function splitFootnotes(segment: Segment): Segment[] {
	const result: Segment[] = [];
	let last = 0;
	for (const match of segment.text.matchAll(FOOTNOTE)) {
		const numbers = parseGroup(match[1] ?? "");
		if (numbers === undefined) continue;
		if (match.index > last) {
			result.push({
				kind: "text",
				offset: segment.offset + last,
				text: segment.text.slice(last, match.index),
			});
		}
		result.push({
			kind: "footnote",
			offset: segment.offset + match.index,
			text: match[0],
			numbers,
		});
		last = match.index + match[0].length;
	}
	if (last < segment.text.length) {
		result.push({ kind: "text", offset: segment.offset + last, text: segment.text.slice(last) });
	}
	return result;
}

function focusCard(idPrefix: string, label: number): void {
	const card = document.getElementById(citationCardId(idPrefix, label));
	if (!card) return;
	card.scrollIntoView?.({ block: "nearest" });
	card.focus();
}

function FootnoteLink({ idPrefix, label }: { readonly idPrefix: string; readonly label: number }) {
	function go(event: MouseEvent<HTMLAnchorElement> | KeyboardEvent<HTMLAnchorElement>) {
		event.preventDefault();
		focusCard(idPrefix, label);
	}
	return (
		<a
			href={`#${citationCardId(idPrefix, label)}`}
			onClick={go}
			onKeyDown={(event) => {
				// Enter activates a link natively; Space does not, so both are handled the same way.
				if (event.key === "Enter" || event.key === " ") go(event);
			}}
			className="rounded-sm font-medium text-primary underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2"
		>
			{`[${label}]`}
		</a>
	);
}

function SegmentView({
	segment,
	labels,
	idPrefix,
}: {
	readonly segment: Segment;
	readonly labels: ReadonlySet<number>;
	readonly idPrefix: string;
}) {
	if (segment.kind === "code")
		return <code className="font-mono text-[0.9em]">{segment.text}</code>;
	if (segment.kind === "text") return <>{segment.text}</>;
	// A footnote group with no card at all keeps its own spelling; otherwise each number is a token.
	if (!segment.numbers.some((n) => labels.has(n))) return <>{segment.text}</>;
	return (
		<>
			{segment.numbers.map((n, index) => (
				// The same number can repeat inside a group, so the position is the identity.
				// biome-ignore lint/suspicious/noArrayIndexKey: see above
				<span key={`${segment.offset}-${index}`}>
					{index > 0 ? " " : null}
					{labels.has(n) ? <FootnoteLink idPrefix={idPrefix} label={n} /> : `[${n}]`}
				</span>
			))}
		</>
	);
}

/**
 * The answer text with its footnotes drawn as links to the citation cards (plan C14). Links exist
 * only for footnotes whose card exists in the settled result; anything else, and everything inside
 * code, stays plain text. The server already removed the out-of-range footnotes, so nothing is
 * re-validated here.
 */
export function AnswerView({ text, citations, noEvidence = false, idPrefix }: AnswerViewProps) {
	const labels = new Set((citations ?? []).map((citation) => citation.label));
	return (
		<div className="flex flex-col gap-2">
			{noEvidence ? <Badge variant="secondary">該当なし</Badge> : null}
			<div className="whitespace-pre-wrap break-words">
				{tokenize(text).map((segment) => (
					<SegmentView
						key={`${segment.kind}-${segment.offset}`}
						segment={segment}
						labels={labels}
						idPrefix={idPrefix}
					/>
				))}
			</div>
		</div>
	);
}
