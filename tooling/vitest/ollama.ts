// Shared Ollama endpoint rules for the hermetic guard and the local global setup (plan C18).

/** Plan default for `OLLAMA_BASE_URL` (env var table). The only definition in the tooling. */
export const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";

const OLLAMA_API_SUFFIX = /\/api$/u;
const TRAILING_SLASHES = /\/+$/u;

/**
 * Normalizes `OLLAMA_BASE_URL` to the server base without a trailing `/` or `/api`.
 * Both `http://host:11434` and the AI SDK provider form `http://host:11434/api` are accepted.
 * An unset or blank value resolves to {@link DEFAULT_OLLAMA_BASE_URL}; anything that is not an
 * absolute http(s) URL returns `undefined`.
 */
export function normalizeOllamaBaseUrl(value: string | undefined): string | undefined {
	const candidate = value?.trim() || DEFAULT_OLLAMA_BASE_URL;
	let url: URL;
	try {
		url = new URL(candidate);
	} catch {
		return undefined;
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
	const path = url.pathname
		.replace(TRAILING_SLASHES, "")
		.replace(OLLAMA_API_SUFFIX, "")
		.replace(TRAILING_SLASHES, "");
	return `${url.origin}${path}`;
}

export function ollamaTagsUrl(baseUrl: string): string {
	return `${baseUrl}/api/tags`;
}
