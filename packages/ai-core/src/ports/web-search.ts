import { tavily } from "@tavily/core";
import { z } from "zod";
import { PlatformError } from "../errors";
import { raceWithAbort } from "./abort";

export interface SearchHit {
	readonly title: string;
	readonly url: string;
	readonly snippet: string;
	readonly score: number;
	readonly publishedDate?: string;
}

export interface WebSearchProvider {
	search(query: string, signal?: AbortSignal): Promise<readonly SearchHit[]>;
}

const tavilyResponseSchema = z.object({
	results: z.array(
		z.object({
			title: z.string(),
			url: z.url({ protocol: /^https?$/ }),
			content: z.string(),
			score: z.number(),
			publishedDate: z.string().nullish(),
		}),
	),
});

interface TavilySearchClient {
	search(query: string, options?: { readonly signal?: AbortSignal }): Promise<unknown>;
}

export interface TavilySearchOptions {
	readonly client?: TavilySearchClient;
}

function createSdkClient(apiKey: string): TavilySearchClient {
	const sdk = tavily({ apiKey });
	// @tavily/core 0.7.13 serializes unknown options into the request body, so the signal is
	// honored on the caller side (raceWithAbort) instead of being forwarded to the SDK.
	return { search: (query) => sdk.search(query) };
}

export function createTavilySearch(
	apiKey: string,
	options: TavilySearchOptions = {},
): WebSearchProvider {
	const client = options.client ?? createSdkClient(apiKey);

	return {
		async search(query, signal) {
			let raw: unknown;
			try {
				raw = await raceWithAbort(client.search(query, signal ? { signal } : {}), signal);
			} catch (cause) {
				if (signal?.aborted) throw signal.reason;
				throw new PlatformError("source-unavailable", "Web 検索に失敗しました。", {
					provider: "tavily",
					...(cause instanceof Error ? { cause: cause.message } : {}),
				});
			}
			const parsed = tavilyResponseSchema.safeParse(raw);
			if (!parsed.success) {
				throw new PlatformError(
					"source-unavailable",
					"Web 検索の応答が想定した形式ではありません。",
					{
						provider: "tavily",
						issues: parsed.error.issues.map((issue) => issue.path.join(".")),
					},
				);
			}
			return parsed.data.results.map((result) => ({
				title: result.title,
				url: result.url,
				snippet: result.content,
				score: result.score,
				...(result.publishedDate ? { publishedDate: result.publishedDate } : {}),
			}));
		},
	};
}
