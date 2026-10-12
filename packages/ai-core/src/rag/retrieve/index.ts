// Public API of the retrieval area (plan C7); re-exported from `@platform/ai-core/rag`.

export type { HypotheticalAnswerParams, HypotheticalAnswerResult } from "./hyde";
export { generateHypotheticalAnswer } from "./hyde";
export type { ExpandQueryParams, ExpandQueryResult } from "./multi-query";
export { expandQuery } from "./multi-query";
export type { RetrievalDeps, RetrievalResult, RunRetrievalParams } from "./pipeline";
export { runRetrieval } from "./pipeline";
export { type FusedRank, reciprocalRankFusion } from "./rrf";
export {
	createTraceBuilder,
	type RerankOutcome,
	type RerankSkipReason,
	type RetrievalMethods,
	type RetrievalSettings,
	type RetrievalStage,
	type RetrievalTrace,
	type SearchCandidates,
	type StageEvent,
	type StageRecord,
	type TraceBuilder,
	type TraceBuilderOptions,
} from "./trace";
