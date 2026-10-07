import { Buffer } from "node:buffer";
import { createRequire } from "node:module";
import { Readability } from "@mozilla/readability";
import { PlatformError } from "../errors";
import type { Clock, HttpFetcher, HttpResponse, TranscriptSource } from "../ports";
import { systemClock, TranscriptSourceError } from "../ports";
import { raceWithAbort } from "../ports/abort";
import { SourceFetchError, TranscriptUnavailableError } from "./errors";
import { parseYoutubeVideoId, type SummaryInput } from "./schema";
import { fetchableUrl } from "./url-guard";

export interface SourceSegment {
	readonly text: string;
	readonly startSeconds: number;
}

/** The text to summarize. YouTube sources keep their timestamped segments for chapters (Req 4.10). */
export interface LoadedSource {
	readonly kind: SummaryInput["kind"];
	readonly text: string;
	readonly title?: string;
	readonly segments?: readonly SourceSegment[];
}

export interface SourceDeps {
	readonly http: HttpFetcher;
	readonly transcripts: TranscriptSource;
	readonly signal?: AbortSignal;
	/** Times the article fetch out ({@link ARTICLE_FETCH_LIMITS}). Defaults to `systemClock`. */
	readonly clock?: Clock;
}

/** Bounds of one article fetch (W3 review M6). */
export const ARTICLE_FETCH_LIMITS = Object.freeze({
	/** The whole fetch, redirects and body included. */
	timeoutMs: 15_000,
	/** UTF-8 bytes of the response body. */
	maxBodyBytes: 5 * 1024 * 1024,
	/** Redirects followed (each location is checked before it is fetched). */
	maxRedirects: 5,
});

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

// jsdom ships no type declarations and `@types/jsdom` is not a declared dependency, so the module
// is loaded through `require` against the minimal surface used here.
interface JsdomModule {
	readonly JSDOM: new (
		html: string,
		options: { readonly url: string; readonly virtualConsole: unknown },
	) => { readonly window: { readonly document: Document; close(): void } };
	readonly VirtualConsole: new () => unknown;
}

let jsdomModule: JsdomModule | undefined;

function jsdom(): JsdomModule {
	jsdomModule ??= createRequire(import.meta.url)("jsdom") as JsdomModule;
	return jsdomModule;
}

const BLOCK_ELEMENTS = new Set([
	"ADDRESS",
	"ARTICLE",
	"ASIDE",
	"BLOCKQUOTE",
	"BR",
	"DD",
	"DIV",
	"DL",
	"DT",
	"FIGCAPTION",
	"FIGURE",
	"FOOTER",
	"H1",
	"H2",
	"H3",
	"H4",
	"H5",
	"H6",
	"HEADER",
	"HR",
	"LI",
	"MAIN",
	"OL",
	"P",
	"PRE",
	"SECTION",
	"TABLE",
	"TD",
	"TH",
	"TR",
	"UL",
]);
const SKIPPED_ELEMENTS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "NAV"]);
const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

/** Collapses whitespace inside each line and drops blank lines. */
function normalizeText(text: string): string {
	return text
		.split("\n")
		.map((line) => line.replace(/\s+/gu, " ").trim())
		.filter((line) => line.length > 0)
		.join("\n");
}

// jsdom implements neither innerText nor layout, so block boundaries are turned into newlines here.
function blockText(root: Node): string {
	const parts: string[] = [];
	const visit = (node: Node): void => {
		if (node.nodeType === TEXT_NODE) {
			parts.push(node.nodeValue ?? "");
			return;
		}
		if (node.nodeType !== ELEMENT_NODE) return;
		const name = node.nodeName.toUpperCase();
		if (SKIPPED_ELEMENTS.has(name)) return;
		const block = BLOCK_ELEMENTS.has(name);
		if (block) parts.push("\n");
		for (const child of node.childNodes) visit(child);
		if (block) parts.push("\n");
	};
	visit(root);
	return normalizeText(parts.join(""));
}

function extractArticle(html: string, url: string): { text: string; title?: string } {
	// Scripts never run and subresources are never fetched (jsdom defaults); CSS parse noise
	// is dropped instead of being written to the console.
	const { JSDOM, VirtualConsole } = jsdom();
	const dom = new JSDOM(html, { url, virtualConsole: new VirtualConsole() });
	try {
		const documentTitle = dom.window.document.title.trim();
		const article = new Readability<Node>(dom.window.document, {
			serializer: (node) => node,
		}).parse();
		const text = article?.content ? blockText(article.content) : "";
		const fallback = text || blockText(dom.window.document.body);
		const title = article?.title?.trim() || documentTitle;
		return { text: fallback, ...(title ? { title } : {}) };
	} finally {
		dom.window.close();
	}
}

function isPlainText(headers: Readonly<Record<string, string>>): boolean {
	return headerValue(headers, "content-type")?.toLowerCase().startsWith("text/plain") ?? false;
}

function headerValue(headers: Readonly<Record<string, string>>, name: string): string | undefined {
	return Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1];
}

interface FetchSignals {
	readonly caller: AbortSignal | undefined;
	readonly timeout: AbortSignal;
	readonly combined: AbortSignal;
}

async function fetchOnce(url: string, http: HttpFetcher, signals: FetchSignals) {
	try {
		// Redirects are followed by `loadArticle` so every location passes the URL guard first.
		// The race also bounds a fetcher that ignores its signal.
		const request = http.fetch(url, { signal: signals.combined, redirect: "manual" });
		// An abandoned request's later rejection must not surface as an unhandled rejection.
		request.catch(() => undefined);
		return await raceWithAbort(request, signals.combined);
	} catch (cause) {
		if (signals.caller?.aborted) throw signals.caller.reason;
		if (signals.timeout.aborted) throw new SourceFetchError("timeout");
		if (cause instanceof PlatformError) throw cause;
		throw new SourceFetchError("network");
	}
}

/**
 * Fetches an article URL. Only http(s) URLs to public hosts are fetched, redirects included
 * (literal checks, see `url-guard.ts`); the fetch is bounded in time and body size.
 */
async function fetchArticle(
	url: string,
	deps: SourceDeps,
): Promise<{ readonly response: HttpResponse; readonly finalUrl: string }> {
	const timeout = (deps.clock ?? systemClock).timeoutSignal(ARTICLE_FETCH_LIMITS.timeoutMs);
	const signals: FetchSignals = {
		caller: deps.signal,
		timeout,
		combined: deps.signal ? AbortSignal.any([deps.signal, timeout]) : timeout,
	};
	let target = url;
	for (let redirects = 0; ; redirects += 1) {
		if (!fetchableUrl(target)) throw new SourceFetchError("disallowed-url");
		const response = await fetchOnce(target, deps.http, signals);
		const location = headerValue(response.headers, "location");
		if (!REDIRECT_STATUSES.has(response.status) || location === undefined) {
			return { response, finalUrl: target };
		}
		if (redirects >= ARTICLE_FETCH_LIMITS.maxRedirects) {
			throw new SourceFetchError("http-status", { status: response.status });
		}
		target = new URL(location, target).href;
	}
}

async function loadArticle(url: string, deps: SourceDeps): Promise<LoadedSource> {
	const { response, finalUrl } = await fetchArticle(url, deps);
	if (response.status < 200 || response.status > 299) {
		throw new SourceFetchError("http-status", { status: response.status });
	}
	if (Buffer.byteLength(response.body, "utf8") > ARTICLE_FETCH_LIMITS.maxBodyBytes) {
		throw new SourceFetchError("too-large");
	}
	const extracted = isPlainText(response.headers)
		? { text: normalizeText(response.body) }
		: extractArticle(response.body, finalUrl);
	if (!extracted.text) throw new SourceFetchError("empty-body");
	return { kind: "article", ...extracted };
}

async function loadYoutube(url: string, deps: SourceDeps): Promise<LoadedSource> {
	const videoId = parseYoutubeVideoId(url);
	if (!videoId) {
		throw new PlatformError("invalid-request", "YouTube の動画 URL として解釈できません。");
	}
	let transcript: Awaited<ReturnType<TranscriptSource["fetchTranscript"]>>;
	try {
		transcript = await deps.transcripts.fetchTranscript(videoId, deps.signal);
	} catch (cause) {
		if (deps.signal?.aborted) throw deps.signal.reason;
		if (cause instanceof TranscriptSourceError) throw new TranscriptUnavailableError(cause.reason);
		if (cause instanceof PlatformError) throw cause;
		throw new TranscriptUnavailableError("fetch-failed");
	}
	const segments = transcript.segments.flatMap((segment) => {
		const text = normalizeText(segment.text).replaceAll("\n", " ");
		return text ? [{ text, startSeconds: segment.startSeconds }] : [];
	});
	if (segments.length === 0) throw new TranscriptUnavailableError("no-captions");
	return {
		kind: "youtube",
		text: segments.map((segment) => segment.text).join("\n"),
		...(transcript.title ? { title: transcript.title } : {}),
		segments,
	};
}

/**
 * Fetches the text to summarize. Every failure is raised here, before any LLM call
 * (Req 4.7, 4.11); an abort rethrows the caller's abort reason unchanged.
 */
export async function loadSource(input: SummaryInput, deps: SourceDeps): Promise<LoadedSource> {
	switch (input.kind) {
		case "article":
			return loadArticle(input.url, deps);
		case "youtube":
			return loadYoutube(input.url, deps);
		case "transcript": {
			const text = normalizeText(input.text);
			if (!text) throw new SourceFetchError("empty-body");
			return { kind: "transcript", text };
		}
	}
}
