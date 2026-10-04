import type {
	Capability,
	CostEstimate,
	ModeDefaults,
	ModelCatalog,
	ModelEntry,
	ModelPurpose,
	ModelUsage,
	ProviderId,
	RunMode,
} from "./types";

// Verified against provider documentation on 2026-09-28. Prices are USD per million tokens.
// Anthropic: https://platform.claude.com/docs/en/about-claude/models/overview
// OpenAI: https://developers.openai.com/api/docs/models and /api/docs/pricing
// Azure: https://learn.microsoft.com/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure
// Google: https://ai.google.dev/gemini-api/docs/models and /docs/pricing
// Ollama: https://ollama.com/library/qwen3:8b and /library/embeddinggemma:300m
export const MODEL_CATALOG = {
	"claude-sonnet-4-6": {
		id: "claude-sonnet-4-6",
		provider: "anthropic",
		modes: ["live"],
		capabilities: {
			tools: true,
			structuredOutput: true,
			reasoning: true,
			imageInput: true,
			embedding: false,
			promptCache: "explicit",
		},
		contextWindow: 1_000_000,
		maxOutputTokens: 64_000,
		pricing: { inputPerMTok: 3, outputPerMTok: 15, cacheReadPerMTok: 0.3, currency: "USD" },
		displayName: "Claude Sonnet 4.6",
	},
	"gpt-5.1": {
		id: "gpt-5.1",
		provider: "openai",
		modes: ["live"],
		capabilities: {
			tools: true,
			structuredOutput: true,
			reasoning: true,
			imageInput: true,
			embedding: false,
			promptCache: "automatic",
		},
		contextWindow: 400_000,
		maxOutputTokens: 128_000,
		pricing: {
			inputPerMTok: 1.25,
			outputPerMTok: 10,
			cacheReadPerMTok: 0.125,
			currency: "USD",
		},
		displayName: "GPT-5.1",
	},
	"text-embedding-3-small": {
		id: "text-embedding-3-small",
		provider: "openai",
		modes: ["live"],
		capabilities: {
			tools: false,
			structuredOutput: false,
			reasoning: false,
			imageInput: false,
			embedding: true,
			promptCache: "none",
		},
		contextWindow: 8_191,
		maxOutputTokens: 0,
		pricing: { inputPerMTok: 0.02, outputPerMTok: 0, currency: "USD" },
		displayName: "OpenAI Text Embedding 3 Small",
	},
	"gpt-5.2": {
		id: "gpt-5.2",
		provider: "azure",
		modes: ["live"],
		capabilities: {
			tools: true,
			structuredOutput: true,
			reasoning: true,
			imageInput: true,
			embedding: false,
			promptCache: "automatic",
		},
		contextWindow: 400_000,
		maxOutputTokens: 128_000,
		pricing: {
			inputPerMTok: 1.75,
			outputPerMTok: 14,
			cacheReadPerMTok: 0.175,
			currency: "USD",
		},
		displayName: "Azure OpenAI GPT-5.2",
	},
	"gemini-2.5-flash": {
		id: "gemini-2.5-flash",
		provider: "google",
		modes: ["live"],
		capabilities: {
			tools: true,
			structuredOutput: true,
			reasoning: true,
			imageInput: true,
			embedding: false,
			promptCache: "automatic",
		},
		contextWindow: 1_048_576,
		maxOutputTokens: 65_536,
		pricing: { inputPerMTok: 0.3, outputPerMTok: 2.5, cacheReadPerMTok: 0.03, currency: "USD" },
		displayName: "Gemini 2.5 Flash",
	},
	"gemini-embedding-001": {
		id: "gemini-embedding-001",
		provider: "google",
		modes: ["live"],
		capabilities: {
			tools: false,
			structuredOutput: false,
			reasoning: false,
			imageInput: false,
			embedding: true,
			promptCache: "none",
		},
		contextWindow: 2_048,
		maxOutputTokens: 0,
		pricing: { inputPerMTok: 0.15, outputPerMTok: 0, currency: "USD" },
		displayName: "Gemini Embedding 001",
	},
	"qwen3:8b": {
		id: "qwen3:8b",
		provider: "ollama",
		modes: ["local"],
		capabilities: {
			tools: true,
			structuredOutput: true,
			reasoning: true,
			imageInput: false,
			embedding: false,
			promptCache: "none",
		},
		contextWindow: 40_960,
		maxOutputTokens: 8_192,
		pricing: null,
		displayName: "Qwen 3 8B (Ollama)",
	},
	"embeddinggemma:300m": {
		id: "embeddinggemma:300m",
		provider: "ollama",
		modes: ["local"],
		capabilities: {
			tools: false,
			structuredOutput: false,
			reasoning: false,
			imageInput: false,
			embedding: true,
			promptCache: "none",
		},
		contextWindow: 2_048,
		maxOutputTokens: 0,
		pricing: null,
		displayName: "EmbeddingGemma 300M (Ollama)",
	},
	"mock:general-v1": {
		id: "mock:general-v1",
		provider: "mock",
		modes: ["mock"],
		capabilities: {
			tools: true,
			structuredOutput: true,
			reasoning: true,
			imageInput: true,
			embedding: false,
			promptCache: "none",
		},
		contextWindow: 131_072,
		maxOutputTokens: 16_384,
		pricing: null,
		displayName: "Deterministic Mock Model",
	},
	"mock:embedding-v1": {
		id: "mock:embedding-v1",
		provider: "mock",
		modes: ["mock"],
		capabilities: {
			tools: false,
			structuredOutput: false,
			reasoning: false,
			imageInput: false,
			embedding: true,
			promptCache: "none",
		},
		contextWindow: 131_072,
		maxOutputTokens: 0,
		pricing: null,
		displayName: "Deterministic Mock Embedding",
	},
} as const satisfies ModelCatalog;

export type CatalogModelId = keyof typeof MODEL_CATALOG;

export const MODEL_DEFAULTS = {
	mock: {
		mock: {
			chat: "mock:general-v1",
			structured: "mock:general-v1",
			embedding: "mock:embedding-v1",
			judge: "mock:general-v1",
		},
	},
	local: {
		ollama: {
			chat: "qwen3:8b",
			structured: "qwen3:8b",
			embedding: "embeddinggemma:300m",
			judge: "qwen3:8b",
		},
	},
	live: {
		anthropic: {
			chat: "claude-sonnet-4-6",
			structured: "claude-sonnet-4-6",
			judge: "claude-sonnet-4-6",
		},
		openai: {
			chat: "gpt-5.1",
			structured: "gpt-5.1",
			embedding: "text-embedding-3-small",
			judge: "gpt-5.1",
		},
		azure: {
			chat: "gpt-5.2",
			structured: "gpt-5.2",
			judge: "gpt-5.2",
		},
		google: {
			chat: "gemini-2.5-flash",
			structured: "gemini-2.5-flash",
			embedding: "gemini-embedding-001",
			judge: "gemini-2.5-flash",
		},
	},
} as const satisfies ModeDefaults<CatalogModelId>;

export function getModelEntry(id: CatalogModelId): ModelEntry<CatalogModelId> {
	const entry = MODEL_CATALOG[id];
	if (!entry) throw new RangeError(`Unknown model catalog ID: ${id}`);
	return entry;
}

function supportsCapability(entry: ModelEntry, capability: Capability): boolean {
	if (capability === "promptCache") return entry.capabilities.promptCache !== "none";
	return entry.capabilities[capability];
}

export function listModels(filter: {
	readonly mode: RunMode;
	readonly provider?: ProviderId;
	readonly capability?: Capability;
}): readonly ModelEntry<CatalogModelId>[] {
	return Object.values(MODEL_CATALOG).filter(
		(entry) =>
			entry.modes.some((mode) => mode === filter.mode) &&
			(filter.provider === undefined || entry.provider === filter.provider) &&
			(filter.capability === undefined || supportsCapability(entry, filter.capability)),
	);
}

export function defaultModelFor(
	mode: RunMode,
	provider: ProviderId,
	purpose: ModelPurpose,
): CatalogModelId {
	const providers = MODEL_DEFAULTS[mode] as Partial<
		Record<ProviderId, Partial<Record<ModelPurpose, CatalogModelId>>>
	>;
	const id = providers[provider]?.[purpose];
	if (!id) throw new RangeError(`No default model for ${mode}/${provider}/${purpose}`);
	return id;
}

export function estimateCost(usage: ModelUsage, entry: ModelEntry): CostEstimate | undefined {
	if (!entry.pricing) return undefined;

	const input = (usage.inputTokens / 1_000_000) * entry.pricing.inputPerMTok;
	const output = (usage.outputTokens / 1_000_000) * entry.pricing.outputPerMTok;
	const cacheRead =
		((usage.cacheReadTokens ?? 0) / 1_000_000) *
		(entry.pricing.cacheReadPerMTok ?? entry.pricing.inputPerMTok);

	return {
		input,
		output,
		cacheRead,
		total: input + output + cacheRead,
		currency: entry.pricing.currency,
	};
}
