import { DEFAULT_SANDBOX } from "@platform/ai-core/config";
import { M3_3_SAMPLE_INSTRUCTIONS } from "@platform/ai-core/mock";
import { createFakeClock } from "@platform/ai-core/ports";
import {
	createMockSandboxProvider,
	createSandboxRegistry,
	type MockSandboxProvider,
} from "@platform/ai-core/sandbox";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createPlatform,
	getSandboxSelection,
	type SandboxSetup,
	setPlatformForTesting,
	setSandboxForTesting,
} from "@/lib/server/platform";
import { POST } from "../../route";
import { DELETE } from "./route";

vi.mock("@/lib/server/platform", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/server/platform")>();
	return { ...original, getSandboxSelection: vi.fn(original.getSandboxSelection) };
});

const MOCK_ENV = { VITEST: "1", AI_TEST_RUN_MODE: "mock" } as const;
const SESSION = "11111111-2222-4333-8444-555555555555";
const OTHER = "99999999-2222-4333-8444-555555555555";

let provider: MockSandboxProvider;
let clock: ReturnType<typeof createFakeClock>;

beforeEach(async () => {
	clock = createFakeClock(Date.parse("2026-10-18T00:00:00.000Z"));
	provider = createMockSandboxProvider();
	const setup: SandboxSetup = {
		kind: "mock",
		provider,
		registry: createSandboxRegistry({
			provider,
			clock,
			idleTimeoutMs: DEFAULT_SANDBOX.idleTimeoutMs,
		}),
		stop: () => undefined,
	};
	setPlatformForTesting(await createPlatform({ env: MOCK_ENV, clock }));
	setSandboxForTesting(setup);
});

afterEach(() => {
	vi.mocked(getSandboxSelection).mockClear();
	setSandboxForTesting(undefined);
	setPlatformForTesting(undefined);
});

function analysisRequest(sessionId = SESSION): Request {
	const form = new FormData();
	form.append("file", new File(["date,sales\n2026-01-01,1\n"], "sales.csv"));
	form.append("instruction", M3_3_SAMPLE_INSTRUCTIONS.success);
	form.append("sessionId", sessionId);
	return new Request("http://localhost/api/analysis", { method: "POST", body: form });
}

function remove(id: string): Promise<Response> {
	return DELETE(new Request(`http://localhost/api/analysis/sessions/${id}`, { method: "DELETE" }), {
		params: Promise.resolve({ id }),
	});
}

describe("DELETE /api/analysis/sessions/[id]", () => {
	it("closes the sandbox that /api/analysis made for the session, from this other route", async () => {
		await (await POST(analysisRequest())).text();
		expect(provider.sessions).toHaveLength(1);
		expect(provider.sessions[0]?.closeCount).toBe(0);

		const response = await remove(SESSION);

		expect(response.status).toBe(204);
		expect(await response.text()).toBe("");
		expect(provider.sessions[0]?.closeCount).toBe(1);
	});

	it("says in a header whether a sandbox was closed, because a 204 has no body", async () => {
		await (await POST(analysisRequest())).text();

		const first = await remove(SESSION);
		const second = await remove(SESSION);
		const unknown = await remove(OTHER);

		expect(first.headers.get("x-analysis-session")).toBe("released");
		expect(second.headers.get("x-analysis-session")).toBe("absent");
		expect(unknown.headers.get("x-analysis-session")).toBe("absent");
	});

	it("leaves the sandboxes of other sessions alone", async () => {
		await (await POST(analysisRequest())).text();
		await (await POST(analysisRequest(OTHER))).text();

		await remove(SESSION);

		expect(provider.sessions.map((session) => session.closeCount)).toEqual([1, 0]);
	});

	it("is idempotent: a second delete, an unknown session and a finished one all answer 204", async () => {
		await (await POST(analysisRequest())).text();

		const statuses = [
			(await remove(SESSION)).status,
			(await remove(SESSION)).status,
			(await remove(OTHER)).status,
		];

		expect(statuses).toEqual([204, 204, 204]);
		expect(provider.sessions[0]?.closeCount).toBe(1);
	});

	it("makes a fresh sandbox for the session if it is used again", async () => {
		await (await POST(analysisRequest())).text();
		await remove(SESSION);

		await (await POST(analysisRequest())).text();

		expect(provider.sessions).toHaveLength(2);
		expect(provider.sessions[1]?.closeCount).toBe(0);
	});

	it.each([
		"not-a-uuid",
		"../../etc/passwd",
		"11111111-2222-4333-8444-55555555555",
		"",
		" ",
		"%00",
	])("answers 400 invalid-request for the id %j, without touching the sandbox", async (id) => {
		const response = await remove(id);

		expect(response.status).toBe(400);
		expect((await response.json()).error.code).toBe("invalid-request");
		expect(vi.mocked(getSandboxSelection)).not.toHaveBeenCalled();
	});

	it("answers 204 when the sandbox is disabled: there is nothing to close", async () => {
		setSandboxForTesting({ kind: "disabled", reason: "r", guidance: "g" });

		const response = await remove(SESSION);

		expect(response.status).toBe(204);
		expect(response.headers.get("x-analysis-session")).toBe("absent");
	});

	it("hides the text of an unexpected failure", async () => {
		vi.mocked(getSandboxSelection).mockRejectedValueOnce(
			new Error("secret detail /private/host/engine-path"),
		);

		const response = await remove(SESSION);
		const text = await response.text();

		expect(response.status).toBe(500);
		expect(text).not.toContain("secret detail");
		expect(text).not.toContain("engine-path");
	});
});
