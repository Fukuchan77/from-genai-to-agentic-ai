// Public API of `@platform/ai-core/rag` (plan C4-C6, C13; the retrieval, answer, agentic and
// evaluation areas are added by later tasks). Everything here is server-only: it pulls in the
// database drivers, `node:fs` and the embedding SDK, so client components must not import it.
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
export {
	INGEST_REQUEST_LIMITS,
	type IngestRequest,
	ingestRequestSchema,
} from "./request-schema";
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
