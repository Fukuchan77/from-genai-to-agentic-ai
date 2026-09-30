import { PlatformError } from "../errors";
import type { ModelPurpose } from "../models/types";
import type { Cassette, CassetteStore } from "./cassette-store";
import { type LanguageModelV4CallOptions, type RequestKey, requestKey } from "./request-key";
import {
	deriveScenarioContext,
	type ScenarioDefinition,
	type ScenarioResponse,
	scenarioMatches,
} from "./scenario";

export interface ScenarioMatchLocation {
	readonly scenarioId: string;
	readonly turnIndex: number;
}

export type ResolvedMockResponse =
	| {
			readonly source: "scenario";
			readonly scenarioId: string;
			readonly turnIndex: number;
			readonly response: ScenarioResponse;
	  }
	| { readonly source: "cassette"; readonly cassette: Cassette };

export class MockFixtureMissingError extends PlatformError {
	readonly key: RequestKey;
	readonly nearest: readonly string[];

	constructor(key: RequestKey, nearest: readonly string[]) {
		super("provider-unavailable", "モック応答が見つかりませんでした。", { key, nearest });
		this.key = key;
		this.nearest = nearest;
	}
}

export function findAmbiguousScenarioMatches(
	params: LanguageModelV4CallOptions,
	purpose: ModelPurpose,
	scenarios: readonly ScenarioDefinition[],
): readonly ScenarioMatchLocation[] {
	const context = deriveScenarioContext(params, purpose);
	return scenarios.flatMap((scenario) =>
		scenario.turns.flatMap((turn, turnIndex) =>
			scenarioMatches(turn.match, context) ? [{ scenarioId: scenario.id, turnIndex }] : [],
		),
	);
}

export async function resolveMockResponse(options: {
	readonly params: LanguageModelV4CallOptions;
	readonly purpose: ModelPurpose;
	readonly scenarios: readonly ScenarioDefinition[];
	readonly cassettes?: CassetteStore;
}): Promise<ResolvedMockResponse> {
	const matches = findAmbiguousScenarioMatches(options.params, options.purpose, options.scenarios);
	const first = matches[0];
	if (first) {
		const scenario = options.scenarios.find((candidate) => candidate.id === first.scenarioId);
		const response = scenario?.turns[first.turnIndex]?.respond;
		if (response) {
			return {
				source: "scenario",
				scenarioId: first.scenarioId,
				turnIndex: first.turnIndex,
				response,
			};
		}
	}
	const key = requestKey(options.params, options.purpose);
	const cassette = await options.cassettes?.get(key);
	if (cassette) return { source: "cassette", cassette };
	throw new MockFixtureMissingError(
		key,
		options.scenarios.map((scenario) => scenario.id).slice(0, 5),
	);
}
