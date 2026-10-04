export type ProviderId = "anthropic" | "openai" | "azure" | "google" | "ollama" | "mock";

export type RunMode = "mock" | "local" | "live";

export type ModelId = string;

export type Capability =
	| "tools"
	| "structuredOutput"
	| "reasoning"
	| "imageInput"
	| "embedding"
	| "promptCache";

export type ModelPurpose = "chat" | "structured" | "embedding" | "judge";

export type PromptCacheMode = "explicit" | "automatic" | "none";

export interface ModelCapabilities {
	readonly tools: boolean;
	readonly structuredOutput: boolean;
	readonly reasoning: boolean;
	readonly imageInput: boolean;
	readonly embedding: boolean;
	readonly promptCache: PromptCacheMode;
}

export interface ModelPricing {
	readonly inputPerMTok: number;
	readonly outputPerMTok: number;
	readonly cacheReadPerMTok?: number;
	readonly currency: "USD";
}

export interface ModelEntry<Id extends ModelId = ModelId> {
	readonly id: Id;
	readonly provider: ProviderId;
	readonly modes: readonly RunMode[];
	readonly capabilities: ModelCapabilities;
	readonly contextWindow: number;
	readonly maxOutputTokens: number;
	readonly pricing: ModelPricing | null;
	readonly displayName: string;
}

export type ModelCatalog = Readonly<Record<string, ModelEntry>>;

export type ModeDefaults<Id extends ModelId = ModelId> = Readonly<
	Record<RunMode, Partial<Record<ProviderId, Partial<Record<ModelPurpose, Id>>>>>
>;

export interface ModelUsage {
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly cacheReadTokens?: number;
}

export interface CostEstimate {
	readonly input: number;
	readonly output: number;
	readonly cacheRead: number;
	readonly total: number;
	readonly currency: "USD";
}
