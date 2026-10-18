import { EventEmitter } from "node:events";
import { access } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";
import { DEFAULT_SANDBOX } from "@platform/ai-core/config";
import type { McpRegistry, McpServerConfig } from "@platform/ai-core/mcp";
import { defaultRerankModel, ModelSelectionError } from "@platform/ai-core/models";
import type {
	HttpFetcher,
	SandboxProvider,
	TranscriptSource,
	WebSearchProvider,
} from "@platform/ai-core/ports";
import { createFakeClock, createNodeHttpFetcher } from "@platform/ai-core/ports";
import { KnowledgeBaseUnavailableError, type RagDatabaseHandle } from "@platform/ai-core/rag";
import { createMockSandboxProvider } from "@platform/ai-core/sandbox";
import { ARTICLE_FETCH_LIMITS, SourceFetchError } from "@platform/ai-core/summarize";
import { describe, expect, it, vi } from "vitest";
import {
	createGuardedFetch,
	createKnowledgeBase,
	createMcpRegistry,
	createPlatform,
	getHelpdeskStore,
	getKnowledgeBase,
	getMcpRegistry,
	getPlatform,
	getSandboxSelection,
	type HttpRequestFunction,
	invalidateSandboxSelection,
	type KnowledgeBaseFactories,
	mcpServerConfigs,
	resolveKnowledgeEmbedding,
	type SandboxDeps,
	setKnowledgeBaseForTesting,
	setMcpRegistryForTesting,
	setPlatformForTesting,
	setSandboxForTesting,
} from "./platform";

const MOCK_ENV = { VITEST: "1", AI_TEST_RUN_MODE: "mock" } as const;
const LOCAL_ENV = { VITEST: "1", AI_TEST_RUN_MODE: "local" } as const;

// --- A fake of node:http(s).request that follows the real lookup contract ---

interface FakeResponse {
	readonly status: number;
	readonly headers?: Record<string, string | string[]>;
	readonly chunks: readonly (string | Uint8Array)[];
}

interface FakeTransport {
	readonly request: HttpRequestFunction;
	/** Addresses a "connection" was opened to (the lookup result, or an IP literal). */
	readonly connections: string[];
	/** Chunks the consumer pulled from the response body. */
	readonly pulled: { count: number };
}

function fakeTransport(respond: (address: string) => FakeResponse): FakeTransport {
	const connections: string[] = [];
	const pulled = { count: 0 };
	const request: HttpRequestFunction = (url, options, onResponse) => {
		const emitter = new EventEmitter() as EventEmitter & {
			end(): void;
			destroy(error?: Error): void;
			write(): boolean;
		};
		const deliver = (address: string): void => {
			connections.push(address);
			const scripted = respond(address);
			const stream = Readable.from(
				(async function* () {
					for (const chunk of scripted.chunks) {
						pulled.count += 1;
						yield typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk);
					}
				})(),
			);
			Object.assign(stream, { statusCode: scripted.status, headers: scripted.headers ?? {} });
			onResponse(stream as never);
		};
		emitter.write = () => true;
		emitter.destroy = (error) => {
			if (error) queueMicrotask(() => emitter.emit("error", error));
		};
		emitter.end = () => {
			const hostname = url.hostname.replace(/^\[|\]$/gu, "");
			if (/^[\d.]+$/u.test(hostname) || hostname.includes(":")) {
				deliver(hostname);
				return;
			}
			options.lookup?.(hostname, {}, (error, address) => {
				if (error) {
					// Real node:http emits the lookup error on the request unchanged.
					emitter.emit("error", error);
					return;
				}
				deliver(address as string);
			});
		};
		return emitter as never;
	};
	return { request, connections, pulled };
}

function resolverTo(...answers: string[][]) {
	let call = 0;
	return vi.fn(async (_hostname: string): Promise<readonly string[]> => {
		const answer = answers[Math.min(call, answers.length - 1)] ?? [];
		call += 1;
		return answer;
	});
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
	try {
		await promise;
	} catch (error) {
		return error;
	}
	throw new Error("expected the promise to reject");
}

const OK_BODY: FakeResponse = { status: 200, headers: {}, chunks: ["ok"] };

// --- assembly ---

describe("createPlatform in mock mode", () => {
	it("assembles config, gateway, fixture ports, clock, limiter and tool runtime from the config", async () => {
		const platform = await createPlatform({
			env: { ...MOCK_ENV, AGENT_TOOL_TIMEOUT_MS: "1234", CHAT_RATE_LIMIT_MAX: "2" },
		});

		expect(platform.mode).toBe("mock");
		expect(platform.config.mode).toBe("mock");
		expect(platform.toolRuntime).toEqual({ clock: platform.clock, toolTimeoutMs: 1234 });
		const resolved = await platform.gateway.resolve({ purpose: "chat" });
		expect(resolved.mode).toBe("mock");

		// The fixture HttpFetcher serves recorded pages and never touches the network.
		const article = await platform.ports.http.fetch("https://example.test/articles/agentic-ai");
		expect(article.status).toBe(200);
		expect(article.body).toContain("Agentic AI");
		await expect(platform.ports.webSearch.search("anything-unrecorded")).rejects.toThrow();
		await expect(platform.ports.transcript.fetchTranscript("unrecorded-id")).rejects.toThrow();

		// One shared limiter built from CHAT_RATE_LIMIT_*.
		expect(platform.limiter.check()).toEqual({ allowed: true });
		expect(platform.limiter.check()).toEqual({ allowed: true });
		expect(platform.limiter.check().allowed).toBe(false);
	});

	it("uses the injected clock for the tool runtime, the limiter and the gateway", async () => {
		const clock = createFakeClock(1_000);
		const platform = await createPlatform({
			env: { ...MOCK_ENV, CHAT_RATE_LIMIT_MAX: "1", CHAT_RATE_LIMIT_WINDOW_SECONDS: "10" },
			clock,
		});

		expect(platform.clock).toBe(clock);
		expect(platform.toolRuntime.clock).toBe(clock);
		expect(platform.limiter.check().allowed).toBe(true);
		expect(platform.limiter.check().allowed).toBe(false);
		clock.advanceBy(10_000);
		expect(platform.limiter.check().allowed).toBe(true);
	});

	it("rejects an invalid configuration with ConfigError instead of building a platform", async () => {
		await expect(createPlatform({ env: { ...MOCK_ENV, AGENT_MAX_STEPS: "zero" } })).rejects.toThrow(
			/環境変数/u,
		);
	});
});

describe("createPlatform ports outside mock mode", () => {
	const inner = {
		http: {
			fetch: vi.fn(async () => ({ status: 200, headers: {}, body: "<p>live</p>" })),
		} satisfies HttpFetcher,
		transcript: {
			fetchTranscript: vi.fn(async (videoId: string) => ({ videoId, segments: [] })),
		} as unknown as TranscriptSource,
		webSearch: { search: vi.fn(async () => []) } satisfies WebSearchProvider,
	};

	it("uses the production ports unchanged when AI_RECORD is not set", async () => {
		const store = { put: vi.fn() };
		const platform = await createPlatform({
			env: LOCAL_ENV,
			productionPorts: inner,
			recording: { store },
		});

		expect(platform.ports.http).toBe(inner.http);
		expect(platform.ports.transcript).toBe(inner.transcript);
		expect(platform.ports.webSearch).toBe(inner.webSearch);
		expect(store.put).not.toHaveBeenCalled();
	});

	it("wraps all three ports in recording wrappers when AI_RECORD=1", async () => {
		const store = { put: vi.fn() };
		const platform = await createPlatform({
			env: { ...LOCAL_ENV, AI_RECORD: "1", TAVILY_API_KEY: "tvly-secret-value-0123" },
			productionPorts: inner,
			recording: { store },
		});

		expect(platform.ports.http).not.toBe(inner.http);
		await platform.ports.http.fetch("https://example.com/a?api_key=tvly-secret-value-0123");
		await platform.ports.transcript.fetchTranscript("abc");
		await platform.ports.webSearch.search("q tvly-secret-value-0123");

		const keys = store.put.mock.calls.map(([key]) => String(key).split("/")[0]);
		expect(keys).toEqual(["http", "transcripts", "web-search"]);
		expect(JSON.stringify(store.put.mock.calls)).not.toContain("tvly-secret-value-0123");
	});

	it("never builds recording wrappers in mock mode", async () => {
		const store = { put: vi.fn() };
		const platform = await createPlatform({ env: MOCK_ENV, recording: { store } });
		await platform.ports.http.fetch("https://example.test/articles/agentic-ai");
		expect(store.put).not.toHaveBeenCalled();
	});

	it("builds a web search provider that fails closed when no Tavily key is configured", async () => {
		// A store that discards writes keeps a recording bug from touching the real fixtures.
		const platform = await createPlatform({
			env: LOCAL_ENV,
			recording: { store: { put: vi.fn() } },
		});
		const error = await rejection(platform.ports.webSearch.search("q"));
		expect(error).toMatchObject({ code: "source-unavailable" });
	});
});

// --- guarded fetch: connect-time DNS check ---

describe("createGuardedFetch connect-time address check", () => {
	const blocked = ["127.0.0.1", "169.254.169.254", "::1", "::ffff:10.0.0.1"];

	it.each(blocked)("refuses a public name that resolves to %s as disallowed-url", async (ip) => {
		const transport = fakeTransport(() => OK_BODY);
		const fetcher = createNodeHttpFetcher(
			createGuardedFetch({ resolve: resolverTo([ip]), request: transport.request }),
		);

		const error = await rejection(fetcher.fetch("http://news.example.com/a"));

		expect(error).toBeInstanceOf(SourceFetchError);
		expect(error).toMatchObject({ reason: "disallowed-url" });
		expect(transport.connections).toEqual([]);
	});

	it("refuses when any of several resolved addresses is internal", async () => {
		const transport = fakeTransport(() => OK_BODY);
		const guarded = createGuardedFetch({
			resolve: resolverTo(["93.184.216.34", "10.0.0.5"]),
			request: transport.request,
		});
		await expect(guarded("http://news.example.com/a")).rejects.toMatchObject({
			reason: "disallowed-url",
		});
		expect(transport.connections).toEqual([]);
	});

	it("converts a disallowed-url hidden in an Error cause chain (undici-style) instead of network", async () => {
		const wrapped = new TypeError("fetch failed", {
			cause: new SourceFetchError("disallowed-url"),
		});
		const request: HttpRequestFunction = () => {
			const emitter = new EventEmitter() as never as ReturnType<HttpRequestFunction>;
			Object.assign(emitter, {
				write: () => true,
				destroy: () => undefined,
				end: () => queueMicrotask(() => emitter.emit("error", wrapped)),
			});
			return emitter;
		};
		const guarded = createGuardedFetch({ resolve: resolverTo(["93.184.216.34"]), request });
		await expect(guarded("http://news.example.com/a")).rejects.toMatchObject({
			reason: "disallowed-url",
		});
	});

	it("passes a name that resolves to a public IPv6 address (2606:4700::1111)", async () => {
		const transport = fakeTransport(() => OK_BODY);
		const fetcher = createNodeHttpFetcher(
			createGuardedFetch({ resolve: resolverTo(["2606:4700::1111"]), request: transport.request }),
		);

		const response = await fetcher.fetch("https://news.example.com/a");

		expect(response).toMatchObject({ status: 200, body: "ok" });
		expect(transport.connections).toEqual(["2606:4700::1111"]);
	});

	it("connects only to the address it validated: a rebinding resolver cannot reach an internal IP", async () => {
		const transport = fakeTransport(() => OK_BODY);
		// Answers: 1st lookup public, 2nd lookup internal. One lookup per connection, so the
		// address that was checked is the address that is connected to.
		const resolve = resolverTo(["93.184.216.34"], ["169.254.169.254"]);
		const guarded = createGuardedFetch({ resolve, request: transport.request });

		await guarded("http://rebind.example.com/first");
		const second = await rejection(guarded("http://rebind.example.com/second"));

		expect(second).toMatchObject({ reason: "disallowed-url" });
		expect(resolve).toHaveBeenCalledTimes(2);
		expect(transport.connections).toEqual(["93.184.216.34"]);
	});

	it("checks an IP-literal URL without resolving (defence in depth)", async () => {
		const transport = fakeTransport(() => OK_BODY);
		const resolve = resolverTo(["93.184.216.34"]);
		const guarded = createGuardedFetch({ resolve, request: transport.request });

		await expect(guarded("http://[::ffff:10.0.0.1]/a")).rejects.toMatchObject({
			reason: "disallowed-url",
		});
		await expect(guarded("http://0x7f.1/a")).rejects.toMatchObject({ reason: "disallowed-url" });
		expect(resolve).not.toHaveBeenCalled();
		expect(transport.connections).toEqual([]);
	});

	it("returns an address for the `all` lookup form as well", async () => {
		const guarded = createGuardedFetch({
			resolve: resolverTo(["93.184.216.34", "2606:4700::1111"]),
			request: (_url, options, onResponse) => {
				const emitter = new EventEmitter() as never as ReturnType<HttpRequestFunction>;
				Object.assign(emitter, {
					write: () => true,
					destroy: () => undefined,
					end: () =>
						options.lookup?.("news.example.com", { all: true }, (error, addresses) => {
							expect(error).toBeNull();
							expect(addresses).toEqual([
								{ address: "93.184.216.34", family: 4 },
								{ address: "2606:4700::1111", family: 6 },
							]);
							const stream = Readable.from([Buffer.from("ok")]);
							Object.assign(stream, { statusCode: 200, headers: {} });
							onResponse(stream as never);
						}),
				});
				return emitter;
			},
		});
		expect((await guarded("http://news.example.com/")).status).toBe(200);
	});
});

// --- guarded fetch: body limits ---

describe("createGuardedFetch body limits", () => {
	const max = ARTICLE_FETCH_LIMITS.maxBodyBytes;
	const publicIp = ["93.184.216.34"];

	it("accepts a body of exactly maxBodyBytes", async () => {
		const transport = fakeTransport(() => ({
			status: 200,
			chunks: ["a".repeat(max / 2), "a".repeat(max / 2)],
		}));
		const fetcher = createNodeHttpFetcher(
			createGuardedFetch({ resolve: resolverTo(publicIp), request: transport.request }),
		);
		const response = await fetcher.fetch("https://news.example.com/big");
		expect(response.body).toHaveLength(max);
	});

	it("aborts with too-large at one byte over maxBodyBytes and stops reading", async () => {
		const transport = fakeTransport(() => ({
			status: 200,
			chunks: ["a".repeat(max), "b", "never-read", "never-read-either"],
		}));
		const fetcher = createNodeHttpFetcher(
			createGuardedFetch({ resolve: resolverTo(publicIp), request: transport.request }),
		);

		const error = await rejection(fetcher.fetch("https://news.example.com/big"));

		expect(error).toBeInstanceOf(SourceFetchError);
		expect(error).toMatchObject({ reason: "too-large" });
		expect(transport.pulled.count).toBeLessThan(4);
	});

	it("counts bytes, not characters", async () => {
		// 3 bytes per "あ": 1,747,627 of them are 5,242,881 bytes, one over the limit.
		const transport = fakeTransport(() => ({ status: 200, chunks: ["あ".repeat(1_747_627)] }));
		const fetcher = createNodeHttpFetcher(
			createGuardedFetch({ resolve: resolverTo(publicIp), request: transport.request }),
		);
		await expect(fetcher.fetch("https://news.example.com/big")).rejects.toMatchObject({
			reason: "too-large",
		});
	});

	it("does not read the body when Content-Length is over the limit", async () => {
		const transport = fakeTransport(() => ({
			status: 200,
			headers: { "content-length": String(max + 1) },
			chunks: ["a", "b", "c"],
		}));
		const fetcher = createNodeHttpFetcher(
			createGuardedFetch({ resolve: resolverTo(publicIp), request: transport.request }),
		);

		await expect(fetcher.fetch("https://news.example.com/big")).rejects.toMatchObject({
			reason: "too-large",
		});
		expect(transport.pulled.count).toBe(0);
	});

	it("limits the decompressed size of an encoded body", async () => {
		const bomb = gzipSync(Buffer.alloc(max + 1, 97));
		const transport = fakeTransport(() => ({
			status: 200,
			headers: { "content-encoding": "gzip" },
			chunks: [bomb],
		}));
		const fetcher = createNodeHttpFetcher(
			createGuardedFetch({ resolve: resolverTo(publicIp), request: transport.request }),
		);
		await expect(fetcher.fetch("https://news.example.com/bomb")).rejects.toMatchObject({
			reason: "too-large",
		});
	});

	it("returns redirects unfollowed so the caller can check every location", async () => {
		const transport = fakeTransport(() => ({
			status: 302,
			headers: { location: "http://169.254.169.254/latest" },
			chunks: [],
		}));
		const fetcher = createNodeHttpFetcher(
			createGuardedFetch({ resolve: resolverTo(publicIp), request: transport.request }),
		);
		const response = await fetcher.fetch("https://news.example.com/r", { redirect: "manual" });
		expect(response.status).toBe(302);
		expect(response.headers.location).toBe("http://169.254.169.254/latest");
		expect(transport.connections).toEqual(publicIp);
	});

	it("rejects a non-http(s) URL as disallowed-url", async () => {
		const transport = fakeTransport(() => OK_BODY);
		const guarded = createGuardedFetch({
			resolve: resolverTo(publicIp),
			request: transport.request,
		});
		await expect(guarded("ftp://news.example.com/a")).rejects.toMatchObject({
			reason: "disallowed-url",
		});
	});
});

// --- singleton ---

describe("getPlatform", () => {
	it("caches the assembled platform until it is reset", async () => {
		const first = await createPlatform({ env: MOCK_ENV });
		setPlatformForTesting(first);
		expect(await getPlatform()).toBe(first);
		expect(await getPlatform()).toBe(first);
		setPlatformForTesting(undefined);
		setPlatformForTesting(await createPlatform({ env: MOCK_ENV }));
		expect(await getPlatform()).not.toBe(first);
		setPlatformForTesting(undefined);
	});
});

// --- knowledge base (plan C13, Req 1.1) ---

function fakeHandle(kind: RagDatabaseHandle["kind"]): RagDatabaseHandle & { closed: number } {
	const handle = {
		db: {} as RagDatabaseHandle["db"],
		kind,
		closed: 0,
		async close() {
			handle.closed += 1;
		},
	};
	return handle;
}

function fakeFactories(overrides: Partial<KnowledgeBaseFactories> = {}) {
	const calls = { pglite: 0, postgres: [] as unknown[] };
	const factories: KnowledgeBaseFactories = {
		pglite: async () => {
			calls.pglite += 1;
			return fakeHandle("pglite");
		},
		postgres: async (config) => {
			calls.postgres.push(config);
			return fakeHandle("postgres");
		},
		...overrides,
	};
	return { factories, calls };
}

describe("knowledgeRoots", () => {
	it("are absolute paths to the learner's knowledge/ and the evaluation corpus", async () => {
		const { knowledgeRoots } = await createPlatform({ env: MOCK_ENV });

		expect(path.isAbsolute(knowledgeRoots.knowledge)).toBe(true);
		expect(path.isAbsolute(knowledgeRoots.evalCorpus)).toBe(true);
		expect(knowledgeRoots.knowledge.endsWith(`${path.sep}knowledge`)).toBe(true);
		expect(
			knowledgeRoots.evalCorpus.endsWith(
				path.join("packages", "ai-core", "fixtures", "rag", "corpus"),
			),
		).toBe(true);
		// The tracked README proves the path points at the repository's knowledge/ directory.
		await expect(access(path.join(knowledgeRoots.knowledge, "README.md"))).resolves.toBeUndefined();
	});

	it("do not depend on the working directory", async () => {
		const original = process.cwd();
		const before = (await createPlatform({ env: MOCK_ENV })).knowledgeRoots;
		process.chdir(path.dirname(original));
		try {
			expect((await createPlatform({ env: MOCK_ENV })).knowledgeRoots).toEqual(before);
		} finally {
			process.chdir(original);
		}
	});

	it("can be replaced for tests", async () => {
		const roots = { knowledge: "/tmp/k", evalCorpus: "/tmp/e" };

		expect((await createPlatform({ env: MOCK_ENV, knowledgeRoots: roots })).knowledgeRoots).toEqual(
			roots,
		);
	});
});

describe("createKnowledgeBase", () => {
	it("uses in-memory PGlite in mock mode and does not touch Postgres", async () => {
		const platform = await createPlatform({ env: MOCK_ENV });
		const { factories, calls } = fakeFactories();

		const handle = await createKnowledgeBase(platform, factories);

		expect(handle.kind).toBe("pglite");
		expect(calls).toEqual({ pglite: 1, postgres: [] });
	});

	it.each([
		["local", LOCAL_ENV],
		[
			"live",
			{
				VITEST: "1",
				AI_TEST_RUN_MODE: "live",
				AI_LIVE_PROVIDER: "openai",
				OPENAI_API_KEY: "test-key",
			},
		],
	] as const)("connects to Postgres with the configured database in %s mode", async (_, env) => {
		const platform = await createPlatform({ env: { ...env, POSTGRES_PORT: "5544" } });
		const { factories, calls } = fakeFactories();

		const handle = await createKnowledgeBase(platform, factories);

		expect(handle.kind).toBe("postgres");
		expect(calls.pglite).toBe(0);
		expect(calls.postgres).toEqual([platform.config.database]);
		expect(platform.config.database.port).toBe(5544);
	});

	it("propagates provider-unavailable when Postgres cannot be reached", async () => {
		const platform = await createPlatform({ env: LOCAL_ENV });
		const { factories } = fakeFactories({
			postgres: async () => {
				throw new KnowledgeBaseUnavailableError();
			},
		});

		await expect(createKnowledgeBase(platform, factories)).rejects.toMatchObject({
			code: "provider-unavailable",
		});
	});
});

describe("getKnowledgeBase", () => {
	async function withPlatform(env: Record<string, string>) {
		setPlatformForTesting(await createPlatform({ env }));
		setKnowledgeBaseForTesting(undefined);
	}

	it("builds the handle once, even for concurrent callers", async () => {
		await withPlatform(MOCK_ENV);
		const { factories, calls } = fakeFactories();
		try {
			const [first, second] = await Promise.all([
				getKnowledgeBase(factories),
				getKnowledgeBase(factories),
			]);
			const third = await getKnowledgeBase(factories);

			expect(second).toBe(first);
			expect(third).toBe(first);
			expect(calls.pglite).toBe(1);
		} finally {
			setKnowledgeBaseForTesting(undefined);
			setPlatformForTesting(undefined);
		}
	});

	it("builds a real in-memory PGlite database in mock mode", async () => {
		await withPlatform(MOCK_ENV);
		try {
			const handle = await getKnowledgeBase();

			expect(handle.kind).toBe("pglite");
			expect(await getKnowledgeBase()).toBe(handle);
			await handle.close();
		} finally {
			setKnowledgeBaseForTesting(undefined);
			setPlatformForTesting(undefined);
		}
		// Starting PGlite takes seconds when the gate runs every workspace at once.
	}, 30_000);

	it("does not cache a failure: the next call tries again", async () => {
		await withPlatform(LOCAL_ENV);
		let attempts = 0;
		const { factories } = fakeFactories({
			postgres: async () => {
				attempts += 1;
				if (attempts === 1) throw new KnowledgeBaseUnavailableError();
				return fakeHandle("postgres");
			},
		});
		try {
			await expect(getKnowledgeBase(factories)).rejects.toBeInstanceOf(
				KnowledgeBaseUnavailableError,
			);

			const handle = await getKnowledgeBase(factories);

			expect(handle.kind).toBe("postgres");
			expect(attempts).toBe(2);
		} finally {
			setKnowledgeBaseForTesting(undefined);
			setPlatformForTesting(undefined);
		}
	});
});

describe("createPlatform rerank port (CL-6)", () => {
	const inner = {
		http: { fetch: vi.fn() } as unknown as HttpFetcher,
		transcript: { fetchTranscript: vi.fn() } as unknown as TranscriptSource,
		webSearch: { search: vi.fn() } as unknown as WebSearchProvider,
	};

	it("uses the deterministic pseudo implementation in mock mode, without any key", async () => {
		const platform = await createPlatform({ env: MOCK_ENV });

		expect(platform.ports.rerank?.modelId).toMatch(/mock/iu);
		const ranked = await platform.ports.rerank?.rerank(
			"検索",
			[
				{ id: "a", text: "無関係" },
				{ id: "b", text: "検索の話" },
			],
			{ topN: 1 },
		);
		expect(ranked?.map((row) => row.id)).toEqual(["b"]);
	});

	it("ignores a Cohere key in mock mode (the pseudo implementation stays)", async () => {
		const platform = await createPlatform({ env: { ...MOCK_ENV, COHERE_API_KEY: "co-test-key" } });

		expect(platform.ports.rerank?.modelId).toMatch(/mock/iu);
	});

	it("has no Rerank provider outside mock mode when COHERE_API_KEY is not set", async () => {
		const platform = await createPlatform({ env: LOCAL_ENV, productionPorts: inner });

		expect(platform.ports.rerank).toBeUndefined();
	});

	it("treats an empty COHERE_API_KEY as not set", async () => {
		const platform = await createPlatform({
			env: { ...LOCAL_ENV, COHERE_API_KEY: "" },
			productionPorts: inner,
		});

		expect(platform.ports.rerank).toBeUndefined();
	});

	it("builds the Cohere provider outside mock mode when the key is set, without connecting", async () => {
		const platform = await createPlatform({
			env: { ...LOCAL_ENV, COHERE_API_KEY: "co-test-key" },
			productionPorts: inner,
		});

		expect(platform.ports.rerank?.modelId).toBe(defaultRerankModel().id);
	});

	it("does not record the Rerank provider when AI_RECORD=1", async () => {
		const store = { put: vi.fn() };
		const platform = await createPlatform({
			env: { ...LOCAL_ENV, AI_RECORD: "1", COHERE_API_KEY: "co-test-key" },
			productionPorts: inner,
			recording: { store },
		});

		expect(platform.ports.rerank?.modelId).toBe(defaultRerankModel().id);
		expect(store.put).not.toHaveBeenCalled();
	});
});

describe("resolveKnowledgeEmbedding", () => {
	it("returns the embedding model the gateway resolves", async () => {
		const platform = await createPlatform({ env: MOCK_ENV });

		const resolved = await resolveKnowledgeEmbedding(platform);

		expect(resolved.entry.id).toBe("mock:embedding-v1");
	});

	it("explains AI_MODEL_EMBEDDING as an invalid request when the provider has no default", async () => {
		const platform = await createPlatform({ env: MOCK_ENV });
		const noDefault = new ModelSelectionError({
			reason: "no-default",
			mode: "live",
			provider: "anthropic",
			purpose: "chat",
		});
		const gateway = {
			...platform.gateway,
			resolveEmbedding: async () => Promise.reject(noDefault),
		};

		await expect(resolveKnowledgeEmbedding({ gateway: gateway as never })).rejects.toMatchObject({
			code: "invalid-request",
			message: expect.stringContaining("AI_MODEL_EMBEDDING"),
		});
	});

	it("rethrows any other failure unchanged", async () => {
		const failure = new Error("boom");
		const gateway = { resolveEmbedding: async () => Promise.reject(failure) };

		await expect(resolveKnowledgeEmbedding({ gateway: gateway as never })).rejects.toBe(failure);
	});
});

describe("mcpServerConfigs (plan C13, Req 1.7, 1.9)", () => {
	const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");
	const TOKEN = "ghp_test-token-for-platform";

	async function configsFor(env: Record<string, string>): Promise<readonly McpServerConfig[]> {
		return mcpServerConfigs(await createPlatform({ env }));
	}

	it("offers only the platform's own file server in mock mode, even when a GitHub token is set", async () => {
		const configs = await configsFor({ ...MOCK_ENV, GITHUB_TOKEN: TOKEN });

		expect(configs.map((config) => config.id)).toEqual(["files"]);
	});

	it("adds the GitHub server outside mock mode only when GITHUB_TOKEN is set", async () => {
		const without = await configsFor(LOCAL_ENV);
		const withToken = await configsFor({ ...LOCAL_ENV, GITHUB_TOKEN: TOKEN });

		expect(without.map((config) => config.id)).toEqual(["files"]);
		expect(withToken.map((config) => config.id)).toEqual(["files", "github"]);
	});

	it("starts the file server from the repository's own source with the default allowed root", async () => {
		const [files] = await configsFor(MOCK_ENV);

		if (files?.transport.kind !== "stdio") throw new Error("expected stdio");
		expect(files.transport.args).toEqual([
			path.join(REPO_ROOT, "packages", "ai-core", "src", "files", "stdio.ts"),
		]);
		expect(files.transport.env.MCP_FS_ROOT).toBe(path.join(REPO_ROOT, "workspace"));
		expect(files.trustErrorMeta).toBe(true);
	});

	it("resolves a relative MCP_FS_ROOT against the repository root, not the working directory", async () => {
		const [files] = await configsFor({ ...MOCK_ENV, MCP_FS_ROOT: "notes/area" });

		if (files?.transport.kind !== "stdio") throw new Error("expected stdio");
		expect(files.transport.env.MCP_FS_ROOT).toBe(path.join(REPO_ROOT, "notes", "area"));
	});

	it("keeps an absolute MCP_FS_ROOT as it is", async () => {
		const [files] = await configsFor({ ...MOCK_ENV, MCP_FS_ROOT: "/srv/learner-files" });

		if (files?.transport.kind !== "stdio") throw new Error("expected stdio");
		expect(files.transport.env.MCP_FS_ROOT).toBe("/srv/learner-files");
	});

	it("keeps the token out of every config but the GitHub Authorization header", async () => {
		const configs = await configsFor({ ...LOCAL_ENV, GITHUB_TOKEN: TOKEN });
		const [files, github] = configs;

		expect(JSON.stringify(files)).not.toContain(TOKEN);
		if (github?.transport.kind !== "http") throw new Error("expected http");
		expect(github.transport.headers.Authorization).toBe(`Bearer ${TOKEN}`);
	});
});

describe("createMcpRegistry and getMcpRegistry", () => {
	function fakeRegistry(): McpRegistry {
		return { status: () => [], toolsFor: () => [], close: async () => undefined };
	}

	it("connects to the configured servers with the platform's clock", async () => {
		const platform = await createPlatform({ env: MOCK_ENV });
		const registry = fakeRegistry();
		const connect = vi.fn(async () => registry);

		const created = await createMcpRegistry(platform, { connect });

		expect(created).toBe(registry);
		expect(connect).toHaveBeenCalledTimes(1);
		const [configs, options] = connect.mock.calls[0] as unknown as [
			readonly McpServerConfig[],
			{ clock: unknown },
		];
		expect(configs.map((config) => config.id)).toEqual(["files"]);
		expect(options.clock).toBe(platform.clock);
	});

	it("reports a failure to prepare the connections as provider-unavailable", async () => {
		const platform = await createPlatform({ env: MOCK_ENV });
		const connect = vi.fn(async () => {
			throw new Error("secret detail ghp_leak");
		});

		const failure = await createMcpRegistry(platform, { connect }).catch((error: unknown) => error);

		expect(failure).toMatchObject({ code: "provider-unavailable" });
		expect(String((failure as Error).message)).not.toContain("ghp_leak");
	});

	it("builds the registry once, even for concurrent callers, and does not cache a failure", async () => {
		setPlatformForTesting(await createPlatform({ env: MOCK_ENV }));
		setMcpRegistryForTesting(undefined);
		const registry = fakeRegistry();
		let attempts = 0;
		const connect = vi.fn(async () => {
			attempts += 1;
			if (attempts === 1) throw new Error("first attempt fails");
			return registry;
		});
		try {
			await expect(getMcpRegistry({ connect })).rejects.toMatchObject({
				code: "provider-unavailable",
			});

			const [first, second] = await Promise.all([
				getMcpRegistry({ connect }),
				getMcpRegistry({ connect }),
			]);

			expect(first).toBe(registry);
			expect(second).toBe(registry);
			expect(attempts).toBe(2);
		} finally {
			setMcpRegistryForTesting(undefined);
			setPlatformForTesting(undefined);
		}
	});
});

describe("getHelpdeskStore (plan C13, Req 2.6, 2.7)", () => {
	async function withPlatform(env: Record<string, string>) {
		setPlatformForTesting(
			await createPlatform({ env, clock: createFakeClock(Date.parse("2026-10-18T00:00:00.000Z")) }),
		);
		setKnowledgeBaseForTesting(undefined);
	}

	it("stores tickets in the shared knowledge-base database with the platform clock", async () => {
		await withPlatform(MOCK_ENV);
		try {
			const store = await getHelpdeskStore();

			const ticket = await store.create({ inquiry: "VPN に接続できません" });
			const handle = await getKnowledgeBase();

			expect(ticket).toMatchObject({ id: "T-0001", status: "open" });
			expect(ticket.createdAt).toEqual(new Date("2026-10-18T00:00:00.000Z"));
			expect(await (await getHelpdeskStore()).get("T-0001")).toEqual(ticket);
			expect(handle.kind).toBe("pglite");
			await handle.close();
		} finally {
			setKnowledgeBaseForTesting(undefined);
			setPlatformForTesting(undefined);
		}
		// Starting PGlite takes seconds when the gate runs every workspace at once.
	}, 30_000);

	it("reports an unreachable database as provider-unavailable with the start-up guidance, and tries again next time", async () => {
		await withPlatform(LOCAL_ENV);
		let attempts = 0;
		const { factories } = fakeFactories({
			postgres: async () => {
				attempts += 1;
				throw new KnowledgeBaseUnavailableError();
			},
		});
		try {
			const failure = await getHelpdeskStore(factories).catch((error: unknown) => error);

			expect(failure).toBeInstanceOf(KnowledgeBaseUnavailableError);
			expect(failure).toMatchObject({ code: "provider-unavailable" });
			expect((failure as Error).message).toMatch(/services:up:db/);
			await getHelpdeskStore(factories).catch(() => undefined);
			expect(attempts).toBe(2);
		} finally {
			setKnowledgeBaseForTesting(undefined);
			setPlatformForTesting(undefined);
		}
	});
});

describe("getSandboxSelection (plan C13, Req 3.7, 3.8, 3.10)", () => {
	const E2B_ENV = { ...LOCAL_ENV, E2B_API_KEY: "changeme-e2b" } as const;
	const READY = { reachable: true, imagePresent: true } as const;
	const DOWN = { reachable: false, imagePresent: false } as const;

	function fakeDeps(overrides: Partial<SandboxDeps> = {}) {
		const created: string[] = [];
		const deps: SandboxDeps = {
			probe: vi.fn(async () => DOWN),
			createE2b: vi.fn((params) => {
				created.push(`e2b:${params.apiKey}`);
				return {
					...createMockSandboxProvider(),
					kind: "e2b" as const,
				} as unknown as SandboxProvider;
			}),
			createDocker: vi.fn((params) => {
				created.push(`docker:${params.image}`);
				return {
					...createMockSandboxProvider(),
					kind: "docker" as const,
				} as unknown as SandboxProvider;
			}),
			createMock: vi.fn(() => {
				created.push("mock");
				return createMockSandboxProvider();
			}),
			sweepIntervalMs: null,
			...overrides,
		};
		return { deps, created };
	}

	async function withPlatform(env: Record<string, string>, clock = createFakeClock(1_000)) {
		setPlatformForTesting(await createPlatform({ env, clock }));
		setSandboxForTesting(undefined);
		return clock;
	}

	function cleanup() {
		setSandboxForTesting(undefined);
		setPlatformForTesting(undefined);
	}

	it("uses the pseudo provider in mock mode, without looking at Docker", async () => {
		await withPlatform(MOCK_ENV);
		const { deps, created } = fakeDeps();
		try {
			const setup = await getSandboxSelection(deps);

			expect(setup.kind).toBe("mock");
			if (setup.kind === "disabled") throw new Error("expected an enabled setup");
			expect(setup.provider.kind).toBe("mock");
			expect(created).toEqual(["mock"]);
			expect(deps.probe).not.toHaveBeenCalled();
		} finally {
			cleanup();
		}
	});

	it("prefers E2B when a key is set, and does not probe Docker", async () => {
		await withPlatform(E2B_ENV);
		const { deps, created } = fakeDeps({ probe: vi.fn(async () => READY) });
		try {
			const setup = await getSandboxSelection(deps);

			expect(setup.kind).toBe("e2b");
			expect(created).toEqual(["e2b:changeme-e2b"]);
			expect(deps.probe).not.toHaveBeenCalled();
		} finally {
			cleanup();
		}
	});

	it("uses the local container when there is no key and Docker has the image", async () => {
		await withPlatform({
			...LOCAL_ENV,
			DOCKER_HOST: "unix:///custom/engine.sock",
			DOCKER_SANDBOX_IMAGE: "my-sandbox:1",
		});
		const { deps, created } = fakeDeps({ probe: vi.fn(async () => READY) });
		try {
			const setup = await getSandboxSelection(deps);

			expect(setup.kind).toBe("docker");
			expect(created).toEqual(["docker:my-sandbox:1"]);
			expect(deps.probe).toHaveBeenCalledWith(
				expect.objectContaining({
					image: "my-sandbox:1",
					env: { DOCKER_HOST: "unix:///custom/engine.sock" },
				}),
			);
			expect(deps.createDocker).toHaveBeenCalledWith(
				expect.objectContaining({ environment: READY }),
			);
		} finally {
			cleanup();
		}
	});

	it("is disabled with the reason and the guidance when neither a key nor a container is available", async () => {
		await withPlatform(LOCAL_ENV);
		const { deps, created } = fakeDeps();
		try {
			const setup = await getSandboxSelection(deps);

			expect(setup.kind).toBe("disabled");
			if (setup.kind !== "disabled") throw new Error("expected disabled");
			expect(setup.reason).toContain("E2B_API_KEY");
			expect(setup.guidance).toContain("E2B_API_KEY");
			expect(setup.guidance).toContain("mise run sandbox:build");
			expect(created).toEqual([]);
		} finally {
			cleanup();
		}
	});

	it("looks again each time while disabled, so starting Docker takes effect without a restart", async () => {
		await withPlatform(LOCAL_ENV);
		let ready = false;
		const { deps } = fakeDeps({ probe: vi.fn(async () => (ready ? READY : DOWN)) });
		try {
			expect((await getSandboxSelection(deps)).kind).toBe("disabled");
			ready = true;
			expect((await getSandboxSelection(deps)).kind).toBe("docker");
			expect(deps.probe).toHaveBeenCalledTimes(2);
		} finally {
			cleanup();
		}
	});

	it("builds an enabled setup once and shares it, even between concurrent callers", async () => {
		await withPlatform(MOCK_ENV);
		const { deps, created } = fakeDeps();
		try {
			const [first, second] = await Promise.all([
				getSandboxSelection(deps),
				getSandboxSelection(deps),
			]);
			const third = await getSandboxSelection(deps);

			expect(second).toBe(first);
			expect(third).toBe(first);
			expect(created).toEqual(["mock"]);
		} finally {
			cleanup();
		}
	});

	it("gives the registry the platform clock and the ten-minute idle timeout", async () => {
		const clock = await withPlatform(MOCK_ENV);
		const { deps } = fakeDeps();
		try {
			const setup = await getSandboxSelection(deps);
			if (setup.kind === "disabled") throw new Error("expected an enabled setup");
			(await setup.registry.acquire("s1")).done();

			clock.advanceBy(DEFAULT_SANDBOX.idleTimeoutMs);
			expect(await setup.registry.sweep()).toEqual([]);
			clock.advanceBy(1);
			expect(await setup.registry.sweep()).toEqual(["s1"]);
		} finally {
			cleanup();
		}
	});

	describe("the idle sweep", () => {
		it("sweeps on a timer, and stops when the setup is replaced", async () => {
			vi.useFakeTimers();
			try {
				const clock = await withPlatform(MOCK_ENV);
				const { deps } = fakeDeps({ sweepIntervalMs: 1_000 });
				const setup = await getSandboxSelection(deps);
				if (setup.kind === "disabled") throw new Error("expected an enabled setup");
				const lease = await setup.registry.acquire("s1");
				lease.done();
				const sweep = vi.spyOn(setup.registry, "sweep");

				clock.advanceBy(DEFAULT_SANDBOX.idleTimeoutMs + 1);
				await vi.advanceTimersByTimeAsync(1_000);
				expect(sweep).toHaveBeenCalledTimes(1);
				expect(await lease.session.isAlive()).toBe(false);

				setSandboxForTesting(undefined);
				await vi.advanceTimersByTimeAsync(5_000);
				expect(sweep).toHaveBeenCalledTimes(1);
			} finally {
				vi.useRealTimers();
				cleanup();
			}
		});

		it("keeps sweeping after a sweep fails", async () => {
			vi.useFakeTimers();
			try {
				await withPlatform(MOCK_ENV);
				const { deps } = fakeDeps({ sweepIntervalMs: 1_000 });
				const setup = await getSandboxSelection(deps);
				if (setup.kind === "disabled") throw new Error("expected an enabled setup");
				const failure = Promise.reject(new Error("boom"));
				// The test itself handles it at once, so Node does not report it before the timer
				// fires; the spy below then counts only the handlers the code under test adds.
				failure.catch(() => undefined);
				const handled = vi.spyOn(failure, "catch");
				const sweep = vi.spyOn(setup.registry, "sweep").mockReturnValue(failure);

				await vi.advanceTimersByTimeAsync(3_000);

				expect(sweep).toHaveBeenCalledTimes(3);
				// Each failed sweep is caught, not left as an unhandled rejection.
				expect(handled).toHaveBeenCalledTimes(3);
			} finally {
				vi.useRealTimers();
				cleanup();
			}
		});
	});

	it("does not keep a failed build, so the next request tries again", async () => {
		await withPlatform(MOCK_ENV);
		let attempts = 0;
		const { deps } = fakeDeps({
			createMock: vi.fn(() => {
				attempts += 1;
				if (attempts === 1) throw new Error("first attempt fails");
				return createMockSandboxProvider();
			}),
		});
		try {
			await expect(getSandboxSelection(deps)).rejects.toThrow("first attempt fails");

			expect((await getSandboxSelection(deps)).kind).toBe("mock");
			expect(attempts).toBe(2);
		} finally {
			cleanup();
		}
	});

	it("caps the sandboxes alive at once at the configured number", async () => {
		await withPlatform(MOCK_ENV);
		const { deps } = fakeDeps();
		try {
			const setup = await getSandboxSelection(deps);
			if (setup.kind === "disabled") throw new Error("expected an enabled setup");
			const leases = [];
			for (let index = 0; index < DEFAULT_SANDBOX.maxSessions; index += 1) {
				leases.push(await setup.registry.acquire(`session-${index}`));
			}

			await expect(setup.registry.acquire("one-too-many")).rejects.toMatchObject({
				code: "provider-unavailable",
			});
			leases[0]?.done();
			await expect(setup.registry.acquire("now-there-is-room")).resolves.toBeDefined();
		} finally {
			cleanup();
		}
	});

	describe("invalidateSandboxSelection", () => {
		it("closes every session, stops the sweep, and makes the next request choose again", async () => {
			vi.useFakeTimers();
			try {
				await withPlatform(MOCK_ENV);
				const { deps, created } = fakeDeps({ sweepIntervalMs: 1_000 });
				const setup = await getSandboxSelection(deps);
				if (setup.kind === "disabled") throw new Error("expected an enabled setup");
				const lease = await setup.registry.acquire("s1");
				const sweep = vi.spyOn(setup.registry, "sweep");

				await invalidateSandboxSelection();
				await vi.advanceTimersByTimeAsync(5_000);

				expect(await lease.session.isAlive()).toBe(false);
				expect(sweep).not.toHaveBeenCalled();
				const next = await getSandboxSelection(deps);
				expect(next).not.toBe(setup);
				expect(created).toEqual(["mock", "mock"]);
			} finally {
				vi.useRealTimers();
				cleanup();
			}
		});

		it("is harmless when nothing has been chosen yet, or the choice was disabled", async () => {
			await withPlatform(MOCK_ENV);
			try {
				await expect(invalidateSandboxSelection()).resolves.toBeUndefined();
				setSandboxForTesting({ kind: "disabled", reason: "r", guidance: "g" });
				await expect(invalidateSandboxSelection()).resolves.toBeUndefined();
			} finally {
				cleanup();
			}
		});
	});

	it("can be replaced for a test and cleared", async () => {
		await withPlatform(MOCK_ENV);
		const provider = createMockSandboxProvider();
		const installed = { kind: "disabled", reason: "r", guidance: "g" } as const;
		try {
			setSandboxForTesting(installed);
			expect(await getSandboxSelection(fakeDeps().deps)).toBe(installed);
			setSandboxForTesting(undefined);
			expect((await getSandboxSelection(fakeDeps().deps)).kind).toBe("mock");
			void provider;
		} finally {
			cleanup();
		}
	});
});
