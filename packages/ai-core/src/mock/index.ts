import { M3_1_SCENARIOS } from "../../fixtures/scenarios/m3-1";
import { M3_2_SCENARIOS } from "../../fixtures/scenarios/m3-2";
import { M3_3_SCENARIOS } from "../../fixtures/scenarios/m3-3";
import { M3_4_SCENARIOS } from "../../fixtures/scenarios/m3-4";
import { M3_5_SCENARIOS } from "../../fixtures/scenarios/m3-5";
import { M3_6_SCENARIOS } from "../../fixtures/scenarios/m3-6";
import type { ScenarioDefinition } from "./scenario";

/**
 * Every M3 scenario, in one list for the `mock` gateway. Each wave adds its module's scenarios
 * here (3-1 in W2 … 3-6 in W6) and updates the expected counts in `m3-scenarios.test.ts`, whose
 * detectors keep the list unambiguous.
 */
export const M3_SCENARIOS: readonly ScenarioDefinition[] = Object.freeze([
	...M3_1_SCENARIOS,
	...M3_2_SCENARIOS,
	...M3_3_SCENARIOS,
	...M3_4_SCENARIOS,
	...M3_5_SCENARIOS,
	...M3_6_SCENARIOS,
]);

export { M1_2_SCENARIOS } from "../../fixtures/scenarios/m1-2";
export { M1_3_SCENARIOS } from "../../fixtures/scenarios/m1-3";
export {
	M2_1_SAMPLE_QUESTIONS,
	M2_1_SCENARIOS,
	M2_CORPUS_TEXT,
} from "../../fixtures/scenarios/m2-1";
export { M2_2_SCENARIOS } from "../../fixtures/scenarios/m2-2";
export { M2_3_SAMPLE_TASKS, M2_3_SCENARIOS } from "../../fixtures/scenarios/m2-3";
export { M2_4_SAMPLE_TASKS, M2_4_SCENARIOS } from "../../fixtures/scenarios/m2-4";
export { M3_1_SAMPLE_TASKS, M3_1_SCENARIOS } from "../../fixtures/scenarios/m3-1";
export { M3_2_SAMPLE_INQUIRIES, M3_2_SCENARIOS } from "../../fixtures/scenarios/m3-2";
export { M3_3_SAMPLE_INSTRUCTIONS, M3_3_SCENARIOS } from "../../fixtures/scenarios/m3-3";
export { M3_4_SAMPLE_THEMES, M3_4_SCENARIOS } from "../../fixtures/scenarios/m3-4";
export {
	M3_5_SAMPLE_ANSWERS,
	M3_5_SAMPLE_OVERVIEWS,
	M3_5_SCENARIOS,
} from "../../fixtures/scenarios/m3-5";
export {
	M3_6_SAMPLE_DRAFTS,
	M3_6_SAMPLE_MESSAGES,
	M3_6_SCENARIOS,
} from "../../fixtures/scenarios/m3-6";
export {
	ARXIV_FIXTURE_FEEDS,
	type ArxivFixtureFeed,
	createArxivFixtureFetcher,
} from "./arxiv-fixtures";
export { type Cassette, type CassetteStore, createCassetteStore } from "./cassette-store";
export { createDeterministicEmbeddingModel } from "./deterministic-embedding";
export {
	CASSETTE_FIXTURE_DIRECTORY,
	createFixtureHttpFetcher,
	createFixtureTranscriptSource,
	createFixtureWebSearch,
	DEFAULT_FIXTURE_DIRECTORY,
	describeHttpFixtureRequest,
	type FixtureSet,
	type HttpFixture,
	httpFixtureRequestKey,
	loadFixtureSet,
	type TranscriptFixture,
	transcriptFixtureRequestKey,
	type WebSearchFixture,
	webSearchFixtureRequestKey,
} from "./fixtures";
export {
	type RecordingMiddlewareOptions,
	type RecordingStore,
	recordingHttpFetcher,
	recordingMiddleware,
	recordingTranscriptSource,
	recordingWebSearch,
} from "./recording";
export { createRedactor, type Redactor } from "./redactor";
export { normalizeRequest, type RequestKey, requestKey } from "./request-key";
export {
	findAmbiguousScenarioMatches,
	MockFixtureMissingError,
	type ResolvedMockResponse,
	resolveMockResponse,
	type ScenarioMatchLocation,
} from "./resolve";
export {
	defineScenario,
	deriveScenarioContext,
	type ScenarioContext,
	type ScenarioDefinition,
	type ScenarioMatch,
	type ScenarioResponse,
	type ScenarioToolCall,
	type ScenarioTurn,
	type ScenarioUsage,
	scenarioMatches,
} from "./scenario";
export { createScenarioModel } from "./scenario-model";
