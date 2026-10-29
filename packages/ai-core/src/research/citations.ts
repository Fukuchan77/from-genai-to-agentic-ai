import type { ArxivPaper } from "./arxiv/types";

// The citation check of plan C9 / Req 4.5. It is a pure function over text: it finds every arXiv ID
// and paper link in the report, keeps the ones that belong to a paper the search sub-agent actually
// fetched, and removes the rest. What it cannot see is a paper written about with no ID and no
// known title; the warnings below only catch the shapes that look like a reference.

const MIN_TITLE_CHARACTERS = 8;
const MAX_REFERENCE_WARNINGS = 5;
const EXCERPT_CHARACTERS = 60;

const OLD_STYLE = String.raw`[a-zA-Z]+(?:-[a-zA-Z]+)*(?:\.[A-Za-z]{2})?\/\d{7}`;
const ID_BODY = String.raw`(?:\d{2}(?:0[1-9]|1[0-2])\.\d{4,5}|${OLD_STYLE})`;
// A bare ID: not glued to a word, a path or a longer number, with an optional `arXiv:` and version.
// With the `arXiv:` label any four digits can be the month: the label says it is an ID, so a made-up
// one like 2499.99999 is still removed. Without it the month must be real, or "1234.5678" would be one.
const LABELLED_ID = String.raw`\d{4}\.\d{4,5}|${OLD_STYLE}`;
// `_` is not a boundary: Markdown emphasis (`_2412.99999_`) wraps IDs in it. The arXiv DOI
// (`10.48550/arXiv.<id>`) is a label too.
const BARE_ID = String.raw`(?<![A-Za-z0-9./-])(?:[aA][rR][xX][iI][vV]\s*:\s*(${LABELLED_ID})|10\.48550\/[aA][rR][xX][iI][vV]\.(${LABELLED_ID})|(${ID_BODY}))(?:v\d+)?(?![A-Za-z0-9]|\.\d)`;
const URL_BODY = String.raw`[^\s<>()\[\]"'「」『』（）【】]+`;
const URL_TOKEN = String.raw`(?i:https?:\/\/${URL_BODY}|(?<![\w.@/-])(?:(?:www|export)\.)?arxiv\.org\/${URL_BODY})`;
// The link text is bounded so that a run of `[` cannot make the scan quadratic.
const MARKDOWN_LINK = String.raw`\[([^\]\n]{0,200})\]\(\s*<?(${URL_BODY})>?[^)\n]{0,200}\)`;

// Groups: 1 = link text, 2 = link address, 3 = bare address, 4 = labelled ID, 5 = DOI ID, 6 = bare ID.
const MENTION = new RegExp(`${MARKDOWN_LINK}|(${URL_TOKEN})|${BARE_ID}`, "gu");
const BARE_ID_ONLY = new RegExp(BARE_ID, "gu");

/** Hosts that carry papers other than arXiv's. A link to one is kept only if a fetched paper lists it. */
const PAPER_HOSTS: ReadonlySet<string> = new Set([
	"doi.org",
	"dx.doi.org",
	"openreview.net",
	"aclanthology.org",
	"semanticscholar.org",
	"proceedings.mlr.press",
	"dl.acm.org",
	"ieeexplore.ieee.org",
	"papers.nips.cc",
	"proceedings.neurips.cc",
	"link.springer.com",
	"researchgate.net",
]);

interface Mention {
	/** Offsets in the line. */
	readonly start: number;
	readonly end: number;
	readonly kind: "arxiv" | "site";
	/** The arXiv ID without its version, or the normalised address of another paper site. */
	readonly key: string;
	/** What the learner sees: the ID, or the address as it was written. */
	readonly display: string;
}

/**
 * An address with no scheme, no leading `www.`, no fragment, no trailing slash and no doubled
 * slash. `dx.doi.org` is `doi.org`, and a DOI is not case sensitive.
 */
function normaliseUrl(url: string): string {
	const withoutScheme = url.replace(/^https?:\/\//iu, "").replace(/#.*$/u, "");
	const slash = withoutScheme.indexOf("/");
	const host = (slash === -1 ? withoutScheme : withoutScheme.slice(0, slash))
		.replace(/^www\./iu, "")
		.toLowerCase()
		.replace(/^dx\.doi\.org$/u, "doi.org");
	const rest = (slash === -1 ? "" : withoutScheme.slice(slash)).replace(/\/{2,}/gu, "/");
	return `${host}${host === "doi.org" ? rest.toLowerCase() : rest}`.replace(/\/+$/u, "");
}

// Pages of other sites that carry an arXiv ID in their address are mentions of that paper.
const EMBEDDED_ID = new RegExp(
	String.raw`^(?:huggingface\.co\/papers|alphaxiv\.org\/(?:abs|overview)|(?:api\.)?semanticscholar\.org\/arxiv|doi\.org\/10\.48550\/arxiv\.)\/?(${LABELLED_ID})`,
	"iu",
);

/** A link is a paper mention if it points at an arXiv paper page or at a known paper site. */
function classifyUrl(url: string): Pick<Mention, "kind" | "key"> | undefined {
	const normalised = normaliseUrl(url);
	const slash = normalised.indexOf("/");
	const host = (slash === -1 ? normalised : normalised.slice(0, slash)).replace(
		/^(?:www|export|m)\./u,
		"",
	);
	if (host === "arxiv.org" || host === "ar5iv.org" || host === "ar5iv.labs.arxiv.org") {
		const path = slash === -1 ? "" : normalised.slice(slash);
		const match = /^\/(?:abs|pdf|html)\/([^?]+)/iu.exec(path);
		if (match === null) return undefined;
		return { kind: "arxiv", key: (match[1] ?? "").replace(/\.pdf$/u, "").replace(/v\d+$/u, "") };
	}
	const embedded = EMBEDDED_ID.exec(normalised)?.[1];
	if (embedded !== undefined) return { kind: "arxiv", key: embedded };
	return PAPER_HOSTS.has(host) ? { kind: "site", key: normalised } : undefined;
}

function trimTrailingPunctuation(url: string): string {
	return url.replace(/[.,;:!?。、]+$/u, "");
}

function bareMentions(text: string, offset: number): Mention[] {
	return [...text.matchAll(BARE_ID_ONLY)].map((match) => {
		const id = match[1] ?? match[2] ?? match[3] ?? "";
		const start = offset + (match.index ?? 0);
		return { start, end: start + match[0].length, kind: "arxiv", key: id, display: id };
	});
}

function linkMention(
	classified: Pick<Mention, "kind" | "key">,
	url: string,
	start: number,
	end: number,
): Mention {
	return {
		start,
		end,
		...classified,
		display: classified.kind === "arxiv" ? classified.key : url,
	};
}

/** Every arXiv ID and paper link in one line, in order. */
function findMentions(line: string): Mention[] {
	const found: Mention[] = [];
	for (const match of line.matchAll(MENTION)) {
		const start = match.index ?? 0;
		const [whole, linkText, linkAddress, bareAddress, labelledId, doiId, plainId] = match;
		const bareId = labelledId ?? doiId ?? plainId;
		if (linkAddress !== undefined) {
			const url = trimTrailingPunctuation(linkAddress);
			const classified = classifyUrl(url);
			if (classified !== undefined) {
				found.push(linkMention(classified, url, start, start + whole.length));
				// The text can name another paper than the address does; it is cut out with the link.
				for (const named of bareMentions(linkText ?? "", start)) {
					found.push({ ...named, start, end: start + whole.length });
				}
			} else {
				// A link to somewhere else can still carry an ID in its text.
				found.push(...bareMentions(linkText ?? "", start + 1));
			}
		} else if (bareAddress !== undefined) {
			const url = trimTrailingPunctuation(bareAddress);
			const classified = classifyUrl(url);
			if (classified !== undefined) {
				found.push(linkMention(classified, url, start, start + url.length));
			}
		} else if (bareId !== undefined) {
			found.push({ start, end: start + whole.length, kind: "arxiv", key: bareId, display: bareId });
		}
	}
	return found;
}

const LIST_OR_TABLE_LINE = /^\s*(?:[-*+]\s|\d+[.)]\s|\|)/u;
const SENTENCE_END = /[。！？]/u;
const OPENING = "([（【";
const CLOSING = ")]）】";

function isSentenceEnd(line: string, index: number): boolean {
	const character = line.charAt(index);
	if (SENTENCE_END.test(character)) return true;
	if (character !== "." && character !== "!" && character !== "?") return false;
	const next = line.charAt(index + 1);
	return next === "" || /\s/u.test(next);
}

/** The sentence that holds `mention`, as `[start, end)`. */
function sentenceAround(line: string, mention: Mention): readonly [number, number] {
	let start = 0;
	for (let index = mention.start - 1; index >= 0; index -= 1) {
		if (isSentenceEnd(line, index)) {
			start = index + 1;
			break;
		}
	}
	let end = line.length;
	for (let index = mention.end; index < line.length; index += 1) {
		if (isSentenceEnd(line, index)) {
			end = index + 1;
			break;
		}
	}
	return [start, end];
}

/** The mention and the bracket that closes right around it, if there is one. */
function withBrackets(line: string, mention: Mention): readonly [number, number] {
	const before = OPENING.indexOf(line.charAt(mention.start - 1));
	const after = CLOSING.indexOf(line.charAt(mention.end));
	if (before !== -1 && before === after) return [mention.start - 1, mention.end + 1];
	return [mention.start, mention.end];
}

function deleteSpans(line: string, spans: readonly (readonly [number, number])[]): string {
	// The spans come in the order of the mentions, so they only ever repeat or follow each other; a
	// repeated span slices an empty range.
	let result = "";
	let from = 0;
	for (const [start, end] of spans) {
		result += line.slice(from, start);
		from = end;
	}
	result += line.slice(from);
	// A removal can leave a space at the start; the line's own indentation is the only one kept.
	const indent = /^\s*/u.exec(line)?.[0] ?? "";
	return `${indent}${result.trimStart().replace(/[ \t]{2,}/gu, " ")}`.trimEnd();
}

interface Removal {
	readonly display: string;
	/** True when only the mention could be removed because the sentence also cites a kept paper. */
	readonly partial: boolean;
}

function removalWarning(display: string, partial: boolean): string {
	return partial
		? `「${display}」は、検索で取得した論文の集合に無いため除去しました。同じ文に別の論文があるため文は残しています。内容を確認してください。`
		: `「${display}」は、検索で取得した論文の集合に無いため、その言及を除去しました。`;
}

interface LineResult {
	/** `undefined` drops the line. */
	readonly text: string | undefined;
}

function cleanLine(
	line: string,
	isKept: (mention: Mention) => boolean,
	removals: Map<string, Removal>,
): LineResult {
	const mentions = findMentions(line);
	const unknown = mentions.filter((mention) => !isKept(mention));
	if (unknown.length === 0) return { text: line };
	const known = mentions.filter(isKept);
	const record = (mention: Mention, partial: boolean) => {
		const previous = removals.get(mention.key);
		removals.set(mention.key, {
			display: previous?.display ?? mention.display,
			partial: partial || (previous?.partial ?? false),
		});
	};

	if (LIST_OR_TABLE_LINE.test(line) && known.length === 0) {
		for (const mention of unknown) record(mention, false);
		return { text: undefined };
	}
	const spans: (readonly [number, number])[] = [];
	for (const mention of unknown) {
		const structural = LIST_OR_TABLE_LINE.test(line);
		const sentence = structural ? undefined : sentenceAround(line, mention);
		const keepsKnown =
			sentence === undefined ||
			known.some((other) => other.start >= sentence[0] && other.end <= sentence[1]);
		if (sentence !== undefined && !keepsKnown) {
			spans.push(sentence);
			record(mention, false);
		} else {
			spans.push(withBrackets(line, mention));
			record(mention, true);
		}
	}
	const text = deleteSpans(line, spans);
	return { text: text.trim() === "" ? undefined : text };
}

/** Drops the lines marked `undefined` together with one line break each. */
function joinLines(parts: readonly string[], dropped: ReadonlySet<number>): string {
	// `parts` alternates a line and the break that follows it.
	const out: string[] = [];
	for (let index = 0; index < parts.length; index += 2) {
		const line = parts[index] ?? "";
		const separator = parts[index + 1];
		if (dropped.has(index)) {
			if (separator === undefined) {
				// The last line goes: take the break before it too.
				if (out.length > 0) out.pop();
			}
			continue;
		}
		out.push(line);
		if (separator !== undefined) out.push(separator);
	}
	return out.join("");
}

function normaliseText(text: string): string {
	return text.toLowerCase().replace(/\s+/gu, " ").trim();
}

function excerpt(line: string): string {
	const characters = Array.from(line.trim());
	return characters.length <= EXCERPT_CHARACTERS
		? characters.join("")
		: `${characters.slice(0, EXCERPT_CHARACTERS).join("")}…`;
}

const ET_AL = /\bet al\b/iu;
const PAREN_YEAR = /[（(]\s*(?:19|20)\d{2}\s*[)）]/u;

export interface CitationCheck {
	/** The report with every mention of a paper outside the set removed (warnings not yet attached). */
	readonly report: string;
	/** The IDs (or addresses) that were removed, once each, in order of appearance. */
	readonly removed: readonly string[];
	readonly warnings: readonly string[];
}

/**
 * Checks the report's citations against the papers the run fetched (Req 4.5). An ID or arXiv link
 * outside the set is removed with its list item, table row or sentence; when that sentence also
 * cites a kept paper only the mention goes and a warning asks the learner to look at the sentence.
 * Versions (`v2`) and link spellings (`http` / `https`, `abs` / `pdf`, `www.`) are not told apart.
 * A known paper named without its ID, and a line that looks like a reference but has no ID, only
 * produce warnings.
 */
export function checkCitations(report: string, papers: readonly ArxivPaper[]): CitationCheck {
	const ids = new Set(papers.map((paper) => paper.arxivId.toLowerCase()));
	const addresses = new Set(
		papers.flatMap((paper) => paper.links.map((link) => normaliseUrl(link.href))),
	);
	const isKept = (mention: Mention) =>
		mention.kind === "arxiv" ? ids.has(mention.key.toLowerCase()) : addresses.has(mention.key);

	const removals = new Map<string, Removal>();
	const parts = report.split(/(\r?\n)/u);
	const dropped = new Set<number>();
	const lines = parts.map((part, index) => {
		if (index % 2 === 1) return part;
		const result = cleanLine(part, isKept, removals);
		if (result.text === undefined) dropped.add(index);
		return result.text ?? part;
	});
	const changed = removals.size > 0;
	let cleaned = changed ? joinLines(lines, dropped) : report;
	if (changed) cleaned = cleaned.replace(/(\r?\n)(?:\r?\n){2,}/gu, "$1$1");

	const warnings = [...removals.values()].map((removal) =>
		removalWarning(removal.display, removal.partial),
	);
	warnings.push(...missingIdWarnings(cleaned, papers));
	return {
		report: cleaned,
		removed: [...removals.values()].map((removal) => removal.display),
		warnings,
	};
}

/** Warnings for a known paper named without its ID, and for lines that look like unlinked references. */
function missingIdWarnings(report: string, papers: readonly ArxivPaper[]): string[] {
	const warnings: string[] = [];
	const titled = papers.filter((paper) => Array.from(paper.title).length >= MIN_TITLE_CHARACTERS);
	const paragraphs = report.split(/\r?\n[ \t]*\r?\n/u);
	for (const paper of titled) {
		const title = normaliseText(paper.title);
		const own = new Set([paper.arxivId, ...paper.links.map((link) => normaliseUrl(link.href))]);
		const unlinked = paragraphs.some(
			(paragraph) =>
				normaliseText(paragraph).includes(title) &&
				!paragraph.split(/\r?\n/u).some((line) => findMentions(line).some((m) => own.has(m.key))),
		);
		if (unlinked) warnings.push(`論文「${paper.title}」に arXiv ID またはリンクが付いていません。`);
	}

	const titles = titled.map((paper) => normaliseText(paper.title));
	const lines = report.split(/\r?\n/u);
	const flagged: string[] = [];
	lines.forEach((line, index) => {
		if (!ET_AL.test(line) && !PAREN_YEAR.test(line)) return;
		const normalised = normaliseText(line);
		// A line that names a known paper is already reported above.
		if (titles.some((title) => normalised.includes(title))) return;
		// A reference that wraps may carry its ID on the next line.
		const next = LIST_OR_TABLE_LINE.test(line) ? "" : (lines[index + 1] ?? "");
		if (findMentions(line).length > 0 || findMentions(next).length > 0) return;
		flagged.push(line);
	});
	for (const line of flagged.slice(0, MAX_REFERENCE_WARNINGS)) {
		warnings.push(`ID の付いていない論文の言及の可能性があります: 「${excerpt(line)}」`);
	}
	if (flagged.length > MAX_REFERENCE_WARNINGS) {
		warnings.push(
			`ほかに ${flagged.length - MAX_REFERENCE_WARNINGS} 行にも、ID の付いていない論文の言及の可能性があります。`,
		);
	}
	return warnings;
}

/** Adds the warnings to the end of the report as a section, so a copied report carries them (Req 4.5). */
export function attachCitationWarnings(report: string, warnings: readonly string[]): string {
	if (warnings.length === 0) return report;
	const items = warnings.map((warning) => `- ${warning}`).join("\n");
	return `${report.trimEnd()}\n\n---\n\n## 引用の確認\n\n${items}\n`;
}
