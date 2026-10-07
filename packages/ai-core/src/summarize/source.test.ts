import { beforeAll, describe, expect, it } from "vitest";
import { PlatformError } from "../errors";
import {
	createFixtureHttpFetcher,
	createFixtureTranscriptSource,
	type FixtureSet,
	loadFixtureSet,
	MockFixtureMissingError,
} from "../mock";
import type { HttpFetcher, TranscriptSource } from "../ports";
import { SourceFetchError, TranscriptUnavailableError } from "./errors";
import { loadSource, type SourceDeps } from "./source";

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
