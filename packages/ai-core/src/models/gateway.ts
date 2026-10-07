import { M1_2_SCENARIOS } from "../../fixtures/scenarios/m1-2";
import { M1_3_SCENARIOS } from "../../fixtures/scenarios/m1-3";
import type { PlatformConfig } from "../config";
import { type CassetteStore, createCassetteStore } from "../mock/cassette-store";
import { CASSETTE_FIXTURE_DIRECTORY } from "../mock/fixtures";
import type { ScenarioDefinition } from "../mock/scenario";
import { createScenarioModel } from "../mock/scenario-model";
import type { HttpFetcher } from "../ports/http";
import { type CatalogModelId, MODEL_CATALOG } from "./catalog";
import { ModelSelectionError, ProviderCredentialsMissingError } from "./errors";
import {
	type LanguageModelV4,
	missingCredentials,
	PROVIDER_FACTORIES,
	type ProviderFactories,
	type ProviderSettings,
} from "./providers";
import type { Capability, ModelEntry, ModelId, ModelPurpose, RunMode } from "./types";

export interface GatewayMockOptions {
	/** Scenario scripts for `mock` mode; defaults to the M1 scenarios. */
	readonly scenarios?: readonly ScenarioDefinition[];
	/** Recorded cassettes for `mock` mode; defaults to `fixtures/cassettes/`. */
	readonly cassettes?: CassetteStore;
}

export interface GatewayDeps {
	readonly config: PlatformConfig;
	readonly mock?: GatewayMockOptions;
	/** Provider factory table; tests inject fakes. Defaults to {@link PROVIDER_FACTORIES}. */
	readonly providers?: ProviderFactories;
	/** HTTP port used by the Ollama preflight in `local` mode. */
	readonly fetcher?: HttpFetcher;
}

export interface ResolveRequest {
	readonly purpose: ModelPurpose;
	readonly modelId?: ModelId;
	readonly require?: readonly Capability[];
}

export interface ResolvedModel {
	readonly model: LanguageModelV4;
	readonly entry: ModelEntry;
	readonly mode: RunMode;
}

export interface ModelGateway {
	resolve(request: ResolveRequest): Promise<ResolvedModel>;
}

function isCatalogModelId(id: ModelId): id is CatalogModelId {
	return Object.hasOwn(MODEL_CATALOG, id);
}

export function createModelGateway(deps: GatewayDeps): ModelGateway {
	const { config } = deps;
	const providers = deps.providers ?? PROVIDER_FACTORIES;
	const settings: ProviderSettings = {
		credentials: config.credentials,
		ollamaBaseUrl: config.ollamaBaseUrl,
	};
	const scenarios = deps.mock?.scenarios ?? [...M1_2_SCENARIOS, ...M1_3_SCENARIOS];
	const cassettes = deps.mock?.cassettes ?? createCassetteStore(CASSETTE_FIXTURE_DIRECTORY);

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

	function assertCredentials(entry: ModelEntry): void {
		const missing = missingCredentials(entry.provider, config.credentials);
		if (missing.length > 0) throw new ProviderCredentialsMissingError(entry.provider, missing);
	}

	return {
		async resolve(request) {
			const entry = selectEntry(request.purpose, request.modelId);
			assertCredentials(entry);
			if (entry.provider === "mock") {
				return {
					model: createScenarioModel({ purpose: request.purpose, scenarios, cassettes }),
					entry,
					mode: config.mode,
				};
			}
			const model = providers[entry.provider](settings).languageModel(entry.id);
			return { model, entry, mode: config.mode };
		},
	};
}
