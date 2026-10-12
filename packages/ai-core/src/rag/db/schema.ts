import { sql } from "drizzle-orm";
import {
	customType,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	unique,
	vector,
} from "drizzle-orm/pg-core";

/** Embedding dimensionality of the knowledge base (ADR-4). */
export const EMBEDDING_DIMENSIONS = 768;

// Drizzle has no tsvector column type; the column is generated, so only reads use it.
const tsvector = customType<{ data: string }>({
	dataType() {
		return "tsvector";
	},
});

export const ragMigrations = pgTable("rag_migrations", {
	name: text("name").primaryKey(),
	appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
});

export const ragMeta = pgTable("rag_meta", {
	id: text("id").primaryKey(),
	embeddingModelId: text("embedding_model_id").notNull(),
	dimensions: integer("dimensions").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const ragDocuments = pgTable("rag_documents", {
	id: text("id").primaryKey(),
	title: text("title").notNull(),
	sourceType: text("source_type", { enum: ["markdown", "pdf"] }).notNull(),
	tags: text("tags").array().notNull().default(sql`'{}'`),
	chunkCount: integer("chunk_count").notNull(),
	ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull(),
});

export const ragChunks = pgTable(
	"rag_chunks",
	{
		id: text("id").primaryKey(),
		documentId: text("document_id")
			.notNull()
			.references(() => ragDocuments.id, { onDelete: "cascade" }),
		ordinal: integer("ordinal").notNull(),
		headingPath: text("heading_path").array().notNull().default(sql`'{}'`),
		page: integer("page"),
		body: text("body").notNull(),
		searchText: text("search_text").notNull(),
		embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
		tsv: tsvector("tsv").generatedAlwaysAs(sql`to_tsvector('simple', search_text)`),
	},
	(table) => [
		unique("rag_chunks_document_ordinal_unique").on(table.documentId, table.ordinal),
		index("rag_chunks_embedding_hnsw").using("hnsw", table.embedding.op("vector_cosine_ops")),
		index("rag_chunks_tsv_gin").using("gin", table.tsv),
	],
);
