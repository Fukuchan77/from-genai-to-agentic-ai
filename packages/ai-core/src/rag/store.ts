import {
	and,
	arrayOverlaps,
	asc,
	cosineDistance,
	desc,
	eq,
	gte,
	inArray,
	type SQL,
	sql,
} from "drizzle-orm";
import { PlatformError } from "../errors";
import { type Clock, systemClock } from "../ports/clock";
import { EMBEDDING_DIMENSIONS, type RagDatabase, ragChunks, ragDocuments, ragMeta } from "./db";
import { assertKnowledgeBaseCompatible, type KnowledgeBaseMeta } from "./embedding";

// Every SQL statement of the knowledge base lives in this file (plan C6), so the driver-specific
// parts stay in `rag/db/` and the rest of `rag/` never sees a query.

const META_ROW_ID = "kb";

export interface DocumentInput {
	readonly id: string;
	readonly title: string;
	readonly sourceType: "markdown" | "pdf";
	readonly tags: readonly string[];
}

export interface ChunkInput {
	readonly id: string;
	readonly ordinal: number;
	readonly headingPath: readonly string[];
	/** 1-based PDF page; `null` for Markdown. */
	readonly page: number | null;
	readonly body: string;
	/** `toSearchText(body)`: the segmented text that `tsv` is generated from. */
	readonly searchText: string;
}

/** A stored chunk with the source metadata a citation needs. */
export interface KnowledgeChunk {
	readonly id: string;
	readonly documentId: string;
	readonly documentTitle: string;
	readonly ordinal: number;
	readonly headingPath: string[];
	readonly page: number | null;
	readonly body: string;
}

/** Plain data for the document list; `ingestedAt` is an ISO 8601 string. */
export interface DocumentSummary {
	readonly id: string;
	readonly title: string;
	readonly sourceType: "markdown" | "pdf";
	readonly tags: string[];
	readonly chunkCount: number;
	readonly ingestedAt: string;
}

/** Narrows a search; an empty or missing list applies no restriction. */
export interface SearchFilter {
	/** Chunks of these documents only. */
	readonly documentIds?: readonly string[];
	/** Chunks of documents that have at least one of these tags. */
	readonly tags?: readonly string[];
}

export interface ScoredChunk {
	readonly chunk: KnowledgeChunk;
	/** Higher is better: the cosine similarity for vector search, `ts_rank` for full-text search. */
	readonly score: number;
	/** Cosine similarity in [-1, 1]; set by vector search only. */
	readonly similarity?: number;
}

export interface VectorSearchParams {
	readonly embedding: readonly number[];
	readonly limit: number;
	/** Candidates with a lower cosine similarity are dropped; equal is kept. */
	readonly minSimilarity: number;
	readonly filter?: SearchFilter;
}

export interface FullTextSearchParams {
	/** Output of `buildFullTextQuery`; `undefined` (no usable words) searches nothing. */
	readonly query: string | undefined;
	readonly limit: number;
	readonly filter?: SearchFilter;
}

export interface KnowledgeStore {
	searchByVector(params: VectorSearchParams): Promise<ScoredChunk[]>;
	searchByFullText(params: FullTextSearchParams): Promise<ScoredChunk[]>;
	/**
	 * Replaces one document in a single transaction (delete, then insert). The embedding record
	 * is created on the first write and checked on every later one.
	 */
	replaceDocument(
		document: DocumentInput,
		chunks: readonly ChunkInput[],
		embeddings: readonly (readonly number[])[],
		meta: KnowledgeBaseMeta,
	): Promise<void>;
	getChunks(ids: readonly string[]): Promise<KnowledgeChunk[]>;
	listDocuments(): Promise<DocumentSummary[]>;
	getMeta(): Promise<KnowledgeBaseMeta | undefined>;
	/** Removes every document, chunk and the embedding record. */
	reset(): Promise<void>;
}

export interface KnowledgeStoreOptions {
	/** Source of `ingested_at` and `created_at`; SQL never calls `now()` for these. */
	readonly clock?: Clock;
}

const CHUNK_COLUMNS = {
	id: ragChunks.id,
	documentId: ragChunks.documentId,
	documentTitle: ragDocuments.title,
	ordinal: ragChunks.ordinal,
	headingPath: ragChunks.headingPath,
	page: ragChunks.page,
	body: ragChunks.body,
} as const;

// `buildFullTextQuery` joins plain words with " | "; anything else would reach `to_tsquery` as
// operator syntax, so it is refused here rather than trusted.
const PLAIN_OR_QUERY = /^[\p{L}\p{N}]+(?: \| [\p{L}\p{N}]+)*$/u;

function assertSearchable(limit: number): void {
	if (!Number.isInteger(limit) || limit < 1) {
		throw new PlatformError("invalid-request", "検索の件数は 1 以上の整数で指定してください。", {
			limit,
		});
	}
}

function filterConditions(filter: SearchFilter | undefined): SQL[] {
	const conditions: SQL[] = [];
	if (filter?.documentIds?.length) {
		conditions.push(inArray(ragChunks.documentId, [...filter.documentIds]));
	}
	if (filter?.tags?.length) conditions.push(arrayOverlaps(ragDocuments.tags, [...filter.tags]));
	return conditions;
}

function assertWritable(
	chunks: readonly ChunkInput[],
	embeddings: readonly (readonly number[])[],
): void {
	if (chunks.length !== embeddings.length) {
		throw new PlatformError(
			"output-invalid",
			"チャンクの数と埋め込みの数が一致しません。ナレッジベースは変更していません。",
			{ chunks: chunks.length, embeddings: embeddings.length },
		);
	}
	for (const embedding of embeddings) {
		if (embedding.length !== EMBEDDING_DIMENSIONS) {
			throw new PlatformError(
				"output-invalid",
				`埋め込みの次元が ${EMBEDDING_DIMENSIONS} ではありません（${embedding.length}）。ナレッジベースは変更していません。`,
				{ expected: EMBEDDING_DIMENSIONS, actual: embedding.length },
			);
		}
	}
}

export function createKnowledgeStore(
	db: RagDatabase,
	options: KnowledgeStoreOptions = {},
): KnowledgeStore {
	const clock = options.clock ?? systemClock;

	async function readMeta(executor: RagDatabase): Promise<KnowledgeBaseMeta | undefined> {
		const [row] = await executor
			.select({ embeddingModelId: ragMeta.embeddingModelId, dimensions: ragMeta.dimensions })
			.from(ragMeta)
			.where(eq(ragMeta.id, META_ROW_ID));
		return row;
	}

	return {
		async searchByVector({ embedding, limit, minSimilarity, filter }) {
			assertSearchable(limit);
			if (embedding.length !== EMBEDDING_DIMENSIONS) {
				throw new PlatformError(
					"output-invalid",
					`検索の埋め込みの次元が ${EMBEDDING_DIMENSIONS} ではありません（${embedding.length}）。`,
					{ expected: EMBEDDING_DIMENSIONS, actual: embedding.length },
				);
			}
			const distance = cosineDistance(ragChunks.embedding, [...embedding]);
			const similarity = sql<number>`1 - (${distance})`;
			const rows = await db
				.select({ ...CHUNK_COLUMNS, similarity })
				.from(ragChunks)
				.innerJoin(ragDocuments, eq(ragChunks.documentId, ragDocuments.id))
				.where(and(gte(similarity, minSimilarity), ...filterConditions(filter)))
				.orderBy(asc(distance), asc(ragChunks.id))
				.limit(limit);
			return rows.map(({ similarity: value, ...chunk }) => ({
				chunk,
				score: Number(value),
				similarity: Number(value),
			}));
		},

		async searchByFullText({ query, limit, filter }) {
			assertSearchable(limit);
			if (query === undefined) return [];
			if (!PLAIN_OR_QUERY.test(query)) {
				throw new PlatformError("invalid-request", "全文検索のクエリの形式が正しくありません。", {
					reason: "invalid-full-text-query",
				});
			}
			const tsquery = sql`to_tsquery('simple', ${query})`;
			const rank = sql<number>`ts_rank(${ragChunks.tsv}, ${tsquery})`;
			const rows = await db
				.select({ ...CHUNK_COLUMNS, rank })
				.from(ragChunks)
				.innerJoin(ragDocuments, eq(ragChunks.documentId, ragDocuments.id))
				.where(and(sql`${ragChunks.tsv} @@ ${tsquery}`, ...filterConditions(filter)))
				.orderBy(desc(rank), asc(ragChunks.id))
				.limit(limit);
			return rows.map(({ rank: value, ...chunk }) => ({ chunk, score: Number(value) }));
		},

		async replaceDocument(document, chunks, embeddings, meta) {
			assertWritable(chunks, embeddings);
			const now = new Date(clock.now());
			await db.transaction(async (tx) => {
				// A concurrent first write may create the row between the read and the insert; the
				// conflict is ignored and the row is read again, so both writers see the winner.
				await tx
					.insert(ragMeta)
					.values({
						id: META_ROW_ID,
						embeddingModelId: meta.embeddingModelId,
						dimensions: meta.dimensions,
						createdAt: now,
					})
					.onConflictDoNothing();
				assertKnowledgeBaseCompatible(await readMeta(tx), { entry: { id: meta.embeddingModelId } });

				await tx.delete(ragDocuments).where(eq(ragDocuments.id, document.id));
				await tx.insert(ragDocuments).values({
					id: document.id,
					title: document.title,
					sourceType: document.sourceType,
					tags: [...new Set(document.tags)],
					chunkCount: chunks.length,
					ingestedAt: now,
				});
				if (chunks.length === 0) return;
				await tx.insert(ragChunks).values(
					chunks.map((chunk, index) => ({
						id: chunk.id,
						documentId: document.id,
						ordinal: chunk.ordinal,
						headingPath: [...chunk.headingPath],
						page: chunk.page,
						body: chunk.body,
						searchText: chunk.searchText,
						embedding: [...(embeddings[index] ?? [])],
					})),
				);
			});
		},

		async getChunks(ids) {
			if (ids.length === 0) return [];
			const rows = await db
				.select(CHUNK_COLUMNS)
				.from(ragChunks)
				.innerJoin(ragDocuments, eq(ragChunks.documentId, ragDocuments.id))
				.where(inArray(ragChunks.id, [...ids]));
			const byId = new Map(rows.map((row) => [row.id, row]));
			return ids.flatMap((id) => byId.get(id) ?? []);
		},

		async listDocuments() {
			const rows = await db.select().from(ragDocuments).orderBy(ragDocuments.id);
			return rows.map((row) => ({
				id: row.id,
				title: row.title,
				sourceType: row.sourceType,
				tags: row.tags,
				chunkCount: row.chunkCount,
				ingestedAt: row.ingestedAt.toISOString(),
			}));
		},

		getMeta() {
			return readMeta(db);
		},

		async reset() {
			await db.transaction(async (tx) => {
				await tx.delete(ragDocuments);
				await tx.delete(ragMeta);
			});
		},
	};
}
