import { M3_5_SAMPLE_OVERVIEWS } from "@platform/ai-core/mock";
import {
	createInterviewState,
	getRequirementsSessions,
	REQUIREMENT_DOCUMENT_HEADINGS,
	renderRequirementDocument,
} from "@platform/ai-core/requirements";
import { createFakeClock } from "@platform/ai-core/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPlatform, setPlatformForTesting } from "@/lib/server/platform";
import { getSessionRegistry, resetSessionRegistriesForTesting } from "@/lib/server/sessions";
import { POST as createSession } from "../../route";
import { GET } from "./route";

const NOW = Date.parse("2026-10-24T00:00:00.000Z");
const IDLE_MS = 600_000;
const ID = "7b0f6c1e-5d3a-4e8b-9a21-0c4d5e6f7a8b";

let clock = createFakeClock(NOW);

const sessions = () => getRequirementsSessions(getSessionRegistry, clock);

function seed(id: string, document: string | null) {
	return sessions().create(id, () => ({
		overview: "x",
		personas: [],
		state: createInterviewState({ maxRounds: 3 }),
		questions: [],
		document,
	}));
}

const call = (id: string) =>
	GET(new Request(`http://localhost/api/requirements/sessions/${id}/document`), {
		params: Promise.resolve({ id }),
	});

const errorOf = async (response: Response) =>
	(await response.json()).error as { code: string; message: string };

const DOCUMENT = renderRequirementDocument(
	{
		functional: [{ text: "問い合わせを振り分ける", personaId: "p1" }],
		nonFunctional: [],
		constraints: [],
		unconfirmed: [],
	},
	{ forcedEnd: false, missing: [] },
);

beforeEach(async () => {
	resetSessionRegistriesForTesting();
	clock = createFakeClock(NOW);
	const platform = await createPlatform({
		env: { VITEST: "1", AI_TEST_RUN_MODE: "mock" },
		clock,
	});
	setPlatformForTesting(platform);
});

afterEach(() => {
	setPlatformForTesting(undefined);
	resetSessionRegistriesForTesting();
});

describe("GET /api/requirements/sessions/[id]/document: the download", () => {
	it("returns the stored Markdown exactly, with its chapters", async () => {
		seed(ID, DOCUMENT);

		const response = await call(ID);

		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).toBe(DOCUMENT);
		for (const heading of Object.values(REQUIREMENT_DOCUMENT_HEADINGS)) {
			expect(body).toContain(heading);
		}
	});

	it("sets the content type, a fixed attachment file name and the hardening headers", async () => {
		seed(ID, DOCUMENT);

		const response = await call(ID);

		expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
		expect(response.headers.get("content-disposition")).toBe(
			'attachment; filename="requirements.md"',
		);
		expect(response.headers.get("x-content-type-options")).toBe("nosniff");
		expect(response.headers.get("cache-control")).toBe("no-store");
	});

	it("never lets the session id reach a header", async () => {
		seed(ID, DOCUMENT);

		const response = await call(ID);

		for (const [, value] of response.headers) expect(value).not.toContain(ID);
	});

	it("counts a download as activity", async () => {
		seed(ID, DOCUMENT);
		clock.advanceBy(IDLE_MS - 1);
		expect((await call(ID)).status).toBe(200);
		clock.advanceBy(IDLE_MS - 1);

		expect((await call(ID)).status).toBe(200);
	});

	it("does not keep an idle session alive past the limit", async () => {
		seed(ID, DOCUMENT);
		clock.advanceBy(IDLE_MS + 1);

		expect((await call(ID)).status).toBe(404);
	});
});

describe("GET /api/requirements/sessions/[id]/document: not available", () => {
	it("answers 409 invalid-request while the document is not generated yet", async () => {
		seed(ID, null);

		const response = await call(ID);

		expect(response.status).toBe(409);
		expect(response.headers.get("content-type")).toContain("application/json");
		expect(response.headers.get("content-disposition")).toBeNull();
		const error = await errorOf(response);
		expect(error.code).toBe("invalid-request");
		expect(error.message).not.toContain(ID);
	});

	it("keeps the session after a 409 and still counts it as activity", async () => {
		seed(ID, null);
		clock.advanceBy(IDLE_MS - 1);
		await call(ID);
		clock.advanceBy(IDLE_MS - 1);

		expect((await call(ID)).status).toBe(409);
	});

	it("answers 404 for an unknown session, not echoing the id", async () => {
		const response = await call(ID);

		expect(response.status).toBe(404);
		const error = await errorOf(response);
		expect(error.code).toBe("invalid-request");
		expect(error.message).not.toContain(ID);
	});

	it("answers 404 for a disposed session", async () => {
		seed(ID, DOCUMENT);
		sessions().dispose(ID);

		expect((await call(ID)).status).toBe(404);
	});

	it("answers 404 for an id of the wrong shape, without a header carrying it", async () => {
		const response = await call("../../etc/passwd");

		expect(response.status).toBe(404);
		for (const [, value] of response.headers) expect(value).not.toContain("passwd");
	});
});

describe("GET /api/requirements/sessions/[id]/document: shared registry", () => {
	it("finds a session made by the real POST /api/requirements/sessions", async () => {
		const created = await createSession(
			new Request("http://localhost/api/requirements/sessions", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ overview: M3_5_SAMPLE_OVERVIEWS.default }),
			}),
		);
		expect(created.status).toBe(200);
		const { sessionId } = (await created.json()) as { sessionId: string };

		// The interview has not ended: no document yet.
		expect((await call(sessionId)).status).toBe(409);

		const session = sessions().get(sessionId);
		if (!session) throw new Error("session missing");
		session.document = DOCUMENT;

		const response = await call(sessionId);
		expect(response.status).toBe(200);
		expect(await response.text()).toBe(DOCUMENT);
	});

	it("finds a session created through another module instance (shared globalThis registry)", async () => {
		seed(ID, DOCUMENT);
		vi.resetModules();
		const fresh = await import("./route");

		const response = await fresh.GET(new Request("http://localhost/x"), {
			params: Promise.resolve({ id: ID }),
		});

		expect(response.status).toBe(200);
		expect(await response.text()).toBe(DOCUMENT);
	});
});
