import { describe, expect, it, vi } from "vitest";
import type { TestProject } from "vitest/node";
import setupLocalAvailability, {
	checkLocalAvailability,
	findMissingModels,
	httpErrorReason,
	parseTagsResponse,
	requiredModels,
} from "./global-setup-local";
import { DEFAULT_OLLAMA_BASE_URL, normalizeOllamaBaseUrl, ollamaTagsUrl } from "./ollama";

const LOCAL_ENV = { AI_TEST_RUN_MODE: "local" } as const;

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
	return new Response(JSON.stringify(body), {
		headers: { "content-type": "application/json" },
		...init,
	});
}

function fetchReturning(response: Response) {
	return vi.fn<typeof fetch>().mockResolvedValue(response);
}

describe("Ollama base URL normalization", () => {
	it("uses the plan default when OLLAMA_BASE_URL is unset or blank", () => {
		expect(DEFAULT_OLLAMA_BASE_URL).toBe("http://127.0.0.1:11434");
		expect(normalizeOllamaBaseUrl(undefined)).toBe("http://127.0.0.1:11434");
		expect(normalizeOllamaBaseUrl("   ")).toBe("http://127.0.0.1:11434");
	});

	it.each([
		["http://127.0.0.1:11434", "http://127.0.0.1:11434"],
		["http://127.0.0.1:11434/", "http://127.0.0.1:11434"],
		["http://127.0.0.1:11434/api", "http://127.0.0.1:11434"],
		["http://127.0.0.1:11434/api/", "http://127.0.0.1:11434"],
		["  https://ollama.example.test/proxy/api  ", "https://ollama.example.test/proxy"],
		["http://127.0.0.1:11434/apis", "http://127.0.0.1:11434/apis"],
	])("normalizes %s to the base %s", (input, expected) => {
		expect(normalizeOllamaBaseUrl(input)).toBe(expected);
	});

	it.each(["not a url", "ftp://127.0.0.1:11434", "file:///tmp/ollama"])("rejects %s", (input) => {
		expect(normalizeOllamaBaseUrl(input)).toBeUndefined();
	});

	it("builds the tags URL from the base without a doubled /api", () => {
		expect(ollamaTagsUrl("http://127.0.0.1:11434")).toBe("http://127.0.0.1:11434/api/tags");
	});
});

describe("Ollama tags and required models", () => {
	it("parses model names, falling back to the model field and de-duplicating", () => {
		expect(
			parseTagsResponse({
				models: [
					{ name: "chat-model:latest" },
					{ model: "embed-model:latest" },
					{ name: "chat-model:latest" },
				],
			}),
		).toEqual({ models: ["chat-model:latest", "embed-model:latest"] });
		expect(parseTagsResponse({ models: [] })).toEqual({ models: [] });
	});

	it.each([
		null,
		"models",
		{},
		{ models: "chat-model" },
		{ models: [null] },
		{ models: [{ name: "" }] },
		{ models: [{ size: 1 }] },
	])("rejects the malformed tags payload %j", (payload) => {
		expect(parseTagsResponse(payload)).toBeUndefined();
	});

	it("reads required models from the AI_MODEL_* variables, trimmed and de-duplicated", () => {
		expect(
			requiredModels({
				AI_MODEL_CHAT: " chat-model ",
				AI_MODEL_STRUCTURED: "chat-model",
				AI_MODEL_EMBEDDING: "embed-model",
				AI_MODEL_JUDGE: "",
			}),
		).toEqual(["chat-model", "embed-model"]);
		expect(requiredModels({})).toEqual([]);
	});

	it("treats an untagged model and its :latest tag as the same model", () => {
		expect(
			findMissingModels(
				["chat-model", "judge-model:large", "structured-model:latest"],
				["chat-model:latest", "structured-model"],
			),
		).toEqual(["judge-model:large"]);
		expect(findMissingModels(["judge-model:large"], ["judge-model:small"])).toEqual([
			"judge-model:large",
		]);
		expect(findMissingModels([], [])).toEqual([]);
	});

	it("describes HTTP errors with the status and the requested URL", () => {
		expect(httpErrorReason(503, "Service Unavailable", "http://127.0.0.1:11434/api/tags")).toBe(
			"Ollama returned HTTP 503 Service Unavailable from http://127.0.0.1:11434/api/tags.",
		);
		expect(httpErrorReason(404, "", "http://127.0.0.1:11434/api/tags")).toBe(
			"Ollama returned HTTP 404 from http://127.0.0.1:11434/api/tags.",
		);
	});
});

describe("checkLocalAvailability", () => {
	it("does not probe Ollama outside local mode", async () => {
		const fetchImpl = vi.fn<typeof fetch>();
		const result = await checkLocalAvailability({
			env: { AI_TEST_RUN_MODE: "mock" },
			fetch: fetchImpl,
		});

		expect(result).toMatchObject({
			available: false,
			reason: "Local tests require AI_TEST_RUN_MODE=local.",
		});
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("probes the default Ollama tags URL when OLLAMA_BASE_URL is unset", async () => {
		const fetchImpl = fetchReturning(jsonResponse({ models: [] }));
		const result = await checkLocalAvailability({ env: { ...LOCAL_ENV }, fetch: fetchImpl });

		expect(fetchImpl).toHaveBeenCalledWith("http://127.0.0.1:11434/api/tags", expect.any(Object));
		expect(result).toEqual({
			available: true,
			baseUrl: "http://127.0.0.1:11434",
			models: [],
			missingModels: [],
			reason: null,
		});
	});

	it("accepts an OLLAMA_BASE_URL that already ends with /api", async () => {
		const fetchImpl = fetchReturning(jsonResponse({ models: [{ name: "chat-model:latest" }] }));
		const result = await checkLocalAvailability({
			env: {
				...LOCAL_ENV,
				OLLAMA_BASE_URL: "http://127.0.0.1:11434/api",
				AI_MODEL_CHAT: "chat-model",
			},
			fetch: fetchImpl,
		});

		expect(fetchImpl).toHaveBeenCalledWith("http://127.0.0.1:11434/api/tags", expect.any(Object));
		expect(result.available).toBe(true);
		expect(result.baseUrl).toBe("http://127.0.0.1:11434");
	});

	it("reports an invalid OLLAMA_BASE_URL without probing", async () => {
		const fetchImpl = vi.fn<typeof fetch>();
		const result = await checkLocalAvailability({
			env: { ...LOCAL_ENV, OLLAMA_BASE_URL: "ftp://127.0.0.1" },
			fetch: fetchImpl,
		});

		expect(result).toMatchObject({
			available: false,
			reason: "OLLAMA_BASE_URL must be an absolute http or https URL.",
		});
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("reports missing models with pull commands", async () => {
		const result = await checkLocalAvailability({
			env: { ...LOCAL_ENV, AI_MODEL_CHAT: "chat-model", AI_MODEL_EMBEDDING: "embed-model" },
			fetch: fetchReturning(jsonResponse({ models: [{ name: "chat-model:latest" }] })),
		});

		expect(result).toEqual({
			available: false,
			baseUrl: "http://127.0.0.1:11434",
			models: ["chat-model:latest"],
			missingModels: ["embed-model"],
			reason:
				"Required Ollama models are not installed: embed-model. Run `ollama pull embed-model`.",
		});
	});

	it("reports an HTTP error status", async () => {
		const result = await checkLocalAvailability({
			env: { ...LOCAL_ENV },
			fetch: fetchReturning(
				new Response("down", { status: 503, statusText: "Service Unavailable" }),
			),
		});

		expect(result).toMatchObject({
			available: false,
			reason: "Ollama returned HTTP 503 Service Unavailable from http://127.0.0.1:11434/api/tags.",
		});
	});

	it.each([
		["a malformed payload", jsonResponse({ models: "none" })],
		["a non-JSON body", new Response("<html>proxy</html>", { status: 200 })],
	])("reports %s as an invalid tags response", async (_label, response) => {
		const result = await checkLocalAvailability({
			env: { ...LOCAL_ENV },
			fetch: fetchReturning(response),
		});

		expect(result).toMatchObject({
			available: false,
			reason: "Ollama returned an invalid /api/tags response from http://127.0.0.1:11434/api/tags.",
		});
	});

	it("reports a connection failure with the base URL and a start hint", async () => {
		const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed"));
		const result = await checkLocalAvailability({ env: { ...LOCAL_ENV }, fetch: fetchImpl });

		expect(result).toMatchObject({
			available: false,
			reason:
				"Ollama is unavailable at http://127.0.0.1:11434: fetch failed. Start it with `ollama serve`.",
		});
	});

	it("provides the availability to the Vitest project", async () => {
		const provide = vi.fn();
		await setupLocalAvailability({ provide } as unknown as TestProject, {
			env: { AI_TEST_RUN_MODE: "mock" },
		});

		expect(provide).toHaveBeenCalledWith(
			"localAvailability",
			expect.objectContaining({ available: false, baseUrl: "http://127.0.0.1:11434" }),
		);
	});
});
