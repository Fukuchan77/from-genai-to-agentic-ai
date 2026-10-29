import { M3_5_SAMPLE_OVERVIEWS } from "@platform/ai-core/mock";
import { CapabilityUnsupportedError, MODEL_CATALOG } from "@platform/ai-core/models";
import {
	createInterviewState,
	getRequirementsSessions,
	REQUIREMENTS_MAX_SESSIONS,
	REQUIREMENTS_SESSION_IDLE_MS,
} from "@platform/ai-core/requirements";
import { createFakeClock } from "@platform/ai-core/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPlatform, setPlatformForTesting } from "@/lib/server/platform";
import { getSessionRegistry, resetSessionRegistriesForTesting } from "@/lib/server/sessions";
import { verifyOrWriteFixture } from "../../../../../../scripts/e2e/generate-sse-fixtures.mjs";
import { POST } from "./route";

const MOCK_ENV = { VITEST: "1", AI_TEST_RUN_MODE: "mock" } as const;
const LIVE_ENV = {
	VITEST: "1",
	AI_TEST_RUN_MODE: "live",
	AI_LIVE_PROVIDER: "openai",
	OPENAI_API_KEY: "test-key",
	CHAT_RATE_LIMIT_MAX: "1",
} as const;
const NOW = Date.parse("2026-10-24T00:00:00.000Z");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

let modelCalls: number;
let platformClock = createFakeClock(NOW);

async function installPlatform(
	env: Record<string, string> = MOCK_ENV,
	adjust: (platform: Awaited<ReturnType<typeof createPlatform>>) => object = () => ({}),
) {
	platformClock = createFakeClock(NOW);
	const platform = await createPlatform({ env, clock: platformClock });
	const resolve = platform.gateway.resolve.bind(platform.gateway);
	setPlatformForTesting({
		...platform,
		gateway: {
			...platform.gateway,
			resolve: async (request: Parameters<typeof resolve>[0]) => {
				const resolved = await resolve(request);
				const { model } = resolved;
				const wrapped = Object.create(model) as typeof model;
				wrapped.doGenerate = async (options) => {
					modelCalls += 1;
					return model.doGenerate(options);
				};
				return { ...resolved, model: wrapped };
			},
		} as never,
		...adjust(platform),
	});
}

function post(body: unknown, init: RequestInit = {}): Request {
	return new Request("http://localhost/api/requirements/sessions", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: typeof body === "string" ? body : JSON.stringify(body),
		...init,
	});
}

const errorOf = async (response: Response) =>
	(await response.json()).error as { code: string; message: string };

const sessions = () => getRequirementsSessions(getSessionRegistry, platformClock);
// The store type has no size(); the registry behind it does.
const registrySize = () =>
	(
		getSessionRegistry("requirements", { clock: platformClock, idleTimeoutMs: 1 }) as unknown as {
			size(): number;
		}
	).size();

interface Created {
	sessionId: string;
	personas: { id: string; name: string; role: string; goals: string[] }[];
	questions: { id: string; personaId: string; text: string }[];
}

beforeEach(() => {
	modelCalls = 0;
	resetSessionRegistriesForTesting();
});

afterEach(() => {
	setPlatformForTesting(undefined);
	resetSessionRegistriesForTesting();
});

describe("POST /api/requirements/sessions: rejections before any model call", () => {
	it("answers 413 for an oversized body", async () => {
		await installPlatform();

		const response = await POST(post({ overview: "x", padding: "x".repeat(600_000) }));

		expect(response.status).toBe(413);
		expect(modelCalls).toBe(0);
	});

	it.each([
		["invalid JSON", "{not json"],
		["an unknown field", { overview: "x", sessionId: "abc" }],
		["no overview", {}],
		["an empty overview", { overview: "" }],
		["a blank overview", { overview: "  \n " }],
		["an unknown model", { overview: "x", modelId: "not-a-model" }],
		["personaCount 0", { overview: "x", personaCount: 0 }],
		["personaCount 6", { overview: "x", personaCount: 6 }],
		["a fractional personaCount", { overview: "x", personaCount: 2.5 }],
		["maxRounds 0", { overview: "x", maxRounds: 0 }],
		["maxRounds 11", { overview: "x", maxRounds: 11 }],
		["a fractional maxRounds", { overview: "x", maxRounds: 1.5 }],
		["a string personaCount", { overview: "x", personaCount: "3" }],
	])("answers 400 invalid-request for %s, creating no session", async (_name, body) => {
		await installPlatform();

		const response = await POST(post(body));

		expect(response.status).toBe(400);
		expect((await errorOf(response)).code).toBe("invalid-request");
		expect(modelCalls).toBe(0);
		expect(sessions().get("anything")).toBeUndefined();
	});

	it("answers 400 for an overview over 2000 characters, and accepts exactly 2000", async () => {
		await installPlatform();

		const tooLong = await POST(post({ overview: "あ".repeat(2_001) }));
		const exact = await POST(post({ overview: "あ".repeat(2_000) }));

		expect(tooLong.status).toBe(400);
		// 2000 characters have no mock script: it passes the guard and ends in the model step.
		expect(exact.status).not.toBe(400);
		expect(exact.status).not.toBe(413);
	});

	it("counts the overview in characters (code points) all the way: 2000 emoji pass, 2001 are 400", async () => {
		await installPlatform();

		const exact = await POST(post({ overview: "😀".repeat(2_000) }));
		const tooLong = await POST(post({ overview: "😀".repeat(2_001) }));

		// 2000 emoji have no mock script: they pass the guard and the personas' own length check.
		expect(exact.status).not.toBe(400);
		expect(tooLong.status).toBe(400);
	});

	it("sweeps expired interviews and refuses a new one at the cap before any LLM call", async () => {
		await installPlatform();
		const store = sessions();
		const filler = () => ({
			overview: "x",
			personas: [],
			state: createInterviewState({ maxRounds: 1 }),
			questions: [],
			document: null,
		});
		for (let i = 0; i < REQUIREMENTS_MAX_SESSIONS; i += 1) store.create(`fill-${i}`, filler);

		const full = await POST(post({ overview: M3_5_SAMPLE_OVERVIEWS.default }));
		expect(full.status).toBe(503);
		expect((await errorOf(full)).code).toBe("provider-unavailable");
		expect(modelCalls).toBe(0);

		platformClock.advanceBy(REQUIREMENTS_SESSION_IDLE_MS + 1);
		const afterIdle = await POST(post({ overview: M3_5_SAMPLE_OVERVIEWS.default }));
		expect(afterIdle.status).toBe(200);
		expect(store.get("fill-0")).toBeUndefined();
	});

	it("checks the body (400) before the rate limit (429), and rate-limits only in live mode", async () => {
		await installPlatform(LIVE_ENV, (platform) => ({
			gateway: {
				...platform.gateway,
				resolve: async () => {
					throw new CapabilityUnsupportedError("structuredOutput", "gpt-test", "OpenAI");
				},
			},
		}));

		const rejected = await POST(post({ overview: "" }));
		const first = await POST(post({ overview: "x" }));
		const second = await POST(post({ overview: "x" }));

		expect(rejected.status).toBe(400);
		expect(first.status).toBe(400);
		expect((await errorOf(first)).code).toBe("capability-unsupported");
		expect(second.status).toBe(429);
		expect((await errorOf(second)).code).toBe("rate-limited");
	});

	it("answers 400 capability-unsupported when the model has no structured output, before any LLM call", async () => {
		let required: readonly string[] | undefined;
		await installPlatform(MOCK_ENV, (platform) => ({
			gateway: {
				...platform.gateway,
				resolve: async (request: { require?: readonly string[] }) => {
					required = request.require;
					throw new CapabilityUnsupportedError("structuredOutput", "mock:general-v1", "Mock");
				},
			},
		}));

		const response = await POST(post({ overview: M3_5_SAMPLE_OVERVIEWS.default }));

		expect(response.status).toBe(400);
		expect((await errorOf(response)).code).toBe("capability-unsupported");
		expect(required).toEqual(["structuredOutput"]);
		expect(modelCalls).toBe(0);
	});

	it("passes the model the request names to the gateway, and none when it names none", async () => {
		const modelId = Object.keys(MODEL_CATALOG)[0] as string;
		let asked: { modelId?: string } | undefined;
		await installPlatform(MOCK_ENV, (platform) => ({
			gateway: {
				...platform.gateway,
				resolve: async (request: { modelId?: string }) => {
					asked = request;
					throw new CapabilityUnsupportedError("structuredOutput", modelId, "Mock");
				},
			},
		}));

		await POST(post({ overview: "x", modelId }));
		expect(asked?.modelId).toBe(modelId);

		await POST(post({ overview: "x" }));
		expect(asked).not.toHaveProperty("modelId");
	});
});

describe("POST /api/requirements/sessions: a start in mock mode", () => {
	it("creates the session and returns the id, the personas and one question per persona", async () => {
		await installPlatform();

		const response = await POST(post({ overview: M3_5_SAMPLE_OVERVIEWS.default }));
		const body = (await response.json()) as Created;

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("application/json");
		expect(body.sessionId).toMatch(UUID);
		expect(body.personas.map((persona) => persona.id)).toEqual([
			"persona-1",
			"persona-2",
			"persona-3",
		]);
		for (const persona of body.personas) {
			expect(Object.keys(persona).sort()).toEqual(
				expect.arrayContaining(["goals", "id", "name", "role"]),
			);
			expect(persona.goals.length).toBeGreaterThan(0);
		}
		expect(body.questions.map((q) => q.personaId)).toEqual(body.personas.map((p) => p.id));
		expect(body.questions.map((q) => q.id)).toEqual(["q-1-1", "q-1-2", "q-1-3"]);
		for (const question of body.questions) expect(question.text).not.toBe("");
		expect(Object.keys(body).sort()).toEqual(["personas", "questions", "sessionId"]);
		expect(modelCalls).toBe(2);
	});

	it("stores the fresh interview in the shared registry under the returned id", async () => {
		await installPlatform();

		const body = (await (
			await POST(post({ overview: M3_5_SAMPLE_OVERVIEWS.default }))
		).json()) as Created;

		const stored = sessions().get(body.sessionId);
		expect(stored?.overview).toBe(M3_5_SAMPLE_OVERVIEWS.default);
		expect(stored?.personas).toEqual(body.personas);
		expect(stored?.questions).toEqual(body.questions);
		expect(stored?.document).toBeNull();
		expect(stored?.state).toMatchObject({
			round: 0,
			maxRounds: 5,
			completed: false,
			forcedEnd: false,
			answers: [],
			missing: [],
		});
		expect(stored?.modelId).toBeUndefined();
	});

	it("applies maxRounds", async () => {
		await installPlatform();

		const body = (await (
			await POST(post({ overview: M3_5_SAMPLE_OVERVIEWS.default, maxRounds: 2 }))
		).json()) as Created;

		expect(sessions().get(body.sessionId)?.state.maxRounds).toBe(2);
	});

	it("remembers the model the request names for the next rounds", async () => {
		const modelId = Object.keys(MODEL_CATALOG)[0] as string;
		// The catalog model is not a mock model: resolve the default one, as the mock gateway would.
		await installPlatform(MOCK_ENV, (platform) => ({
			gateway: {
				...platform.gateway,
				resolve: (request: { modelId?: string }) =>
					platform.gateway.resolve({ ...request, modelId: undefined } as never),
			},
		}));

		const body = (await (
			await POST(post({ overview: M3_5_SAMPLE_OVERVIEWS.default, modelId }))
		).json()) as Created;

		expect(sessions().get(body.sessionId)?.modelId).toBe(modelId);
	});

	it("gives every start its own id and session", async () => {
		await installPlatform();

		const first = (await (
			await POST(post({ overview: M3_5_SAMPLE_OVERVIEWS.default }))
		).json()) as Created;
		const second = (await (
			await POST(post({ overview: M3_5_SAMPLE_OVERVIEWS.default }))
		).json()) as Created;

		expect(first.sessionId).not.toBe(second.sessionId);
		expect(sessions().get(first.sessionId)).toBeDefined();
		expect(sessions().get(second.sessionId)).toBeDefined();
	});

	it("lets the session lapse after 10 idle minutes", async () => {
		await installPlatform();
		const body = (await (
			await POST(post({ overview: M3_5_SAMPLE_OVERVIEWS.default }))
		).json()) as Created;

		platformClock.advanceBy(600_001);

		expect(sessions().get(body.sessionId)).toBeUndefined();
	});

	it("answers 502 output-invalid when the persona output is invalid three times, storing no session", async () => {
		await installPlatform(MOCK_ENV, (platform) => ({
			gateway: {
				...platform.gateway,
				resolve: async (request: never) => {
					const resolved = await platform.gateway.resolve(request);
					const invalid = Object.create(resolved.model) as typeof resolved.model;
					invalid.doGenerate = async (options) => {
						modelCalls += 1;
						const result = await resolved.model.doGenerate(options);
						return { ...result, content: [{ type: "text", text: '{"personas":[]}' }] };
					};
					return { ...resolved, model: invalid };
				},
			},
		}));

		const response = await POST(post({ overview: M3_5_SAMPLE_OVERVIEWS.default }));

		expect(response.status).toBe(502);
		expect((await errorOf(response)).code).toBe("output-invalid");
		expect(modelCalls).toBe(3);
		expect(registrySize()).toBe(0);
	});

	it("does not invent personas for an overview without a script", async () => {
		await installPlatform();

		const response = await POST(post({ overview: "台本の無い概要" }));

		expect(response.status).toBeGreaterThanOrEqual(400);
		expect(registrySize()).toBe(0);
	});

	it("stops at an abort after the questions are asked and stores no session", async () => {
		const controller = new AbortController();
		await installPlatform(MOCK_ENV, (platform) => ({
			gateway: {
				...platform.gateway,
				resolve: async (request: never) => {
					const resolved = await platform.gateway.resolve(request);
					const model = resolved.model;
					const wrapped = Object.create(model) as typeof model;
					wrapped.doGenerate = async (options) => {
						modelCalls += 1;
						const result = await model.doGenerate(options);
						// The last call (the questions) finishes, then the client is gone.
						if (modelCalls === 2) controller.abort(new DOMException("Stopped", "AbortError"));
						return result;
					};
					return { ...resolved, model: wrapped };
				},
			},
		}));

		const response = await POST(
			post({ overview: M3_5_SAMPLE_OVERVIEWS.default }, { signal: controller.signal }),
		);

		expect(response.status).toBeGreaterThanOrEqual(400);
		expect(modelCalls).toBe(2);
		expect(registrySize()).toBe(0);
	});

	it("keeps provider failures out of the response body", async () => {
		await installPlatform(MOCK_ENV, (platform) => ({
			gateway: {
				...platform.gateway,
				resolve: async (request: never) => {
					const resolved = await platform.gateway.resolve(request);
					const failing = Object.create(resolved.model) as typeof resolved.model;
					failing.doGenerate = async () => {
						throw new Error("upstream said: key sk-secret-999 rejected");
					};
					return { ...resolved, model: failing };
				},
			},
		}));

		const response = await POST(post({ overview: M3_5_SAMPLE_OVERVIEWS.default }));

		expect(response.status).toBeGreaterThanOrEqual(500);
		expect(await response.text()).not.toContain("sk-secret-999");
	});
});

describe("POST /api/requirements/sessions: generated SSE fixtures used by the E2E specs (JSON bodies)", () => {
	it("matches the generated SSE fixture (JSON) of a started interview (a fixed session id)", async () => {
		await installPlatform();
		const spy = vi
			.spyOn(crypto, "randomUUID")
			.mockReturnValue("00000000-0000-4000-8000-000000000001");
		try {
			const response = await POST(post({ overview: M3_5_SAMPLE_OVERVIEWS.default }));

			expect(response.status).toBe(200);
			verifyOrWriteFixture(
				"requirements-session.json",
				`${JSON.stringify(await response.json(), null, "\t")}\n`,
			);
		} finally {
			spy.mockRestore();
		}
	});
});
