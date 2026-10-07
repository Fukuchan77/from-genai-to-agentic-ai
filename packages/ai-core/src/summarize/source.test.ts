import { beforeAll, describe, expect, it } from "vitest";
import { PlatformError } from "../errors";
import {
	createFixtureHttpFetcher,
	createFixtureTranscriptSource,
	type FixtureSet,
	loadFixtureSet,
	MockFixtureMissingError,
} from "../mock";
import { createFakeClock, type FetchInit, type HttpFetcher, type TranscriptSource } from "../ports";
import { SourceFetchError, TranscriptUnavailableError } from "./errors";
import { ARTICLE_FETCH_LIMITS, loadSource, type SourceDeps } from "./source";

const ARTICLE_URL = "https://example.test/articles/agentic-ai";

let fixtures: FixtureSet;
let deps: SourceDeps;

beforeAll(async () => {
	fixtures = await loadFixtureSet();
	deps = {
		http: createFixtureHttpFetcher(fixtures.http),
		transcripts: createFixtureTranscriptSource(fixtures.transcripts),
	};
});

function withHttp(http: HttpFetcher): SourceDeps {
	return { ...deps, http };
}

function withTranscripts(transcripts: TranscriptSource): SourceDeps {
	return { ...deps, transcripts };
}

function htmlFixture(url: string, status: number, body: string, contentType = "text/html") {
	return createFixtureHttpFetcher([
		{ url, status, headers: { "content-type": contentType }, body },
	]);
}

describe("loadSource: article", () => {
	it("extracts the readable title and body text of the 13.6 article fixture", async () => {
		const source = await loadSource({ kind: "article", url: ARTICLE_URL }, deps);

		expect(source.kind).toBe("article");
		expect(source.title).toBe("Agentic AI 入門");
		expect(source.text).toContain(
			"エージェントは目標に向けてツールを使い、結果を評価しながら処理を進めます。",
		);
		expect(source.text).not.toMatch(/<[a-z]/u);
		expect(source.segments).toBeUndefined();
	});

	it("drops scripts, navigation and blank lines from the extracted text", async () => {
		const paragraph = "本文の段落です。".repeat(20);
		const http = htmlFixture(
			"https://example.test/noisy",
			200,
			`<html><head><title>Noisy</title><script>window.secret = 1;</script></head><body>
			<nav><a href="/">ホーム</a></nav>
			<article><h1>Noisy</h1><p>${paragraph}</p>


			<p>${paragraph}</p></article></body></html>`,
		);

		const source = await loadSource(
			{ kind: "article", url: "https://example.test/noisy" },
			withHttp(http),
		);

		expect(source.text).not.toContain("window.secret");
		expect(source.text).not.toMatch(/\n\s*\n/u);
		expect(source.text.split("\n").every((line) => line === line.trim())).toBe(true);
		expect(source.text).toContain(paragraph);
	});

	it("uses a text/plain body as is", async () => {
		const http = htmlFixture(
			"https://example.test/plain.txt",
			200,
			"  1行目\n\n2行目  ",
			"text/plain",
		);

		const source = await loadSource(
			{ kind: "article", url: "https://example.test/plain.txt" },
			withHttp(http),
		);

		expect(source).toEqual({ kind: "article", text: "1行目\n2行目" });
	});

	it("rejects an HTTP error status with SourceFetchError(http-status)", async () => {
		const http = htmlFixture("https://example.test/missing", 404, "<html>Not Found</html>");

		const error = await loadSource(
			{ kind: "article", url: "https://example.test/missing" },
			withHttp(http),
		).catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(SourceFetchError);
		expect(error).toMatchObject({ reason: "http-status", status: 404 });
	});

	it.each([
		[
			"an empty document",
			"<html><head><title>空</title></head><body>   </body></html>",
			"text/html",
		],
		[
			"a script-only document",
			"<html><body><script>var a = 1;</script></body></html>",
			"text/html",
		],
		["a blank text body", " \n\t ", "text/plain"],
		[
			"a navigation-only document",
			'<html><body><nav><a href="/">ホーム</a></nav><style>p{}</style></body></html>',
			"text/html",
		],
	])("rejects %s with SourceFetchError(empty-body)", async (_label, body, contentType) => {
		const http = htmlFixture("https://example.test/empty", 200, body, contentType);

		const error = await loadSource(
			{ kind: "article", url: "https://example.test/empty" },
			withHttp(http),
		).catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(SourceFetchError);
		expect(error).toMatchObject({ reason: "empty-body", status: undefined });
	});

	it("rejects a transport failure with SourceFetchError(network)", async () => {
		const http: HttpFetcher = {
			fetch: async () => {
				throw new TypeError("fetch failed");
			},
		};

		const error = await loadSource({ kind: "article", url: ARTICLE_URL }, withHttp(http)).catch(
			(caught: unknown) => caught,
		);

		expect(error).toBeInstanceOf(SourceFetchError);
		expect(error).toMatchObject({ reason: "network" });
	});

	it("passes platform errors such as a missing mock fixture through unchanged", async () => {
		const error = await loadSource(
			{ kind: "article", url: "https://example.test/not-registered" },
			deps,
		).catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(MockFixtureMissingError);
	});

	it("rethrows the abort reason instead of reporting a network failure", async () => {
		const controller = new AbortController();
		const reason = new DOMException("stopped", "AbortError");
		controller.abort(reason);

		await expect(
			loadSource({ kind: "article", url: ARTICLE_URL }, { ...deps, signal: controller.signal }),
		).rejects.toBe(reason);
	});
});

describe("loadSource: article fetch limits", () => {
	function failure(url: string, sourceDeps: SourceDeps) {
		return loadSource({ kind: "article", url }, sourceDeps).catch((caught: unknown) => caught);
	}

	function spyFetcher(inner: HttpFetcher) {
		const calls: { url: string; init: FetchInit | undefined }[] = [];
		const http: HttpFetcher = {
			fetch: (url, init) => {
				calls.push({ url, init });
				return inner.fetch(url, init);
			},
		};
		return { http, calls };
	}

	it.each([
		"http://127.0.0.1:11434/api/tags",
		"http://169.254.169.254/latest/meta-data/",
		"http://[::1]/",
		"http://localhost:3000/",
		"http://192.168.1.1/",
		"file:///etc/passwd",
	])("refuses %s with SourceFetchError(disallowed-url) without fetching it", async (url) => {
		const { http, calls } = spyFetcher(htmlFixture(url, 200, "secret"));

		const error = await failure(url, withHttp(http));

		expect(error).toBeInstanceOf(SourceFetchError);
		expect(error).toMatchObject({ code: "source-unavailable", reason: "disallowed-url" });
		expect(calls).toEqual([]);
	});

	it("follows a redirect itself, checking each location before fetching it", async () => {
		const { http, calls } = spyFetcher(
			createFixtureHttpFetcher([
				{
					url: "https://example.test/old",
					status: 301,
					headers: { Location: "/new" },
					body: "",
				},
				{
					url: "https://example.test/new",
					status: 200,
					headers: { "content-type": "text/plain" },
					body: "移動後の本文",
				},
			]),
		);

		const source = await loadSource(
			{ kind: "article", url: "https://example.test/old" },
			withHttp(http),
		);

		expect(source.text).toBe("移動後の本文");
		expect(calls.map((call) => call.url)).toEqual([
			"https://example.test/old",
			"https://example.test/new",
		]);
		expect(calls.every((call) => call.init?.redirect === "manual")).toBe(true);
	});

	it("refuses a redirect to a private address without fetching it", async () => {
		const { http, calls } = spyFetcher(
			createFixtureHttpFetcher([
				{
					url: "https://example.test/hop",
					status: 302,
					headers: { location: "http://169.254.169.254/latest/meta-data/" },
					body: "",
				},
			]),
		);

		const error = await failure("https://example.test/hop", withHttp(http));

		expect(error).toMatchObject({ reason: "disallowed-url" });
		expect(calls).toHaveLength(1);
	});

	it("stops after the redirect limit with SourceFetchError(http-status)", async () => {
		const hops = Array.from({ length: ARTICLE_FETCH_LIMITS.maxRedirects + 1 }, (_, index) => ({
			url: `https://example.test/hop-${index}`,
			status: 307,
			headers: { location: `https://example.test/hop-${index + 1}` },
			body: "",
		}));
		const final = {
			url: `https://example.test/hop-${hops.length}`,
			status: 200,
			headers: { "content-type": "text/plain" },
			body: "本文",
		};
		const { http, calls } = spyFetcher(createFixtureHttpFetcher([...hops, final]));

		const error = await failure("https://example.test/hop-0", withHttp(http));

		expect(error).toMatchObject({ reason: "http-status", status: 307 });
		expect(calls).toHaveLength(ARTICLE_FETCH_LIMITS.maxRedirects + 1);
	});

	it("follows exactly the redirect limit", async () => {
		const hops = Array.from({ length: ARTICLE_FETCH_LIMITS.maxRedirects }, (_, index) => ({
			url: `https://example.test/hop-${index}`,
			status: 308,
			headers: { location: `https://example.test/hop-${index + 1}` },
			body: "",
		}));
		const final = {
			url: `https://example.test/hop-${hops.length}`,
			status: 200,
			headers: { "content-type": "text/plain" },
			body: "本文",
		};

		const source = await loadSource(
			{ kind: "article", url: "https://example.test/hop-0" },
			withHttp(createFixtureHttpFetcher([...hops, final])),
		);

		expect(source.text).toBe("本文");
	});

	it("treats a redirect status without a location as an HTTP error", async () => {
		const http = htmlFixture("https://example.test/no-location", 302, "");

		const error = await failure("https://example.test/no-location", withHttp(http));

		expect(error).toMatchObject({ reason: "http-status", status: 302 });
	});

	it("times out through the injected clock with SourceFetchError(timeout)", async () => {
		const clock = createFakeClock();
		let received: AbortSignal | undefined;
		// A fetcher that ignores its signal still cannot hold the request open.
		const http: HttpFetcher = {
			fetch: (_url, init) => {
				received = init?.signal ?? undefined;
				return new Promise(() => undefined);
			},
		};

		const pending = failure(ARTICLE_URL, { ...withHttp(http), clock });
		clock.advanceBy(ARTICLE_FETCH_LIMITS.timeoutMs - 1);
		await Promise.resolve();
		expect(received?.aborted).toBe(false);
		clock.advanceBy(1);
		const error = await pending;

		expect(received?.aborted).toBe(true);
		expect(error).toBeInstanceOf(SourceFetchError);
		expect(error).toMatchObject({ reason: "timeout" });
	});

	it("still rethrows the caller's abort reason when a clock is injected", async () => {
		const clock = createFakeClock();
		const controller = new AbortController();
		const reason = new DOMException("stopped", "AbortError");
		const http: HttpFetcher = { fetch: () => new Promise(() => undefined) };

		const pending = failure(ARTICLE_URL, {
			...withHttp(http),
			clock,
			signal: controller.signal,
		});
		controller.abort(reason);

		await expect(pending).resolves.toBe(reason);
	});

	it("accepts a body of exactly the size limit and refuses one byte more (too-large)", async () => {
		// Three-byte characters: the limit counts UTF-8 bytes, not string length.
		const limit = ARTICLE_FETCH_LIMITS.maxBodyBytes;
		const atLimit = "あ".repeat(Math.floor(limit / 3)) + "a".repeat(limit % 3);
		const http = (body: string) => htmlFixture("https://example.test/big", 200, body, "text/plain");

		const accepted = await loadSource(
			{ kind: "article", url: "https://example.test/big" },
			withHttp(http(atLimit)),
		);
		const error = await failure("https://example.test/big", withHttp(http(`${atLimit}a`)));

		expect(accepted.text.length).toBe(atLimit.length);
		expect(error).toBeInstanceOf(SourceFetchError);
		expect(error).toMatchObject({ reason: "too-large" });
	});
});

describe("loadSource: youtube", () => {
	it("returns timestamped segments and their joined text for the 13.6 transcript fixture", async () => {
		const source = await loadSource(
			{ kind: "youtube", url: "https://www.youtube.com/watch?v=m1-agentic-ai" },
			deps,
		);

		expect(source).toEqual({
			kind: "youtube",
			title: "Agentic AI 入門",
			text: "Agentic AI の基本を説明します。\n次に安全なツール利用を実装します。",
			segments: [
				{ text: "Agentic AI の基本を説明します。", startSeconds: 0 },
				{ text: "次に安全なツール利用を実装します。", startSeconds: 90 },
			],
		});
	});

	it.each([
		["m1-no-captions", "no-captions"],
		["m1-private", "private"],
		["m1-fetch-failed", "fetch-failed"],
	] as const)("maps the %s fixture to TranscriptUnavailableError(%s)", async (videoId, reason) => {
		const error = await loadSource(
			{ kind: "youtube", url: `https://youtu.be/${videoId}` },
			deps,
		).catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(TranscriptUnavailableError);
		expect(error).toMatchObject({ code: "source-unavailable", reason });
	});

	it("treats an unexpected transcript failure as fetch-failed", async () => {
		const transcripts: TranscriptSource = {
			fetchTranscript: async () => {
				throw new TypeError("socket hang up");
			},
		};

		const error = await loadSource(
			{ kind: "youtube", url: "https://youtu.be/m1-agentic-ai" },
			withTranscripts(transcripts),
		).catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(TranscriptUnavailableError);
		expect(error).toMatchObject({ reason: "fetch-failed" });
	});

	it("treats a transcript whose segments are all blank as no-captions", async () => {
		const transcripts = createFixtureTranscriptSource([
			{
				videoId: "blank-video",
				result: {
					videoId: "blank-video",
					segments: [{ text: "  ", startSeconds: 0, durationSeconds: 1 }],
				},
			},
		]);

		const error = await loadSource(
			{ kind: "youtube", url: "https://youtu.be/blank-video" },
			withTranscripts(transcripts),
		).catch((caught: unknown) => caught);

		expect(error).toMatchObject({ reason: "no-captions" });
	});

	it("rejects a URL that is not a YouTube video with invalid-request", async () => {
		const error = await loadSource(
			{ kind: "youtube", url: "https://example.test/video" },
			deps,
		).catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(PlatformError);
		expect(error).toMatchObject({ code: "invalid-request" });
	});

	it("rethrows the abort reason from the transcript source", async () => {
		const controller = new AbortController();
		controller.abort(new DOMException("stopped", "AbortError"));

		await expect(
			loadSource(
				{ kind: "youtube", url: "https://youtu.be/m1-agentic-ai" },
				{ ...deps, signal: controller.signal },
			),
		).rejects.toBe(controller.signal.reason);
	});
});

describe("loadSource: transcript text", () => {
	it("accepts pasted transcript text without timestamps", async () => {
		const source = await loadSource(
			{ kind: "transcript", text: "  字幕の1行目\n\n字幕の2行目 " },
			deps,
		);

		expect(source).toEqual({ kind: "transcript", text: "字幕の1行目\n字幕の2行目" });
	});

	it("rejects whitespace-only text with SourceFetchError(empty-body)", async () => {
		await expect(loadSource({ kind: "transcript", text: " \n " }, deps)).rejects.toMatchObject({
			reason: "empty-body",
		});
	});
});
