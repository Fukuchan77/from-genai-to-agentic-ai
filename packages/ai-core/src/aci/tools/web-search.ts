import { z } from "zod";
import type { SearchHit, WebSearchProvider } from "../../ports/web-search";
import { defineAciTool } from "../define-tool";
import type { AciTool } from "../types";

export const WEB_SEARCH_TOOL_NAME = "webSearch";
export const MAX_SEARCH_RESULTS = 5;

export interface WebSearchResult {
	readonly query: string;
	readonly results: readonly SearchHit[];
}

const webSearchInputSchema = z.object({
	query: z.string().min(1).max(400).describe("検索クエリ"),
});

/**
 * Web search through the injected provider (Tavily in `local` / `live`). It requires the
 * `web-search` feature, so `buildToolSet` leaves it out when `TAVILY_API_KEY` is unset (Req 5.3, 5.4).
 */
export function createWebSearchTool(
	search: WebSearchProvider,
): AciTool<z.output<typeof webSearchInputSchema>, WebSearchResult> {
	return defineAciTool<z.output<typeof webSearchInputSchema>, WebSearchResult>({
		name: WEB_SEARCH_TOOL_NAME,
		description:
			"Web を検索して、関連するページのタイトル・URL・抜粋を返します。最新の情報や出典が必要なときに使ってください。",
		inputSchema: webSearchInputSchema,
		risk: "read-only",
		requiredFeature: "web-search",
		execute: async ({ query }, context) => ({
			query,
			results: (await search.search(query, context.abortSignal)).slice(0, MAX_SEARCH_RESULTS),
		}),
	});
}
