import type { ModelEntry } from "./types";

/** The Ollama request options every call sends (plan C8, C11, C12). */
export interface OllamaRuntimeOptions {
	readonly providerOptions?: { ollama: { options: { num_ctx: number } } };
}

/**
 * Ollama runs a request with its server default context length (a few thousand tokens) unless
 * `num_ctx` is given, and silently truncates a longer prompt. A request whose `num_ctx` differs from
 * the loaded model's also makes Ollama reload the model (seconds per call), so chat, the agent and
 * the summary pipeline all send the catalog `contextWindow` through this one function. Spread the
 * result into the call settings; other providers get nothing.
 */
export function ollamaRuntimeOptions(entry: ModelEntry): OllamaRuntimeOptions {
	if (entry.provider !== "ollama") return {};
	return { providerOptions: { ollama: { options: { num_ctx: entry.contextWindow } } } };
}
