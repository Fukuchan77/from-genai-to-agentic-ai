import type { RequirementItem, Requirements } from "./session";

// Renders the requirement document (Req 5.6, plan C11): a pure function with a fixed chapter list.
// Every string that comes from the learner or the model lands in the body only, as a single-line
// list item, so it can neither forge a chapter nor change the headings.

export const REQUIREMENT_DOCUMENT_TITLE = "# 要件定義書";

export const REQUIREMENT_DOCUMENT_HEADINGS = {
	functional: "## 1. 機能要件",
	nonFunctional: "## 2. 非機能要件",
	constraints: "## 3. 制約",
	unconfirmed: "## 4. 未確認事項",
} as const;

/** Written under a chapter that has no entry. */
export const NONE_TEXT = "なし";

export interface RenderRequirementDocumentOptions {
	/** True when the interview ended at the round limit; only then is `missing` listed. */
	readonly forcedEnd: boolean;
	/** Items the last verdict reported as missing. */
	readonly missing: readonly string[];
}

// A leading marker would start a heading, quote, nested list or ordered list inside the item.
const LEADING_MARKER = /^(?:[#>\-+*=`|~]|\d+[.)])/;

/** Collapses every whitespace run (newlines included) and escapes a leading block marker. */
function toSingleLine(raw: string): string {
	const line = raw.replace(/\s+/g, " ").trim();
	return LEADING_MARKER.test(line) ? `\\${line}` : line;
}

function normalize(raw: string): string {
	return raw.replace(/\s+/g, " ").trim();
}

function renderItems(items: readonly string[]): string {
	return items.length === 0 ? NONE_TEXT : items.map((line) => `- ${line}`).join("\n");
}

function sourced(items: readonly RequirementItem[]): string[] {
	return items
		.filter((entry) => normalize(entry.text) !== "")
		.map((entry) => `${toSingleLine(entry.text)}（出所: ${normalize(entry.personaId)}）`);
}

function unconfirmedLines(
	unconfirmed: readonly RequirementItem[],
	{ forcedEnd, missing }: RenderRequirementDocumentOptions,
): string[] {
	const lines = sourced(unconfirmed);
	if (!forcedEnd) return lines;
	const seen = new Set(unconfirmed.map((entry) => normalize(entry.text)));
	for (const entry of missing) {
		const text = normalize(entry);
		if (text === "" || seen.has(text)) continue;
		seen.add(text);
		lines.push(toSingleLine(text));
	}
	return lines;
}

/**
 * Builds the document: a title and four chapters in a fixed order. An empty chapter reads
 * `なし`. On a forced end the `missing` entries join the unconfirmed chapter (blank and duplicate
 * entries dropped); otherwise `missing` is ignored. The output ends with one newline.
 */
export function renderRequirementDocument(
	requirements: Requirements,
	options: RenderRequirementDocumentOptions,
): string {
	const chapters: [string, string][] = [
		[REQUIREMENT_DOCUMENT_HEADINGS.functional, renderItems(sourced(requirements.functional))],
		[REQUIREMENT_DOCUMENT_HEADINGS.nonFunctional, renderItems(sourced(requirements.nonFunctional))],
		[REQUIREMENT_DOCUMENT_HEADINGS.constraints, renderItems(sourced(requirements.constraints))],
		[
			REQUIREMENT_DOCUMENT_HEADINGS.unconfirmed,
			renderItems(unconfirmedLines(requirements.unconfirmed, options)),
		],
	];
	return `${[REQUIREMENT_DOCUMENT_TITLE, ...chapters.map(([h, b]) => `${h}\n\n${b}`)].join("\n\n")}\n`;
}
