import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { PlatformError } from "../errors";
import { type Clock, systemClock } from "../ports/clock";
import {
	HELPDESK_STOPPED_REASONS,
	type HELPDESK_TICKET_STATUSES,
	helpdeskPlanRevisions,
	helpdeskTickets,
	type RagDatabase,
} from "../rag/db";
import { type Plan, type PlanDiff, PlanDiffSchema, PlanSchema } from "./plan-schema";

export type TicketStatus = (typeof HELPDESK_TICKET_STATUSES)[number];
export type StoppedReason = (typeof HELPDESK_STOPPED_REASONS)[number];

/** A help-desk ticket; fields that apply to one outcome only are absent otherwise. */
export interface Ticket {
	readonly id: string;
	readonly inquiry: string;
	readonly status: TicketStatus;
	/** `resolved` only. Never holds a credential shape (Req 2.8): the caller checks first. */
	readonly answer?: string;
	/** `escalated` only. A short reason the learner may see. */
	readonly escalationReason?: string;
	/** Steps counted by CL-14. */
	readonly stepsUsed: number;
	/** `open` only: why the run stopped before an outcome (CL-14). */
	readonly stoppedReason?: StoppedReason;
	readonly createdAt: Date;
	readonly updatedAt: Date;
}

export interface PlanRevision {
	/** 0 is the first plan. */
	readonly revision: number;
	readonly plan: Plan;
	/** Absent for revision 0. */
	readonly diff: PlanDiff | undefined;
	readonly reason: string;
	readonly createdAt: Date;
}

/** What `setStatus` may do to an `open` ticket. `open` stays open and records why it stopped. */
export type StatusChange =
	| { readonly status: "resolved"; readonly answer: string; readonly stepsUsed: number }
	| { readonly status: "escalated"; readonly reason: string; readonly stepsUsed: number }
	| {
			readonly status: "open";
			readonly stoppedReason: StoppedReason;
			readonly stepsUsed: number;
	  };

export interface CreateTicketParams {
	readonly inquiry: string;
	/** Stored as revision 0 in the same transaction as the ticket. */
	readonly initialPlan?: Plan;
}

export interface RecordRevisionParams {
	readonly ticketId: string;
	readonly plan: Plan;
	/** Required for every revision after the first, and refused for the first. */
	readonly diff?: PlanDiff | undefined;
	readonly reason: string;
}

export const MAX_TICKET_LIST = 50;

export interface ListTicketsOptions {
	readonly status?: TicketStatus;
	readonly limit?: number;
}

export interface TicketStore {
	create(params: CreateTicketParams): Promise<Ticket>;
	/** Only an `open` ticket can change; anything else is refused (no way back). */
	setStatus(id: string, change: StatusChange): Promise<Ticket>;
	/** Appends the next revision and returns its number. Earlier revisions are never changed. */
	recordRevision(params: RecordRevisionParams): Promise<number>;
	get(id: string): Promise<Ticket | undefined>;
	revisions(id: string): Promise<readonly PlanRevision[]>;
	/** Newest first, at most `MAX_TICKET_LIST`. */
	list(options?: ListTicketsOptions): Promise<readonly Ticket[]>;
	/** Empties the help-desk tables only; the `rag_*` tables are left alone. */
	reset(): Promise<void>;
}

export interface TicketStoreOptions {
	/** Source of `created_at` / `updated_at`; SQL never calls `now()`. */
	readonly clock?: Clock;
}

const MAX_ATTEMPTS = 5;
const UNIQUE_VIOLATION = "23505";

const invalid = (message: string, details?: Record<string, unknown>) =>
	new PlatformError("invalid-request", message, details);

function parsePlan(plan: Plan): Plan {
	const parsed = PlanSchema.safeParse(plan);
	if (!parsed.success) throw invalid("計画の形式が正しくありません。");
	return parsed.data;
}

function parseDiff(diff: PlanDiff): PlanDiff {
	const parsed = PlanDiffSchema.safeParse(diff);
	if (!parsed.success) throw invalid("計画の差分の形式が正しくありません。");
	return parsed.data;
}

const StatusChangeSchema = z.discriminatedUnion("status", [
	z.strictObject({
		status: z.literal("resolved"),
		answer: z.string().refine((text) => text.trim() !== "", "回答が空です。"),
		stepsUsed: z.number().int().min(0),
	}),
	z.strictObject({
		status: z.literal("escalated"),
		reason: z.string().refine((text) => text.trim() !== "", "理由が空です。"),
		stepsUsed: z.number().int().min(0),
	}),
	z.strictObject({
		status: z.literal("open"),
		stoppedReason: z.enum(HELPDESK_STOPPED_REASONS),
		stepsUsed: z.number().int().min(0),
	}),
]);

/** A unique-key conflict from either driver; Drizzle wraps the driver error as `cause`. */
function isUniqueViolation(error: unknown): boolean {
	let current: unknown = error;
	for (let depth = 0; depth < 4 && typeof current === "object" && current !== null; depth += 1) {
		if ((current as { code?: unknown }).code === UNIQUE_VIOLATION) return true;
		current = (current as { cause?: unknown }).cause;
	}
	return false;
}

/** Runs `attempt` again (in a new transaction) while another writer takes the same key. */
async function retryOnConflict<T>(attempt: () => Promise<T>): Promise<T> {
	for (let tries = 1; ; tries += 1) {
		try {
			return await attempt();
		} catch (error) {
			if (!isUniqueViolation(error)) throw error;
			if (tries >= MAX_ATTEMPTS) {
				throw new PlatformError(
					"source-unavailable",
					"チケットの番号を割り当てられませんでした。もう一度お試しください。",
				);
			}
		}
	}
}

function toTicket(row: typeof helpdeskTickets.$inferSelect): Ticket {
	return {
		id: row.id,
		inquiry: row.inquiry,
		status: row.status,
		...(row.answer === null ? {} : { answer: row.answer }),
		...(row.escalationReason === null ? {} : { escalationReason: row.escalationReason }),
		stepsUsed: row.stepsUsed,
		...(row.stoppedReason === null ? {} : { stoppedReason: row.stoppedReason }),
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

function toRevision(row: typeof helpdeskPlanRevisions.$inferSelect): PlanRevision {
	const plan = PlanSchema.safeParse(row.plan);
	const diff = row.diff === null ? undefined : PlanDiffSchema.safeParse(row.diff);
	if (!plan.success || (diff !== undefined && !diff.success)) {
		throw new PlatformError("source-unavailable", "保存されている計画の形式が正しくありません。", {
			ticketId: row.ticketId,
			revision: row.revision,
		});
	}
	return {
		revision: row.revision,
		plan: plan.data,
		diff: diff?.data,
		reason: row.reason,
		createdAt: row.createdAt,
	};
}

function formatTicketId(number: number): string {
	return `T-${String(number).padStart(4, "0")}`;
}

/**
 * Help-desk tickets and their plan revisions (plan C10, Req 2.3, 2.6, 2.7). The numbering is the
 * largest stored number plus one (no clock, no randomness); a conflict with another writer retries
 * in a new transaction. A ticket only moves from `open`, and the move is a single conditional
 * UPDATE, so two writers cannot both finish it. The state CHECK in `0002_helpdesk.sql` backs this up
 * for the rows themselves. Plan revisions have no update path here: they are only appended.
 */
export function createTicketStore(db: RagDatabase, options: TicketStoreOptions = {}): TicketStore {
	const clock = options.clock ?? systemClock;
	const now = () => new Date(clock.now());

	async function getRow(id: string) {
		const [row] = await db.select().from(helpdeskTickets).where(eq(helpdeskTickets.id, id));
		return row;
	}

	return {
		async create({ inquiry, initialPlan }) {
			if (inquiry.trim() === "") throw invalid("問い合わせが空です。");
			const plan = initialPlan === undefined ? undefined : parsePlan(initialPlan);
			return await retryOnConflict(() =>
				db.transaction(async (tx) => {
					const [latest] = await tx
						.select({
							number: sql<number | null>`max(substring(${helpdeskTickets.id} from 3)::int)`,
						})
						.from(helpdeskTickets);
					const created = now();
					const [row] = await tx
						.insert(helpdeskTickets)
						.values({
							id: formatTicketId((latest?.number ?? 0) + 1),
							inquiry,
							status: "open",
							stepsUsed: 0,
							createdAt: created,
							updatedAt: created,
						})
						.returning();
					if (!row)
						throw new PlatformError("source-unavailable", "チケットを保存できませんでした。");
					if (plan !== undefined) {
						await tx.insert(helpdeskPlanRevisions).values({
							ticketId: row.id,
							revision: 0,
							plan,
							diff: null,
							reason: "initial",
							createdAt: created,
						});
					}
					return toTicket(row);
				}),
			);
		},

		async setStatus(id, change) {
			const parsed = StatusChangeSchema.safeParse(change);
			if (!parsed.success) {
				throw invalid("チケットの更新内容が正しくありません。", {
					issues: parsed.error.issues.map((issue) => issue.path.join(".")),
				});
			}
			const next = parsed.data;
			const base = { stepsUsed: next.stepsUsed, updatedAt: now() };
			const values =
				next.status === "resolved"
					? {
							...base,
							status: "resolved" as const,
							answer: next.answer,
							escalationReason: null,
							stoppedReason: null,
						}
					: next.status === "escalated"
						? {
								...base,
								status: "escalated" as const,
								answer: null,
								escalationReason: next.reason,
								stoppedReason: null,
							}
						: { ...base, stoppedReason: next.stoppedReason };
			const [row] = await db
				.update(helpdeskTickets)
				.set(values)
				.where(and(eq(helpdeskTickets.id, id), eq(helpdeskTickets.status, "open")))
				.returning();
			if (row) return toTicket(row);

			const current = await getRow(id);
			if (!current) throw invalid(`チケット ${id} は見つかりません。`, { ticketId: id });
			throw invalid(
				`チケット ${id} は ${current.status} のため、状態を変更できません。状態は open から変わるだけで、戻せません。`,
				{ ticketId: id, status: current.status },
			);
		},

		async recordRevision({ ticketId, plan, diff, reason }) {
			if (reason.trim() === "") throw invalid("計画を改訂した理由が空です。");
			const checkedPlan = parsePlan(plan);
			const checkedDiff = diff === undefined ? undefined : parseDiff(diff);
			return await retryOnConflict(() =>
				db.transaction(async (tx) => {
					const [ticket] = await tx
						.select({ id: helpdeskTickets.id })
						.from(helpdeskTickets)
						.where(eq(helpdeskTickets.id, ticketId));
					if (!ticket) throw invalid(`チケット ${ticketId} は見つかりません。`, { ticketId });
					const [latest] = await tx
						.select({ revision: sql<number | null>`max(${helpdeskPlanRevisions.revision})` })
						.from(helpdeskPlanRevisions)
						.where(eq(helpdeskPlanRevisions.ticketId, ticketId));
					const revision = (latest?.revision ?? -1) + 1;
					if (revision === 0 && checkedDiff !== undefined) {
						throw invalid("最初の計画には差分を付けません。");
					}
					if (revision > 0 && checkedDiff === undefined) {
						throw invalid("2 回目以降の改訂には、変更前後の差分が必要です。");
					}
					await tx.insert(helpdeskPlanRevisions).values({
						ticketId,
						revision,
						plan: checkedPlan,
						diff: checkedDiff ?? null,
						reason,
						createdAt: now(),
					});
					return revision;
				}),
			);
		},

		async get(id) {
			const row = await getRow(id);
			return row ? toTicket(row) : undefined;
		},

		async revisions(id) {
			const rows = await db
				.select()
				.from(helpdeskPlanRevisions)
				.where(eq(helpdeskPlanRevisions.ticketId, id))
				.orderBy(helpdeskPlanRevisions.revision);
			return rows.map(toRevision);
		},

		async list(options: ListTicketsOptions = {}) {
			const { status, limit = MAX_TICKET_LIST } = options;
			if (!Number.isInteger(limit) || limit < 1)
				throw invalid("件数は 1 以上の整数にしてください。");
			const rows = await db
				.select()
				.from(helpdeskTickets)
				.where(status === undefined ? undefined : eq(helpdeskTickets.status, status))
				.orderBy(
					desc(helpdeskTickets.createdAt),
					desc(sql`length(${helpdeskTickets.id})`),
					desc(helpdeskTickets.id),
				)
				.limit(Math.min(limit, MAX_TICKET_LIST));
			return rows.map(toTicket);
		},

		async reset() {
			// The revisions go with their tickets (ON DELETE CASCADE).
			await db.delete(helpdeskTickets);
		},
	};
}
