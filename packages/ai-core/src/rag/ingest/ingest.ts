import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_RAG } from "../../config/defaults";
import { PlatformError } from "../../errors";
import type { ResolvedEmbeddingModel } from "../../models";
import { type Clock, systemClock } from "../../ports/clock";
import type { RagDatabase } from "../db";
import { assertKnowledgeBaseCompatible, embedTexts, KNOWLEDGE_BASE_DIMENSIONS } from "../embedding";
import { type ChunkInput, createKnowledgeStore, type DocumentInput } from "../store";
import { chunkDocument } from "./chunk";
import { isSkippedFile, loadKnowledgeFile, type SkippedFile } from "./loader";
import { toSearchText } from "./search-text";

/** Where a document comes from; it prefixes the document ID so same-named files never collide. */
export const INGEST_SOURCES = ["knowledge", "eval-corpus"] as const;
export type IngestSource = (typeof INGEST_SOURCES)[number];

const DOCUMENT_ID_PREFIX: Readonly<Record<IngestSource, string>> = {
	knowledge: "kb:",
	"eval-corpus": "eval:",
};

const SUPPORTED_EXTENSIONS = new Set([".md", ".markdown", ".pdf"]);
/** The explanatory file in `knowledge/`; it is not one of the learner's documents. */
const README_FILE = "README.md";

export interface IngestedDocument {
	readonly documentId: string;
	readonly title: string;
	readonly chunks: number;
}

export interface IngestResult {
	readonly ingested: IngestedDocument[];
	readonly skipped: SkippedFile[];
	readonly embeddingModelId: string;
}

export interface IngestParams {
	readonly db: RagDatabase;
	readonly embedding: ResolvedEmbeddingModel;
	readonly source: IngestSource;
	/** Absolute path of the directory the file names are resolved against. */
	readonly root: string;
	readonly files: readonly string[];
	/** Added to each document's own front matter tags. */
	readonly tags?: readonly string[];
	/** Empties the knowledge base first, so a different embedding model can start over. */
	readonly reset?: boolean;
	readonly signal?: AbortSignal;
	readonly clock?: Clock;
}

interface PreparedDocument {
	readonly document: DocumentInput;
	readonly chunks: ChunkInput[];
}

/** Supported files directly inside `root`, in name order (hidden files and README.md excluded). */
export async function listIngestableFiles(root: string): Promise<string[]> {
	let entries: Dirent[];
	try {
		entries = await readdir(root, { withFileTypes: true });
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
		throw error;
	}
	return entries
		.filter(
			(entry) =>
				entry.isFile() &&
				!entry.name.startsWith(".") &&
				entry.name !== README_FILE &&
				SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase()),
		)
		.map((entry) => entry.name)
		.sort();
}

/**
 * Reads, splits, embeds and stores documents (plan C5). Every file name is checked and loaded
 * and every embedding is computed before the first write, then all documents are written in one
 * transaction: a failure or an abort before that point changes nothing, and once the write has
 * started it runs to completion.
 */
export async function ingestDocuments(params: IngestParams): Promise<IngestResult> {
	const files = [...new Set(params.files)];
	if (files.length > DEFAULT_RAG.maxIngestFiles) {
		throw new PlatformError(
			"invalid-request",
			`一度に取り込めるファイルは ${DEFAULT_RAG.maxIngestFiles} 件までです。`,
			{ reason: "too-many-files", limit: DEFAULT_RAG.maxIngestFiles, requested: files.length },
		);
	}
	const clock = params.clock ?? systemClock;
	params.signal?.throwIfAborted();

	const skipped: SkippedFile[] = [];
	const prepared: PreparedDocument[] = [];
	const seen = new Set<string>();
	for (const file of files) {
		const loaded = await loadKnowledgeFile(params.root, file);
		if (isSkippedFile(loaded)) {
			skipped.push(loaded);
			continue;
		}
		const documentId = `${DOCUMENT_ID_PREFIX[params.source]}${loaded.file}`;
		// Two spellings of one file (case, Unicode form) resolve to the same on-disk name.
		if (seen.has(documentId)) continue;
		seen.add(documentId);
		const chunks = chunkDocument(loaded, { documentId }).map((chunk, ordinal) => ({
			id: chunk.id,
			ordinal,
			headingPath: chunk.headingPath,
			page: chunk.page ?? null,
			body: chunk.body,
			searchText: toSearchText(chunk.body),
		}));
		if (chunks.length === 0) {
			skipped.push({ file, reason: "no-text" });
			continue;
		}
		prepared.push({
			document: {
				id: documentId,
				title: loaded.title,
				sourceType: loaded.sourceType,
				tags: [...loaded.tags, ...(params.tags ?? [])],
			},
			chunks,
		});
	}

	const meta = {
		embeddingModelId: params.embedding.entry.id,
		dimensions: KNOWLEDGE_BASE_DIMENSIONS,
	};
	const result = (embeddingModelId: string): IngestResult => ({
		ingested: prepared.map(({ document, chunks }) => ({
			documentId: document.id,
			title: document.title,
			chunks: chunks.length,
		})),
		skipped,
		embeddingModelId,
	});
	if (prepared.length === 0) {
		// Nothing to write, but a reset is still a request to empty the base. The result names the
		// model the base holds afterwards, so a caller can tell whether anything changed.
		const store = createKnowledgeStore(params.db, { clock });
		if (params.reset) await store.reset();
		const existing = params.reset ? undefined : await store.getMeta();
		return result(existing?.embeddingModelId ?? meta.embeddingModelId);
	}

	if (!params.reset) {
		const existing = await createKnowledgeStore(params.db, { clock }).getMeta();
		assertKnowledgeBaseCompatible(existing, params.embedding);
	}
	const vectors = await embedTexts({
		resolved: params.embedding,
		values: prepared.flatMap(({ chunks }) => chunks.map((chunk) => chunk.body)),
		...(params.signal ? { signal: params.signal } : {}),
	});
	params.signal?.throwIfAborted();

	await params.db.transaction(async (tx) => {
		const store = createKnowledgeStore(tx, { clock });
		if (params.reset) await store.reset();
		let offset = 0;
		for (const { document, chunks } of prepared) {
			await store.replaceDocument(
				document,
				chunks,
				vectors.slice(offset, offset + chunks.length),
				meta,
			);
			offset += chunks.length;
		}
	});
	return result(meta.embeddingModelId);
}
