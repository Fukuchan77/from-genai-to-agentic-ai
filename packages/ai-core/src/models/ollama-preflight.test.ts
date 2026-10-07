import { describe, expect, it, vi } from "vitest";
import { createFakeClock } from "../ports/clock";
import type { HttpFetcher, HttpResponse } from "../ports/http";
import { defaultModelFor } from "./catalog";
import { OllamaUnavailableError } from "./errors";
import { createOllamaPreflight, OLLAMA_PREFLIGHT_CACHE_TTL_MS } from "./ollama-preflight";

const BASE_URL = "http://127.0.0.1:11434";
const chatModel = defaultModelFor("local", "ollama", "chat");
const embeddingModel = defaultModelFor("local", "ollama", "embedding");

function response(body: unknown, status = 200): HttpResponse {
	return {
		status,
		headers: { "content-type": "application/json" },
		body: typeof body === "string" ? body : JSON.stringify(body),
	};
}

function tags(...names: string[]) {
	return response({ models: names.map((name) => ({ name, model: name })) });
}

function fetcherReturning(
	...results: (HttpResponse | Error)[]
): HttpFetcher & { fetch: ReturnType<typeof vi.fn> } {
	const fetch = vi.fn<HttpFetcher["fetch"]>();
	for (const result of results) {
		if (result instanceof Error) fetch.mockRejectedValueOnce(result);
		else fetch.mockResolvedValueOnce(result);
	}
	return { fetch };
}

function rejection(promise: Promise<unknown>): Promise<unknown> {
	return promise.then(
		() => {
			throw new Error("expected rejection");
		},
		(error: unknown) => error,
	);
}

describe("createOllamaPreflight", () => {
	it("resolves when the server lists the model and calls GET /api/tags with a timeout", async () => {
		const fetcher = fetcherReturning(tags(chatModel, embeddingModel));
		const clock = createFakeClock();
		const preflight = createOllamaPreflight({ baseUrl: BASE_URL, fetcher, clock });

		await expect(preflight.ensureModel(chatModel)).resolves.toBeUndefined();

		expect(fetcher.fetch).toHaveBeenCalledTimes(1);
		const [url, init] = fetcher.fetch.mock.calls[0] ?? [];
		expect(url).toBe(`${BASE_URL}/api/tags`);
		expect(init).toMatchObject({ method: "GET", headers: { accept: "application/json" } });
		expect(init?.signal).toBeInstanceOf(AbortSignal);
		expect(init?.signal?.aborted).toBe(false);
		clock.advanceBy(60_000);
		expect(init?.signal?.aborted).toBe(true);
	});

	it("accepts the provider form of the base URL and untagged names as :latest", async () => {
		const fetcher = fetcherReturning(tags("plain:latest"));
		const preflight = createOllamaPreflight({
			baseUrl: `${BASE_URL}/api/`,
			fetcher,
			clock: createFakeClock(),
		});

		await expect(preflight.ensureModel("plain")).resolves.toBeUndefined();
		expect(fetcher.fetch.mock.calls[0]?.[0]).toBe(`${BASE_URL}/api/tags`);
	});

	it("reports a model that is not pulled with the pull command", async () => {
		const preflight = createOllamaPreflight({
			baseUrl: BASE_URL,
			fetcher: fetcherReturning(tags(embeddingModel)),
			clock: createFakeClock(),
		});

		const error = await rejection(preflight.ensureModel(chatModel));

		expect(error).toBeInstanceOf(OllamaUnavailableError);
		expect(error).toMatchObject({
			code: "provider-unavailable",
			reason: "model-missing",
			baseUrl: BASE_URL,
			modelId: chatModel,
			details: { baseUrl: BASE_URL, reason: "model-missing", modelId: chatModel },
		});
		expect((error as Error).message).toContain(`ollama pull ${chatModel}`);
		expect((error as Error).message).toContain(BASE_URL);
	});

	it("reports an unreachable server with its URL and how to start it", async () => {
		const preflight = createOllamaPreflight({
			baseUrl: BASE_URL,
			fetcher: fetcherReturning(new TypeError("fetch failed")),
			clock: createFakeClock(),
		});

		const error = await rejection(preflight.ensureModel(chatModel));

		expect(error).toMatchObject({ reason: "unreachable", baseUrl: BASE_URL });
		expect((error as Error).message).toContain(BASE_URL);
		expect((error as Error).message).toContain("ollama serve");
	});

	it("reports an HTTP error status and an invalid tags body", async () => {
		const preflight = createOllamaPreflight({
			baseUrl: BASE_URL,
			fetcher: fetcherReturning(
				response("down", 503),
				response("not json"),
				response({ models: [{ size: 1 }] }),
				response({ other: [] }),
			),
			clock: createFakeClock(),
		});

		await expect(preflight.ensureModel(chatModel)).rejects.toMatchObject({
			reason: "http-status",
			details: { status: 503 },
			message: expect.stringContaining("HTTP 503"),
		});
		await expect(preflight.ensureModel(chatModel)).rejects.toMatchObject({
			reason: "invalid-response",
		});
		await expect(preflight.ensureModel(chatModel)).rejects.toMatchObject({
			reason: "invalid-response",
		});
		await expect(preflight.ensureModel(chatModel)).rejects.toMatchObject({
			reason: "invalid-response",
		});
	});

	it("caches a successful tag list for a short time and refreshes it afterwards", async () => {
		const fetcher = fetcherReturning(tags(embeddingModel), tags(chatModel));
		const clock = createFakeClock();
		const preflight = createOllamaPreflight({ baseUrl: BASE_URL, fetcher, clock });

		await preflight.ensureModel(embeddingModel);
		await expect(preflight.ensureModel(chatModel)).rejects.toMatchObject({
			reason: "model-missing",
		});
		expect(fetcher.fetch).toHaveBeenCalledTimes(1);

		clock.advanceBy(OLLAMA_PREFLIGHT_CACHE_TTL_MS);
		await expect(preflight.ensureModel(chatModel)).resolves.toBeUndefined();
		expect(fetcher.fetch).toHaveBeenCalledTimes(2);
	});

	it("does not cache failures, so a started server is seen immediately", async () => {
		const fetcher = fetcherReturning(new TypeError("fetch failed"), tags(chatModel));
		const preflight = createOllamaPreflight({
			baseUrl: BASE_URL,
			fetcher,
			clock: createFakeClock(),
		});

		await expect(preflight.ensureModel(chatModel)).rejects.toMatchObject({
			reason: "unreachable",
		});
		await expect(preflight.ensureModel(chatModel)).resolves.toBeUndefined();
		expect(fetcher.fetch).toHaveBeenCalledTimes(2);
	});

	it("shares one request between concurrent checks", async () => {
		const fetcher = fetcherReturning(tags(chatModel, embeddingModel));
		const preflight = createOllamaPreflight({
			baseUrl: BASE_URL,
			fetcher,
			clock: createFakeClock(),
		});

		await Promise.all([preflight.ensureModel(chatModel), preflight.ensureModel(embeddingModel)]);

		expect(fetcher.fetch).toHaveBeenCalledTimes(1);
	});
});
