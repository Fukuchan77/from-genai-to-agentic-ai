// Public API of `@platform/ai-core/models` (plan C5, C6).
// Client components may import only the types below with `import type` (they come from
// `types.ts` and `gateway.ts` interfaces and contain no Zod); every value export is server-only,
// because the gateway pulls in the provider SDKs, the mock runtime and `node:*` modules.
export {
	type CatalogModelId,
	defaultModelFor,
	estimateCost,
	getModelEntry,
	listModels,
	MODEL_CATALOG,
	MODEL_DEFAULTS,
} from "./catalog";
export {
	CapabilityUnsupportedError,
	type ModelSelectionDetails,
	ModelSelectionError,
	type ModelSelectionFailure,
	OllamaUnavailableError,
	type OllamaUnavailableReason,
	ProviderCredentialsMissingError,
} from "./errors";
export {
	createModelGateway,
	type GatewayDeps,
	type GatewayMockOptions,
	type GatewayRecordingOptions,
	MOCK_EMBEDDING_DIMENSIONS,
	type ModelGateway,
	type ModelOption,
	type ResolvedEmbeddingModel,
	type ResolvedModel,
	type ResolveEmbeddingRequest,
	type ResolveRequest,
} from "./gateway";
export {
	createOllamaPreflight,
	OLLAMA_PREFLIGHT_CACHE_TTL_MS,
	OLLAMA_PREFLIGHT_TIMEOUT_MS,
	type OllamaPreflight,
	type OllamaPreflightOptions,
} from "./ollama-preflight";
export {
	credentialEnvVars,
	type EmbeddingModelV4,
	type LanguageModelV4,
	type LiveProviderId,
	PROVIDER_FACTORIES,
	type ProviderFactories,
	type ProviderFactory,
	type ProviderModels,
	type ProviderSettings,
	type SdkProviderId,
} from "./providers";
export type {
	Capability,
	CostEstimate,
	ModeDefaults,
	ModelCapabilities,
	ModelCatalog,
	ModelEntry,
	ModelId,
	ModelPricing,
	ModelPurpose,
	ModelUsage,
	PromptCacheMode,
	ProviderId,
	RunMode,
} from "./types";
