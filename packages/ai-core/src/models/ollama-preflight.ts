import type { Clock } from "../ports/clock";
import type { HttpFetcher } from "../ports/http";
import { OllamaUnavailableError } from "./errors";
import { ollamaServerUrl } from "./providers";
import type { ModelId } from "./types";

/** How long a successful `/api/tags` listing is reused (plan C6: "短時間キャッシュ"). */
export const OLLAMA_PREFLIGHT_CACHE_TTL_MS = 5_000;
/** Upper bound for one `/api/tags` request, so an unresponsive server fails fast. */
export const OLLAMA_PREFLIGHT_TIMEOUT_MS = 2_000;

const DEFAULT_TAG = ":latest";

export interface OllamaPreflightOptions {
	readonly baseUrl: string;
	readonly fetcher: HttpFetcher;
	readonly clock: Clock;
	readonly cacheTtlMs?: number;
	readonly timeoutMs?: number;
}

export interface OllamaPreflight {
	/** Resolves when Ollama is reachable and has pulled the model; otherwise rejects. */
	ensureModel(modelId: ModelId): Promise<void>;
}

interface CachedTags {
	readonly models: ReadonlySet<string>;
	readonly fetchedAt: number;
}

function withDefaultTag(model: string): string {
	return model.includes(":") ? model : `${model}${DEFAULT_TAG}`;
}

/** Model names from an Ollama `/api/tags` body, or `undefined` for any malformed shape. */
function parseTags(body: string): readonly string[] | undefined {
	let value: unknown;
	try {
		value = JSON.parse(body);
	} catch {
		return undefined;
	}
	if (typeof value !== "object" || value === null) return undefined;
	const models = (value as { models?: unknown }).models;
	if (!Array.isArray(models)) return undefined;
	const names: string[] = [];
	for (const model of models) {
		const entry = (typeof model === "object" && model !== null ? model : {}) as {
			name?: unknown;
			model?: unknown;
		};
		const name = typeof entry.name === "string" ? entry.name : entry.model;
		if (typeof name !== "string") return undefined;
		names.push(name);
	}
	return names;
}

/**
 * Checks that Ollama answers `GET {baseUrl}/api/tags` and has pulled the model (Req 2.3, 2.7).
 * Successful listings are cached for {@link OLLAMA_PREFLIGHT_CACHE_TTL_MS}; failures are not
 * cached, so a server started after an error is seen on the next request.
 */
export function createOllamaPreflight(options: OllamaPreflightOptions): OllamaPreflight {
	const baseUrl = ollamaServerUrl(options.baseUrl);
	const cacheTtlMs = options.cacheTtlMs ?? OLLAMA_PREFLIGHT_CACHE_TTL_MS;
	const timeoutMs = options.timeoutMs ?? OLLAMA_PREFLIGHT_TIMEOUT_MS;
	let cached: CachedTags | undefined;
	let inFlight: Promise<CachedTags> | undefined;

	async function fetchTags(): Promise<CachedTags> {
		let response: Awaited<ReturnType<HttpFetcher["fetch"]>>;
		try {
			response = await options.fetcher.fetch(`${baseUrl}/api/tags`, {
				method: "GET",
				headers: { accept: "application/json" },
				signal: options.clock.timeoutSignal(timeoutMs),
			});
		} catch {
			throw new OllamaUnavailableError(baseUrl, "unreachable");
		}
		if (response.status < 200 || response.status >= 300) {
			throw new OllamaUnavailableError(baseUrl, "http-status", { status: response.status });
		}
		const names = parseTags(response.body);
		if (!names) throw new OllamaUnavailableError(baseUrl, "invalid-response");
		return { models: new Set(names.map(withDefaultTag)), fetchedAt: options.clock.now() };
	}

	async function currentTags(): Promise<CachedTags> {
		if (cached && options.clock.now() - cached.fetchedAt < cacheTtlMs) return cached;
		inFlight ??= fetchTags().finally(() => {
			inFlight = undefined;
		});
		cached = await inFlight;
		return cached;
	}

	return {
		async ensureModel(modelId) {
			const tags = await currentTags();
			if (!tags.models.has(withDefaultTag(modelId))) {
				throw new OllamaUnavailableError(baseUrl, "model-missing", { modelId });
			}
		},
	};
}
