// Ingestion of `@platform/ai-core/rag` (plan C5).
export { type Chunk, type ChunkOptions, chunkDocument, type LoadedDocument } from "./chunk";
export {
	INGEST_SOURCES,
	type IngestedDocument,
	type IngestParams,
	type IngestResult,
	type IngestSource,
	ingestDocuments,
	listIngestableFiles,
} from "./ingest";
export {
	isSkippedFile,
	type LoadKnowledgeFileOptions,
	loadKnowledgeFile,
	SKIP_REASONS,
	type SkippedFile,
	type SkipReason,
} from "./loader";
export { type MarkdownSection, splitMarkdown } from "./markdown";
export { extractPdfPages } from "./pdf";
export { buildFullTextQuery, toSearchText } from "./search-text";
