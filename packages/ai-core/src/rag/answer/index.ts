// Public API of the answer area (plan C8); re-exported from `@platform/ai-core/rag`.
export {
	CITATION_EXCERPT_CHARACTERS,
	type Citation,
	type CitationLocator,
	type ResolvedCitations,
	resolveCitations,
} from "./citations";
export {
	type AnswerPrompt,
	buildAnswerPrompt,
	NO_EVIDENCE_MESSAGE,
	type StreamRagAnswerParams,
	streamRagAnswer,
} from "./prompt";
