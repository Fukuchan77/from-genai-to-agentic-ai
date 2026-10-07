import { generateText } from "ai";
import { describe, expect, it, vi } from "vitest";
import { type EnvSource, loadPlatformConfig } from "../config";
import { PlatformError } from "../errors";
import { createFakeClock } from "../ports/clock";
import { createTextStreamModel } from "../testing/mock-models";
import { defaultModelFor, listModels } from "./catalog";
import {
	ModelSelectionError,
	OllamaUnavailableError,
	ProviderCredentialsMissingError,
} from "./errors";
import { createModelGateway, type GatewayDeps } from "./gateway";
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
