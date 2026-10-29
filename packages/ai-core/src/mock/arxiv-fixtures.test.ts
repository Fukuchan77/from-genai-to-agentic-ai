import { describe, expect, it } from "vitest";
import { parseArxivFeed } from "../research/arxiv/parse";
import { ARXIV_FIXTURE_FEEDS, createArxivFixtureFetcher } from "./arxiv-fixtures";

describe("createArxivFixtureFetcher", () => {
	it("answers every request with the multi-entry feed by default, as a 200", async () => {
		const fetcher = createArxivFixtureFetcher();
		const response = await fetcher.fetch("https://export.arxiv.org/api/query?search_query=all:x");
		expect(response.status).toBe(200);
		expect(parseArxivFeed(response.body).map((paper) => paper.arxivId)).toEqual([
			"2401.01234",
			"2403.05678",
			"cs/0501001",
		]);
	});

	it("answers the same for a different query, because the fixture is not a search engine", async () => {
		const fetcher = createArxivFixtureFetcher();
		const a = await fetcher.fetch("https://export.arxiv.org/api/query?search_query=all:a");
		const b = await fetcher.fetch("https://export.arxiv.org/api/query?search_query=all:b");
		expect(a.body).toBe(b.body);
	});

	it.each([
		["single", 1],
		["empty", 0],
	] as const)("serves the %s feed on request", async (feed, count) => {
		const fetcher = createArxivFixtureFetcher({ feed });
		const response = await fetcher.fetch("https://export.arxiv.org/api/query");
		expect(parseArxivFeed(response.body)).toHaveLength(count);
	});

	it("serves the error feed as a feed that the client treats as a failure", async () => {
		const fetcher = createArxivFixtureFetcher({ feed: "error" });
		const response = await fetcher.fetch("https://export.arxiv.org/api/query");
		expect(() => parseArxivFeed(response.body)).toThrow();
	});

	it("names the feeds it can serve", () => {
		expect([...ARXIV_FIXTURE_FEEDS]).toEqual(["multi", "single", "empty", "error"]);
	});

	it("refuses an address that is not the arXiv API, so a mock run cannot reach another host", async () => {
		const fetcher = createArxivFixtureFetcher();
		await expect(fetcher.fetch("https://example.com/api/query")).rejects.toThrow();
		await expect(fetcher.fetch("http://export.arxiv.org.evil.test/api/query")).rejects.toThrow();
		await expect(
			fetcher.fetch("https://evil.test/?u=https://export.arxiv.org/api/query"),
		).rejects.toThrow();
		await expect(fetcher.fetch("https://export.arxiv.org/api/query-other")).rejects.toThrow();
	});
});
