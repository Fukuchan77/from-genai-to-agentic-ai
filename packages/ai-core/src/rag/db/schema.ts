import { sql } from "drizzle-orm";
import {
	check,
	customType,
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
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

/** Status of a help-desk ticket; a ticket only moves from `open` to one of the other two. */
export const HELPDESK_TICKET_STATUSES = ["open", "resolved", "escalated"] as const;
/** Why an `open` ticket stopped running (003 CL-14). */
export const HELPDESK_STOPPED_REASONS = ["step-limit", "aborted"] as const;

// 0002_helpdesk.sql. Timestamps are set by the application's Clock, so there is no default.
export const helpdeskTickets = pgTable(
	"helpdesk_tickets",
	{
		id: text("id").primaryKey(),
		inquiry: text("inquiry").notNull(),
		status: text("status", { enum: HELPDESK_TICKET_STATUSES }).notNull(),
		answer: text("answer"),
		escalationReason: text("escalation_reason"),
		stepsUsed: integer("steps_used").notNull(),
		stoppedReason: text("stopped_reason", { enum: HELPDESK_STOPPED_REASONS }),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
	},
	(table) => [
		check("helpdesk_tickets_id_check", sql`${table.id} ~ '^T-[0-9]{4,}$'`),
		check("helpdesk_tickets_steps_used_check", sql`${table.stepsUsed} >= 0`),
	],
);

// The plan and the diff are validated with Zod where they are read (`helpdesk/ticket-store.ts`).
export const helpdeskPlanRevisions = pgTable(
	"helpdesk_plan_revisions",
	{
		ticketId: text("ticket_id")
			.notNull()
			.references(() => helpdeskTickets.id, { onDelete: "cascade" }),
		revision: integer("revision").notNull(),
		plan: jsonb("plan").notNull(),
		diff: jsonb("diff"),
		reason: text("reason").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
	},
	(table) => [primaryKey({ columns: [table.ticketId, table.revision] })],
);

// 0003_marketing.sql. The id pattern is the key that recommendations are checked against (003
// CL-15), so it is a database CHECK as well as a seed convention.
export const marketingProducts = pgTable(
	"marketing_products",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		category: text("category").notNull(),
		priceYen: integer("price_yen").notNull(),
		description: text("description").notNull(),
		tags: text("tags").array().notNull().default(sql`'{}'`),
	},
	(table) => [
		check("marketing_products_id_check", sql`${table.id} ~ '^P-[0-9]{3}$'`),
		check("marketing_products_price_yen_check", sql`${table.priceYen} >= 0`),
	],
);

// `ordinal` is the round-robin order of the council; `viewpoint` is the role's standpoint.
export const marketingPersonas = pgTable(
	"marketing_personas",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		viewpoint: text("viewpoint").notNull(),
		ordinal: integer("ordinal").notNull(),
	},
	(table) => [unique("marketing_personas_ordinal_unique").on(table.ordinal)],
);
