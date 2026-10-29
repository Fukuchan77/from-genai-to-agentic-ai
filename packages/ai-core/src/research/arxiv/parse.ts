import { XMLParser } from "fast-xml-parser";
import { ARXIV_ID_PATTERN, ArxivFeedError, type ArxivLink, type ArxivPaper } from "./types";

// Entities are never expanded by the parser (`processEntities: false`), and a feed with a DOCTYPE is
// refused before parsing: arXiv sends none, so one only comes from something hostile (billion-laughs
// and external-entity inputs).
const DOCTYPE = /<!DOCTYPE/iu;

const ARRAY_TAGS: ReadonlySet<string> = new Set(["entry", "author", "link"]);

const parser = new XMLParser({
	processEntities: false,
	ignoreAttributes: false,
	attributeNamePrefix: "@_",
	parseTagValue: false,
	parseAttributeValue: false,
	trimValues: true,
	isArray: (name) => ARRAY_TAGS.has(name),
});

const ENTITY_REFERENCE = /&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/gu;
const NAMED: Readonly<Record<string, string>> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
};

/** One pass over the five predefined entities and numeric references; nothing else is touched. */
function decodeEntities(text: string): string {
	return text.replace(ENTITY_REFERENCE, (whole, reference: string) => {
		const named = NAMED[reference];
		if (named !== undefined) return named;
		const codePoint =
			reference[1] === "x" ? Number.parseInt(reference.slice(2), 16) : Number(reference.slice(1));
		try {
			return String.fromCodePoint(codePoint);
		} catch {
			return whole;
		}
	});
}

function normalise(text: string): string {
	return decodeEntities(text).replace(/\s+/gu, " ").trim();
}

type Node = unknown;

function isRecord(value: Node): value is Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The text of an element, which is an object when the element has attributes. */
function textOf(node: Node): string | undefined {
	if (typeof node === "string") return normalise(node);
	if (isRecord(node) && typeof node["#text"] === "string") return normalise(node["#text"]);
	return undefined;
}

function attribute(node: Readonly<Record<string, unknown>>, name: string): string | undefined {
	const value = node[`@_${name}`];
	return typeof value === "string" ? decodeEntities(value).trim() : undefined;
}

/** `isArray` makes `entry`, `author` and `link` lists; a missing element is no items. */
function listOf(node: Node): readonly Node[] {
	return Array.isArray(node) ? node : [];
}

const ID_PREFIX = /^https?:\/\/(?:www\.)?arxiv\.org\/abs\//u;
const VERSION_SUFFIX = /v\d+$/u;

function arxivIdOf(id: string | undefined): string {
	if (id === undefined || !ID_PREFIX.test(id)) throw new ArxivFeedError();
	const arxivId = id.replace(ID_PREFIX, "").replace(VERSION_SUFFIX, "");
	if (!ARXIV_ID_PATTERN.test(arxivId)) throw new ArxivFeedError();
	return arxivId;
}

function publishedOf(text: string | undefined): string {
	const time = text === undefined ? Number.NaN : Date.parse(text);
	if (Number.isNaN(time)) throw new ArxivFeedError();
	return new Date(time).toISOString();
}

function linksOf(entry: Readonly<Record<string, unknown>>): readonly ArxivLink[] {
	const links: ArxivLink[] = [];
	for (const link of listOf(entry["link"])) {
		if (!isRecord(link)) continue;
		const href = attribute(link, "href");
		if (href === undefined || href === "") continue;
		const rel = attribute(link, "rel");
		const title = attribute(link, "title");
		links.push({
			href,
			...(rel === undefined ? {} : { rel }),
			...(title === undefined ? {} : { title }),
		});
	}
	return links;
}

function authorsOf(entry: Readonly<Record<string, unknown>>): readonly string[] {
	const names: string[] = [];
	for (const author of listOf(entry["author"])) {
		const name = isRecord(author) ? textOf(author["name"]) : undefined;
		if (name !== undefined && name !== "") names.push(name);
	}
	return names;
}

function paperOf(entry: Node): ArxivPaper {
	if (!isRecord(entry)) throw new ArxivFeedError();
	const title = textOf(entry["title"]);
	// arXiv reports a failed query as a feed with one entry whose title is "Error".
	if (title === "Error") throw new ArxivFeedError();
	if (title === undefined || title === "") throw new ArxivFeedError();
	return {
		arxivId: arxivIdOf(textOf(entry["id"])),
		title,
		authors: [...authorsOf(entry)],
		publishedAt: publishedOf(textOf(entry["published"])),
		summary: textOf(entry["summary"]) ?? "",
		links: [...linksOf(entry)],
	};
}

/**
 * Parses an arXiv Atom feed into papers (plan C8). No entries is an empty list, not an error; an
 * arXiv error feed, a DOCTYPE, malformed XML or an entry without a usable id, title or date throws
 * `ArxivFeedError`, so the client can retry or give up.
 */
export function parseArxivFeed(xml: string): readonly ArxivPaper[] {
	if (DOCTYPE.test(xml)) throw new ArxivFeedError();
	let root: unknown;
	try {
		root = parser.parse(xml, true);
	} catch {
		throw new ArxivFeedError();
	}
	const feed = isRecord(root) ? root["feed"] : undefined;
	if (!isRecord(feed)) throw new ArxivFeedError();
	return Object.freeze(listOf(feed["entry"]).map(paperOf));
}
