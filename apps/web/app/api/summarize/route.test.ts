import { defineScenario, M1_3_SCENARIOS, type ScenarioDefinition } from "@platform/ai-core/mock";
import { getModelEntry } from "@platform/ai-core/models";
import type { HttpFetcher } from "@platform/ai-core/ports";
import { createFakeClock } from "@platform/ai-core/testing";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseStreamErrorText } from "@/lib/server/errors";
import { createPlatform, type Platform, setPlatformForTesting } from "@/lib/server/platform";
import { POST } from "./route";

const MOCK_ENV = { VITEST: "1", AI_TEST_RUN_MODE: "mock" } as const;
const MOCK_MODEL = "mock:general-v1";

const SUMMARY = {
	title: "Agentic AI 入門",
	keyPoints: ["目的を明確にする", "ツールを安全に使う", "評価で品質を確認する"],
	tags: ["AI", "agents"],
	actionItems: ["モックでテストする"],
};

// The shared m1-3 scenarios answer in one delta; these stream the same objects in small chunks so
// that several partial objects are observable. They match on text of the 13.6 fixtures.
const STREAMING_SCENARIOS: readonly ScenarioDefinition[] = [
	defineScenario({
		id: "test/summarize-article",
		turns: [
			{
				match: { purpose: "structured", lastUserTextIncludes: "ツールを使い、結果を評価" },
				respond: { object: SUMMARY, chunkSize: 12, usage: { inputTokens: 100, outputTokens: 40 } },
			},
		],
	}),
	defineScenario({
		id: "test/summarize-video",
		turns: [
			{
				match: { purpose: "structured", lastUserTextIncludes: "基本を説明します" },
				respond: {
					object: { ...SUMMARY, chapters: [{ heading: "導入", startSeconds: 0 }] },
					chunkSize: 16,
				},
			},
		],
	}),
];

const EMPTY_CASSETTES = {
	async get() {
		return undefined;
	},
	async put() {},
} as never;

async function mockPlatform(overrides: Partial<Platform> = {}): Promise<Platform> {
	const platform = await createPlatform({
		env: MOCK_ENV,
		clock: createFakeClock(1_000),
		gateway: {
			mock: { scenarios: [...M1_3_SCENARIOS, ...STREAMING_SCENARIOS], cassettes: EMPTY_CASSETTES },
		},
		recording: { store: { async write() {} } as never },
	});
	return { ...platform, ...overrides };
}

afterEach(() => {
	setPlatformForTesting(undefined);
});

function summarizeRequest(input: unknown, extra: Record<string, unknown> = {}): Request {
	return new Request("http://localhost/api/summarize", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ id: "sum-1", input, modelId: MOCK_MODEL, ...extra }),
	});
}

type Chunk = { type: string; id?: string; data?: unknown; [key: string]: unknown };

async function readChunks(response: Response): Promise<Chunk[]> {
	const text = await response.text();
	return text
		.split("\n\n")
		.map((event) => event.trim())
		.filter((event) => event.startsWith("data: ") && event !== "data: [DONE]")
		.map((event) => JSON.parse(event.slice("data: ".length)) as Chunk);
}

/** A gateway whose model is a spy: it proves whether the LLM was called. */
function spyGateway(doStream?: MockLanguageModelV4["doStream"]) {
	const model = new MockLanguageModelV4(doStream ? { doStream } : {});
	const gateway = {
		resolve: vi.fn(async () => ({
			model,
			entry: getModelEntry(MOCK_MODEL),
			mode: "mock" as const,
		})),
		resolveEmbedding: vi.fn(),
		availableModels: () => [],
	};
	return { model, gateway: gateway as unknown as Platform["gateway"] };
}

function failingFetcher(status: number): HttpFetcher {
	return {
		fetch: async () => ({
			url: "https://example.test/missing",
			status,
			headers: {},
			text: async () => "",
		}),
	} as never;
}

describe("POST /api/summarize", () => {
	it("streams growing data-summary parts, then the final summary, then data-summary-meta (Req 4.5, 4.8)", async () => {
		setPlatformForTesting(await mockPlatform());

		const response = await POST(
			summarizeRequest({ kind: "article", url: "https://example.test/articles/agentic-ai" }),
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("x-vercel-ai-ui-message-stream")).toBe("v1");
		const chunks = await readChunks(response);
		const summaries = chunks.filter((chunk) => chunk.type === "data-summary");
		expect(summaries.length).toBeGreaterThan(2);
		// One id per attempt, so the client overwrites the part in place.
		expect(new Set(summaries.map((chunk) => chunk.id))).toEqual(new Set(["summary-1"]));
		const first = summaries[0]?.data as Record<string, unknown>;
		expect(first.keyPoints === undefined || (first.keyPoints as unknown[]).length < 3).toBe(true);
		expect(summaries.at(-1)?.data).toEqual(SUMMARY);

		const types = chunks.map((chunk) => chunk.type);
		const metaIndex = types.indexOf("data-summary-meta");
		expect(metaIndex).toBeGreaterThan(types.lastIndexOf("data-summary"));
		expect(chunks[metaIndex]?.data).toMatchObject({
			strategy: "whole",
			chunks: 1,
			attempts: 1,
			actualInputTokens: 100,
		});
		expect(types).not.toContain("data-summary-restart");
		expect(types).not.toContain("error");
	});

	it("maps chapters of a YouTube transcript into the summary parts (Req 4.10)", async () => {
		setPlatformForTesting(await mockPlatform());

		const response = await POST(
			summarizeRequest({ kind: "youtube", url: "https://www.youtube.com/watch?v=m1-agentic-ai" }),
		);

		expect(response.status).toBe(200);
		const chunks = await readChunks(response);
		const last = chunks.filter((chunk) => chunk.type === "data-summary").at(-1);
		expect(last?.data).toMatchObject({ chapters: [{ heading: "導入", startSeconds: 0 }] });
	});

	it("accepts pasted transcript text", async () => {
		setPlatformForTesting(await mockPlatform());

		const response = await POST(
			summarizeRequest({ kind: "transcript", text: "fixture:summary-full 本文です。" }),
		);

		const chunks = await readChunks(response);
		expect(chunks.filter((chunk) => chunk.type === "data-summary").at(-1)?.data).toMatchObject({
			title: "Agentic AI 入門",
		});
		expect(chunks.map((chunk) => chunk.type)).toContain("data-summary-meta");
	});

	it("sends data-summary-restart on a regeneration and moves later parts to a new id (Req 4.4)", async () => {
		setPlatformForTesting(await mockPlatform());

		// m1-3/validation-retry answers an invalid object every time: three attempts, then an error.
		const response = await POST(
			summarizeRequest({ kind: "transcript", text: "fixture:summary-invalid 本文です。" }),
		);

		expect(response.status).toBe(200);
		const chunks = await readChunks(response);
		const restarts = chunks.filter((chunk) => chunk.type === "data-summary-restart");
		expect(restarts.map((chunk) => (chunk.data as { attempt: number }).attempt)).toEqual([2, 3]);
		expect(((restarts[0]?.data ?? {}) as { issues?: string[] }).issues?.length).toBeGreaterThan(0);
		const ids = chunks.filter((chunk) => chunk.type === "data-summary").map((chunk) => chunk.id);
		expect(new Set(ids)).toEqual(new Set(["summary-1", "summary-2", "summary-3"]));
		const types = chunks.map((chunk) => chunk.type);
		expect(types).not.toContain("data-summary-meta");
		const error = chunks.find((chunk) => chunk.type === "error");
		expect(parseStreamErrorText(String(error?.errorText))).toMatchObject({
			code: "output-invalid",
		});
	});

	it("answers 422 source-unavailable with the reason and never calls the LLM when the fetch fails (Req 4.7)", async () => {
		const { model, gateway } = spyGateway();
		const base = await mockPlatform();
		setPlatformForTesting({
			...base,
			gateway,
			ports: { ...base.ports, http: failingFetcher(404) },
		});

		const response = await POST(
			summarizeRequest({ kind: "article", url: "https://example.test/missing" }),
		);

		expect(response.status).toBe(422);
		const body = (await response.json()) as { error: Record<string, unknown> };
		expect(body.error).toMatchObject({
			code: "source-unavailable",
			details: { reason: "http-status", status: 404 },
		});
		expect(JSON.stringify(body)).not.toMatch(/stack|cause/u);
		expect(model.doStreamCalls).toHaveLength(0);
		expect(model.doGenerateCalls).toHaveLength(0);
	});

	it.each([
		["m1-no-captions", "no-captions"],
		["m1-private", "private"],
		["m1-fetch-failed", "fetch-failed"],
	])(
		"answers 422 for a video without usable captions (%s) before any LLM call (Req 4.11)",
		async (videoId, reason) => {
			const { model, gateway } = spyGateway();
			const base = await mockPlatform();
			setPlatformForTesting({ ...base, gateway });

			const response = await POST(
				summarizeRequest({ kind: "youtube", url: `https://www.youtube.com/watch?v=${videoId}` }),
			);

			expect(response.status).toBe(422);
			const body = (await response.json()) as { error: Record<string, unknown> };
			expect(body.error).toMatchObject({ code: "source-unavailable", details: { reason } });
			expect(model.doStreamCalls).toHaveLength(0);
		},
	);

	it("rejects a private-network article URL as source-unavailable without an LLM call", async () => {
		const { model, gateway } = spyGateway();
		const base = await mockPlatform();
		setPlatformForTesting({ ...base, gateway });

		const response = await POST(summarizeRequest({ kind: "article", url: "http://127.0.0.1/x" }));

		expect(response.status).toBe(422);
		const body = (await response.json()) as { error: Record<string, unknown> };
		expect(body.error).toMatchObject({ details: { reason: "disallowed-url" } });
		expect(model.doStreamCalls).toHaveLength(0);
	});

	it("rejects a malformed or unknown-field body with 400 before the model is resolved (Req 4.7)", async () => {
		const { gateway } = spyGateway();
		const base = await mockPlatform();
		setPlatformForTesting({ ...base, gateway });

		const unknownField = await POST(
			summarizeRequest({ kind: "transcript", text: "x" }, { extra: true }),
		);
		const badUrl = await POST(summarizeRequest({ kind: "article", url: "ftp://example.test/a" }));
		const badModel = await POST(
			summarizeRequest({ kind: "transcript", text: "x" }, { modelId: "no-such-model" }),
		);

		for (const response of [unknownField, badUrl, badModel]) {
			expect(response.status).toBe(400);
			expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
				"invalid-request",
			);
		}
		expect(gateway.resolve).not.toHaveBeenCalled();
	});

	it("rejects an over-long transcript and an over-long URL with limit-exceeded before the model", async () => {
		const { gateway } = spyGateway();
		const base = await mockPlatform();
		setPlatformForTesting({ ...base, gateway });

		const longText = await POST(
			summarizeRequest({ kind: "transcript", text: "あ".repeat(100_001) }),
		);
		const longUrl = await POST(
			summarizeRequest({ kind: "article", url: `https://example.test/${"a".repeat(2_100)}` }),
		);

		for (const response of [longText, longUrl]) {
			expect(response.status).toBe(400);
			expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
				"limit-exceeded",
			);
		}
		expect(gateway.resolve).not.toHaveBeenCalled();
	});

	it("rejects a body over the size limit with 413", async () => {
		const base = await mockPlatform();
		setPlatformForTesting(base);

		const response = await POST(
			summarizeRequest({ kind: "transcript", text: "あ".repeat(200_000) }),
		);

		expect(response.status).toBe(413);
	});

	it("applies the rate limit in live mode only (Req 3.11)", async () => {
		const base = await mockPlatform();
		const limiter = { check: vi.fn(() => ({ allowed: false as const, retryAfterSeconds: 7 })) };
		setPlatformForTesting({ ...base, mode: "live", limiter });
		const live = await POST(summarizeRequest({ kind: "transcript", text: "fixture:summary-full" }));
		expect(live.status).toBe(429);
		expect(live.headers.get("retry-after")).toBe("7");

		limiter.check.mockClear();
		setPlatformForTesting({ ...base, limiter });
		await (
			await POST(summarizeRequest({ kind: "transcript", text: "fixture:summary-full" }))
		).text();
		expect(limiter.check).not.toHaveBeenCalled();
	});

	it("wraps a provider failure into a fixed provider-unavailable stream error without leaking it", async () => {
		const { gateway } = spyGateway(async () => {
			throw new Error("sk-secret-token leaked from provider");
		});
		const base = await mockPlatform();
		setPlatformForTesting({ ...base, gateway });

		const response = await POST(summarizeRequest({ kind: "transcript", text: "本文です。" }));

		expect(response.status).toBe(200);
		const text = await response.text();
		expect(text).not.toContain("sk-secret-token");
		const error = (await readChunks(new Response(text))).find((chunk) => chunk.type === "error");
		expect(parseStreamErrorText(String(error?.errorText))).toMatchObject({
			code: "provider-unavailable",
		});
	});

	it("passes the request's abort signal to the model", async () => {
		const { model, gateway } = spyGateway(async () => {
			throw new Error("stop");
		});
		const base = await mockPlatform();
		setPlatformForTesting({ ...base, gateway });
		const controller = new AbortController();

		const request = new Request("http://localhost/api/summarize", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				id: "s",
				input: { kind: "transcript", text: "本文" },
				modelId: MOCK_MODEL,
			}),
			signal: controller.signal,
		});
		await (await POST(request)).text();

		expect(model.doStreamCalls[0]?.abortSignal).toBeDefined();
		controller.abort();
		expect(model.doStreamCalls[0]?.abortSignal?.aborted).toBe(true);
	});
});
