import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import type { HttpFetcher, TranscriptSource, WebSearchProvider } from "../ports";
import { createCassetteStore } from "./cassette-store";
import {
	createFixtureHttpFetcher,
	createFixtureTranscriptSource,
	createFixtureWebSearch,
	loadFixtureSet,
	type TranscriptFixture,
	type WebSearchFixture,
} from "./fixtures";
import {
	type LanguageModelV4,
	type LanguageModelV4CallOptions,
	type LanguageModelV4GenerateResult,
	type LanguageModelV4Middleware,
	type LanguageModelV4StreamPart,
	type RecordingStore,
	recordingHttpFetcher,
	recordingMiddleware,
	recordingTranscriptSource,
	recordingWebSearch,
} from "./recording";
import { createRedactor } from "./redactor";

const temporaryDirectories: string[] = [];
afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
	);
});

interface StoredRecording {
	readonly key: string;
	readonly value: unknown;
}

function createMemoryStore(): {
	readonly store: RecordingStore;
	readonly writes: StoredRecording[];
} {
	const writes: StoredRecording[] = [];
	return {
		store: {
			put(key, value) {
				writes.push({ key, value });
			},
		},
		writes,
	};
}

const params: LanguageModelV4CallOptions = {
	prompt: [{ role: "user", content: [{ type: "text", text: "keep this prompt private" }] }],
	headers: { Authorization: "Bearer request-secret", "x-request-id": "request-1" },
	providerOptions: { openai: { apiKey: "provider-secret" } },
	tools: [{ type: "function", name: "weather", inputSchema: { type: "object" } }],
};

const usage = {
	inputTokens: { total: 3, noCache: 3, cacheRead: 0, cacheWrite: 0 },
	outputTokens: { total: 2, text: 2, reasoning: 0 },
};

const model: LanguageModelV4 = {
	specificationVersion: "v4",
	provider: "openai",
	modelId: "catalog-model",
	supportedUrls: {},
	doGenerate: () => {
		throw new Error("unused");
	},
	doStream: () => {
		throw new Error("unused");
	},
};

const unusedStream = () => {
	throw new Error("unused");
};

const redactor = createRedactor({
	OPENAI_API_KEY: "sk-live-secret",
	SESSION_SECRET: "session-secret",
});

describe("createRedactor", () => {
	it("redacts configured secrets, known key formats, and sensitive headers recursively", () => {
		const value = redactor.redact({
			message: "tokens: sk-live-secret, tvly-known-secret and session-secret",
			headers: {
				Authorization: "Bearer request-secret",
				"content-type": "application/json",
				"set-cookie": "session=session-secret",
			},
			nested: { apiKey: "provider-secret", safe: "visible" },
		});

		expect(value).toEqual({
			message: "tokens: [REDACTED], [REDACTED] and [REDACTED]",
			headers: { "content-type": "application/json" },
			nested: { apiKey: "[REDACTED]", safe: "visible" },
		});
	});
});

describe("recordingMiddleware", () => {
	it("records generate output as a redacted version-1 cassette without request or response headers", async () => {
		const { store, writes } = createMemoryStore();
		const middleware = recordingMiddleware(store, redactor, {
			purpose: "structured",
			recordedWith: "local",
			now: () => new Date("2026-09-30T00:00:00.000Z"),
		});
		expectTypeOf(middleware).toMatchTypeOf<LanguageModelV4Middleware>();
		const result: LanguageModelV4GenerateResult = {
			content: [{ type: "text", text: "answer sk-live-secret" }],
			finishReason: { unified: "stop", raw: "stop" },
			usage,
			warnings: [],
			response: {
				id: "response-1",
				modelId: "catalog-model",
				headers: { Authorization: "Bearer response-secret", "x-trace": "trace-1" },
			},
		};

		const returned = await middleware.wrapGenerate?.({
			doGenerate: async () => result,
			doStream: unusedStream,
			params,
			model,
		});

		expect(returned).toBe(result);
		expect(writes).toHaveLength(1);
		expect(writes[0]?.key).toMatch(/^llm\/[a-f0-9]{64}$/u);
		expect(writes[0]?.value).toMatchObject({
			version: 1,
			key: writes[0]?.key.slice(4),
			request: {
				purpose: "structured",
				modelId: "catalog-model",
				promptDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
				toolNames: ["weather"],
			},
			recordedAt: "2026-09-30T00:00:00.000Z",
			recordedWith: "local",
		});
		const serialized = JSON.stringify(writes[0]?.value);
		expect(serialized).not.toContain("sk-live-secret");
		expect(serialized).not.toContain("request-secret");
		expect(serialized).not.toContain("response-secret");
		expect(serialized.toLowerCase()).not.toContain("authorization");
		expect(serialized).toContain("[REDACTED]");
	});

	it("records stream parts after consumption while returning the original stream data", async () => {
		const { store, writes } = createMemoryStore();
		const middleware = recordingMiddleware(store, redactor, {
			recordedWith: "live",
			now: () => new Date("2026-09-30T01:00:00.000Z"),
		});
		const parts: LanguageModelV4StreamPart[] = [
			{ type: "text-start", id: "text-1" },
			{ type: "text-delta", id: "text-1", delta: "stream sk-live-secret" },
			{ type: "text-end", id: "text-1" },
			{ type: "finish", usage, finishReason: { unified: "stop", raw: "stop" } },
		];

		const result = await middleware.wrapStream?.({
			doGenerate: async () => {
				throw new Error("unused");
			},
			doStream: async () => ({
				stream: new ReadableStream({
					start(controller) {
						for (const part of parts) controller.enqueue(part);
						controller.close();
					},
				}),
				response: { headers: { Authorization: "Bearer response-secret" } },
			}),
			params,
			model,
		});
		const consumed: LanguageModelV4StreamPart[] = [];
		if (!result) throw new Error("middleware did not return a stream result");
		const reader = result.stream.getReader();
		while (true) {
			const item = await reader.read();
			if (item.done) break;
			consumed.push(item.value);
		}

		expect(consumed).toEqual(parts);
		expect(writes).toHaveLength(1);
		expect(JSON.stringify(writes[0]?.value)).not.toContain("sk-live-secret");
		expect(JSON.stringify(writes[0]?.value).toLowerCase()).not.toContain("authorization");
	});

	it("does not persist a partial cassette when the stream consumer cancels", async () => {
		const { store, writes } = createMemoryStore();
		const middleware = recordingMiddleware(store, redactor);
		const result = await middleware.wrapStream?.({
			doGenerate: async () => {
				throw new Error("unused");
			},
			doStream: async () => ({
				stream: new ReadableStream<LanguageModelV4StreamPart>({
					start(controller) {
						controller.enqueue({ type: "text-start", id: "text-1" });
					},
				}),
			}),
			params,
			model,
		});
		const reader = result?.stream.getReader();
		await reader?.read();
		await reader?.cancel("user-aborted");
		expect(writes).toEqual([]);
	});
});

describe("recording port wrappers", () => {
	it("records an HTTP fixture with a redacted URL, body, and response headers", async () => {
		const { store, writes } = createMemoryStore();
		const inner: HttpFetcher = {
			fetch: vi.fn(async () => ({
				status: 200,
				headers: {
					"content-type": "application/json",
					Authorization: "Bearer response-secret",
					"set-cookie": "session=session-secret",
				},
				body: '{"token":"sk-live-secret","ok":true}',
			})),
		};
		const fetcher = recordingHttpFetcher(inner, store, redactor);

		const response = await fetcher.fetch("https://example.test/data?api_key=sk-live-secret", {
			headers: { Authorization: "Bearer request-secret" },
		});

		expect(response.body).toContain("sk-live-secret");
		expect(writes).toHaveLength(1);
		expect(writes[0]?.key).toMatch(/^http\/[a-f0-9]{64}$/u);
		expect(writes[0]?.value).toMatchObject({
			url: "https://example.test/data?api_key=%5BREDACTED%5D",
			requestKey: expect.stringMatching(/^[a-f0-9]{64}$/u),
			request: { method: "GET" },
			status: 200,
			headers: { "content-type": "application/json" },
			body: '{"token":"[REDACTED]","ok":true}',
		});
	});

	it("records transcript fixtures that replay to the same result", async () => {
		const { store, writes } = createMemoryStore();
		const transcript = {
			videoId: "video-1",
			title: "Safe title",
			language: "en",
			segments: [{ text: "hello", startSeconds: 0, durationSeconds: 1.5 }],
		} as const;
		const inner: TranscriptSource = { fetchTranscript: vi.fn(async () => transcript) };
		const source = recordingTranscriptSource(inner, store, redactor);

		expect(await source.fetchTranscript("video-1")).toEqual(transcript);
		expect(writes).toHaveLength(1);
		const fixture = writes[0]?.value as TranscriptFixture;
		const replay: TranscriptSource = {
			async fetchTranscript(videoId) {
				if (fixture.videoId !== videoId || "error" in fixture.result) throw new Error("missing");
				return fixture.result;
			},
		};
		expect(writes[0]?.key).toMatch(/^transcripts\/[a-f0-9]{64}$/u);
		expect(await replay.fetchTranscript("video-1")).toEqual(transcript);
	});

	it("records web-search fixtures that replay to the same result without secrets", async () => {
		const { store, writes } = createMemoryStore();
		const hits = [
			{
				title: "Result",
				url: "https://example.test/result?token=sk-live-secret",
				snippet: "secret sk-live-secret",
				score: 0.9,
			},
		] as const;
		const inner: WebSearchProvider = { search: vi.fn(async () => hits) };
		const search = recordingWebSearch(inner, store, redactor);

		expect(await search.search("query session-secret")).toEqual(hits);
		expect(writes).toHaveLength(1);
		const fixture = writes[0]?.value as WebSearchFixture;
		expect(writes[0]?.key).toMatch(/^web-search\/[a-f0-9]{64}$/u);
		expect(JSON.stringify(fixture)).not.toContain("sk-live-secret");
		expect(JSON.stringify(fixture)).not.toContain("session-secret");
		const replay = createFixtureWebSearch([fixture]);
		expect(await replay.search("query session-secret")).toEqual([
			{
				title: "Result",
				url: "https://example.test/result?token=%5BREDACTED%5D",
				snippet: "secret [REDACTED]",
				score: 0.9,
			},
		]);
	});

	it("replays recorded port fixtures with the original inputs and distinguishes HTTP bodies", async () => {
		const root = await mkdtemp(path.join(tmpdir(), "recorded-fixtures-"));
		temporaryDirectories.push(root);
		const store = createCassetteStore(path.join(root, "cassettes"));
		const url = "https://example.test/data?api_key=sk-live-secret";
		const httpResponse = {
			status: 200,
			headers: { "content-type": "application/json" },
			body: "ok",
		};
		const transcript = {
			videoId: "video-session-secret",
			segments: [{ text: "hello", startSeconds: 0, durationSeconds: 1 }],
		};
		const hits = [
			{ title: "Result", url: "https://example.test", snippet: "safe", score: 1 },
		] as const;
		await recordingHttpFetcher({ fetch: async () => httpResponse }, store, redactor).fetch(url, {
			method: "POST",
			headers: { "content-type": "application/json", Authorization: "Bearer request-secret" },
			body: '{"city":"Tokyo"}',
		});
		await recordingTranscriptSource(
			{ fetchTranscript: async () => transcript },
			store,
			redactor,
		).fetchTranscript("video-session-secret");
		await recordingWebSearch({ search: async () => hits }, store, redactor).search(
			"query session-secret",
		);

		const fixtures = await loadFixtureSet(root);
		const http = createFixtureHttpFetcher(fixtures.http);
		const transcripts = createFixtureTranscriptSource(fixtures.transcripts);
		const search = createFixtureWebSearch(fixtures.webSearch);
		await expect(
			http.fetch(url, {
				method: "POST",
				headers: { "content-type": "application/json", Authorization: "Bearer different" },
				body: '{"city":"Tokyo"}',
			}),
		).resolves.toEqual(httpResponse);
		await expect(
			http.fetch(url, {
				method: "POST",
				headers: { "content-type": "application/json", Authorization: "Bearer different" },
				body: '{"city":"Osaka"}',
			}),
		).rejects.toMatchObject({ name: "MockFixtureMissingError" });
		await expect(transcripts.fetchTranscript("video-session-secret")).resolves.toEqual(transcript);
		await expect(search.search("query session-secret")).resolves.toEqual([
			expect.objectContaining({ title: "Result", snippet: "safe", score: 1 }),
		]);
		const serialized = JSON.stringify(fixtures);
		expect(serialized).not.toContain("sk-live-secret");
		expect(serialized).not.toContain("session-secret");
	});
});
