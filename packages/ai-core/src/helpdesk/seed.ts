import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { ResolvedEmbeddingModel } from "../models";
import type { Clock } from "../ports/clock";
import {
	HELPDESK_STOPPED_REASONS,
	HELPDESK_TICKET_STATUSES,
	helpdeskPlanRevisions,
	helpdeskTickets,
	type RagDatabase,
} from "../rag/db";
import {
	type IngestedDocument,
	ingestDocuments,
	listIngestableFiles,
	type SkippedFile,
} from "../rag/ingest";
import { PlanSchema } from "./plan-schema";

// `packages/ai-core/fixtures/helpdesk`, relative to this file (`src/helpdesk/`). Not
// `new URL("../../fixtures/...", import.meta.url)`: Turbopack treats that form as an asset reference.
const FIXTURES_DIRECTORY = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"fixtures",
	"helpdesk",
);
export const FAQ_DIRECTORY = path.join(FIXTURES_DIRECTORY, "faq");
const TICKETS_FILE = path.join(FIXTURES_DIRECTORY, "tickets.json");

export const SampleTicketSchema = z.strictObject({
	id: z.string().regex(/^T-\d{4}$/),
	inquiry: z.string().min(1),
	status: z.enum(HELPDESK_TICKET_STATUSES),
	answer: z.string().min(1).optional(),
	escalationReason: z.string().min(1).optional(),
	stoppedReason: z.enum(HELPDESK_STOPPED_REASONS).optional(),
	stepsUsed: z.number().int().min(0),
	createdAt: z.iso.datetime(),
	updatedAt: z.iso.datetime(),
	plan: PlanSchema,
});

export type SampleTicket = z.infer<typeof SampleTicketSchema>;

/** The committed past tickets (`fixtures/helpdesk/tickets.json`), validated. */
export async function loadSampleTickets(): Promise<readonly SampleTicket[]> {
	return z.array(SampleTicketSchema).parse(JSON.parse(await readFile(TICKETS_FILE, "utf8")));
}

export interface SeedKnowledge {
	/** The embedding the FAQ is stored with; it must match the knowledge base already holding documents. */
	readonly embedding: ResolvedEmbeddingModel;
	/** Directory of FAQ and procedure files. Defaults to the committed `fixtures/helpdesk/faq`. */
	readonly root?: string;
}

export interface SeedHelpdeskParams {
	readonly db: RagDatabase;
	readonly knowledge: SeedKnowledge;
	/** Empties the help-desk tables (tickets and their revisions) first. The `rag_*` tables are kept. */
	readonly reset?: boolean;
	readonly clock?: Clock;
	readonly signal?: AbortSignal;
}

export interface SeedResult {
	/** The M2 ingestion's account: a file it cannot read is `skipped`, it does not stop the seed. */
	readonly faq: {
		readonly ingested: readonly IngestedDocument[];
		readonly skipped: readonly SkippedFile[];
	};
	/** `existing`: sample tickets whose id was already taken, left as they are. */
	readonly tickets: { readonly inserted: number; readonly existing: number };
}

/**
 * Seeds the knowledge and the past tickets used to try the help desk (Req 2.9). The FAQ goes in
 * through the M2 ingestion, which replaces a document by its id, and the tickets are inserted only
 * when their id is free, so running it again changes nothing. `reset` empties the help-desk tables
 * first and is the only way this module removes data. An abort is honoured by the ingestion, before
 * anything is written.
 */
export async function seedHelpdesk(params: SeedHelpdeskParams): Promise<SeedResult> {
	const samples = await loadSampleTickets();
	const root = params.knowledge.root ?? FAQ_DIRECTORY;

	const ingested = await ingestDocuments({
		db: params.db,
		embedding: params.knowledge.embedding,
		source: "knowledge",
		root,
		files: await listIngestableFiles(root),
		...(params.clock ? { clock: params.clock } : {}),
		...(params.signal ? { signal: params.signal } : {}),
	});

	const inserted = await params.db.transaction(async (tx) => {
		// The revisions go with their tickets (ON DELETE CASCADE).
		if (params.reset) await tx.delete(helpdeskTickets);
		let count = 0;
		for (const sample of samples) {
			const [row] = await tx
				.insert(helpdeskTickets)
				.values({
					id: sample.id,
					inquiry: sample.inquiry,
					status: sample.status,
					answer: sample.answer ?? null,
					escalationReason: sample.escalationReason ?? null,
					stepsUsed: sample.stepsUsed,
					stoppedReason: sample.stoppedReason ?? null,
					createdAt: new Date(sample.createdAt),
					updatedAt: new Date(sample.updatedAt),
				})
				.onConflictDoNothing()
				.returning({ id: helpdeskTickets.id });
			// A ticket that already exists may be the learner's own: its plan is not touched.
			if (!row) continue;
			count += 1;
			await tx.insert(helpdeskPlanRevisions).values({
				ticketId: sample.id,
				revision: 0,
				plan: sample.plan,
				diff: null,
				reason: "initial",
				createdAt: new Date(sample.createdAt),
			});
		}
		return count;
	});

	return {
		faq: { ingested: ingested.ingested, skipped: ingested.skipped },
		tickets: { inserted, existing: samples.length - inserted },
	};
}
