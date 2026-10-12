/** One heading-delimited part of a Markdown document (plan C5, Req 1.2). */
export interface MarkdownSection {
	/** Heading texts from the outermost to this section's own heading; empty before the first heading. */
	readonly headingPath: readonly string[];
	/** Text under the heading up to the next heading, trimmed. Empty when the heading has no text. */
	readonly body: string;
}

interface FrontMatter {
	readonly lines: readonly string[];
	/** Index of the first body line after the closing delimiter. */
	readonly bodyStart: number;
}

const HEADING = /^ {0,3}(#{1,6})[ \t]+(\S.*?)[ \t]*$/;
const CLOSING_HASHES = /[ \t]+#+$/;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const FRONT_MATTER_DELIMITER = /^---[ \t]*$/;
const FRONT_MATTER_END = /^(?:---|\.\.\.)[ \t]*$/;
const TAGS_KEY = /^tags[ \t]*:(.*)$/;
const BLOCK_ITEM = /^[ \t]*-[ \t]+(\S.*)$/;
const TOP_LEVEL_KEY = /^[^\s\-#]/;

function toLines(text: string): string[] {
	return text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
}

function findFrontMatter(lines: readonly string[]): FrontMatter | undefined {
	if (!FRONT_MATTER_DELIMITER.test(lines[0] ?? "")) return undefined;
	const end = lines.findIndex((line, index) => index > 0 && FRONT_MATTER_END.test(line));
	if (end === -1) return undefined;
	return { lines: lines.slice(1, end), bodyStart: end + 1 };
}

function unquote(raw: string): string {
	const value = raw.trim();
	const first = value[0];
	if (value.length >= 2 && (first === '"' || first === "'") && value.endsWith(first)) {
		return value.slice(1, -1);
	}
	return value;
}

/** Splits a flow-sequence body on commas that sit outside quotes. */
function splitFlowItems(inner: string): string[] {
	const items: string[] = [];
	let current = "";
	let quote: string | undefined;
	for (const char of inner) {
		if (quote) {
			if (char === quote) quote = undefined;
			current += char;
		} else if (char === '"' || char === "'") {
			quote = char;
			current += char;
		} else if (char === ",") {
			items.push(current);
			current = "";
		} else {
			current += char;
		}
	}
	items.push(current);
	return items;
}

/** Returns the unquoted tag, an empty string for an empty item, or undefined for a non-scalar item. */
function toTag(raw: string): string | undefined {
	const value = raw.trim();
	const quoted = unquote(value) !== value;
	if (!quoted && /[[\]{}]/.test(value)) return undefined;
	return unquote(value).trim();
}

function collectTags(items: readonly string[]): string[] {
	const tags: string[] = [];
	for (const item of items) {
		const tag = toTag(item);
		if (tag === undefined) return [];
		if (tag !== "" && !tags.includes(tag)) tags.push(tag);
	}
	return tags;
}

function parseBlockTags(following: readonly string[]): string[] {
	const items: string[] = [];
	for (const line of following) {
		if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
		if (TOP_LEVEL_KEY.test(line)) break;
		const match = BLOCK_ITEM.exec(line);
		if (!match?.[1]) return [];
		items.push(match[1]);
	}
	return collectTags(items);
}

/**
 * Reads only the `tags` key of a leading YAML front matter block. A flow list (`[a, b]`) and a block
 * list are accepted; every other shape (scalar, mapping, nested list, no front matter) yields `[]`.
 */
export function readFrontMatterTags(text: string): string[] {
	const frontMatter = findFrontMatter(toLines(text));
	if (!frontMatter) return [];
	const { lines } = frontMatter;
	const keyIndex = lines.findIndex((line) => TAGS_KEY.test(line));
	if (keyIndex === -1) return [];
	const rest = (TAGS_KEY.exec(lines[keyIndex] ?? "")?.[1] ?? "").trim();
	if (rest === "") return parseBlockTags(lines.slice(keyIndex + 1));
	if (rest.startsWith("[") && rest.endsWith("]")) {
		return collectTags(splitFlowItems(rest.slice(1, -1)));
	}
	return [];
}

/**
 * Splits Markdown at ATX headings (`#` to `######`). Lines inside fenced code blocks are never
 * headings. A heading with no text under it yields a section with an empty body; text before the
 * first heading yields a section with an empty heading path, only when it is not blank.
 */
export function splitMarkdown(text: string): MarkdownSection[] {
	const allLines = toLines(text);
	const lines = allLines.slice(findFrontMatter(allLines)?.bodyStart ?? 0);
	const sections: MarkdownSection[] = [];
	const stack: { level: number; title: string }[] = [];
	let headingPath: string[] = [];
	let hasHeading = false;
	let buffer: string[] = [];
	let fence: { char: string; length: number } | undefined;

	const flush = () => {
		const body = buffer.join("\n").trim();
		if (hasHeading || body !== "") sections.push({ headingPath, body });
		buffer = [];
	};

	for (const line of lines) {
		if (fence) {
			buffer.push(line);
			const closing = new RegExp(`^ {0,3}\\${fence.char}{${fence.length},}[ \\t]*$`);
			if (closing.test(line)) fence = undefined;
			continue;
		}
		const open = FENCE_OPEN.exec(line);
		if (open?.[1]) {
			fence = { char: open[1][0] ?? "`", length: open[1].length };
			buffer.push(line);
			continue;
		}
		const heading = HEADING.exec(line);
		if (heading?.[1] && heading[2]) {
			flush();
			const level = heading[1].length;
			while (stack.length > 0 && (stack.at(-1)?.level ?? 0) >= level) stack.pop();
			stack.push({ level, title: heading[2].replace(CLOSING_HASHES, "").trim() });
			headingPath = stack.map((entry) => entry.title);
			hasHeading = true;
			continue;
		}
		buffer.push(line);
	}
	flush();
	return sections;
}
