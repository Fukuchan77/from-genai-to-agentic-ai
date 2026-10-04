import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { createNodeHttpFetcher, type HttpFetcher } from "./http";

describe("createNodeHttpFetcher", () => {
	it("maps status, headers, and body from the injected fetch", async () => {
		const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
			new Response("article body", {
				status: 202,
				headers: { "content-type": "text/plain", "x-request-id": "request-1" },
			}),
		);
		const fetcher = createNodeHttpFetcher(fetch);

		await expect(fetcher.fetch("https://example.test/article")).resolves.toEqual({
			status: 202,
			headers: { "content-type": "text/plain", "x-request-id": "request-1" },
			body: "article body",
		});
		expectTypeOf(fetcher).toMatchTypeOf<HttpFetcher>();
	});

	it("passes the caller AbortSignal to fetch without replacing it", async () => {
		const fetch = vi
			.fn<typeof globalThis.fetch>()
			.mockResolvedValue(new Response("ok", { status: 200 }));
		const fetcher = createNodeHttpFetcher(fetch);
		const controller = new AbortController();

		await fetcher.fetch("https://example.test/data", {
			method: "POST",
			body: "payload",
			signal: controller.signal,
		});

		expect(fetch).toHaveBeenCalledWith(
			"https://example.test/data",
			expect.objectContaining({
				method: "POST",
				body: "payload",
				signal: controller.signal,
			}),
		);
	});
});
