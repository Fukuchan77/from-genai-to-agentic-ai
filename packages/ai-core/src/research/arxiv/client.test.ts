import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PlatformError } from "../../errors";
import { createFakeClock, type FakeClock } from "../../ports/clock";
import type { FetchInit, HttpFetcher, HttpResponse } from "../../ports/http";
import { createArxivCache, createArxivClient } from "./client";

function fixture(name: string): string {
	return readFileSync(new URL(`../../../fixtures/arxiv/${name}.xml`, import.meta.url), "utf8");
}

const MULTI = fixture("search-multi");
const SINGLE = fixture("search-single");
const EMPTY = fixture("search-empty");
const ERROR_FEED = fixture("error");

async function flush(): Promise<void> {
	for (let turn = 0; turn < 10; turn += 1)
		await new Promise<void>((resolve) => setImmediate(resolve));
}

/** Moves the fake clock in small steps until the promise settles. */
async function drive<T>(promise: Promise<T>, clock: FakeClock, stepMs = 250): Promise<T> {
	let settled = false;
	promise.then(
		() => {
			settled = true;
		},
		() => {
			settled = true;
		},
	);
	for (let turn = 0; turn < 2_000 && !settled; turn += 1) {
		await flush();
		clock.advanceBy(stepMs);
	}
	await flush();
	return promise;
}

type Step =
	| { readonly status: number; readonly body: string; readonly headers?: Record<string, string> }
	| { readonly fail: unknown }
	| { readonly hang: true }
	// Never settles and ignores the abort signal, like a fetcher that does not honour it.
	| { readonly stall: true };

const ok = (body: string = MULTI): Step => ({ status: 200, body });
const status = (code: number, headers: Record<string, string> = {}): Step => ({
	status: code,
	body: "<html>error page</html>",
	headers,
});

interface Call {
	readonly url: string;
	readonly at: number;
	readonly init: FetchInit | undefined;
}

/** Plays the steps in order; the last step repeats. Honours `init.signal` like a real fetch. */
function scriptedFetcher(clock: FakeClock, steps: readonly Step[]) {
	const calls: Call[] = [];
	let running = 0;
	let peak = 0;
	const fetcher: HttpFetcher = {
		async fetch(url, init) {
			const index = Math.min(calls.length, steps.length - 1);
			calls.push({ url, at: clock.now(), init });
			const step = steps[index];
			running += 1;
			peak = Math.max(peak, running);
			try {
				if (step === undefined) throw new Error("no step");
				if ("stall" in step) return await new Promise<HttpResponse>(() => {});
				if ("hang" in step) {
					return await new Promise<HttpResponse>((_resolve, reject) => {
						init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
							once: true,
						});
					});
				}
				if ("fail" in step) throw step.fail;
				const response: HttpResponse = {
					status: step.status,
					headers: step.headers ?? {},
					body: step.body,
				};
				return response;
			} finally {
				running -= 1;
			}
		},
	};
	return { fetcher, calls, peak: () => peak, times: () => calls.map((call) => call.at) };
}

function setup(
	steps: readonly Step[],
	options: Parameters<typeof createArxivClient>[0]["options"] = {},
) {
	const clock = createFakeClock();
	const script = scriptedFetcher(clock, steps);
	const cache = createArxivCache();
	const client = createArxivClient({ fetcher: script.fetcher, clock, cache, options });
	return { clock, cache, client, ...script };
}

async function failureOf(promise: Promise<unknown>): Promise<unknown> {
	return promise.then(
		() => undefined,
		(error: unknown) => error,
	);
}

describe("createArxivClient search", () => {
	describe("the request", () => {
		it("asks the arXiv query API over https with the terms, the count and a feed accept header", async () => {
			const { client, calls, clock } = setup([ok()]);
			await drive(client.search("hierarchical agents", { maxResults: 5 }), clock);
			expect(calls).toHaveLength(1);
			const url = new URL(calls[0]?.url ?? "");
			expect(url.origin + url.pathname).toBe("https://export.arxiv.org/api/query");
			expect(url.searchParams.get("search_query")).toBe("all:hierarchical agents");
			expect(url.searchParams.get("max_results")).toBe("5");
			expect(url.searchParams.get("start")).toBe("0");
			const headers = new Headers(calls[0]?.init?.headers);
			expect(headers.get("accept")).toContain("atom");
			expect(headers.get("user-agent")).toBeTruthy();
		});

		it("returns the parsed papers", async () => {
			const { client, clock } = setup([ok()]);
			const papers = await drive(client.search("agents", { maxResults: 10 }), clock);
			expect(papers.map((paper) => paper.arxivId)).toEqual([
				"2401.01234",
				"2403.05678",
				"cs/0501001",
			]);
		});

		it("never asks for more than the configured number of results", async () => {
			const { client, calls, clock } = setup([ok()], { maxResults: 10 });
			await drive(client.search("agents", { maxResults: 500 }), clock);
			expect(new URL(calls[0]?.url ?? "").searchParams.get("max_results")).toBe("10");
		});

		it("asks for the configured number when the caller gives none", async () => {
			const { client, calls, clock } = setup([ok()], { maxResults: 7 });
			await drive(client.search("agents", {}), clock);
			expect(new URL(calls[0]?.url ?? "").searchParams.get("max_results")).toBe("7");
		});

		it("encodes characters that would change the query", async () => {
			const { client, calls, clock } = setup([ok()]);
			await drive(client.search("a&b=c#d", { maxResults: 3 }), clock);
			const url = new URL(calls[0]?.url ?? "");
			expect(url.searchParams.get("search_query")).toBe("all:a&b=c#d");
			expect(url.searchParams.get("max_results")).toBe("3");
		});

		it.each([
			["empty", ""],
			["only blanks", "   \n\t"],
			["longer than 500 characters", "x".repeat(501)],
		])("rejects a query that is %s without any request", async (_name, query) => {
			const { client, calls, clock } = setup([ok()]);
			const error = await failureOf(drive(client.search(query, { maxResults: 3 }), clock));
			expect(error).toBeInstanceOf(PlatformError);
			expect((error as PlatformError).code).toBe("invalid-request");
			expect(calls).toHaveLength(0);
		});

		it.each([0, -1, 1.5, Number.NaN])("rejects maxResults %s", async (maxResults) => {
			const { client, calls, clock } = setup([ok()]);
			const error = await failureOf(drive(client.search("agents", { maxResults }), clock));
			expect(error).toBeInstanceOf(PlatformError);
			expect((error as PlatformError).code).toBe("invalid-request");
			expect(calls).toHaveLength(0);
		});
	});

	describe("the cache", () => {
		it("answers a repeated query without a request, whatever its case and spacing", async () => {
			const { client, calls, clock } = setup([ok()]);
			await drive(client.search("Hierarchical Agents", { maxResults: 10 }), clock);
			const again = await drive(
				client.search("  hierarchical   agents ", { maxResults: 10 }),
				clock,
			);
			expect(calls).toHaveLength(1);
			expect(again).toHaveLength(3);
		});

		it("answers a cached query at once, without waiting for the spacing", async () => {
			const { client, clock } = setup([ok()]);
			await drive(client.search("agents", { maxResults: 10 }), clock);
			let answered = false;
			void client.search("agents", { maxResults: 10 }).then(() => {
				answered = true;
			});
			await flush();
			expect(answered).toBe(true);
		});

		it("keeps separate entries for a different number of results", async () => {
			const { client, calls, clock } = setup([ok(), ok(SINGLE)]);
			await drive(client.search("agents", { maxResults: 10 }), clock);
			await drive(client.search("agents", { maxResults: 5 }), clock);
			expect(calls).toHaveLength(2);
		});

		it("keeps separate entries for a different query", async () => {
			const { client, calls, clock } = setup([ok(), ok(SINGLE)]);
			await drive(client.search("agents", { maxResults: 10 }), clock);
			await drive(client.search("planning", { maxResults: 10 }), clock);
			expect(calls).toHaveLength(2);
		});

		it("serves from the cache until a day has passed and asks again at exactly one day", async () => {
			const { client, calls, clock } = setup([ok(), ok(SINGLE)]);
			await drive(client.search("agents", { maxResults: 10 }), clock);
			const storedAt = calls[0]?.at ?? -1;

			clock.set(storedAt + 86_400_000 - 1);
			await client.search("agents", { maxResults: 10 });
			expect(calls).toHaveLength(1);

			clock.set(storedAt + 86_400_000);
			const papers = await drive(client.search("agents", { maxResults: 10 }), clock);
			expect(calls).toHaveLength(2);
			expect(papers).toHaveLength(1);
		});

		it("caches an empty result too, because no results is an answer", async () => {
			const { client, calls, clock } = setup([ok(EMPTY)]);
			expect(await drive(client.search("zzzz", { maxResults: 10 }), clock)).toEqual([]);
			expect(await drive(client.search("zzzz", { maxResults: 10 }), clock)).toEqual([]);
			expect(calls).toHaveLength(1);
		});

		it("does not cache a failure", async () => {
			const { client, calls, clock } = setup(
				[status(503), status(503), status(503), status(503), ok()],
				{
					maxRetries: 3,
				},
			);
			await failureOf(drive(client.search("agents", { maxResults: 10 }), clock));
			expect(calls).toHaveLength(4);
			const papers = await drive(client.search("agents", { maxResults: 10 }), clock);
			expect(calls).toHaveLength(5);
			expect(papers).toHaveLength(3);
		});

		it("sends one request for two identical searches that run at the same time", async () => {
			const { client, calls, clock } = setup([ok()]);
			const first = client.search("agents", { maxResults: 10 });
			const second = client.search("agents", { maxResults: 10 });
			const [a, b] = await drive(Promise.all([first, second]), clock);
			expect(calls).toHaveLength(1);
			expect(a).toEqual(b);
		});

		it("evicts the oldest entry beyond its capacity", () => {
			const cache = createArxivCache({ maxEntries: 2 });
			cache.set("a", { papers: [], storedAt: 0 });
			cache.set("b", { papers: [], storedAt: 0 });
			cache.set("c", { papers: [], storedAt: 0 });
			expect(cache.get("a")).toBeUndefined();
			expect(cache.get("b")).toBeDefined();
			expect(cache.get("c")).toBeDefined();
			expect([...cache.entries()]).toHaveLength(2);
		});

		it("treats a rewritten key as the newest", () => {
			const cache = createArxivCache({ maxEntries: 2 });
			cache.set("a", { papers: [], storedAt: 0 });
			cache.set("b", { papers: [], storedAt: 0 });
			cache.set("a", { papers: [], storedAt: 1 });
			cache.set("c", { papers: [], storedAt: 0 });
			expect(cache.get("b")).toBeUndefined();
			expect(cache.get("a")?.storedAt).toBe(1);
		});

		it.each([0, -1, 1.5])("rejects a cache capacity of %s", (maxEntries) => {
			expect(() => createArxivCache({ maxEntries })).toThrow(RangeError);
		});
	});

	describe("spacing and one connection", () => {
		it("waits three seconds after one request ends before the next search starts", async () => {
			const { client, times, clock } = setup([ok(), ok(SINGLE)]);
			const first = client.search("agents", { maxResults: 10 });
			const second = client.search("planning", { maxResults: 10 });
			await drive(Promise.all([first, second]), clock);
			expect(times()).toEqual([0, 3_000]);
		});

		it("never has two requests in flight", async () => {
			const { client, peak, clock } = setup([ok(), ok(SINGLE), ok(EMPTY)]);
			await drive(
				Promise.all([
					client.search("one", { maxResults: 10 }),
					client.search("two", { maxResults: 10 }),
					client.search("three", { maxResults: 10 }),
				]),
				clock,
			);
			expect(peak()).toBe(1);
		});
	});

	describe("retries", () => {
		it.each([
			["a 429", status(429)],
			["a 503", status(503)],
			["a 500", status(500)],
			["a 502", status(502)],
			["a 599", status(599)],
			["a 400", status(400)],
			["a 404", status(404)],
			["a network failure", { fail: new TypeError("fetch failed") }],
			["a body that is not a feed", { status: 200, body: "<html>maintenance</html>" }],
			["the error feed", { status: 200, body: ERROR_FEED }],
			["a feed with a DOCTYPE", { status: 200, body: `<!DOCTYPE feed [<!ENTITY x "y">]>${MULTI}` }],
		] as const)("tries again after %s and returns the next good answer", async (_name, bad) => {
			const { client, calls, clock } = setup([bad, ok()]);
			const papers = await drive(client.search("agents", { maxResults: 10 }), clock);
			expect(calls).toHaveLength(2);
			expect(papers).toHaveLength(3);
		});

		it("gives up after three retries (four requests) with a source-unavailable error", async () => {
			const { client, calls, clock } = setup([status(503)]);
			const error = await failureOf(drive(client.search("agents", { maxResults: 10 }), clock));
			expect(calls).toHaveLength(4);
			expect(error).toBeInstanceOf(PlatformError);
			expect((error as PlatformError).code).toBe("source-unavailable");
			expect((error as PlatformError).details).toMatchObject({ attempts: 4, status: 503 });
		});

		it("honours a smaller retry limit", async () => {
			const { client, calls, clock } = setup([status(503)], { maxRetries: 1 });
			await failureOf(drive(client.search("agents", { maxResults: 10 }), clock));
			expect(calls).toHaveLength(2);
		});

		it("makes a single request when retries are off", async () => {
			const { client, calls, clock } = setup([status(503)], { maxRetries: 0 });
			await failureOf(drive(client.search("agents", { maxResults: 10 }), clock));
			expect(calls).toHaveLength(1);
		});

		it("backs off 3 s, 6 s and 12 s when the server names no wait", async () => {
			const { client, times, clock } = setup([status(503)]);
			await failureOf(drive(client.search("agents", { maxResults: 10 }), clock, 100));
			// Each request starts after the longer of the backoff and the 3 s spacing.
			expect(times()).toEqual([0, 3_000, 9_000, 21_000]);
		});

		it("follows Retry-After in seconds, to the millisecond", async () => {
			const { client, times, clock } = setup([status(429, { "retry-after": "10" }), ok()]);
			const search = client.search("agents", { maxResults: 10 });
			await flush();
			clock.advanceBy(9_999);
			await flush();
			expect(times()).toEqual([0]);
			clock.advanceBy(1);
			await flush();
			expect(times()).toEqual([0, 10_000]);
			await search;
		});

		it("reads the header name in any case", async () => {
			const { client, times, clock } = setup([status(429, { "Retry-After": "7" }), ok()]);
			await drive(client.search("agents", { maxResults: 10 }), clock, 100);
			expect(times()).toEqual([0, 7_000]);
		});

		it("follows Retry-After given as an HTTP date", async () => {
			const start = Date.UTC(2026, 9, 18, 12, 0, 0);
			const clock = createFakeClock(start);
			const date = new Date(start + 20_000).toUTCString();
			const script = scriptedFetcher(clock, [status(503, { "retry-after": date }), ok()]);
			const client = createArxivClient({
				fetcher: script.fetcher,
				clock,
				cache: createArxivCache(),
			});
			await drive(client.search("agents", { maxResults: 10 }), clock, 500);
			expect(script.times()).toEqual([start, start + 20_000]);
		});

		it("never waits less than the 3 s spacing, even for Retry-After: 0", async () => {
			const { client, times, clock } = setup([status(429, { "retry-after": "0" }), ok()]);
			await drive(client.search("agents", { maxResults: 10 }), clock, 100);
			expect(times()).toEqual([0, 3_000]);
		});

		it("caps a long Retry-After at the longest wait it allows", async () => {
			const { client, times, clock } = setup([status(429, { "retry-after": "3600" }), ok()], {
				maxRetryWaitMs: 30_000,
			});
			await drive(client.search("agents", { maxResults: 10 }), clock, 500);
			expect(times()).toEqual([0, 30_000]);
		});

		it.each([
			["garbage", "soon"],
			["negative", "-5"],
			["fractional text", "1.5.2"],
			["empty", ""],
		])("falls back to the backoff for a Retry-After that is %s", async (_name, value) => {
			const { client, times, clock } = setup([status(429, { "retry-after": value }), ok()]);
			await drive(client.search("agents", { maxResults: 10 }), clock, 100);
			expect(times()).toEqual([0, 3_000]);
		});

		it("does not put the response body or the server's wording in the error", async () => {
			const { client, clock } = setup([{ status: 503, body: "secret-token-abc internal host" }]);
			const error = await failureOf(drive(client.search("agents", { maxResults: 10 }), clock));
			expect(
				JSON.stringify([(error as Error).message, (error as PlatformError).details]),
			).not.toContain("secret-token");
		});
	});

	describe("limits on the response", () => {
		it("fails at once, without retrying, for a body over the byte limit", async () => {
			const { client, calls, clock } = setup(
				[{ status: 200, body: `${MULTI}${" ".repeat(200)}` }],
				{
					maxResponseBytes: 100,
				},
			);
			const error = await failureOf(drive(client.search("agents", { maxResults: 10 }), clock));
			expect(calls).toHaveLength(1);
			expect((error as PlatformError).code).toBe("source-unavailable");
		});

		it("measures bytes, not characters", async () => {
			// 40 characters of 3 bytes each: 120 bytes, over a 100-byte limit.
			const { client, calls, clock } = setup([{ status: 200, body: "あ".repeat(40) }], {
				maxResponseBytes: 100,
			});
			await failureOf(drive(client.search("agents", { maxResults: 10 }), clock));
			expect(calls).toHaveLength(1);
		});

		it("accepts a body of exactly the limit", async () => {
			const bytes = Buffer.byteLength(EMPTY);
			const { client, clock } = setup([{ status: 200, body: EMPTY }], { maxResponseBytes: bytes });
			await expect(drive(client.search("agents", { maxResults: 10 }), clock)).resolves.toEqual([]);
		});

		it("treats a 200 as the only success", async () => {
			const { client, calls, clock } = setup([{ status: 204, body: EMPTY }, ok()]);
			const papers = await drive(client.search("agents", { maxResults: 10 }), clock);
			expect(calls).toHaveLength(2);
			expect(papers).toHaveLength(3);
		});
	});

	describe("a request that hangs", () => {
		it("is cut off after the request timeout and counted as a network failure", async () => {
			const { client, calls, clock } = setup([{ hang: true }, ok()], { requestTimeoutMs: 5_000 });
			const search = client.search("agents", { maxResults: 10 });
			await flush();
			clock.advanceBy(4_999);
			await flush();
			expect(calls).toHaveLength(1);
			clock.advanceBy(1);
			await flush();
			const papers = await drive(search, clock);
			expect(calls).toHaveLength(2);
			expect(papers).toHaveLength(3);
		});

		it("cuts off a fetcher that ignores the abort signal and tries again", async () => {
			const { client, calls, clock } = setup([{ stall: true }, ok()], { requestTimeoutMs: 5_000 });
			const papers = await drive(client.search("agents", { maxResults: 10 }), clock);
			expect(calls).toHaveLength(2);
			expect(papers).toHaveLength(3);
		});

		it("passes an abort signal to the fetcher", async () => {
			const { client, calls, clock } = setup([ok()]);
			await drive(client.search("agents", { maxResults: 10 }), clock);
			expect(calls[0]?.init?.signal).toBeInstanceOf(AbortSignal);
		});
	});

	describe("abort", () => {
		it("rejects with the reason and sends no request for a signal that is already aborted", async () => {
			const { client, calls, clock } = setup([ok()]);
			const reason = new Error("stopped");
			const error = await failureOf(
				drive(
					client.search("agents", { maxResults: 10, signal: AbortSignal.abort(reason) }),
					clock,
				),
			);
			expect(error).toBe(reason);
			expect(calls).toHaveLength(0);
		});

		it("rejects with the reason even when the answer is in the cache", async () => {
			const { client, clock } = setup([ok()]);
			await drive(client.search("agents", { maxResults: 10 }), clock);
			const reason = new Error("stopped");
			await expect(
				client.search("agents", { maxResults: 10, signal: AbortSignal.abort(reason) }),
			).rejects.toBe(reason);
		});

		it("stops waiting between retries and makes no further request", async () => {
			const { client, calls, clock } = setup([status(503)]);
			const controller = new AbortController();
			const search = client.search("agents", { maxResults: 10, signal: controller.signal });
			await flush();
			clock.advanceBy(1_000);
			await flush();
			expect(calls).toHaveLength(1);

			const reason = new Error("learner stopped");
			controller.abort(reason);
			await expect(search).rejects.toBe(reason);
			clock.advanceBy(60_000);
			await flush();
			expect(calls).toHaveLength(1);
		});

		it("stops a request in flight and does not retry it", async () => {
			const { client, calls, clock } = setup([{ hang: true }, ok()]);
			const controller = new AbortController();
			const search = client.search("agents", { maxResults: 10, signal: controller.signal });
			await flush();
			const reason = new Error("learner stopped");
			controller.abort(reason);
			await expect(search).rejects.toBe(reason);
			// The abort reached the fetcher, so a real connection is closed.
			expect(calls[0]?.init?.signal?.aborted).toBe(true);
			clock.advanceBy(60_000);
			await flush();
			expect(calls).toHaveLength(1);
		});

		it("stops a request in flight even when the fetcher ignores the signal", async () => {
			const clock = createFakeClock();
			const never: HttpFetcher = { fetch: () => new Promise<HttpResponse>(() => {}) };
			const client = createArxivClient({ fetcher: never, clock, cache: createArxivCache() });
			const controller = new AbortController();
			const search = client.search("agents", { maxResults: 10, signal: controller.signal });
			await flush();
			const reason = new Error("stop");
			controller.abort(reason);
			await expect(search).rejects.toBe(reason);
		});
	});
});

describe("createArxivClient getAbstract", () => {
	async function searched() {
		const context = setup([ok()]);
		await drive(context.client.search("agents", { maxResults: 10 }), context.clock);
		return context;
	}

	it("returns a paper from a search that has been run, without a request", async () => {
		const { client, calls } = await searched();
		const paper = await client.getAbstract("2401.01234");
		expect(paper?.title).toContain("Hierarchical Agents");
		expect(calls).toHaveLength(1);
	});

	it.each([
		["a versioned id", "2401.01234v2"],
		["an arXiv: prefix", "arXiv:2401.01234"],
		["an abstract URL", "https://arxiv.org/abs/2401.01234v2"],
		["a pdf URL", "http://arxiv.org/pdf/2401.01234v1"],
		["blanks around it", "  2401.01234 "],
	])("finds the paper from %s", async (_name, id) => {
		const { client } = await searched();
		expect((await client.getAbstract(id))?.arxivId).toBe("2401.01234");
	});

	it("finds an old-style identifier", async () => {
		const { client } = await searched();
		expect((await client.getAbstract("cs/0501001v1"))?.arxivId).toBe("cs/0501001");
	});

	it("returns undefined for a paper no search returned, and makes no request for it", async () => {
		const { client, calls } = await searched();
		expect(await client.getAbstract("2499.99999")).toBeUndefined();
		expect(calls).toHaveLength(1);
	});

	it.each(["", "not an id", "../../etc/passwd"])("returns undefined for %j", async (id) => {
		const { client } = await searched();
		expect(await client.getAbstract(id)).toBeUndefined();
	});

	it("returns undefined once the cached search has expired", async () => {
		const { client, clock } = await searched();
		clock.set(clock.now() + 86_400_000);
		expect(await client.getAbstract("2401.01234")).toBeUndefined();
	});

	it("never makes a request, even with nothing cached", async () => {
		const { client, calls } = setup([ok()]);
		expect(await client.getAbstract("2401.01234")).toBeUndefined();
		expect(calls).toHaveLength(0);
	});
});
