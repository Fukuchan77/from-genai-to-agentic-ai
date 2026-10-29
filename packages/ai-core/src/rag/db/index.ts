// Database layer of `@platform/ai-core/rag` (plan C4). Only this directory touches the drivers.
export {
	createPgliteDatabase,
	createPostgresDatabase,
	type RagDatabase,
	type RagDatabaseHandle,
} from "./client";
export { KnowledgeBaseUnavailableError } from "./errors";
export { type MigrationResult, runMigrations } from "./migrate";
export {
	EMBEDDING_DIMENSIONS,
	HELPDESK_STOPPED_REASONS,
	HELPDESK_TICKET_STATUSES,
	helpdeskPlanRevisions,
	helpdeskTickets,
	marketingPersonas,
	marketingProducts,
	ragChunks,
	ragDocuments,
	ragMeta,
	ragMigrations,
} from "./schema";
