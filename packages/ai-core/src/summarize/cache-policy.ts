import type { TextPart } from "ai";
import type { ModelEntry, PromptCacheMode } from "../models/types";

export type CacheProviderOptions = NonNullable<TextPart["providerOptions"]>;

/**
 * How a summary call enables prompt caching for the selected model (Req 4.8).
 * - `explicit`: the long source part carries a provider cache marker (Anthropic `cacheControl`).
 * - `automatic`: the provider caches long prefixes on its own; only the cache reads are recorded.
 * - `none`: no caching and no cache-read figure (Ollama, mock).
 */
export interface CachePolicy {
	readonly mode: PromptCacheMode;
	readonly recordsCacheReads: boolean;
	readonly sourcePartProviderOptions?: CacheProviderOptions;
}

const NO_CACHE: CachePolicy = Object.freeze({ mode: "none", recordsCacheReads: false });

export function cachePolicyFor(entry: ModelEntry): CachePolicy {
	const declared = entry.capabilities.promptCache;
	switch (entry.provider) {
		case "anthropic":
			return declared === "none"
				? NO_CACHE
				: {
						mode: "explicit",
						recordsCacheReads: true,
						sourcePartProviderOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
					};
		case "openai":
		case "azure":
		case "google":
			return declared === "none" ? NO_CACHE : { mode: "automatic", recordsCacheReads: true };
		case "ollama":
		case "mock":
			return NO_CACHE;
	}
}
