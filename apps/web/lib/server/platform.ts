import "server-only";

import { lookup as dnsLookup } from "node:dns/promises";
import type { IncomingMessage, RequestOptions } from "node:http";
import http from "node:http";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import path from "node:path";
import { pipeline, type Readable, type Transform } from "node:stream";
import { createBrotliDecompress, createUnzip } from "node:zlib";
import type { ToolRuntime } from "@platform/ai-core/aci";
import { type EnvSource, loadPlatformConfig, type PlatformConfig } from "@platform/ai-core/config";
import { PlatformError } from "@platform/ai-core/errors";
import {
	CASSETTE_FIXTURE_DIRECTORY,
	createCassetteStore,
	createFixtureHttpFetcher,
	createFixtureTranscriptSource,
	createFixtureWebSearch,
	createRedactor,
	DEFAULT_FIXTURE_DIRECTORY,
	type FixtureSet,
	loadFixtureSet,
	type RecordingStore,
	type Redactor,
	recordingHttpFetcher,
	recordingTranscriptSource,
	recordingWebSearch,
} from "@platform/ai-core/mock";
import {
	createModelGateway,
	type GatewayDeps,
	type ModelGateway,
	ModelSelectionError,
	type ResolvedEmbeddingModel,
	type RunMode,
} from "@platform/ai-core/models";
import {
	type Clock,
	createCohereRerank,
	createNodeHttpFetcher,
	createTavilySearch,
	createYoutubeiTranscriptSource,
	type HttpFetcher,
	type RerankProvider,
	systemClock,
	type TranscriptSource,
	type WebSearchProvider,
} from "@platform/ai-core/ports";
import {
	createLexicalRerank,
	createPgliteDatabase,
	createPostgresDatabase,
	type RagDatabaseHandle,
} from "@platform/ai-core/rag";
import {
	ARTICLE_FETCH_LIMITS,
	isBlockedHostname,
	SourceFetchError,
} from "@platform/ai-core/summarize";
import { createRateLimiter, type RateLimiter } from "./guard";

// The only place that wires the platform together (plan C13). It is the only module that imports
// `server-only`, so nothing in here can reach a client bundle, and it is where run modes decide
// which ports exist: fixtures in `mock`, production implementations in `local` / `live`, wrapped in
// recording wrappers when `AI_RECORD=1`.

const MAX_CAUSE_DEPTH = 5;

// --- Guarded fetch (W3 adversarial review r2 N2, N3) ---

/** Resolves a host name to the IP addresses it currently points to. */
export type HostnameResolver = (hostname: string) => Promise<readonly string[]>;

/** The `node:http(s).request` surface the guarded fetch needs; tests inject a fake. */
export type HttpRequestFunction = (
	url: URL,
	options: RequestOptions,
	onResponse: (response: IncomingMessage) => void,
) => ReturnType<typeof http.request>;

export interface GuardedFetchOptions {
	/** Defaults to the system resolver (`dns.lookup` with `all`). */
	readonly resolve?: HostnameResolver;
	/** Defaults to `node:http` / `node:https`. */
	readonly request?: HttpRequestFunction;
	/** Defaults to {@link ARTICLE_FETCH_LIMITS}`.maxBodyBytes`. */
	readonly maxBodyBytes?: number;
}

const systemResolver: HostnameResolver = async (hostname) =>
	(await dnsLookup(hostname, { all: true, verbatim: true })).map(({ address }) => address);

const systemRequest: HttpRequestFunction = (url, options, onResponse) =>
	(url.protocol === "https:" ? https : http).request(url, options, onResponse);

function disallowedUrl(): SourceFetchError {
	return new SourceFetchError("disallowed-url");
}

/**
 * `isBlockedHostname` expects a hostname normalized by WHATWG URL (`::ffff:10.0.0.1` becomes
 * `[::ffff:a00:1]`, an IPv4 in decimal), so a raw resolver answer goes through `URL` first.
 */
function isBlockedAddress(address: string): boolean {
	const family = isIP(address);
	if (family === 0) return true;
	try {
		const host = family === 6 ? `[${address}]` : address;
		return isBlockedHostname(new URL(`http://${host}/`).hostname);
	} catch {
		return true;
	}
}

function notFound(hostname: string): NodeJS.ErrnoException {
	return Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), {
		code: "ENOTFOUND",
		hostname,
	});
}

/**
 * A `lookup` for `net.connect`: resolution and connection are the same step, so the address that
 * is checked is the address that is connected to, and a rebinding DNS server gets one answer per
 * connection. Any internal address among the answers refuses the connection.
 */
function createGuardedLookup(resolve: HostnameResolver): LookupFunction {
	return (hostname, options, callback) => {
		resolve(hostname).then(
			(addresses) => {
				if (addresses.some(isBlockedAddress)) {
					callback(disallowedUrl(), "", undefined);
					return;
				}
				const wanted = options.family === 4 || options.family === 6 ? options.family : 0;
				const entries = addresses
					.map((address) => ({ address, family: isIP(address) }))
					.filter((entry) => wanted === 0 || entry.family === wanted);
				const first = entries[0];
				if (first === undefined) {
					callback(notFound(hostname), "", undefined);
				} else if (options.all) {
					callback(null, entries);
				} else {
					callback(null, first.address, first.family);
				}
			},
			(error: unknown) => callback(error as NodeJS.ErrnoException, "", undefined),
		);
	};
}

/** Finds a `SourceFetchError` in an error and its `cause` chain (undici wraps lookup errors). */
function unwrapSourceError(error: unknown): unknown {
	let current: unknown = error;
	for (let depth = 0; depth < MAX_CAUSE_DEPTH && current instanceof Error; depth += 1) {
		if (current instanceof SourceFetchError) return current;
		current = current.cause;
	}
	return error;
}

function decoderFor(encoding: string | undefined): Transform | undefined {
	switch (encoding?.trim().toLowerCase()) {
		case "gzip":
		case "x-gzip":
		case "deflate":
			return createUnzip();
		case "br":
			return createBrotliDecompress();
		default:
			return undefined;
	}
}

function toHeaders(raw: IncomingMessage["headers"]): Headers {
	const headers = new Headers();
	for (const [name, value] of Object.entries(raw)) {
		if (value === undefined) continue;
		for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item);
	}
	return headers;
}

function declaredLength(headers: IncomingMessage["headers"]): number | undefined {
	const value = headers["content-length"];
	if (typeof value !== "string" || !/^\d+$/u.test(value)) return undefined;
	return Number(value);
}

/** Streams the (decoded) body and fails with `too-large` once it passes `maxBytes`. */
function limitedBody(response: IncomingMessage, maxBytes: number): ReadableStream<Uint8Array> {
	const decoder = decoderFor(response.headers["content-encoding"] as string | undefined);
	let source: Readable = response;
	if (decoder) {
		pipeline(response, decoder, () => undefined);
		source = decoder;
	}
	const iterator = source[Symbol.asyncIterator]() as AsyncIterator<Uint8Array>;
	let total = 0;
	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			try {
				const { done, value } = await iterator.next();
				if (done) {
					controller.close();
					return;
				}
				total += value.byteLength;
				if (total > maxBytes) {
					source.destroy();
					response.destroy();
					controller.error(new SourceFetchError("too-large"));
					return;
				}
				controller.enqueue(value);
			} catch (error) {
				controller.error(unwrapSourceError(error));
			}
		},
		cancel() {
			source.destroy();
			response.destroy();
		},
	});
}

const NULL_BODY_STATUSES: ReadonlySet<number> = new Set([101, 204, 205, 304]);

/**
 * A `fetch` for `createNodeHttpFetcher` that refuses internal destinations at connect time and
 * reads at most `maxBodyBytes` of body. Redirects are never followed (the caller checks every
 * location). `undici` is not a declared dependency, so this uses `node:http(s)` with a custom
 * `lookup` instead of an undici `Agent({ connect: { lookup } })`.
 */
export function createGuardedFetch(options: GuardedFetchOptions = {}): typeof globalThis.fetch {
	const request = options.request ?? systemRequest;
	const maxBodyBytes = options.maxBodyBytes ?? ARTICLE_FETCH_LIMITS.maxBodyBytes;
	const lookup = createGuardedLookup(options.resolve ?? systemResolver);

	return async (input, init) => {
		let url: URL;
		try {
			url = new URL(input instanceof Request ? input.url : input);
		} catch {
			throw disallowedUrl();
		}
		if (
			(url.protocol !== "http:" && url.protocol !== "https:") ||
			isBlockedHostname(url.hostname)
		) {
			throw disallowedUrl();
		}
		const headers = new Headers(init?.headers);
		if (!headers.has("accept-encoding")) headers.set("accept-encoding", "identity");

		return await new Promise<Response>((resolve, reject) => {
			const outgoing = request(
				url,
				{
					method: init?.method ?? "GET",
					headers: Object.fromEntries(headers.entries()),
					lookup,
					...(init?.signal ? { signal: init.signal } : {}),
				},
				(response) => {
					const length = declaredLength(response.headers);
					if (length !== undefined && length > maxBodyBytes) {
						response.destroy();
						reject(new SourceFetchError("too-large"));
						return;
					}
					const status = response.statusCode ?? 502;
					resolve(
						new Response(
							NULL_BODY_STATUSES.has(status) ? null : limitedBody(response, maxBodyBytes),
							{ status, headers: toHeaders(response.headers) },
						),
					);
				},
			);
			outgoing.on("error", (error: unknown) => reject(unwrapSourceError(error)));
			if (typeof init?.body === "string") outgoing.write(init.body);
			outgoing.end();
		});
	};
}

// --- Platform assembly ---

export interface PlatformPorts {
	readonly http: HttpFetcher;
	readonly transcript: TranscriptSource;
	readonly webSearch: WebSearchProvider;
}

/** The ports plus the Rerank provider, which has no recorded fixture (plan ADR-7). */
export interface PlatformPortSet extends PlatformPorts {
	/** `undefined` when no Cohere key is set outside `mock`: the Rerank stage is skipped (Req 2.6). */
	readonly rerank: RerankProvider | undefined;
}

/** Server-side directories the ingest API reads from (Req 1.1); callers pass file names only. */
export interface KnowledgeRoots {
	/** The learner's documents (`knowledge/` at the repository root). */
	readonly knowledge: string;
	/** The Japanese evaluation corpus under `packages/ai-core/fixtures/rag/corpus`. */
	readonly evalCorpus: string;
}

export interface Platform {
	readonly mode: RunMode;
	readonly config: PlatformConfig;
	readonly gateway: ModelGateway;
	readonly clock: Clock;
	readonly ports: PlatformPortSet;
	/** One window shared by every LLM-calling route. */
	readonly limiter: RateLimiter;
	readonly toolRuntime: ToolRuntime;
	readonly knowledgeRoots: KnowledgeRoots;
}

export interface PlatformOptions {
	/** Defaults to `process.env`. */
	readonly env?: EnvSource;
	readonly clock?: Clock;
	/** `mock` fixtures; defaults to `packages/ai-core/fixtures`. */
	readonly fixtures?: FixtureSet;
	/** Replaces the `local` / `live` ports (before any recording wrapper). */
	readonly productionPorts?: PlatformPorts;
	/** Resolver and transport of the production HttpFetcher. */
	readonly network?: GuardedFetchOptions;
	/** Where `AI_RECORD=1` writes; defaults to the cassette fixture directory. */
	readonly recording?: { readonly store?: RecordingStore; readonly redactor?: Redactor };
	/** Gateway test seams (scenarios, cassettes, provider factories, Ollama fetcher). */
	readonly gateway?: Pick<GatewayDeps, "mock" | "providers" | "fetcher">;
	/** Replaces the ingest directories (tests); defaults to {@link defaultKnowledgeRoots}. */
	readonly knowledgeRoots?: KnowledgeRoots;
}

const unavailableWebSearch: WebSearchProvider = {
	async search() {
		throw new PlatformError("source-unavailable", "Web 検索は設定されていません。", {
			provider: "tavily",
		});
	},
};

function credentialSecrets(credentials: PlatformConfig["credentials"]) {
	return {
		ANTHROPIC_API_KEY: credentials.anthropic,
		OPENAI_API_KEY: credentials.openai,
		AZURE_API_KEY: credentials.azure?.apiKey,
		GOOGLE_GENERATIVE_AI_API_KEY: credentials.google,
		TAVILY_API_KEY: credentials.tavily,
		COHERE_API_KEY: credentials.cohere,
	};
}

function createProductionPorts(
	config: PlatformConfig,
	network: GuardedFetchOptions | undefined,
): PlatformPorts {
	return {
		http: createNodeHttpFetcher(createGuardedFetch(network)),
		transcript: createYoutubeiTranscriptSource(),
		// The web search tool is listed even without a key (Req 5.4), so an unusable provider is
		// passed instead of none.
		webSearch: config.credentials.tavily
			? createTavilySearch(config.credentials.tavily)
			: unavailableWebSearch,
	};
}

/** `mock` always uses the pseudo implementation; elsewhere a Cohere key decides (CL-6). */
function createRerank(config: PlatformConfig): RerankProvider | undefined {
	if (config.mode === "mock") return createLexicalRerank();
	return config.credentials.cohere ? createCohereRerank(config.credentials.cohere) : undefined;
}

function recordedPorts(ports: PlatformPorts, store: RecordingStore, redactor: Redactor) {
	return {
		http: recordingHttpFetcher(ports.http, store, redactor),
		transcript: recordingTranscriptSource(ports.transcript, store, redactor),
		webSearch: recordingWebSearch(ports.webSearch, store, redactor),
	} satisfies PlatformPorts;
}

// Derived from the fixtures directory (`packages/ai-core/fixtures`), not from the working
// directory: `next dev` runs in `apps/web`, other tools run at the repository root.
function defaultKnowledgeRoots(): KnowledgeRoots {
	return {
		knowledge: path.resolve(DEFAULT_FIXTURE_DIRECTORY, "..", "..", "..", "knowledge"),
		evalCorpus: path.join(DEFAULT_FIXTURE_DIRECTORY, "rag", "corpus"),
	};
}

/** Builds a platform from the environment. Throws `ConfigError` when the configuration is invalid. */
export async function createPlatform(options: PlatformOptions = {}): Promise<Platform> {
	const config = loadPlatformConfig(options.env ?? process.env);
	const clock = options.clock ?? systemClock;
	const store = options.recording?.store ?? createCassetteStore(CASSETTE_FIXTURE_DIRECTORY);
	const redactor =
		options.recording?.redactor ?? createRedactor(credentialSecrets(config.credentials));

	let ports: PlatformPorts;
	if (config.mode === "mock") {
		const fixtures = options.fixtures ?? (await loadFixtureSet());
		ports = {
			http: createFixtureHttpFetcher(fixtures.http),
			transcript: createFixtureTranscriptSource(fixtures.transcripts),
			webSearch: createFixtureWebSearch(fixtures.webSearch),
		};
	} else {
		const production = options.productionPorts ?? createProductionPorts(config, options.network);
		ports = config.recording ? recordedPorts(production, store, redactor) : production;
	}

	return {
		mode: config.mode,
		config,
		gateway: createModelGateway({
			config,
			clock,
			recording: { store, redactor },
			...options.gateway,
		}),
		clock,
		ports: { ...ports, rerank: createRerank(config) },
		limiter: createRateLimiter({
			limit: config.rateLimit.maxRequests,
			windowMs: config.rateLimit.windowSeconds * 1000,
			clock,
		}),
		toolRuntime: { clock, toolTimeoutMs: config.agent.toolTimeoutMs },
		knowledgeRoots: options.knowledgeRoots ?? defaultKnowledgeRoots(),
	};
}

// --- Process-wide instance ---

// Kept on `globalThis` so that dev-server module reloads do not reset the rate limiter.
const INSTANCE_KEY = Symbol.for("from-genai-to-agentic-ai.platform");

type PlatformHolder = { [INSTANCE_KEY]?: Promise<Platform> };

/** The shared platform; built on first use from `process.env`, and rebuilt after a failed build. */
export function getPlatform(): Promise<Platform> {
	const holder = globalThis as PlatformHolder;
	const existing = holder[INSTANCE_KEY];
	if (existing) return existing;
	const created = createPlatform();
	holder[INSTANCE_KEY] = created;
	created.catch(() => {
		if (holder[INSTANCE_KEY] === created) delete holder[INSTANCE_KEY];
	});
	return created;
}

/** Test seam: installs `platform` as the shared instance, or clears it with `undefined`. */
export function setPlatformForTesting(platform: Platform | undefined): void {
	const holder = globalThis as PlatformHolder;
	if (platform) holder[INSTANCE_KEY] = Promise.resolve(platform);
	else delete holder[INSTANCE_KEY];
}

// --- Knowledge base (plan C13) ---

export interface KnowledgeBaseFactories {
	readonly pglite: typeof createPgliteDatabase;
	readonly postgres: typeof createPostgresDatabase;
}

const DEFAULT_KNOWLEDGE_BASE_FACTORIES: KnowledgeBaseFactories = {
	pglite: createPgliteDatabase,
	postgres: createPostgresDatabase,
};

/**
 * `mock` uses in-memory PGlite (gone with the process; ingesting again rebuilds it), `local` and
 * `live` use the Compose Postgres. An unreachable Postgres is `provider-unavailable`.
 */
export function createKnowledgeBase(
	platform: Pick<Platform, "mode" | "config">,
	factories: KnowledgeBaseFactories = DEFAULT_KNOWLEDGE_BASE_FACTORIES,
): Promise<RagDatabaseHandle> {
	return platform.mode === "mock"
		? factories.pglite()
		: factories.postgres(platform.config.database);
}

const KNOWLEDGE_BASE_KEY = Symbol.for("from-genai-to-agentic-ai.knowledge-base");

type KnowledgeBaseHolder = { [KNOWLEDGE_BASE_KEY]?: Promise<RagDatabaseHandle> };

/**
 * The shared database handle, created on first use (concurrent callers share one creation) and
 * kept on `globalThis` for the same dev-reload reason as the platform. A failed creation is not
 * cached, so starting Postgres and retrying works without restarting the server.
 */
export function getKnowledgeBase(
	factories: KnowledgeBaseFactories = DEFAULT_KNOWLEDGE_BASE_FACTORIES,
): Promise<RagDatabaseHandle> {
	const holder = globalThis as KnowledgeBaseHolder;
	const existing = holder[KNOWLEDGE_BASE_KEY];
	if (existing) return existing;
	const created = getPlatform().then((platform) => createKnowledgeBase(platform, factories));
	holder[KNOWLEDGE_BASE_KEY] = created;
	created.catch(() => {
		if (holder[KNOWLEDGE_BASE_KEY] === created) delete holder[KNOWLEDGE_BASE_KEY];
	});
	return created;
}

/** Test seam: installs `handle` as the shared database, or clears it with `undefined`. */
export function setKnowledgeBaseForTesting(handle: RagDatabaseHandle | undefined): void {
	const holder = globalThis as KnowledgeBaseHolder;
	if (handle) holder[KNOWLEDGE_BASE_KEY] = Promise.resolve(handle);
	else delete holder[KNOWLEDGE_BASE_KEY];
}

// --- Embedding model (plan C13) ---

/**
 * The embedding model every RAG route embeds with. A provider without a default (the `live`
 * Anthropic one) fails with the setting to change; the gateway's own message does not name it.
 */
export async function resolveKnowledgeEmbedding(
	platform: Pick<Platform, "gateway">,
): Promise<ResolvedEmbeddingModel> {
	try {
		return await platform.gateway.resolveEmbedding();
	} catch (error) {
		if (error instanceof ModelSelectionError && error.reason === "no-default") {
			throw new PlatformError(
				"invalid-request",
				"埋め込みモデルが設定されていません。環境変数 AI_MODEL_EMBEDDING に埋め込みモデルを指定し、対応するプロバイダの API キーも設定してください。",
				{ ...error.details },
			);
		}
		throw error;
	}
}
