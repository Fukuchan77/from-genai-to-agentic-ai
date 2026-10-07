import { wrapLanguageModel } from "ai";
import { M1_2_SCENARIOS } from "../../fixtures/scenarios/m1-2";
import { M1_3_SCENARIOS } from "../../fixtures/scenarios/m1-3";
import type { PlatformConfig } from "../config";
import { type CassetteStore, createCassetteStore } from "../mock/cassette-store";
import { createDeterministicEmbeddingModel } from "../mock/deterministic-embedding";
import { CASSETTE_FIXTURE_DIRECTORY } from "../mock/fixtures";
import { type RecordingStore, recordingMiddleware } from "../mock/recording";
import { createRedactor, type Redactor } from "../mock/redactor";
import type { ScenarioDefinition } from "../mock/scenario";
import { createScenarioModel } from "../mock/scenario-model";
import { type Clock, systemClock } from "../ports/clock";
import { createNodeHttpFetcher, type HttpFetcher } from "../ports/http";
import { type CatalogModelId, listModels, MODEL_CATALOG } from "./catalog";
import {
	CapabilityUnsupportedError,
	ModelSelectionError,
	ProviderCredentialsMissingError,
} from "./errors";
import { createOllamaPreflight } from "./ollama-preflight";
import {
	type EmbeddingModelV4,
	type LanguageModelV4,
	missingCredentials,
	PROVIDER_FACTORIES,
	type ProviderFactories,
	type ProviderSettings,
} from "./providers";
import type {
	Capability,
	ModelCapabilities,
	ModelEntry,
	ModelId,
	ModelPurpose,
	ProviderId,
	RunMode,
} from "./types";

/** Vector size of the `mock` embedding model (matches the `local` default embedding model). */
export const MOCK_EMBEDDING_DIMENSIONS = 768;

export interface GatewayMockOptions {
	/** Scenario scripts for `mock` mode; defaults to the M1 scenarios. */
	readonly scenarios?: readonly ScenarioDefinition[];
	/** Recorded cassettes for `mock` mode; defaults to `fixtures/cassettes/`. */
	readonly cassettes?: CassetteStore;
	/** Vector size of the deterministic embeddings; defaults to {@link MOCK_EMBEDDING_DIMENSIONS}. */
	readonly embeddingDimensions?: number;
}

export interface GatewayRecordingOptions {
	/** Where cassettes go when `AI_RECORD=1`; defaults to `fixtures/cassettes/`. */
	readonly store?: RecordingStore;
	/** Secret redaction; defaults to a redactor over the configured provider credentials. */
	readonly redactor?: Redactor;
}

export interface GatewayDeps {
	readonly config: PlatformConfig;
	readonly mock?: GatewayMockOptions;
	readonly recording?: GatewayRecordingOptions;
	/** Provider factory table; tests inject fakes. Defaults to {@link PROVIDER_FACTORIES}. */
	readonly providers?: ProviderFactories;
	/** HTTP port used by the Ollama preflight in `local` mode. Defaults to the Node fetcher. */
	readonly fetcher?: HttpFetcher;
	/** Clock for the preflight cache and timeout and the cassette time. Defaults to `systemClock`. */
	readonly clock?: Clock;
}

export interface ResolveRequest {
	readonly purpose: ModelPurpose;
	readonly modelId?: ModelId;
	readonly require?: readonly Capability[];
}

export interface ResolveEmbeddingRequest {
	readonly modelId?: ModelId;
}

export interface ResolvedModel {
	readonly model: LanguageModelV4;
	readonly entry: ModelEntry;
	readonly mode: RunMode;
}

export interface ResolvedEmbeddingModel {
	readonly model: EmbeddingModelV4;
	readonly entry: ModelEntry;
	readonly mode: RunMode;
}

/** A selectable model for the UI (Req 3.2). Plain data only, so it can cross to the client. */
export interface ModelOption {
	readonly id: ModelId;
	readonly displayName: string;
	readonly provider: ProviderId;
	readonly capabilities: ModelCapabilities;
	readonly contextWindow: number;
}

export interface ModelGateway {
	resolve(request: ResolveRequest): Promise<ResolvedModel>;
	resolveEmbedding(request?: ResolveEmbeddingRequest): Promise<ResolvedEmbeddingModel>;
	/** Models of the current run mode whose provider credentials are configured. */
	availableModels(): readonly ModelOption[];
}

function isCatalogModelId(id: ModelId): id is CatalogModelId {
	return Object.hasOwn(MODEL_CATALOG, id);
}

function supportsCapability(entry: ModelEntry, capability: Capability): boolean {
	if (capability === "promptCache") return entry.capabilities.promptCache !== "none";
	return entry.capabilities[capability];
}

function toOption(entry: ModelEntry): ModelOption {
	return {
		id: entry.id,
		displayName: entry.displayName,
		provider: entry.provider,
		capabilities: { ...entry.capabilities },
		contextWindow: entry.contextWindow,
	};
}

/** Only the configured secret values, in the env-variable form `createRedactor` reads. */
function credentialSecrets(credentials: PlatformConfig["credentials"]) {
	return {
		ANTHROPIC_API_KEY: credentials.anthropic,
		OPENAI_API_KEY: credentials.openai,
		AZURE_API_KEY: credentials.azure?.apiKey,
		GOOGLE_GENERATIVE_AI_API_KEY: credentials.google,
		TAVILY_API_KEY: credentials.tavily,
	};
}

/**
 * Resolves a purpose (and optional model ID) to a model for the current run mode (plan C6).
 * Checks run in this order, all before any model call: catalog and run mode (D9), capability
 * (Req 2.9), provider credentials (Req 2.6), then the Ollama preflight in `local` (Req 2.7).
 */
export function createModelGateway(deps: GatewayDeps): ModelGateway {
	const { config } = deps;
	const providers = deps.providers ?? PROVIDER_FACTORIES;
	const clock = deps.clock ?? systemClock;
	const settings: ProviderSettings = {
		credentials: config.credentials,
		ollamaBaseUrl: config.ollamaBaseUrl,
	};
	const scenarios = deps.mock?.scenarios ?? [...M1_2_SCENARIOS, ...M1_3_SCENARIOS];
	const cassettes = deps.mock?.cassettes ?? createCassetteStore(CASSETTE_FIXTURE_DIRECTORY);
	const embeddingDimensions = deps.mock?.embeddingDimensions ?? MOCK_EMBEDDING_DIMENSIONS;
	const ollama = createOllamaPreflight({
		baseUrl: config.ollamaBaseUrl,
		fetcher: deps.fetcher ?? createNodeHttpFetcher(),
		clock,
	});

	function selectEntry(purpose: ModelPurpose, modelId: ModelId | undefined): ModelEntry {
		const id = modelId ?? config.models[purpose];
		if (id === undefined) {
			throw new ModelSelectionError({
				reason: "no-default",
				mode: config.mode,
				provider: config.provider,
				purpose,
			});
		}
		if (!isCatalogModelId(id)) {
			throw new ModelSelectionError({ reason: "unknown-model", mode: config.mode, modelId: id });
		}
		const entry: ModelEntry = MODEL_CATALOG[id];
		if (!entry.modes.includes(config.mode)) {
			throw new ModelSelectionError({
				reason: "mode-mismatch",
				mode: config.mode,
				modelId: id,
				modes: entry.modes,
			});
		}
		return entry;
	}

	function assertCapabilities(entry: ModelEntry, required: readonly Capability[]): void {
		const unsupported = required.find((capability) => !supportsCapability(entry, capability));
		if (unsupported !== undefined) {
			throw new CapabilityUnsupportedError(unsupported, entry.id, entry.displayName);
		}
	}

	async function assertReachable(entry: ModelEntry): Promise<void> {
		const missing = missingCredentials(entry.provider, config.credentials);
		if (missing.length > 0) throw new ProviderCredentialsMissingError(entry.provider, missing);
		if (entry.provider === "ollama") await ollama.ensureModel(entry.id);
	}

	function withRecording(model: LanguageModelV4, purpose: ModelPurpose): LanguageModelV4 {
		if (!config.recording || config.mode === "mock") return model;
		const store = deps.recording?.store ?? createCassetteStore(CASSETTE_FIXTURE_DIRECTORY);
		const redactor =
			deps.recording?.redactor ?? createRedactor(credentialSecrets(config.credentials));
		return wrapLanguageModel({
			model,
			middleware: recordingMiddleware(store, redactor, {
				purpose,
				recordedWith: config.mode,
				now: () => new Date(clock.now()),
			}),
		});
	}

	return {
		async resolve(request) {
			const entry = selectEntry(request.purpose, request.modelId);
			if (entry.capabilities.embedding) {
				throw new ModelSelectionError({
					reason: "purpose-mismatch",
					mode: config.mode,
					modelId: entry.id,
					purpose: request.purpose,
				});
			}
			assertCapabilities(entry, request.require ?? []);
			await assertReachable(entry);
			const model =
				entry.provider === "mock"
					? createScenarioModel({ purpose: request.purpose, scenarios, cassettes })
					: providers[entry.provider](settings).languageModel(entry.id);
			return { model: withRecording(model, request.purpose), entry, mode: config.mode };
		},

		async resolveEmbedding(request = {}) {
			const entry = selectEntry("embedding", request.modelId);
			assertCapabilities(entry, ["embedding"]);
			await assertReachable(entry);
			const model =
				entry.provider === "mock"
					? createDeterministicEmbeddingModel({ dimensions: embeddingDimensions })
					: providers[entry.provider](settings).embeddingModel(entry.id);
			return { model, entry, mode: config.mode };
		},

		availableModels() {
			return listModels({ mode: config.mode })
				.filter((entry) => missingCredentials(entry.provider, config.credentials).length === 0)
				.map(toOption);
		},
	};
}
