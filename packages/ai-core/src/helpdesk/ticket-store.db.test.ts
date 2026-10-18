import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PlatformError } from "../errors";
import { createFakeClock, type FakeClock } from "../ports/clock";
import {
	createPgliteDatabase,
	helpdeskPlanRevisions,
	helpdeskTickets,
	type RagDatabase,
	type RagDatabaseHandle,
	ragDocuments,
} from "../rag/db";
import type { Plan, PlanDiff } from "./plan-schema";
import { createTicketStore, type TicketStore } from "./ticket-store";

const START = Date.parse("2026-10-18T00:00:00.000Z");
const PLAN: Plan = {
	tasks: [
		{ id: "t1", description: "検索", dependsOn: [] },
		{ id: "t2", description: "回答", dependsOn: ["t1"] },
	],
};
const PLAN_2: Plan = {
	tasks: [
		PLAN.tasks[0] as Plan["tasks"][number],
		{ id: "t3", description: "別", dependsOn: ["t1"] },
	],
};
const DIFF: PlanDiff = { added: ["t3"], removed: ["t2"], changed: [] };

let handle: RagDatabaseHandle;
let clock: FakeClock;
let store: TicketStore;

beforeAll(async () => {
	handle = await createPgliteDatabase();
});

afterAll(async () => {
	await handle.close();
});

beforeEach(async () => {
	await handle.db.execute(sql`TRUNCATE helpdesk_plan_revisions, helpdesk_tickets CASCADE`);
	clock = createFakeClock(START);
	store = createTicketStore(handle.db, { clock });
});

async function rejection(promise: Promise<unknown>): Promise<unknown> {
	try {
		await promise;
	} catch (error) {
		return error;
	}
	throw new Error("expected the call to be rejected");
}

describe("create", () => {
	it("numbers tickets T-0001, T-0002 … from the largest existing number", async () => {
		const first = await store.create({ inquiry: "A" });
		const second = await store.create({ inquiry: "B" });
		expect([first.id, second.id]).toEqual(["T-0001", "T-0002"]);

		await handle.db.insert(helpdeskTickets).values({
			id: "T-0009",
			inquiry: "x",
			status: "open",
			stepsUsed: 0,
			createdAt: new Date(START),
			updatedAt: new Date(START),
		});
		expect((await store.create({ inquiry: "C" })).id).toBe("T-0010");
	});

	it("numbers past four digits by value, not as text (T-9999 then T-10000, then T-10001)", async () => {
		await handle.db.insert(helpdeskTickets).values({
			id: "T-9999",
			inquiry: "x",
			status: "open",
			stepsUsed: 0,
			createdAt: new Date(START),
			updatedAt: new Date(START),
		});

		expect((await store.create({ inquiry: "next" })).id).toBe("T-10000");
		expect((await store.create({ inquiry: "next" })).id).toBe("T-10001");
	});

	it("does not reuse a number after the latest ticket is gone only when a larger one exists", async () => {
		await store.create({ inquiry: "A" });
		const second = await store.create({ inquiry: "B" });
		await handle.db.execute(sql`DELETE FROM helpdesk_tickets WHERE id = 'T-0001'`);

		expect((await store.create({ inquiry: "C" })).id).toBe("T-0003");
		expect(second.id).toBe("T-0002");
	});

	it("is deterministic: the same steps give the same ids with the same clock", async () => {
		const ids = [
			(await store.create({ inquiry: "A" })).id,
			(await store.create({ inquiry: "B" })).id,
		];
		await handle.db.execute(sql`TRUNCATE helpdesk_tickets CASCADE`);

		const again = [
			(await store.create({ inquiry: "A" })).id,
			(await store.create({ inquiry: "B" })).id,
		];

		expect(again).toEqual(ids);
	});

	it("starts open with 0 steps and takes both timestamps from the clock", async () => {
		const ticket = await store.create({ inquiry: "VPN に接続できません" });

		expect(ticket).toEqual({
			id: "T-0001",
			inquiry: "VPN に接続できません",
			status: "open",
			stepsUsed: 0,
			createdAt: new Date(START),
			updatedAt: new Date(START),
		});
	});

	it("writes revision 0 in the same transaction when an initial plan is given", async () => {
		const ticket = await store.create({ inquiry: "A", initialPlan: PLAN });

		const revisions = await store.revisions(ticket.id);
		expect(revisions).toEqual([
			{ revision: 0, plan: PLAN, diff: undefined, reason: "initial", createdAt: new Date(START) },
		]);
	});

	it("leaves no ticket behind when the initial plan is malformed", async () => {
		const bad = { tasks: [{ id: "t1" }] } as unknown as Plan;

		// A malformed plan is refused before any row is written.
		await expect(store.create({ inquiry: "A", initialPlan: bad })).rejects.toBeInstanceOf(
			PlatformError,
		);
		expect(await store.list()).toEqual([]);
	});

	it("retries with the next number when the chosen number was taken meanwhile", async () => {
		let failures = 1;
		const flaky = new Proxy(handle.db, {
			get(target, property, receiver) {
				if (property === "transaction" && failures > 0) {
					failures -= 1;
					return async () => {
						throw Object.assign(new Error("Failed query"), {
							cause: Object.assign(new Error("duplicate key value violates unique constraint"), {
								code: "23505",
							}),
						});
					};
				}
				return Reflect.get(target, property, receiver);
			},
		}) as RagDatabase;

		const ticket = await createTicketStore(flaky, { clock }).create({ inquiry: "A" });

		expect(ticket.id).toBe("T-0001");
		expect(failures).toBe(0);
	});

	it("gives up after a few conflicts and does not retry other errors", async () => {
		let attempts = 0;
		const failing = (code: string) =>
			new Proxy(handle.db, {
				get(target, property, receiver) {
					if (property === "transaction") {
						return async () => {
							attempts += 1;
							throw Object.assign(new Error("Failed query"), {
								cause: Object.assign(new Error("boom"), { code }),
							});
						};
					}
					return Reflect.get(target, property, receiver);
				},
			}) as RagDatabase;

		attempts = 0;
		await expect(
			createTicketStore(failing("23505"), { clock }).create({ inquiry: "A" }),
		).rejects.toThrow();
		expect(attempts).toBe(5);

		attempts = 0;
		await expect(
			createTicketStore(failing("57014"), { clock }).create({ inquiry: "A" }),
		).rejects.toThrow();
		expect(attempts).toBe(1);
	});

	it("keeps concurrent creates unique", async () => {
		const created = await Promise.all(
			Array.from({ length: 20 }, (_, index) => store.create({ inquiry: `q${index}` })),
		);

		expect(new Set(created.map((ticket) => ticket.id)).size).toBe(20);
	});
});

describe("setStatus: transitions", () => {
	it("resolves an open ticket with its answer and the steps used", async () => {
		const ticket = await store.create({ inquiry: "A" });
		clock.advanceBy(5_000);

		const resolved = await store.setStatus(ticket.id, {
			status: "resolved",
			answer: "設定画面から再接続してください。",
			stepsUsed: 4,
		});

		expect(resolved).toMatchObject({
			id: ticket.id,
			status: "resolved",
			answer: "設定画面から再接続してください。",
			stepsUsed: 4,
			createdAt: new Date(START),
			updatedAt: new Date(START + 5_000),
		});
		expect(resolved.escalationReason).toBeUndefined();
		expect(resolved.stoppedReason).toBeUndefined();
		expect(await store.get(ticket.id)).toEqual(resolved);
	});

	it("escalates an open ticket with the reason", async () => {
		const ticket = await store.create({ inquiry: "A" });

		const escalated = await store.setStatus(ticket.id, {
			status: "escalated",
			reason: "ナレッジに根拠が見つかりませんでした。",
			stepsUsed: 6,
		});

		expect(escalated).toMatchObject({
			status: "escalated",
			escalationReason: "ナレッジに根拠が見つかりませんでした。",
			stepsUsed: 6,
		});
		expect(escalated.answer).toBeUndefined();
	});

	it.each(["step-limit", "aborted"] as const)(
		"records the stop reason %s and stays open",
		async (stoppedReason) => {
			const ticket = await store.create({ inquiry: "A" });

			const stopped = await store.setStatus(ticket.id, {
				status: "open",
				stoppedReason,
				stepsUsed: 12,
			});

			expect(stopped).toMatchObject({ status: "open", stoppedReason, stepsUsed: 12 });
			expect(stopped.answer).toBeUndefined();
		},
	);

	it.each([
		["resolved", { status: "resolved", answer: "a", stepsUsed: 1 }],
		["escalated", { status: "escalated", reason: "r", stepsUsed: 1 }],
	] as const)(
		"never moves a %s ticket again (no way back, no change of outcome)",
		async (_name, first) => {
			const ticket = await store.create({ inquiry: "A" });
			await store.setStatus(ticket.id, first);
			const before = await store.get(ticket.id);

			for (const change of [
				{ status: "open", stoppedReason: "aborted", stepsUsed: 2 },
				{ status: "resolved", answer: "別の回答", stepsUsed: 2 },
				{ status: "escalated", reason: "別の理由", stepsUsed: 2 },
			] as const) {
				const error = await rejection(store.setStatus(ticket.id, change));
				expect(error).toBeInstanceOf(PlatformError);
				expect((error as PlatformError).code).toBe("invalid-request");
			}
			expect(await store.get(ticket.id)).toEqual(before);
		},
	);

	it("rejects a change to a ticket that does not exist", async () => {
		const error = await rejection(
			store.setStatus("T-0404", { status: "resolved", answer: "a", stepsUsed: 1 }),
		);

		expect(error).toBeInstanceOf(PlatformError);
		expect((error as PlatformError).message).toContain("T-0404");
	});

	it("rejects an empty answer, an empty reason and a negative step count before touching the row", async () => {
		const ticket = await store.create({ inquiry: "A" });

		for (const change of [
			{ status: "resolved", answer: "", stepsUsed: 1 },
			{ status: "resolved", answer: "   ", stepsUsed: 1 },
			{ status: "escalated", reason: "", stepsUsed: 1 },
			{ status: "open", stoppedReason: "aborted", stepsUsed: -1 },
			{ status: "resolved", answer: "a", stepsUsed: 1.5 },
		] as const) {
			await expect(store.setStatus(ticket.id, change)).rejects.toBeInstanceOf(PlatformError);
		}
		expect((await store.get(ticket.id))?.status).toBe("open");
	});

	it("lets a stopped ticket still be resolved later, and clears the stop reason", async () => {
		const ticket = await store.create({ inquiry: "A" });
		await store.setStatus(ticket.id, {
			status: "open",
			stoppedReason: "step-limit",
			stepsUsed: 12,
		});

		const resolved = await store.setStatus(ticket.id, {
			status: "resolved",
			answer: "a",
			stepsUsed: 13,
		});

		expect(resolved.stoppedReason).toBeUndefined();
		expect(resolved.status).toBe("resolved");
	});
});

describe("recordRevision / revisions", () => {
	it("appends numbered revisions and never changes an earlier one", async () => {
		const ticket = await store.create({ inquiry: "A" });

		expect(await store.recordRevision({ ticketId: ticket.id, plan: PLAN, reason: "initial" })).toBe(
			0,
		);
		clock.advanceBy(1_000);
		expect(
			await store.recordRevision({
				ticketId: ticket.id,
				plan: PLAN_2,
				diff: DIFF,
				reason: "手順書に別の手順があった",
			}),
		).toBe(1);

		expect(await store.revisions(ticket.id)).toEqual([
			{ revision: 0, plan: PLAN, diff: undefined, reason: "initial", createdAt: new Date(START) },
			{
				revision: 1,
				plan: PLAN_2,
				diff: DIFF,
				reason: "手順書に別の手順があった",
				createdAt: new Date(START + 1_000),
			},
		]);
	});

	it("requires a diff for every revision after the first, and none for the first", async () => {
		const ticket = await store.create({ inquiry: "A" });

		await expect(
			store.recordRevision({ ticketId: ticket.id, plan: PLAN, diff: DIFF, reason: "initial" }),
		).rejects.toBeInstanceOf(PlatformError);
		await store.recordRevision({ ticketId: ticket.id, plan: PLAN, reason: "initial" });
		await expect(
			store.recordRevision({ ticketId: ticket.id, plan: PLAN_2, reason: "replan" }),
		).rejects.toBeInstanceOf(PlatformError);
		expect(await store.revisions(ticket.id)).toHaveLength(1);
	});

	it("rejects a revision of a ticket that does not exist", async () => {
		await expect(
			store.recordRevision({ ticketId: "T-0404", plan: PLAN, reason: "initial" }),
		).rejects.toBeInstanceOf(PlatformError);
	});

	it("returns [] for a ticket without revisions and only that ticket's revisions", async () => {
		const a = await store.create({ inquiry: "A", initialPlan: PLAN });
		const b = await store.create({ inquiry: "B" });

		expect(await store.revisions(b.id)).toEqual([]);
		expect(await store.revisions(a.id)).toHaveLength(1);
	});

	it("refuses to read a stored plan that no longer fits the schema", async () => {
		const ticket = await store.create({ inquiry: "A" });
		await handle.db.insert(helpdeskPlanRevisions).values({
			ticketId: ticket.id,
			revision: 0,
			plan: { tasks: "broken" },
			diff: null,
			reason: "initial",
			createdAt: new Date(START),
		});

		await expect(store.revisions(ticket.id)).rejects.toBeInstanceOf(PlatformError);
	});

	it("deletes a ticket's revisions with it", async () => {
		const ticket = await store.create({ inquiry: "A", initialPlan: PLAN });

		await handle.db.execute(sql`DELETE FROM helpdesk_tickets WHERE id = ${ticket.id}`);

		expect(await handle.db.$count(helpdeskPlanRevisions)).toBe(0);
	});
});

describe("get / list", () => {
	it("returns undefined for an unknown id", async () => {
		expect(await store.get("T-0404")).toBeUndefined();
	});

	it("lists newest first, at most 50, and can filter by status", async () => {
		for (let index = 0; index < 52; index += 1) {
			await store.create({ inquiry: `q${index}` });
			clock.advanceBy(1_000);
		}
		await store.setStatus("T-0003", { status: "resolved", answer: "a", stepsUsed: 1 });
		await store.setStatus("T-0050", { status: "escalated", reason: "r", stepsUsed: 1 });

		const all = await store.list();
		expect(all).toHaveLength(50);
		expect(all[0]?.id).toBe("T-0052");
		expect(all.at(-1)?.id).toBe("T-0003");
		expect((await store.list({ status: "resolved" })).map((ticket) => ticket.id)).toEqual([
			"T-0003",
		]);
		expect((await store.list({ status: "escalated" })).map((ticket) => ticket.id)).toEqual([
			"T-0050",
		]);
		expect(await store.list({ status: "open" })).toHaveLength(50);
		expect(await store.list({ limit: 500 })).toHaveLength(50);
	});

	it("breaks a tie in creation time by the larger id first", async () => {
		await store.create({ inquiry: "A" });
		await store.create({ inquiry: "B" });

		expect((await store.list()).map((ticket) => ticket.id)).toEqual(["T-0002", "T-0001"]);
	});

	it("honours a smaller limit and never returns more than 50", async () => {
		for (let index = 0; index < 3; index += 1) await store.create({ inquiry: `q${index}` });

		expect(await store.list({ limit: 2 })).toHaveLength(2);
		expect(await store.list({ limit: 500 })).toHaveLength(3);
		await expect(store.list({ limit: 0 })).rejects.toBeInstanceOf(PlatformError);
	});

	it("returns the inquiry text unchanged", async () => {
		const text = "パスワードを忘れました。\n<script>alert(1)</script> '; DROP TABLE x; --";
		const ticket = await store.create({ inquiry: text });

		expect((await store.get(ticket.id))?.inquiry).toBe(text);
	});
});

describe("reset", () => {
	it("empties the help-desk tables only and leaves the rag_* tables alone", async () => {
		await handle.db.insert(ragDocuments).values({
			id: "kb:keep.md",
			title: "keep",
			sourceType: "markdown",
			tags: [],
			chunkCount: 0,
			ingestedAt: new Date(START),
		});
		await store.create({ inquiry: "A", initialPlan: PLAN });

		await store.reset();

		expect(await handle.db.$count(helpdeskTickets)).toBe(0);
		expect(await handle.db.$count(helpdeskPlanRevisions)).toBe(0);
		expect(await handle.db.$count(ragDocuments)).toBe(1);
		await handle.db.execute(sql`DELETE FROM rag_documents`);
	});

	it("restarts the numbering", async () => {
		await store.create({ inquiry: "A" });
		await store.reset();

		expect((await store.create({ inquiry: "B" })).id).toBe("T-0001");
	});
});
