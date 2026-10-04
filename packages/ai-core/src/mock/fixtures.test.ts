import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, expectTypeOf, it } from "vitest";
import type { HttpFetcher, TranscriptSource, WebSearchProvider } from "../ports";
import {
	CASSETTE_FIXTURE_DIRECTORY,
	createFixtureHttpFetcher,
	createFixtureTranscriptSource,
	createFixtureWebSearch,
	DEFAULT_FIXTURE_DIRECTORY,
	loadFixtureSet,
	M1_2_SCENARIOS,
	M1_3_SCENARIOS,
	MockFixtureMissingError,
} from "./index";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
	);
});

describe("fixture port factories", () => {
	it("returns registered HTTP, transcript, and web-search fixtures", async () => {
		const http = createFixtureHttpFetcher([
			{
				url: "https://example.test/article",
				status: 200,
				headers: { "content-type": "text/html" },
				body: "<article>fixture</article>",
			},
		]);
		const transcripts = createFixtureTranscriptSource([
			{
				videoId: "video-ok",
				result: {
					videoId: "video-ok",
					title: "Fixture video",
					language: "ja",
					segments: [{ text: "hello", startSeconds: 0, durationSeconds: 1.5 }],
				},
			},
		]);
		const search = createFixtureWebSearch([
			{
				query: "agentic ai",
				result: [
					{
						title: "Fixture result",
						url: "https://example.test/result",
						snippet: "deterministic result",
						score: 0.9,
					},
				],
			},
		]);

		await expect(http.fetch("https://example.test/article")).resolves.toEqual({
			status: 200,
			headers: { "content-type": "text/html" },
			body: "<article>fixture</article>",
		});
		await expect(transcripts.fetchTranscript("video-ok")).resolves.toMatchObject({
			videoId: "video-ok",
			segments: [{ text: "hello" }],
		});
		await expect(search.search("agentic ai")).resolves.toEqual([
			expect.objectContaining({ title: "Fixture result", score: 0.9 }),
		]);
		expectTypeOf(http).toMatchTypeOf<HttpFetcher>();
		expectTypeOf(transcripts).toMatchTypeOf<TranscriptSource>();
		expectTypeOf(search).toMatchTypeOf<WebSearchProvider>();
	});

	it("replays recorded failure fixtures with the port-specific error contract", async () => {
		const transcripts = createFixtureTranscriptSource([
			{ videoId: "no-captions", result: { error: "no-captions" } },
		]);
		const search = createFixtureWebSearch([
			{ query: "failing search", result: { error: "recorded provider failure" } },
		]);

		await expect(transcripts.fetchTranscript("no-captions")).rejects.toMatchObject({
			name: "TranscriptSourceError",
			reason: "no-captions",
		});
		await expect(search.search("failing search")).rejects.toMatchObject({
			name: "PlatformError",
			code: "source-unavailable",
		});
	});

	it.each([
		["http", () => createFixtureHttpFetcher([]).fetch("https://missing.test/")],
		["transcript", () => createFixtureTranscriptSource([]).fetchTranscript("missing-video")],
		["web search", () => createFixtureWebSearch([]).search("missing query")],
	] as const)(
		"throws MockFixtureMissingError for an unregistered %s request",
		async (_kind, call) => {
			const promise = call();
			await expect(promise).rejects.toBeInstanceOf(MockFixtureMissingError);
			await expect(promise).rejects.toMatchObject({
				code: "provider-unavailable",
				nearest: [],
				key: expect.stringMatching(/^[a-f0-9]{64}$/u),
			});
		},
	);
});

describe("loadFixtureSet", () => {
	it("loads handwritten fixtures and recorded fixtures under cassettes", async () => {
		const root = await mkdtemp(path.join(tmpdir(), "fixture-set-"));
		temporaryDirectories.push(root);
		await Promise.all([
			mkdir(path.join(root, "http"), { recursive: true }),
			mkdir(path.join(root, "transcripts"), { recursive: true }),
			mkdir(path.join(root, "web-search"), { recursive: true }),
			mkdir(path.join(root, "cassettes", "http"), { recursive: true }),
			mkdir(path.join(root, "cassettes", "transcripts"), { recursive: true }),
			mkdir(path.join(root, "cassettes", "web-search"), { recursive: true }),
		]);
		await Promise.all([
			writeFile(
				path.join(root, "http", "manual.json"),
				JSON.stringify({ url: "https://manual.test", status: 200, headers: {}, body: "manual" }),
			),
			writeFile(
				path.join(root, "cassettes", "http", "recorded.json"),
				JSON.stringify({
					url: "https://recorded.test",
					status: 202,
					headers: {},
					body: "recorded",
				}),
			),
			writeFile(
				path.join(root, "transcripts", "manual.json"),
				JSON.stringify({
					videoId: "manual-video",
					result: { videoId: "manual-video", segments: [] },
				}),
			),
			writeFile(
				path.join(root, "cassettes", "transcripts", "recorded.json"),
				JSON.stringify({ videoId: "recorded-video", result: { error: "private" } }),
			),
			writeFile(
				path.join(root, "web-search", "manual.json"),
				JSON.stringify({ query: "manual query", result: [] }),
			),
			writeFile(
				path.join(root, "cassettes", "web-search", "recorded.json"),
				JSON.stringify({ query: "recorded query", result: { error: "failed" } }),
			),
		]);

		const fixtures = await loadFixtureSet(root);

		expect(fixtures.http.map((fixture) => fixture.url)).toEqual([
			"https://manual.test",
			"https://recorded.test",
		]);
		expect(fixtures.transcripts.map((fixture) => fixture.videoId)).toEqual([
			"manual-video",
			"recorded-video",
		]);
		expect(fixtures.webSearch.map((fixture) => fixture.query)).toEqual([
			"manual query",
			"recorded query",
		]);
	});

	it("ships M1 scenarios, JSON fixtures, and cassette save directories", async () => {
		const fixtures = await loadFixtureSet();

		expect(M1_2_SCENARIOS.map((scenario) => scenario.id)).toEqual(
			expect.arrayContaining(["m1-2/chat", "m1-2/weather-tool"]),
		);
		expect(M1_3_SCENARIOS.map((scenario) => scenario.id)).toEqual(
			expect.arrayContaining(["m1-3/full-summary", "m1-3/chapter-summary"]),
		);
		expect(fixtures.http.length).toBeGreaterThanOrEqual(2);
		expect(fixtures.transcripts.length).toBeGreaterThanOrEqual(4);
		expect(fixtures.webSearch.length).toBeGreaterThanOrEqual(1);
		expect(DEFAULT_FIXTURE_DIRECTORY).toContain(path.join("packages", "ai-core", "fixtures"));
		expect(CASSETTE_FIXTURE_DIRECTORY).toBe(path.join(DEFAULT_FIXTURE_DIRECTORY, "cassettes"));
		await expect(
			readFile(path.join(CASSETTE_FIXTURE_DIRECTORY, "http", ".gitkeep"), "utf8"),
		).resolves.toBe("");
	});
});
