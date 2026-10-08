import { createAnthropic } from "@ai-sdk/anthropic";
import { createAzure } from "@ai-sdk/azure";
import { createGoogle } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type { EmbeddingModel, LanguageModel } from "ai";
import { createOllama } from "ollama-ai-provider-v2";
import type { PlatformConfig } from "../config";
import { FEATURE_REQUIREMENTS, type RequiredEnvVariable } from "../config/feature-requirements";
import type { ModelId, ProviderId } from "./types";

export type LanguageModelV4 = Extract<LanguageModel, { readonly specificationVersion: "v4" }>;
export type EmbeddingModelV4 = Extract<EmbeddingModel, { readonly specificationVersion: "v4" }>;

/** Providers that are backed by an SDK (every catalog provider except `mock`). */
export type SdkProviderId = Exclude<ProviderId, "mock">;
export type LiveProviderId = Exclude<SdkProviderId, "ollama">;

export interface ProviderSettings {
	readonly credentials: PlatformConfig["credentials"];
	readonly ollamaBaseUrl: string;
}

export interface ProviderModels {
	languageModel(modelId: ModelId): LanguageModelV4;
	embeddingModel(modelId: ModelId): EmbeddingModelV4;
}

export type ProviderFactory = (settings: ProviderSettings) => ProviderModels;
export type ProviderFactories = Readonly<Record<SdkProviderId, ProviderFactory>>;

const TRAILING_SLASHES = /\/+$/u;
const OLLAMA_API_SUFFIX = /\/api$/u;

/** Server base URL without a trailing `/` or `/api` (both forms are accepted in OLLAMA_BASE_URL). */
export function ollamaServerUrl(baseUrl: string): string {
	return baseUrl.replace(TRAILING_SLASHES, "").replace(OLLAMA_API_SUFFIX, "");
}

// Only pass a key that is configured: the gateway rejects missing credentials before a factory
// runs, so an SDK never falls back to reading `process.env` itself.
function apiKeyOption(apiKey: string | undefined): { apiKey?: string } {
	return apiKey === undefined ? {} : { apiKey };
}

/**
 * Provider factory table (plan C6). Each factory receives only the settings it needs and builds
 * the SDK provider; building a provider never performs network I/O.
 */
export const PROVIDER_FACTORIES: ProviderFactories = Object.freeze({
	anthropic: ({ credentials }) => {
		const provider = createAnthropic(apiKeyOption(credentials.anthropic));
		return {
			languageModel: (id) => provider.languageModel(id),
			embeddingModel: (id) => provider.embeddingModel(id),
		};
	},
	openai: ({ credentials }) => {
		const provider = createOpenAI(apiKeyOption(credentials.openai));
		return {
			languageModel: (id) => provider.languageModel(id),
			embeddingModel: (id) => provider.embeddingModel(id),
		};
	},
	azure: ({ credentials }) => {
		const provider = createAzure(credentials.azure ? { ...credentials.azure } : {});
		return {
			languageModel: (id) => provider.languageModel(id),
			embeddingModel: (id) => provider.embeddingModel(id),
		};
	},
	google: ({ credentials }) => {
		const provider = createGoogle(apiKeyOption(credentials.google));
		return {
			languageModel: (id) => provider.languageModel(id),
			embeddingModel: (id) => provider.embeddingModel(id),
		};
	},
	ollama: ({ ollamaBaseUrl }) => {
		const provider = createOllama({ baseURL: `${ollamaServerUrl(ollamaBaseUrl)}/api` });
		return {
			languageModel: (id) => provider.languageModel(id),
			embeddingModel: (id) => provider.textEmbeddingModel(id),
		};
	},
});

/** Environment variables a live provider needs (single source: C4 feature requirements). */
export function credentialEnvVars(provider: LiveProviderId): readonly RequiredEnvVariable[] {
	return FEATURE_REQUIREMENTS[`live-${provider}`];
}

/** Returns the missing variables for the provider, or an empty list when it can be used. */
export function missingCredentials(
	provider: ProviderId,
	credentials: PlatformConfig["credentials"],
): readonly RequiredEnvVariable[] {
	if (provider === "mock" || provider === "ollama") return [];
	return credentials[provider] === undefined ? credentialEnvVars(provider) : [];
}
