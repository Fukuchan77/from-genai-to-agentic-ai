import { readFileSync } from "node:fs";
import { PlatformError } from "../errors";
import type { HttpFetcher } from "../ports";

export const ARXIV_FIXTURE_FEEDS = ["multi", "single", "empty", "error"] as const;
export type ArxivFixtureFeed = (typeof ARXIV_FIXTURE_FEEDS)[number];

const FILES: Readonly<Record<ArxivFixtureFeed, string>> = {
	multi: "search-multi.xml",
	single: "search-single.xml",
	empty: "search-empty.xml",
	error: "error.xml",
};

const ARXIV_API = /^https:\/\/export\.arxiv\.org\/api\/query(?:\?|$)/u;

/**
 * A fetcher for `mock` mode that answers the arXiv query API from `fixtures/arxiv/`. It is not a
 * search engine: every query gets the same feed. It refuses any other address, so a `mock` run
 * cannot be pointed at another host by accident.
 */
export function createArxivFixtureFetcher(
	options: { readonly feed?: ArxivFixtureFeed } = {},
): HttpFetcher {
	const file = FILES[options.feed ?? "multi"];
	const body = readFileSync(new URL(`../../fixtures/arxiv/${file}`, import.meta.url), "utf8");
	return {
		async fetch(url) {
			if (!ARXIV_API.test(url)) {
				throw new PlatformError(
					"source-unavailable",
					"mock の arXiv は API の URL だけに答えます。",
				);
			}
			return { status: 200, headers: { "content-type": "application/atom+xml" }, body };
		},
	};
}
