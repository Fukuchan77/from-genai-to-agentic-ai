import { DEFAULT_ARXIV } from "../../config/defaults";
import { PlatformError } from "../../errors";
import { raceWithAbort } from "../../ports/abort";
import type { Clock } from "../../ports/clock";
import type { HttpFetcher } from "../../ports/http";
import { parseArxivFeed } from "./parse";
import { createRequestQueue, waitFor } from "./queue";
import type { ArxivPaper } from "./types";

const API_URL = "https://export.arxiv.org/api/query";
const USER_AGENT = "from-genai-to-agentic-ai (learning project; research agent demo)";
const MAX_QUERY_CHARACTERS = 500;
const DEFAULT_MAX_CACHE_ENTRIES = 200;

export interface ArxivClientOptions {
	readonly minIntervalMs: number;
	/** Retries after the first request, so a value of 3 makes at most four requests (Req 4.7). */
	readonly maxRetries: number;
	readonly cacheTtlMs: number;
	readonly maxResponseBytes: number;
	/** The default number of results, and the most one search may ask for. */
	readonly maxResults: number;
	/** One request is cut off after this; the single connection must not hang on it. */
	readonly requestTimeoutMs: number;
	/** The longest pause between two attempts, however long `Retry-After` asks for. */
	readonly maxRetryWaitMs: number;
}

const DEFAULT_OPTIONS: ArxivClientOptions = Object.freeze({
	...DEFAULT_ARXIV,
	requestTimeoutMs: 15_000,
	maxRetryWaitMs: 30_000,
});

export interface ArxivCacheEntry {
	readonly papers: readonly ArxivPaper[];
	readonly storedAt: number;
}

export interface ArxivCache {
	get(key: string): ArxivCacheEntry | undefined;
	set(key: string, entry: ArxivCacheEntry): void;
	entries(): Iterable<ArxivCacheEntry>;
}

/** An in-memory cache that forgets its oldest entry beyond `maxEntries`. */
export function createArxivCache(options: { readonly maxEntries?: number } = {}): ArxivCache {
	const maxEntries = options.maxEntries ?? DEFAULT_MAX_CACHE_ENTRIES;
	if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0) {
		throw new RangeError("maxEntries must be a positive integer");
	}
	const map = new Map<string, ArxivCacheEntry>();
	return {
		get: (key) => map.get(key),
		set: (key, entry) => {
			map.delete(key);
			map.set(key, entry);
			if (map.size > maxEntries) {
				const oldest = map.keys().next();
				if (!oldest.done) map.delete(oldest.value);
			}
		},
		entries: () => map.values(),
	};
}

export interface ArxivSearchOptions {
	readonly maxResults?: number | undefined;
	readonly signal?: AbortSignal | undefined;
}

export interface ArxivClient {
	search(query: string, options?: ArxivSearchOptions): Promise<readonly ArxivPaper[]>;
	/**
	 * A paper that an earlier search returned and that has not expired from the cache. It never
	 * makes a request, so a model cannot make the client fetch anything by naming an identifier.
	 */
	getAbstract(arxivId: string): Promise<ArxivPaper | undefined>;
}

export interface ArxivClientDependencies {
	readonly fetcher: HttpFetcher;
	readonly clock: Clock;
	readonly cache?: ArxivCache | undefined;
	readonly options?: Partial<ArxivClientOptions> | undefined;
}

/** One failed attempt. `retryable` is false only for a response that cannot get better. */
class AttemptFailure extends Error {
	readonly retryable: boolean;
	readonly status: number | undefined;
	readonly retryAfterMs: number | undefined;

	constructor(init: { retryable: boolean; status?: number; retryAfterMs?: number }) {
		super("arXiv request failed");
		this.name = "AttemptFailure";
		this.retryable = init.retryable;
		this.status = init.status;
		this.retryAfterMs = init.retryAfterMs;
	}
}

function headerValue(headers: Readonly<Record<string, string>>, name: string): string | undefined {
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() === name) return value;
	}
	return undefined;
}

/** `Retry-After` is whole seconds or an HTTP date; anything else is no instruction. */
function parseRetryAfter(value: string | undefined, now: number): number | undefined {
	if (value === undefined) return undefined;
	const text = value.trim();
	if (/^\d+$/u.test(text)) return Number(text) * 1_000;
	const date = Date.parse(text);
	return Number.isNaN(date) || !/[A-Za-z]/u.test(text) ? undefined : Math.max(0, date - now);
}

function normaliseQuery(query: string): string {
	return query.trim().replace(/\s+/gu, " ").toLowerCase();
}

function invalidRequest(message: string): PlatformError {
	return new PlatformError("invalid-request", message);
}

/** Pulls an identifier out of `2401.01234v2`, `arXiv:2401.01234`, or an abstract / pdf URL. */
function arxivIdFrom(input: string): string {
	return input
		.trim()
		.replace(/^arxiv:/iu, "")
		.replace(/^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\//u, "")
		.replace(/(?:\.pdf)?(?:v\d+)?$/u, "");
}

/**
 * The arXiv Atom API client (plan C8). Requests go through one queue, which keeps to the terms of
 * use (one connection, three seconds apart). A repeated query is answered from a day-long cache.
 * A failed attempt is retried up to `maxRetries` times with a pause on the injected clock.
 */
export function createArxivClient(dependencies: ArxivClientDependencies): ArxivClient {
	const { fetcher, clock } = dependencies;
	const cache = dependencies.cache ?? createArxivCache();
	const options: ArxivClientOptions = { ...DEFAULT_OPTIONS, ...dependencies.options };
	const queue = createRequestQueue({ clock, minIntervalMs: options.minIntervalMs });

	function fresh(key: string): readonly ArxivPaper[] | undefined {
		const entry = cache.get(key);
		return entry !== undefined && clock.now() - entry.storedAt < options.cacheTtlMs
			? entry.papers
			: undefined;
	}

	async function requestOnce(
		url: string,
		signal: AbortSignal | undefined,
	): Promise<readonly ArxivPaper[]> {
		const timeout = clock.timeoutSignal(options.requestTimeoutMs);
		const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
		let response: Awaited<ReturnType<HttpFetcher["fetch"]>>;
		try {
			response = await raceWithAbort(
				fetcher.fetch(url, {
					headers: { accept: "application/atom+xml", "user-agent": USER_AGENT },
					signal: combined,
				}),
				combined,
			);
		} catch {
			// A caller's abort is told apart from a failure by `search`, which sees the signal.
			throw new AttemptFailure({ retryable: true });
		}
		if (response.status !== 200) {
			const retryAfterMs = parseRetryAfter(
				headerValue(response.headers, "retry-after"),
				clock.now(),
			);
			throw new AttemptFailure({
				retryable: true,
				status: response.status,
				...(retryAfterMs === undefined ? {} : { retryAfterMs }),
			});
		}
		// The fetcher has read the whole body already; this refuses to parse an oversized one.
		if (Buffer.byteLength(response.body) > options.maxResponseBytes) {
			throw new AttemptFailure({ retryable: false, status: response.status });
		}
		try {
			return parseArxivFeed(response.body);
		} catch {
			throw new AttemptFailure({ retryable: true, status: response.status });
		}
	}

	function pauseBefore(failure: AttemptFailure, attempt: number): number {
		const backoff = options.minIntervalMs * 2 ** attempt;
		return Math.min(failure.retryAfterMs ?? backoff, options.maxRetryWaitMs);
	}

	return {
		async search(query, searchOptions = {}) {
			const signal = searchOptions.signal;
			signal?.throwIfAborted();
			const terms = query.trim().replace(/\s+/gu, " ");
			if (terms === "" || terms.length > MAX_QUERY_CHARACTERS) {
				throw invalidRequest(`検索語は 1〜${MAX_QUERY_CHARACTERS} 文字で指定してください。`);
			}
			const requested = searchOptions.maxResults ?? options.maxResults;
			if (!Number.isSafeInteger(requested) || requested <= 0) {
				throw invalidRequest("取得する論文の件数は 1 以上の整数で指定してください。");
			}
			const maxResults = Math.min(requested, options.maxResults);
			const key = `${normaliseQuery(terms)}|${maxResults}`;
			const cached = fresh(key);
			if (cached !== undefined) return cached;

			const params = new URLSearchParams({
				search_query: `all:${terms}`,
				start: "0",
				max_results: String(maxResults),
			});
			const url = `${API_URL}?${params.toString()}`;

			for (let attempt = 0; ; attempt += 1) {
				try {
					return await queue.run(async () => {
						// An earlier request in the queue may have fetched the same query.
						const again = fresh(key);
						if (again !== undefined) return again;
						const papers = await requestOnce(url, signal);
						cache.set(key, { papers, storedAt: clock.now() });
						return papers;
					}, signal);
				} catch (error) {
					if (signal?.aborted) throw signal.reason;
					if (!(error instanceof AttemptFailure)) throw error;
					if (!error.retryable || attempt >= options.maxRetries) {
						throw new PlatformError(
							"source-unavailable",
							"arXiv から論文を取得できませんでした。",
							{
								attempts: attempt + 1,
								...(error.status === undefined ? {} : { status: error.status }),
							},
						);
					}
					await waitFor(clock, pauseBefore(error, attempt), signal);
				}
			}
		},

		async getAbstract(arxivId) {
			// An identifier that is not a paper's simply finds nothing.
			const id = arxivIdFrom(arxivId);
			for (const entry of cache.entries()) {
				if (clock.now() - entry.storedAt >= options.cacheTtlMs) continue;
				const paper = entry.papers.find((candidate) => candidate.arxivId === id);
				if (paper !== undefined) return paper;
			}
			return undefined;
		},
	};
}
