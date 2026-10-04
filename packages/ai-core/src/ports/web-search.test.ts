import { tavily } from "@tavily/core";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { PlatformError } from "../errors";
import { createTavilySearch, type WebSearchProvider } from "./index";

const sdkSearch = vi.hoisted(() => vi.fn());
vi.mock("@tavily/core", () => ({ tavily: vi.fn(() => ({ search: sdkSearch })) }));

describe("createTavilySearch", () => {
	it("maps Tavily results to stable SearchHit values", async () => {
		const client = {
			search: vi.fn().mockResolvedValue({
				results: [
					{
						title: "Agent engineering",
						url: "https://example.test/agents",
						content: "A practical guide.",
						score: 0.91,
						publishedDate: "2026-09-20",
					},
				],
			}),
		};
		const search = createTavilySearch("test-key", { client });

		await expect(search.search("agent engineering")).resolves.toEqual([
			{
				title: "Agent engineering",
				url: "https://example.test/agents",
				snippet: "A practical guide.",
				score: 0.91,
				publishedDate: "2026-09-20",
			},
		]);
		expectTypeOf(search).toMatchTypeOf<WebSearchProvider>();
	});

	it("omits a missing or null publishedDate", async () => {
		const hit = { title: "T", url: "https://example.test/t", content: "C", score: 0.5 };
		const client = {
			search: vi.fn().mockResolvedValue({
				results: [hit, { ...hit, publishedDate: null }],
			}),
		};
		const search = createTavilySearch("test-key", { client });

		const hits = await search.search("dates");
		expect(hits).toEqual([
			{ title: "T", url: "https://example.test/t", snippet: "C", score: 0.5 },
			{ title: "T", url: "https://example.test/t", snippet: "C", score: 0.5 },
		]);
		expect(hits.every((entry) => !("publishedDate" in entry))).toBe(true);
	});

	it.each([
		["missing results", {}],
		["missing score", { results: [{ title: "T", url: "https://example.test/t", content: "C" }] }],
		[
			"non-http url",
			{ results: [{ title: "T", url: "javascript:alert(1)", content: "C", score: 0.1 }] },
		],
	])("rejects a malformed Tavily response (%s) as source-unavailable", async (_case, response) => {
		const search = createTavilySearch("test-key", {
			client: { search: vi.fn().mockResolvedValue(response) },
		});

		const promise = search.search("malformed");
		await expect(promise).rejects.toBeInstanceOf(PlatformError);
		await expect(promise).rejects.toMatchObject({
			code: "source-unavailable",
			details: { provider: "tavily" },
		});
	});

	it("wraps Tavily SDK failures as source-unavailable", async () => {
		const search = createTavilySearch("test-key", {
			client: { search: vi.fn().mockRejectedValue(new Error("Request failed with status 429")) },
		});

		const promise = search.search("rate limited", new AbortController().signal);
		await expect(promise).rejects.toBeInstanceOf(PlatformError);
		await expect(promise).rejects.toMatchObject({
			code: "source-unavailable",
			details: { provider: "tavily", cause: "Request failed with status 429" },
		});
	});

	it("keeps the AbortSignal out of the real Tavily SDK request options", async () => {
		sdkSearch.mockResolvedValue({ results: [] });
		const search = createTavilySearch("sdk-key");

		await expect(search.search("real sdk", new AbortController().signal)).resolves.toEqual([]);
		expect(tavily).toHaveBeenCalledWith({ apiKey: "sdk-key" });
		expect(sdkSearch).toHaveBeenCalledWith("real sdk");
	});

	it("passes AbortSignal to the client and rejects when the caller aborts", async () => {
		const client = {
			search: vi.fn(
				(_query: string, _options: { signal?: AbortSignal }) =>
					new Promise<{ results: never[] }>(() => {}),
			),
		};
		const search = createTavilySearch("test-key", { client });
		const controller = new AbortController();
		const result = search.search("cancel me", controller.signal);

		expect(client.search).toHaveBeenCalledWith(
			"cancel me",
			expect.objectContaining({ signal: controller.signal }),
		);
		controller.abort(new DOMException("Stopped", "AbortError"));
		await expect(result).rejects.toMatchObject({ name: "AbortError" });
	});
});
