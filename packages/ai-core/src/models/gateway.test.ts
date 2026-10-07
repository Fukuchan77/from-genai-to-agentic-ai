import { embed, generateText } from "ai";
import { describe, expect, it, vi } from "vitest";
import { type EnvSource, loadPlatformConfig } from "../config";
import { PlatformError } from "../errors";
import type { RecordingStore } from "../mock/recording";
import { createFakeClock } from "../ports/clock";
import { createTextStreamModel } from "../testing/mock-models";
import { defaultModelFor, getModelEntry, listModels } from "./catalog";
import {
	CapabilityUnsupportedError,
	ModelSelectionError,
	OllamaUnavailableError,
	ProviderCredentialsMissingError,
} from "./errors";
import {
	createModelGateway,
	type GatewayDeps,
	MOCK_EMBEDDING_DIMENSIONS,
	type ModelOption,
} from "./gateway";
import { PROVIDER_FACTORIES, type ProviderFactories } from "./providers";

const FAKE_ANTHROPIC_KEY = "test-anthropic-key";

function configFor(env: EnvSource) {
	return loadPlatformConfig({ VITEST: "true", ...env });
}

/** Provider factories that never build a real SDK client, recording every call. */
function spyProviders(): ProviderFactories & { readonly calls: string[] } {
	const calls: string[] = [];
	const factory = (provider: string) => () => ({
		languageModel(modelId: string) {
			calls.push(`${provider}:${modelId}`);
			return createTextStreamModel(`${provider} reply`);
		},
		embeddingModel(modelId: string): never {
			throw new Error(`unexpected embedding ${provider}:${modelId}`);
		},
	});
	return {
		calls,
		anthropic: factory("anthropic"),
		openai: factory("openai"),
		azure: factory("azure"),
		google: factory("google"),
		ollama: factory("ollama"),
	};
}

function caught(promise: Promise<unknown>): Promise<unknown> {
	return promise.then(
		() => {
			throw new Error("expected rejection");
		},
		(error: unknown) => error,
	);
}

const liveOnlyChatId = defaultModelFor("live", "anthropic", "chat");
const openAiChatId = defaultModelFor("live", "openai", "chat");
const azureChatId = defaultModelFor("live", "azure", "chat");
const localChatId = defaultModelFor("local", "ollama", "chat");

describe("createModelGateway resolve (mock)", () => {
	it("returns a scenario model bound to the purpose and answers without network", async () => {
		const gateway = createModelGateway({ config: configFor({}) });

		const resolved = await gateway.resolve({ purpose: "chat" });

		expect(resolved.mode).toBe("mock");
		expect(resolved.entry.id).toBe(defaultModelFor("mock", "mock", "chat"));
		expect(resolved.model.modelId).toBe("mock:chat");
		const result = await generateText({ model: resolved.model, prompt: "こんにちは" });
		expect(result.text).toContain("モックモード");
	});

	it("binds a separate mock model per purpose and uses injected scenarios", async () => {
		const gateway = createModelGateway({
			config: configFor({}),
			mock: {
				scenarios: [
					{
						id: "test/structured",
						turns: [{ match: { purpose: "structured" }, respond: { text: "structured" } }],
					},
				],
			},
		});

		const resolved = await gateway.resolve({ purpose: "structured" });

		expect(resolved.model.modelId).toBe("mock:structured");
		await expect(
			generateText({ model: resolved.model, prompt: "x" }).then((result) => result.text),
		).resolves.toBe("structured");
	});
});

describe("createModelGateway resolve (live)", () => {
	it("builds the default live model for the configured provider", async () => {
		const gateway = createModelGateway({
			config: configFor({ AI_TEST_RUN_MODE: "live", ANTHROPIC_API_KEY: FAKE_ANTHROPIC_KEY }),
		});

		const resolved = await gateway.resolve({ purpose: "chat" });

		expect(resolved).toMatchObject({ mode: "live", entry: { id: liveOnlyChatId } });
		expect(resolved.model.modelId).toBe(liveOnlyChatId);
		expect(resolved.model.provider).toContain("anthropic");
	});

	it("builds every live provider through the real factory table", () => {
		const settings = {
			credentials: {
				anthropic: "a",
				openai: "o",
				azure: { apiKey: "z", resourceName: "resource" },
				google: "g",
			},
			ollamaBaseUrl: "http://127.0.0.1:11434",
		};
		for (const entry of listModels({ mode: "live" })) {
			const factory = PROVIDER_FACTORIES[entry.provider as keyof ProviderFactories](settings);
			const model = entry.capabilities.embedding
				? factory.embeddingModel(entry.id)
				: factory.languageModel(entry.id);
			expect(model.modelId).toBe(entry.id);
		}
	});

	it("rejects a provider without credentials before building any model", async () => {
		const providers = spyProviders();
		const gateway = createModelGateway({
			config: configFor({ AI_TEST_RUN_MODE: "live", ANTHROPIC_API_KEY: FAKE_ANTHROPIC_KEY }),
			providers,
		});

		const error = await caught(gateway.resolve({ purpose: "chat", modelId: openAiChatId }));

		expect(error).toBeInstanceOf(ProviderCredentialsMissingError);
		expect(error).toBeInstanceOf(PlatformError);
		expect(error).toMatchObject({
			code: "provider-unavailable",
			provider: "openai",
			envVars: ["OPENAI_API_KEY"],
			details: { provider: "openai", envVars: ["OPENAI_API_KEY"] },
		});
		expect((error as Error).message).toContain("openai");
		expect((error as Error).message).toContain("OPENAI_API_KEY");
		expect(providers.calls).toEqual([]);
	});

	it("names every Azure variable when its credentials are incomplete", async () => {
		const gateway = createModelGateway({
			config: configFor({ AI_TEST_RUN_MODE: "live", ANTHROPIC_API_KEY: FAKE_ANTHROPIC_KEY }),
			providers: spyProviders(),
		});

		await expect(gateway.resolve({ purpose: "chat", modelId: azureChatId })).rejects.toMatchObject({
			provider: "azure",
			envVars: ["AZURE_API_KEY", "AZURE_RESOURCE_NAME"],
		});
	});

	it("passes configured credentials to the provider factory", async () => {
		const providers = spyProviders();
		const anthropic = vi.spyOn(providers, "anthropic");
		const gateway = createModelGateway({
			config: configFor({ AI_TEST_RUN_MODE: "live", ANTHROPIC_API_KEY: FAKE_ANTHROPIC_KEY }),
			providers,
		});

		await gateway.resolve({ purpose: "judge" });

		expect(anthropic).toHaveBeenCalledWith(
			expect.objectContaining({ credentials: { anthropic: FAKE_ANTHROPIC_KEY } }),
		);
		expect(providers.calls).toEqual([`anthropic:${liveOnlyChatId}`]);
	});
});

describe("createModelGateway resolve (model selection, D9)", () => {
	function deps(env: EnvSource): GatewayDeps & { fetch: ReturnType<typeof vi.fn> } {
		const fetch = vi.fn();
		return { config: configFor(env), providers: spyProviders(), fetcher: { fetch }, fetch };
	}

	it("rejects a live-only ID set through AI_MODEL_CHAT in local mode without contacting Ollama", async () => {
		const gatewayDeps = deps({ AI_TEST_RUN_MODE: "local", AI_MODEL_CHAT: liveOnlyChatId });
		const gateway = createModelGateway(gatewayDeps);

		const error = await caught(gateway.resolve({ purpose: "chat" }));

		expect(error).toBeInstanceOf(ModelSelectionError);
		expect(error).toMatchObject({
			code: "invalid-request",
			reason: "mode-mismatch",
			details: { modelId: liveOnlyChatId, mode: "local", modes: ["live"] },
		});
		expect((error as Error).message).toContain(liveOnlyChatId);
		expect((error as Error).message).toContain("local");
		expect(gatewayDeps.fetch).not.toHaveBeenCalled();
	});

	it("rejects a local-only request model in live mode", async () => {
		const gateway = createModelGateway(
			deps({ AI_TEST_RUN_MODE: "live", ANTHROPIC_API_KEY: FAKE_ANTHROPIC_KEY }),
		);

		await expect(gateway.resolve({ purpose: "chat", modelId: localChatId })).rejects.toMatchObject({
			reason: "mode-mismatch",
			details: { mode: "live" },
		});
	});

	it("rejects a request model ID outside the catalog", async () => {
		const gateway = createModelGateway(deps({}));
		const unknownId = ["not", "in", "catalog"].join("-");

		await expect(gateway.resolve({ purpose: "chat", modelId: unknownId })).rejects.toMatchObject({
			name: "ModelSelectionError",
			reason: "unknown-model",
			details: { modelId: unknownId, mode: "mock" },
		});
	});
});

describe("createModelGateway resolve (local)", () => {
	const localEmbeddingId = defaultModelFor("local", "ollama", "embedding");
	const tagsBody = (...names: string[]) => ({
		status: 200,
		headers: {},
		body: JSON.stringify({ models: names.map((name) => ({ name })) }),
	});

	it("checks Ollama and builds the Ollama model for the configured base URL", async () => {
		const fetch = vi.fn().mockResolvedValue(tagsBody(localChatId, localEmbeddingId));
		const gateway = createModelGateway({
			config: configFor({
				AI_TEST_RUN_MODE: "local",
				OLLAMA_BASE_URL: "http://ollama.test:11434",
			}),
			fetcher: { fetch },
			clock: createFakeClock(),
		});

		const resolved = await gateway.resolve({ purpose: "chat" });

		expect(resolved).toMatchObject({ mode: "local", entry: { id: localChatId } });
		expect(resolved.model.modelId).toBe(localChatId);
		expect(resolved.model.provider).toContain("ollama");
		expect(fetch).toHaveBeenCalledWith("http://ollama.test:11434/api/tags", expect.anything());
	});

	it("raises OllamaUnavailableError with the URL and start guidance before building a model", async () => {
		const providers = spyProviders();
		const gateway = createModelGateway({
			config: configFor({ AI_TEST_RUN_MODE: "local" }),
			providers,
			fetcher: { fetch: vi.fn().mockRejectedValue(new TypeError("fetch failed")) },
			clock: createFakeClock(),
		});

		const error = await caught(gateway.resolve({ purpose: "chat" }));

		expect(error).toBeInstanceOf(OllamaUnavailableError);
		expect(error).toMatchObject({
			code: "provider-unavailable",
			baseUrl: "http://127.0.0.1:11434",
			reason: "unreachable",
		});
		expect((error as Error).message).toContain("http://127.0.0.1:11434");
		expect((error as Error).message).toContain("ollama serve");
		expect(providers.calls).toEqual([]);
	});

	it("names the model to pull when Ollama does not have it", async () => {
		const gateway = createModelGateway({
			config: configFor({ AI_TEST_RUN_MODE: "local" }),
			providers: spyProviders(),
			fetcher: { fetch: vi.fn().mockResolvedValue(tagsBody(localEmbeddingId)) },
			clock: createFakeClock(),
		});

		await expect(gateway.resolve({ purpose: "chat" })).rejects.toMatchObject({
			reason: "model-missing",
			message: expect.stringContaining(`ollama pull ${localChatId}`),
		});
	});
});

describe("createModelGateway capability checks", () => {
	it("rejects an unsupported capability with the capability and model names", async () => {
		const gateway = createModelGateway({ config: configFor({}) });
		const mockChat = getModelEntry(defaultModelFor("mock", "mock", "chat"));

		const error = await caught(
			gateway.resolve({ purpose: "chat", require: ["tools", "embedding"] }),
		);

		expect(error).toBeInstanceOf(CapabilityUnsupportedError);
		expect(error).toMatchObject({
			code: "capability-unsupported",
			capability: "embedding",
			modelId: mockChat.id,
			details: { capability: "embedding", modelId: mockChat.id },
		});
		expect((error as Error).message).toContain("embedding");
		expect((error as Error).message).toContain(mockChat.displayName);
	});

	it("rejects image input on a local text-only model before contacting Ollama", async () => {
		const fetch = vi.fn();
		const gateway = createModelGateway({
			config: configFor({ AI_TEST_RUN_MODE: "local" }),
			fetcher: { fetch },
			clock: createFakeClock(),
		});

		await expect(
			gateway.resolve({ purpose: "chat", require: ["imageInput"] }),
		).rejects.toMatchObject({ capability: "imageInput", modelId: localChatId });
		await expect(
			gateway.resolve({ purpose: "chat", require: ["promptCache"] }),
		).rejects.toMatchObject({ capability: "promptCache" });
		expect(fetch).not.toHaveBeenCalled();
	});

	it("accepts every capability the entry declares", async () => {
		const gateway = createModelGateway({
			config: configFor({ AI_TEST_RUN_MODE: "live", ANTHROPIC_API_KEY: FAKE_ANTHROPIC_KEY }),
			providers: spyProviders(),
		});

		await expect(
			gateway.resolve({
				purpose: "chat",
				require: ["tools", "structuredOutput", "reasoning", "imageInput", "promptCache"],
			}),
		).resolves.toMatchObject({ entry: { id: liveOnlyChatId } });
	});

	it("does not resolve an embedding model as a language model", async () => {
		const gateway = createModelGateway({ config: configFor({}) });
		const mockEmbeddingId = defaultModelFor("mock", "mock", "embedding");

		await expect(
			gateway.resolve({ purpose: "chat", modelId: mockEmbeddingId }),
		).rejects.toMatchObject({
			name: "ModelSelectionError",
			reason: "purpose-mismatch",
			details: { modelId: mockEmbeddingId, purpose: "chat" },
		});
	});
});

describe("createModelGateway resolveEmbedding", () => {
	it("returns a deterministic embedding model in mock mode", async () => {
		const gateway = createModelGateway({ config: configFor({}) });

		const resolved = await gateway.resolveEmbedding();
		const first = await embed({ model: resolved.model, value: "hello" });
		const second = await embed({ model: resolved.model, value: "hello" });

		expect(resolved).toMatchObject({
			mode: "mock",
			entry: { id: defaultModelFor("mock", "mock", "embedding") },
		});
		expect(first.embedding).toHaveLength(MOCK_EMBEDDING_DIMENSIONS);
		expect(second.embedding).toEqual(first.embedding);
	});

	it("uses the configured mock dimensions", async () => {
		const gateway = createModelGateway({
			config: configFor({}),
			mock: { embeddingDimensions: 8 },
		});

		const { model } = await gateway.resolveEmbedding();

		expect((await embed({ model, value: "x" })).embedding).toHaveLength(8);
	});

	it("builds live and local embedding models through the provider factory", async () => {
		const openAiEmbeddingId = defaultModelFor("live", "openai", "embedding");
		const live = createModelGateway({
			config: configFor({
				AI_TEST_RUN_MODE: "live",
				AI_LIVE_PROVIDER: "openai",
				OPENAI_API_KEY: "test-openai-key",
			}),
		});
		const localEmbeddingId = defaultModelFor("local", "ollama", "embedding");
		const local = createModelGateway({
			config: configFor({ AI_TEST_RUN_MODE: "local" }),
			fetcher: {
				fetch: vi.fn().mockResolvedValue({
					status: 200,
					headers: {},
					body: JSON.stringify({ models: [{ name: localEmbeddingId }] }),
				}),
			},
			clock: createFakeClock(),
		});

		const liveModel = await live.resolveEmbedding();
		const localModel = await local.resolveEmbedding();

		expect(liveModel.model.modelId).toBe(openAiEmbeddingId);
		expect(liveModel.model.provider).toContain("openai");
		expect(localModel).toMatchObject({ mode: "local", entry: { id: localEmbeddingId } });
		expect(localModel.model.provider).toContain("ollama");
	});

	it("explains a provider without an embedding default", async () => {
		const gateway = createModelGateway({
			config: configFor({ AI_TEST_RUN_MODE: "live", ANTHROPIC_API_KEY: FAKE_ANTHROPIC_KEY }),
		});

		const error = await caught(gateway.resolveEmbedding());

		expect(error).toMatchObject({
			name: "ModelSelectionError",
			reason: "no-default",
			details: { mode: "live", provider: "anthropic", purpose: "embedding" },
		});
		expect((error as Error).message).toContain("AI_MODEL_EMBEDDING");
	});

	it("rejects a language model and checks credentials for embeddings", async () => {
		const gateway = createModelGateway({
			config: configFor({ AI_TEST_RUN_MODE: "live", ANTHROPIC_API_KEY: FAKE_ANTHROPIC_KEY }),
			providers: spyProviders(),
		});

		await expect(gateway.resolveEmbedding({ modelId: liveOnlyChatId })).rejects.toMatchObject({
			name: "CapabilityUnsupportedError",
			capability: "embedding",
		});
		await expect(
			gateway.resolveEmbedding({ modelId: defaultModelFor("live", "openai", "embedding") }),
		).rejects.toMatchObject({ name: "ProviderCredentialsMissingError", provider: "openai" });
	});
});

describe("createModelGateway availableModels", () => {
	const ids = (options: readonly ModelOption[]) => options.map((option) => option.id);

	it("lists only models of the current run mode (D9)", () => {
		const mock = createModelGateway({ config: configFor({}) }).availableModels();
		const local = createModelGateway({
			config: configFor({ AI_TEST_RUN_MODE: "local" }),
		}).availableModels();

		expect(ids(mock)).toEqual(ids(listModels({ mode: "mock" })));
		expect(ids(local)).toEqual(ids(listModels({ mode: "local" })));
		expect(ids(local)).not.toContain(liveOnlyChatId);
	});

	it("lists only live providers whose credentials are configured", () => {
		const anthropicOnly = createModelGateway({
			config: configFor({ AI_TEST_RUN_MODE: "live", ANTHROPIC_API_KEY: FAKE_ANTHROPIC_KEY }),
		}).availableModels();
		const withOpenAi = createModelGateway({
			config: configFor({
				AI_TEST_RUN_MODE: "live",
				ANTHROPIC_API_KEY: FAKE_ANTHROPIC_KEY,
				OPENAI_API_KEY: "test-openai-key",
			}),
		}).availableModels();

		expect(ids(anthropicOnly)).toEqual(ids(listModels({ mode: "live", provider: "anthropic" })));
		expect(ids(withOpenAi)).toEqual(
			ids(
				listModels({ mode: "live" }).filter(
					(entry) => entry.provider !== "azure" && entry.provider !== "google",
				),
			),
		);
		expect(ids(withOpenAi)).not.toContain(localChatId);
	});

	it("returns plain serializable options for the client", () => {
		const [option] = createModelGateway({ config: configFor({}) }).availableModels();
		const entry = getModelEntry(defaultModelFor("mock", "mock", "chat"));

		expect(option).toEqual({
			id: entry.id,
			displayName: entry.displayName,
			provider: entry.provider,
			capabilities: entry.capabilities,
			contextWindow: entry.contextWindow,
		});
		expect(JSON.parse(JSON.stringify(option))).toEqual(option);
	});
});

describe("createModelGateway recording", () => {
	function recordingStore() {
		const put = vi.fn<RecordingStore["put"]>();
		return { put };
	}

	it("records live calls as redacted cassettes when AI_RECORD=1", async () => {
		const store = recordingStore();
		const providers = {
			...spyProviders(),
			anthropic: () => ({
				languageModel: () => createTextStreamModel(`echo ${FAKE_ANTHROPIC_KEY}`),
				embeddingModel: (): never => {
					throw new Error("unused");
				},
			}),
		};
		const clock = createFakeClock(Date.UTC(2026, 9, 7));
		const gateway = createModelGateway({
			config: configFor({
				AI_TEST_RUN_MODE: "live",
				ANTHROPIC_API_KEY: FAKE_ANTHROPIC_KEY,
				AI_RECORD: "1",
			}),
			providers,
			clock,
			recording: { store },
		});

		const { model } = await gateway.resolve({ purpose: "judge" });
		const result = await generateText({ model, prompt: "hi" });

		expect(result.text).toBe(`echo ${FAKE_ANTHROPIC_KEY}`);
		expect(store.put).toHaveBeenCalledTimes(1);
		const [key, cassette] = store.put.mock.calls[0] ?? [];
		expect(key).toMatch(/^llm\/[a-f0-9]{64}$/u);
		expect(cassette).toMatchObject({
			version: 1,
			recordedWith: "live",
			recordedAt: "2026-10-07T00:00:00.000Z",
			request: { purpose: "judge" },
		});
		expect(JSON.stringify(cassette)).not.toContain(FAKE_ANTHROPIC_KEY);
	});

	it("records local calls with recordedWith local", async () => {
		const store = recordingStore();
		const gateway = createModelGateway({
			config: configFor({ AI_TEST_RUN_MODE: "local", AI_RECORD: "1" }),
			providers: spyProviders(),
			fetcher: {
				fetch: vi.fn().mockResolvedValue({
					status: 200,
					headers: {},
					body: JSON.stringify({ models: [{ name: localChatId }] }),
				}),
			},
			clock: createFakeClock(),
			recording: { store },
		});

		const { model } = await gateway.resolve({ purpose: "chat" });
		await generateText({ model, prompt: "hi" });

		expect(store.put.mock.calls[0]?.[1]).toMatchObject({
			recordedWith: "local",
			request: { purpose: "chat" },
		});
	});

	it("does not wrap the model when recording is off", async () => {
		const store = recordingStore();
		const gateway = createModelGateway({
			config: configFor({ AI_TEST_RUN_MODE: "live", ANTHROPIC_API_KEY: FAKE_ANTHROPIC_KEY }),
			providers: spyProviders(),
			recording: { store },
		});

		const { model } = await gateway.resolve({ purpose: "chat" });
		await generateText({ model, prompt: "hi" });

		expect(store.put).not.toHaveBeenCalled();
	});
});
