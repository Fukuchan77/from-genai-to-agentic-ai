// Public API of `@platform/ai-core/rag` (plan C4-C10, C13). Everything here is server-only: it pulls in the
// database drivers, `node:fs` and the embedding SDK, so client components must not import it.

export {
	type CitationRegistry,
	createSearchKnowledgeBaseTool,
	type KnowledgeSearcher,
	type KnowledgeSearchHit,
	SEARCH_KNOWLEDGE_BASE_TOOL_NAME,
	type SearchKnowledgeBaseResult,
} from "../aci/tools/search-knowledge-base";
export {
	AGENTIC_RAG_INSTRUCTIONS,
	type AgenticRagSummary,
	createCitationRegistry,
	createKnowledgeSearcher,
	type KnowledgeSearcherOptions,
	type RagCitationRegistry,
	summarizeAgenticRun,
} from "./agentic";
export {
	buildAnswerPrompt,
	CITATION_EXCERPT_CHARACTERS,
	type Citation,
	type CitationLocator,
	NO_EVIDENCE_MESSAGE,
	type ResolvedCitations,
	resolveCitations,
	streamRagAnswer,
} from "./answer";
export {
	createPgliteDatabase,
	createPostgresDatabase,
	EMBEDDING_DIMENSIONS,
	KnowledgeBaseUnavailableError,
	type MigrationResult,
	type RagDatabase,
	type RagDatabaseHandle,
	ragChunks,
	ragDocuments,
	ragMeta,
	ragMigrations,
	runMigrations,
} from "./db";
export {
	assertKnowledgeBaseCompatible,
	embedQuery,
	embedTexts,
	KNOWLEDGE_BASE_DIMENSIONS,
	type KnowledgeBaseMeta,
} from "./embedding";
export * from "./eval";
export {
	buildFullTextQuery,
	type Chunk,
	type ChunkOptions,
	chunkDocument,
	extractPdfPages,
	INGEST_SOURCES,
	type IngestedDocument,
	type IngestParams,
	type IngestResult,
	type IngestSource,
	ingestDocuments,
	isSkippedFile,
	type LoadedDocument,
	type LoadKnowledgeFileOptions,
	listIngestableFiles,
	loadKnowledgeFile,
	type MarkdownSection,
	SKIP_REASONS,
	type SkippedFile,
	type SkipReason,
	splitMarkdown,
	toSearchText,
} from "./ingest";
export { createLexicalRerank, LEXICAL_RERANK_MODEL_ID } from "./lexical-rerank";
export {
	type RagEvent,
	type RagQueryRequest,
	type RagResult,
	type RagStage,
	type RagStageEvent,
	streamRagQuery,
} from "./query";
export {
	INGEST_REQUEST_LIMITS,
	type IngestRequest,
	ingestRequestSchema,
	QUERY_REQUEST_LIMITS,
	type QueryMethods,
	type QueryRequest,
	type QuerySettings,
	queryRequestSchema,
} from "./request-schema";
export * from "./retrieve";
export {
	type ChunkInput,
	createKnowledgeStore,
	type DocumentInput,
	type DocumentSummary,
	type FullTextSearchParams,
	type KnowledgeChunk,
	type KnowledgeStore,
	type KnowledgeStoreOptions,
	type ScoredChunk,
	type SearchFilter,
	type VectorSearchParams,
} from "./store";
