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
import {
	DEFAULT_SANDBOX,
	type EnvSource,
	loadPlatformConfig,
	type PlatformConfig,
} from "@platform/ai-core/config";
import { PlatformError } from "@platform/ai-core/errors";
import { createTicketStore, FAQ_DIRECTORY, type TicketStore } from "@platform/ai-core/helpdesk";
import { type CatalogRepo, createCatalogRepo, seedMarketing } from "@platform/ai-core/marketing";
import {
	connectMcpServers,
	filesServerConfig,
	githubServerConfig,
	type McpRegistry,
	type McpServerConfig,
} from "@platform/ai-core/mcp";
import {
	CASSETTE_FIXTURE_DIRECTORY,
	createArxivFixtureFetcher,
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
	type SandboxProvider,
	systemClock,
	type TranscriptSource,
	type WebSearchProvider,
} from "@platform/ai-core/ports";
import {
	createLexicalRerank,
	createPgliteDatabase,
	createPostgresDatabase,
	ingestDocuments,
	KnowledgeBaseUnavailableError,
	listIngestableFiles,
	type RagDatabaseHandle,
} from "@platform/ai-core/rag";
import { type ArxivClient, createArxivClient } from "@platform/ai-core/research";
import {
	createE2bProvider,
	createLocalDockerProvider,
	createMockSandboxProvider,
	createSandboxRegistry,
	probeDockerEnvironment,
	type SandboxRegistry,
	selectSandboxProvider,
} from "@platform/ai-core/sandbox";
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

// --- MCP servers (plan C13, Req 1.7-1.10) ---

// The repository root, derived from the fixtures directory (`packages/ai-core/fixtures`) like the
// knowledge roots: `next dev` runs in `apps/web`, other tools run at the repository root.
const REPOSITORY_ROOT = path.resolve(DEFAULT_FIXTURE_DIRECTORY, "..", "..", "..");

/** The entry the platform's own file server is started from (CL-3). */
const FILES_SERVER_FILE = path.resolve(DEFAULT_FIXTURE_DIRECTORY, "..", "src", "files", "stdio.ts");

/**
 * The servers this process connects to. The file server needs no key and runs in every mode. GitHub
 * is offered only outside `mock` and only with `GITHUB_TOKEN`, so the gate never reaches the network
 * and a learner without a token sees no GitHub server (Req 1.9). A relative `MCP_FS_ROOT` is
 * resolved against the repository root.
 */
export function mcpServerConfigs(
	platform: Pick<Platform, "mode" | "config">,
): readonly McpServerConfig[] {
	const configs: McpServerConfig[] = [
		filesServerConfig({
			root: path.resolve(REPOSITORY_ROOT, platform.config.mcpFsRoot),
			serverFile: FILES_SERVER_FILE,
		}),
	];
	if (platform.mode !== "mock") {
		const github = githubServerConfig({ GITHUB_TOKEN: platform.config.credentials.github });
		if (!("reason" in github)) configs.push(github);
	}
	return configs;
}

export interface McpRegistryDeps {
	readonly connect: typeof connectMcpServers;
}

const DEFAULT_MCP_DEPS: McpRegistryDeps = { connect: connectMcpServers };

/**
 * Connects to every configured server. A server that cannot be reached is recorded in the
 * registry's status, not thrown; only a failure to prepare the connections is an error, and its
 * cause (which may hold a header or a path) stays out of the message.
 */
export async function createMcpRegistry(
	platform: Pick<Platform, "mode" | "config" | "clock">,
	deps: McpRegistryDeps = DEFAULT_MCP_DEPS,
): Promise<McpRegistry> {
	try {
		return await deps.connect(mcpServerConfigs(platform), { clock: platform.clock });
	} catch {
		throw new PlatformError(
			"provider-unavailable",
			"MCP サーバーへの接続を準備できませんでした。サーバーの設定を確認してください。",
		);
	}
}

const MCP_REGISTRY_KEY = Symbol.for("from-genai-to-agentic-ai.mcp-registry");

type McpRegistryHolder = { [MCP_REGISTRY_KEY]?: Promise<McpRegistry> };

/**
 * The shared registry, created on first use and kept on `globalThis` (a Route Handler can be a
 * separate bundle and dev reloads modules, so a module variable would start a second set of child
 * processes). A failed creation is not cached.
 */
export function getMcpRegistry(deps: McpRegistryDeps = DEFAULT_MCP_DEPS): Promise<McpRegistry> {
	const holder = globalThis as McpRegistryHolder;
	const existing = holder[MCP_REGISTRY_KEY];
	if (existing) return existing;
	const created = getPlatform().then((platform) => createMcpRegistry(platform, deps));
	holder[MCP_REGISTRY_KEY] = created;
	created.catch(() => {
		if (holder[MCP_REGISTRY_KEY] === created) delete holder[MCP_REGISTRY_KEY];
	});
	return created;
}

/** Test seam: installs `registry` as the shared one, or clears it with `undefined`. */
export function setMcpRegistryForTesting(registry: McpRegistry | undefined): void {
	const holder = globalThis as McpRegistryHolder;
	if (registry) holder[MCP_REGISTRY_KEY] = Promise.resolve(registry);
	else delete holder[MCP_REGISTRY_KEY];
}

// --- Help-desk tickets (plan C13, Req 2.6, 2.7) ---

/**
 * The ticket store, on the knowledge base's database (one PGlite in `mock`, the Compose Postgres
 * elsewhere) and the platform clock. An unreachable Postgres is `provider-unavailable` with the
 * start-up guidance, exactly as for the knowledge base; the store itself holds no state.
 */
export async function getHelpdeskStore(
	factories: KnowledgeBaseFactories = DEFAULT_KNOWLEDGE_BASE_FACTORIES,
): Promise<TicketStore> {
	const [platform, handle] = await Promise.all([getPlatform(), getKnowledgeBase(factories)]);
	if (platform.mode === "mock") await ensureMockFaq(platform, handle);
	return createTicketStore(handle.db, { clock: platform.clock });
}

/** The throwaway databases whose FAQ was already ingested, so a request does not ingest again. */
const FAQ_SEEDED = new WeakSet<object>();

/**
 * `mock` runs on an empty throwaway PGlite, so without this every sample inquiry would be
 * escalated for lack of evidence (W3 carry-over F-8). Only the FAQ goes in, not the sample tickets,
 * so the first ticket of a run is still `T-0001`. `local` and `live` never seed: their knowledge
 * base holds the learner's own documents, and `mise run seed:samples` is the explicit way in.
 */
async function ensureMockFaq(
	platform: Pick<Platform, "gateway" | "clock">,
	handle: RagDatabaseHandle,
): Promise<void> {
	if (FAQ_SEEDED.has(handle.db)) return;
	await ingestDocuments({
		db: handle.db,
		embedding: await resolveKnowledgeEmbedding(platform),
		source: "knowledge",
		root: FAQ_DIRECTORY,
		files: await listIngestableFiles(FAQ_DIRECTORY),
		clock: platform.clock,
	});
	FAQ_SEEDED.add(handle.db);
}

// --- Marketing catalog (plan C13, Req 6.5, 6.6) ---

/**
 * The product catalog and council personas, on the knowledge base's database. `mock` seeds the
 * bundled samples into its throwaway PGlite (idempotent), so the screens work out of the box;
 * `local` and `live` never seed: an empty catalog is `provider-unavailable` pointing at
 * `mise run seed:samples`.
 */
export async function getCatalogRepo(
	factories: KnowledgeBaseFactories = DEFAULT_KNOWLEDGE_BASE_FACTORIES,
): Promise<CatalogRepo> {
	const [platform, handle] = await Promise.all([getPlatform(), getKnowledgeBase(factories)]);
	const repo = createCatalogRepo(handle.db);
	if (await repo.isSeeded()) return repo;
	if (platform.mode === "mock") {
		await seedMarketing({ db: handle.db });
		return repo;
	}
	throw new KnowledgeBaseUnavailableError(
		"商品カタログとペルソナが未投入です。`mise run seed:samples` でサンプルデータを投入してから、もう一度実行してください。",
	);
}

// --- Sandbox (plan C13, Req 3.7, 3.8, 3.10) ---

/**
 * Where generated code runs, chosen when first asked. `mock` uses the pseudo provider; elsewhere the
 * E2B key comes first, then a local container, and with neither the analysis is disabled with the
 * reason and what to set up (Req 3.8).
 */
export type SandboxSetup =
	| {
			readonly kind: "e2b" | "docker" | "mock";
			readonly provider: SandboxProvider;
			/** One sandbox per learner session, closed on release or after ten idle minutes. */
			readonly registry: SandboxRegistry;
			/** Stops the idle sweep. */
			readonly stop: () => void;
	  }
	| { readonly kind: "disabled"; readonly reason: string; readonly guidance: string };

export interface SandboxDeps {
	readonly probe: typeof probeDockerEnvironment;
	readonly createE2b: typeof createE2bProvider;
	readonly createDocker: typeof createLocalDockerProvider;
	readonly createMock: typeof createMockSandboxProvider;
	/** How often idle sandboxes are swept. `null` starts no timer (tests). */
	readonly sweepIntervalMs: number | null;
}

const DEFAULT_SANDBOX_DEPS: SandboxDeps = {
	probe: probeDockerEnvironment,
	createE2b: createE2bProvider,
	createDocker: createLocalDockerProvider,
	createMock: createMockSandboxProvider,
	sweepIntervalMs: 60_000,
};

const NO_DOCKER = { reachable: false, imagePresent: false } as const;

function startSweep(registry: SandboxRegistry, intervalMs: number | null): () => void {
	if (intervalMs === null) return () => undefined;
	const timer = setInterval(() => {
		// A failed sweep is tried again at the next tick; it must not stop the timer.
		registry.sweep().catch(() => undefined);
	}, intervalMs);
	// The sweep must not keep the process alive on its own.
	timer.unref?.();
	return () => clearInterval(timer);
}

/** Builds the sandbox setup for this platform. Never throws for a missing key or a missing Docker. */
export async function createSandboxSetup(
	platform: Pick<Platform, "mode" | "config" | "clock">,
	deps: SandboxDeps = DEFAULT_SANDBOX_DEPS,
): Promise<SandboxSetup> {
	const { config } = platform;
	let kind: "e2b" | "docker" | "mock";
	let provider: SandboxProvider;

	if (platform.mode === "mock") {
		kind = "mock";
		provider = deps.createMock();
	} else {
		const e2bKey = config.credentials.e2b;
		// With a key Docker is not consulted, so no socket is touched for nothing.
		const docker = e2bKey
			? NO_DOCKER
			: await deps.probe({ env: { DOCKER_HOST: config.docker.host }, image: config.docker.image });
		const selection = selectSandboxProvider({
			env: { E2B_API_KEY: e2bKey, DOCKER_SANDBOX_IMAGE: config.docker.image },
			dockerProbe: docker,
		});
		if (selection.kind === "disabled") return selection;
		kind = selection.kind;
		provider =
			selection.kind === "e2b"
				? deps.createE2b({ apiKey: e2bKey })
				: deps.createDocker({
						environment: docker,
						image: config.docker.image,
						clock: platform.clock,
						onWarning: (message) => console.warn(message),
					});
	}

	const registry = createSandboxRegistry({
		provider,
		clock: platform.clock,
		idleTimeoutMs: DEFAULT_SANDBOX.idleTimeoutMs,
		maxSessions: DEFAULT_SANDBOX.maxSessions,
	});
	return { kind, provider, registry, stop: startSweep(registry, deps.sweepIntervalMs) };
}

const SANDBOX_KEY = Symbol.for("from-genai-to-agentic-ai.sandbox");

type SandboxHolder = { [SANDBOX_KEY]?: Promise<SandboxSetup> };

function stopSetup(setup: SandboxSetup | undefined): void {
	if (setup && setup.kind !== "disabled") setup.stop();
}

/**
 * The shared sandbox setup, kept on `globalThis` (a Route Handler can be a separate bundle and dev
 * reloads modules, so a module variable would hold a second registry and a second timer: a session
 * made by one route could not be released by another). An enabled setup is built once. A disabled
 * one is not kept, so starting Docker or setting a key takes effect on the next request.
 */
export function getSandboxSelection(
	deps: SandboxDeps = DEFAULT_SANDBOX_DEPS,
): Promise<SandboxSetup> {
	const holder = globalThis as SandboxHolder;
	const existing = holder[SANDBOX_KEY];
	if (existing) return existing;
	const created = getPlatform().then((platform) => createSandboxSetup(platform, deps));
	holder[SANDBOX_KEY] = created;
	created.then(
		(setup) => {
			if (setup.kind === "disabled" && holder[SANDBOX_KEY] === created) delete holder[SANDBOX_KEY];
		},
		() => {
			if (holder[SANDBOX_KEY] === created) delete holder[SANDBOX_KEY];
		},
	);
	return created;
}

/**
 * Forgets the shared setup: the idle sweep stops, every session is closed, and the next request
 * chooses again. Used when the sandbox turned out to be gone after it had been chosen (Docker
 * stopped, for one), so the status shows the truth and the guidance, not a stale `docker`.
 */
export async function invalidateSandboxSelection(): Promise<void> {
	const holder = globalThis as SandboxHolder;
	const previous = holder[SANDBOX_KEY];
	delete holder[SANDBOX_KEY];
	if (!previous) return;
	const setup = await previous.catch(() => undefined);
	if (!setup || setup.kind === "disabled") return;
	setup.stop();
	await setup.registry.closeAll();
}

/** Test seam: installs `setup` as the shared one (stopping the previous sweep), or clears it. */
export function setSandboxForTesting(setup: SandboxSetup | undefined): void {
	const holder = globalThis as SandboxHolder;
	const previous = holder[SANDBOX_KEY];
	if (previous) void previous.then(stopSetup, () => undefined);
	if (setup) holder[SANDBOX_KEY] = Promise.resolve(setup);
	else delete holder[SANDBOX_KEY];
}

// --- arXiv client (plan C13, Req 4.3, 4.7) ---

/**
 * The arXiv client for this platform. `mock` reads the fixture feed and needs no spacing; elsewhere
 * the platform's guarded `HttpFetcher` is used (so `AI_RECORD=1` records arXiv too) and the client
 * keeps arXiv's terms: one connection, three seconds apart, a day-long cache.
 */
export function createArxivClientFor(
	platform: Pick<Platform, "mode" | "ports" | "clock">,
): ArxivClient {
	return platform.mode === "mock"
		? createArxivClient({
				fetcher: createArxivFixtureFetcher(),
				clock: platform.clock,
				options: { minIntervalMs: 0 },
			})
		: createArxivClient({ fetcher: platform.ports.http, clock: platform.clock });
}

const ARXIV_CLIENT_KEY = Symbol.for("from-genai-to-agentic-ai.arxiv-client");

type ArxivClientHolder = { [ARXIV_CLIENT_KEY]?: Promise<ArxivClient> };

/**
 * The shared client, kept on `globalThis` for the reason the platform is: a Route Handler can be a
 * separate bundle and dev reloads modules, and a second client would be a second queue (breaking
 * "one connection") and a second cache. A failed build is not cached.
 */
export function getArxivClient(): Promise<ArxivClient> {
	const holder = globalThis as ArxivClientHolder;
	const existing = holder[ARXIV_CLIENT_KEY];
	if (existing) return existing;
	const created = getPlatform().then(createArxivClientFor);
	holder[ARXIV_CLIENT_KEY] = created;
	created.catch(() => {
		if (holder[ARXIV_CLIENT_KEY] === created) delete holder[ARXIV_CLIENT_KEY];
	});
	return created;
}

/** Test seam: installs `client` as the shared one, or clears it with `undefined`. */
export function setArxivClientForTesting(client: ArxivClient | undefined): void {
	const holder = globalThis as ArxivClientHolder;
	if (client) holder[ARXIV_CLIENT_KEY] = Promise.resolve(client);
	else delete holder[ARXIV_CLIENT_KEY];
}
