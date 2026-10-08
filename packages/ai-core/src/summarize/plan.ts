import { PlatformError } from "../errors";
import type { ModelEntry } from "../models/types";
import {
	buildChunkPrompt,
	buildIntegrationPrompt,
	buildSummaryPrompt,
	type SummaryPrompt,
} from "./prompts";
import type { Summary } from "./schema";
import type { LoadedSource } from "./source";
import { countTextTokens, estimateFromCount, estimateTokens } from "./tokens";

/** Share of the context window an input may use; the rest is headroom for estimate error (ADR-9). */
export const CONTEXT_USAGE_RATIO = 0.8;
/** Tokens kept free for the generated summary (ADR-9). */
export const OUTPUT_RESERVE_TOKENS = 4_096;
/** Below this many tokens per chunk, staged summarization is refused as impractical. */
export const MIN_CHUNK_TOKENS = 256;

export type SummaryStrategy = "whole" | "staged";

export interface SummaryPlan {
	readonly strategy: SummaryStrategy;
	/** The safety-factored estimate of the source text the decision was based on (Req 4.12). */
	readonly estimatedInputTokens: number;
	/** `[text]` for `whole`; the parts to summarize one by one for `staged`. */
	readonly chunks: readonly string[];
	/** Timestamped sources must produce chapters (Req 4.10). */
	readonly withChapters: boolean;
	readonly title?: string;
}

/** Timestamped segments become `[90s] text` lines so the model can cite start times. */
export function formatSourceText(source: LoadedSource): string {
	if (!source.segments?.length) return source.text;
	return source.segments
		.map((segment) => `[${Math.floor(segment.startSeconds)}s] ${segment.text}`)
		.join("\n");
}

function withChapters(source: LoadedSource): boolean {
	return Boolean(source.segments?.length);
}

function promptText(prompt: SummaryPrompt): string {
	const parts = prompt.messages.flatMap((message) =>
		typeof message.content === "string"
			? [message.content]
			: message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])),
	);
	return [prompt.instructions, ...parts].join("\n");
}

// The prompt overhead is measured from the real prompts with an empty source, so a change to the
// instructions is reflected in the decision automatically. Cache markers add no text.
const NO_CACHE = { cachePolicy: { mode: "none", recordsCacheReads: false } } as const;

/** Estimated tokens of the system prompt, delimiters, title and instruction of a whole summary. */
export function wholeOverheadTokens(source: LoadedSource): number {
	return estimateTokens(
		promptText(
			buildSummaryPrompt(
				{ text: "", withChapters: withChapters(source), ...titleOf(source) },
				NO_CACHE,
			),
		),
	);
}

function chunkOverheadTokens(source: LoadedSource): number {
	return estimateTokens(
		promptText(
			buildChunkPrompt(
				// A wide index keeps the estimate valid for any chunk number.
				{
					text: "",
					index: 99_998,
					total: 99_999,
					withChapters: withChapters(source),
					...titleOf(source),
				},
				NO_CACHE,
			),
		),
	);
}

function titleOf(source: LoadedSource): { title?: string } {
	return source.title ? { title: source.title } : {};
}

/** Tokens available for input: 80% of the context window minus the output reserve. */
export function contextBudgetTokens(entry: ModelEntry): number {
	return Math.floor(entry.contextWindow * CONTEXT_USAGE_RATIO) - OUTPUT_RESERVE_TOKENS;
}

/** Estimated tokens one chunk of source text may use in a staged summary. */
export function chunkBudgetTokens(source: LoadedSource, entry: ModelEntry): number {
	return contextBudgetTokens(entry) - chunkOverheadTokens(source);
}

/**
 * End of the longest prefix of `characters[start..]` (by code point, at least one) that still fits
 * the budget. Token counts grow almost linearly with length, so each probe is placed by
 * interpolation from the last one instead of bisecting the rest of the line; a search then needs
 * a few tokenizations of about the piece's size (W3 review M6: bisection re-tokenized up to the
 * whole remaining text about 20 times per piece, seconds for a 2 MB single-line body).
 * `low` always fits (the empty prefix at first) and `high` never does (one past the end at first).
 */
export function fittingEnd(characters: readonly string[], start: number, budget: number): number {
	let low = start;
	let lowTokens = 0;
	let high = characters.length + 1;
	let probe = start + budget;
	while (high - low > 1) {
		const end = Math.min(high - 1, Math.max(low + 1, probe));
		const tokens = estimateTokens(characters.slice(start, end).join(""));
		if (tokens <= budget) {
			low = end;
			lowTokens = tokens;
		} else {
			high = end;
		}
		probe = low + Math.floor(((budget - lowTokens) * (end - start)) / tokens);
	}
	return Math.max(low, start + 1);
}

// Splits one overlong line at the longest prefix (by code point) that still fits the budget.
function hardSplit(line: string, budget: number): string[] {
	const characters = Array.from(line);
	const pieces: string[] = [];
	let start = 0;
	while (start < characters.length) {
		const end = fittingEnd(characters, start, budget);
		pieces.push(characters.slice(start, end).join(""));
		start = end;
	}
	return pieces;
}

// Greedy packing on line boundaries. Line counts are summed (plus one token per newline) instead
// of re-tokenizing the growing chunk, which keeps planning linear in the input size.
function splitIntoChunks(text: string, budget: number): string[] {
	const chunks: string[] = [];
	let current: string[] = [];
	let currentTokens = 0;
	const flush = () => {
		if (current.length > 0) chunks.push(current.join("\n"));
		current = [];
		currentTokens = 0;
	};
	for (const line of text.split("\n")) {
		const lineTokens = countTextTokens(line);
		const combined = current.length === 0 ? lineTokens : currentTokens + 1 + lineTokens;
		if (estimateFromCount(combined) <= budget) {
			current.push(line);
			currentTokens = combined;
			continue;
		}
		flush();
		if (estimateFromCount(lineTokens) <= budget) {
			current.push(line);
			currentTokens = lineTokens;
		} else {
			chunks.push(...hardSplit(line, budget));
		}
	}
	flush();
	return chunks;
}

/**
 * Decides between one whole-text call and staged (chunk → integrate) summarization: the source
 * is summarized whole when its estimate plus the prompt overhead fits the context budget (ADR-9).
 */
export function planSummary(source: LoadedSource, entry: ModelEntry): SummaryPlan {
	const text = formatSourceText(source);
	const estimatedInputTokens = estimateTokens(text);
	const common = { estimatedInputTokens, withChapters: withChapters(source), ...titleOf(source) };
	if (estimatedInputTokens + wholeOverheadTokens(source) <= contextBudgetTokens(entry)) {
		return { strategy: "whole", chunks: [text], ...common };
	}
	const budget = chunkBudgetTokens(source, entry);
	if (budget < MIN_CHUNK_TOKENS) throw contextTooSmall(entry);
	return { strategy: "staged", chunks: splitIntoChunks(text, budget), ...common };
}

function contextTooSmall(entry: ModelEntry): PlatformError {
	return new PlatformError(
		"capability-unsupported",
		"選択したモデルのコンテキスト上限が小さすぎるため、この入力を要約できません。",
		{ modelId: entry.id, contextWindow: entry.contextWindow },
	);
}

export interface IntegrationOptions {
	readonly withChapters: boolean;
	readonly title?: string;
}

// The prompt joins one JSON line per partial; like line packing, the raw counts of the empty
// prompt and of each line (plus one for its newline) are summed instead of re-tokenizing a group.
function integrationRawTokens(partials: readonly Summary[], options: IntegrationOptions): number {
	const overhead = countTextTokens(
		promptText(buildIntegrationPrompt({ partials: [], ...options }, NO_CACHE)),
	);
	return partials.reduce(
		(total, partial) => total + countTextTokens(JSON.stringify(partial)) + 1,
		overhead,
	);
}

/** Estimated tokens of the prompt that integrates `partials` (staged summaries, ADR-9). */
export function integrationTokens(
	partials: readonly Summary[],
	options: IntegrationOptions,
): number {
	return estimateFromCount(integrationRawTokens(partials, options));
}

/**
 * Groups partial summaries in order so the integration prompt of each group fits the context
 * budget; `streamSummary` integrates the groups and repeats until one group remains (W3 review
 * L14). Throws `capability-unsupported` when a partial alone does not fit, or when no group can
 * hold two partials, since merging could then never finish.
 */
export function integrationGroups(
	partials: readonly Summary[],
	options: IntegrationOptions,
	entry: ModelEntry,
): Summary[][] {
	const budget = contextBudgetTokens(entry);
	const groups: Summary[][] = [];
	let current: Summary[] = [];
	for (const partial of partials) {
		// A partial that alone overflows may push an empty group here, but the check after the
		// push then refuses, so an empty group is never integrated.
		if (integrationTokens([...current, partial], options) > budget) {
			groups.push(current);
			current = [];
		}
		current.push(partial);
		if (integrationTokens(current, options) > budget) throw contextTooSmall(entry);
	}
	groups.push(current);
	if (partials.length > 1 && groups.length === partials.length) throw contextTooSmall(entry);
	return groups;
}
