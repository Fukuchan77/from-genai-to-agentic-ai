-- Knowledge base schema (plan C4 / Data Model). Statements are separated by the
-- statement-breakpoint marker so the migrator can run them one at a time on any driver.
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS rag_migrations (
	name text PRIMARY KEY,
	applied_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE rag_meta (
	id text PRIMARY KEY CHECK (id = 'kb'),
	embedding_model_id text NOT NULL,
	dimensions integer NOT NULL CHECK (dimensions = 768),
	created_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE TABLE rag_documents (
	id text PRIMARY KEY,
	title text NOT NULL,
	source_type text NOT NULL CHECK (source_type IN ('markdown', 'pdf')),
	tags text[] NOT NULL DEFAULT '{}',
	chunk_count integer NOT NULL CHECK (chunk_count >= 0),
	ingested_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE TABLE rag_chunks (
	id text PRIMARY KEY,
	document_id text NOT NULL REFERENCES rag_documents (id) ON DELETE CASCADE,
	ordinal integer NOT NULL,
	heading_path text[] NOT NULL DEFAULT '{}',
	page integer CHECK (page >= 1),
	body text NOT NULL,
	search_text text NOT NULL,
	embedding vector(768) NOT NULL,
	tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', search_text)) STORED,
	CONSTRAINT rag_chunks_document_ordinal_unique UNIQUE (document_id, ordinal)
);
--> statement-breakpoint
CREATE INDEX rag_chunks_embedding_hnsw ON rag_chunks USING hnsw (embedding vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX rag_chunks_tsv_gin ON rag_chunks USING gin (tsv);
