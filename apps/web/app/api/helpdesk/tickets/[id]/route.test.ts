import { createTicketStore, type TicketStore } from "@platform/ai-core/helpdesk";
import {
	createPgliteDatabase,
	KnowledgeBaseUnavailableError,
	type RagDatabaseHandle,
} from "@platform/ai-core/rag";
import { createFakeClock } from "@platform/ai-core/testing";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createPlatform,
	getHelpdeskStore,
	setKnowledgeBaseForTesting,
	setPlatformForTesting,
} from "@/lib/server/platform";
import { GET } from "./route";

vi.mock("@/lib/server/platform", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/server/platform")>();
	return { ...original, getHelpdeskStore: vi.fn(original.getHelpdeskStore) };
});

const MOCK_ENV = { VITEST: "1", AI_TEST_RUN_MODE: "mock" } as const;
const START = Date.parse("2026-10-18T00:00:00.000Z");

let handle: RagDatabaseHandle;
let clock: ReturnType<typeof createFakeClock>;
let store: TicketStore;

beforeAll(async () => {
	handle = await createPgliteDatabase();
});

afterAll(async () => {
	await handle.close();
});

beforeEach(async () => {
	clock = createFakeClock(START);
	setPlatformForTesting(await createPlatform({ env: MOCK_ENV, clock }));
	setKnowledgeBaseForTesting(handle);
	store = createTicketStore(handle.db, { clock });
	await store.reset();
});

afterEach(() => {
	setPlatformForTesting(undefined);
	setKnowledgeBaseForTesting(undefined);
	vi.mocked(getHelpdeskStore).mockClear();
});

const PLAN = {
	tasks: [
		{ id: "t1", description: "検索", dependsOn: [] },
		{ id: "t2", description: "回答", dependsOn: ["t1"] },
	],
};
const PLAN_2 = {
	tasks: [
		PLAN.tasks[0] as (typeof PLAN.tasks)[number],
		{ id: "t3", description: "別の確認", dependsOn: ["t1"] },
	],
};

function get(id: string): [Request, { params: Promise<{ id: string }> }] {
	return [
		new Request(`http://localhost/api/helpdesk/tickets/${id}`),
		{ params: Promise.resolve({ id }) },
	];
}

describe("GET /api/helpdesk/tickets/[id]", () => {
	it("returns the ticket and its plan revisions with the diff of each replan", async () => {
		const created = await store.create({ inquiry: "VPN に接続できません", initialPlan: PLAN });
		clock.advanceBy(1_000);
		await store.recordRevision({
			ticketId: created.id,
			plan: PLAN_2,
			diff: { added: ["t3"], removed: ["t2"], changed: [] },
			reason: "別の手順があった",
		});
		await store.setStatus(created.id, { status: "resolved", answer: "回答です", stepsUsed: 4 });

		const response = await GET(...get("T-0001"));
		const body = (await response.json()) as {
			ticket: Record<string, unknown>;
			revisions: Record<string, unknown>[];
		};

		expect(response.status).toBe(200);
		expect(body.ticket).toMatchObject({
			id: "T-0001",
			inquiry: "VPN に接続できません",
			status: "resolved",
			answer: "回答です",
			stepsUsed: 4,
		});
		expect(body.revisions).toEqual([
			{ revision: 0, plan: PLAN, reason: "initial", createdAt: "2026-10-18T00:00:00.000Z" },
			{
				revision: 1,
				plan: PLAN_2,
				diff: { added: ["t3"], removed: ["t2"], changed: [] },
				reason: "別の手順があった",
				createdAt: "2026-10-18T00:00:01.000Z",
			},
		]);
	});

	it("returns an empty revision list for a ticket that has no plan", async () => {
		await store.create({ inquiry: "計画なし" });

		const body = (await (await GET(...get("T-0001"))).json()) as { revisions: unknown[] };

		expect(body.revisions).toEqual([]);
	});

	it("shows why an open ticket stopped", async () => {
		await store.create({ inquiry: "q", initialPlan: PLAN });
		await store.setStatus("T-0001", { status: "open", stoppedReason: "step-limit", stepsUsed: 12 });

		const body = (await (await GET(...get("T-0001"))).json()) as {
			ticket: Record<string, unknown>;
		};

		expect(body.ticket).toMatchObject({
			status: "open",
			stoppedReason: "step-limit",
			stepsUsed: 12,
		});
	});

	it("answers 404 invalid-request for an id no ticket has", async () => {
		await store.create({ inquiry: "q" });

		const response = await GET(...get("T-0404"));

		expect(response.status).toBe(404);
		const { error } = (await response.json()) as { error: { code: string; message: string } };
		expect(error.code).toBe("invalid-request");
		expect(error.message).not.toContain("T-0404");
	});

	it.each([
		"T-1",
		"x",
		"t-0001",
		"T-0001 ",
		"../../etc",
		"T-0001'; DROP TABLE helpdesk_tickets; --",
	])("answers 404 for the malformed id %j without asking the database", async (id) => {
		await store.create({ inquiry: "q" });

		const response = await GET(...get(id));

		expect(response.status).toBe(404);
		const { error } = (await response.json()) as { error: { code: string; message: string } };
		expect(error.code).toBe("invalid-request");
		expect(error.message).not.toContain("DROP TABLE");
		expect(vi.mocked(getHelpdeskStore)).not.toHaveBeenCalled();
		expect(await store.get("T-0001")).toBeDefined();
	});

	it("answers 503 provider-unavailable when the database cannot be reached", async () => {
		vi.mocked(getHelpdeskStore).mockRejectedValueOnce(new KnowledgeBaseUnavailableError());

		const response = await GET(...get("T-0001"));

		expect(response.status).toBe(503);
		expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
			"provider-unavailable",
		);
	});
});
