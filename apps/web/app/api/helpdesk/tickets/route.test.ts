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

function get(query = ""): Request {
	return new Request(`http://localhost/api/helpdesk/tickets${query}`);
}

interface TicketJson {
	id: string;
	inquiry: string;
	status: string;
	answer?: string;
	escalationReason?: string;
	stoppedReason?: string;
	stepsUsed: number;
	createdAt: string;
	updatedAt: string;
}

async function ticketsOf(response: Response): Promise<TicketJson[]> {
	return ((await response.json()) as { tickets: TicketJson[] }).tickets;
}

async function seed(): Promise<void> {
	await store.create({ inquiry: "一件目" });
	clock.advanceBy(1_000);
	await store.create({ inquiry: "二件目" });
	clock.advanceBy(1_000);
	await store.create({ inquiry: "三件目" });
	await store.setStatus("T-0001", { status: "resolved", answer: "回答です", stepsUsed: 3 });
	await store.setStatus("T-0003", {
		status: "escalated",
		reason: "根拠がありません",
		stepsUsed: 2,
	});
}

describe("GET /api/helpdesk/tickets", () => {
	it("lists the tickets newest first with their state", async () => {
		await seed();

		const response = await GET(get());
		const tickets = await ticketsOf(response);

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("application/json");
		expect(tickets.map((ticket) => ticket.id)).toEqual(["T-0003", "T-0002", "T-0001"]);
		expect(tickets[0]).toMatchObject({
			status: "escalated",
			escalationReason: "根拠がありません",
			stepsUsed: 2,
			createdAt: "2026-10-18T00:00:02.000Z",
		});
		expect(tickets[2]).toMatchObject({ status: "resolved", answer: "回答です" });
		expect(tickets[1]).toMatchObject({ status: "open", inquiry: "二件目" });
		expect(Object.keys(tickets[1] ?? {})).not.toContain("answer");
	});

	it("filters by status", async () => {
		await seed();

		expect((await ticketsOf(await GET(get("?status=resolved")))).map((t) => t.id)).toEqual([
			"T-0001",
		]);
		expect((await ticketsOf(await GET(get("?status=escalated")))).map((t) => t.id)).toEqual([
			"T-0003",
		]);
		expect((await ticketsOf(await GET(get("?status=open")))).map((t) => t.id)).toEqual(["T-0002"]);
	});

	it("returns an empty list, not an error, when there is no ticket", async () => {
		expect(await ticketsOf(await GET(get()))).toEqual([]);
	});

	it("returns at most 50, the newest", async () => {
		for (let index = 0; index < 52; index += 1) {
			await store.create({ inquiry: `q${index}` });
			clock.advanceBy(1_000);
		}

		const tickets = await ticketsOf(await GET(get()));

		expect(tickets).toHaveLength(50);
		expect(tickets[0]?.id).toBe("T-0052");
		expect(tickets.at(-1)?.id).toBe("T-0003");
	});

	it.each([
		["an unknown status", "?status=closed"],
		["an empty status", "?status="],
		["a repeated status", "?status=open&status=resolved"],
		["an unknown parameter", "?limit=500"],
		["a status in the wrong case", "?status=OPEN"],
	])("answers 400 invalid-request for %s", async (_name, query) => {
		const response = await GET(get(query));

		expect(response.status).toBe(400);
		expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
			"invalid-request",
		);
	});

	it("answers 503 provider-unavailable with the start-up guidance when the database cannot be reached", async () => {
		vi.mocked(getHelpdeskStore).mockRejectedValueOnce(new KnowledgeBaseUnavailableError());

		const response = await GET(get());

		expect(response.status).toBe(503);
		const { error } = (await response.json()) as { error: { code: string; message: string } };
		expect(error.code).toBe("provider-unavailable");
		expect(error.message).toContain("services:up:db");
	});
});
