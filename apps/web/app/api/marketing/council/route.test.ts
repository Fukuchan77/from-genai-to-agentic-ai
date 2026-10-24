import { DEFAULT_COUNCIL } from "@platform/ai-core/config";
import { seedMarketing } from "@platform/ai-core/marketing";
import { M3_6_SAMPLE_DRAFTS } from "@platform/ai-core/mock";
import { CapabilityUnsupportedError, MODEL_CATALOG } from "@platform/ai-core/models";
import {
	createPgliteDatabase,
	KnowledgeBaseUnavailableError,
	type RagDatabaseHandle,
} from "@platform/ai-core/rag";
import { createFakeClock } from "@platform/ai-core/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createPlatform,
	setKnowledgeBaseForTesting,
	setPlatformForTesting,
} from "@/lib/server/platform";
import { POST } from "./route";

// Each test starts its own in-memory PGlite (about 0.5 s alone, several seconds under the gate's
// parallel workers), so the default 5 s limit is too tight.
vi.setConfig({ testTimeout: 60_000 });

const MOCK_ENV = { VITEST: "1", AI_TEST_RUN_MODE: "mock" } as const;
const LIVE_ENV = {
	VITEST: "1",
	AI_TEST_RUN_MODE: "live",
	AI_LIVE_PROVIDER: "openai",
	OPENAI_API_KEY: "test-key",
	CHAT_RATE_LIMIT_MAX: "1",
} as const;
const NOW = Date.parse("2026-10-24T00:00:00.000Z");
const DRAFT = M3_6_SAMPLE_DRAFTS.default;

/** Every `doGenerate` of the resolved chat model, with the hook the test installed. */
let modelCalls: number;
let beforeModelCall: ((callIndex: number) => Promise<void> | void) | undefined;
let handle: RagDatabaseHandle | undefined;

async function installPlatform(
	env: Record<string, string> = MOCK_ENV,
	adjust: (platform: Awaited<ReturnType<typeof createPlatform>>) => object = () => ({}),
) {
	const platform = await createPlatform({ env, clock: createFakeClock(NOW) });
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
					await beforeModelCall?.(modelCalls);
					return model.doGenerate(options);
				};
				return { ...resolved, model: wrapped };
			},
		} as never,
		...adjust(platform),
	});
}

/** A fresh in-memory database; `mock` seeds it on first use, `seeded` seeds it now. */
async function installDatabase(seeded: boolean): Promise<void> {
	handle = await createPgliteDatabase();
	if (seeded) await seedMarketing({ db: handle.db });
	setKnowledgeBaseForTesting(handle);
}

function post(body: unknown, init: RequestInit = {}): Request {
	return new Request("http://localhost/api/marketing/council", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: typeof body === "string" ? body : JSON.stringify(body),
		...init,
	});
}

interface StreamPart {
	type: string;
	id?: string;
	data?: Record<string, unknown>;
	errorText?: string;
}

function parseParts(text: string): StreamPart[] {
	return text
		.split("\n\n")
		.map((chunk) => chunk.trim())
		.filter((chunk) => chunk.startsWith("data: ") && chunk !== "data: [DONE]")
		.map((chunk) => JSON.parse(chunk.slice("data: ".length)) as StreamPart);
}

const partsOf = async (response: Response) => parseParts(await response.text());
const errorOf = async (response: Response) =>
	(await response.json()).error as { code: string; message: string };

const ofType = (parts: readonly StreamPart[], type: string) =>
	parts.filter((part) => part.type === type);
const turnsOf = (parts: readonly StreamPart[]) =>
	ofType(parts, "data-council-turn").map(
		(part) => part.data as { round: number; personaId: string; personaName: string; text: string },
	);
const verdictsOf = (parts: readonly StreamPart[]) =>
	ofType(parts, "data-council-verdict").map(
		(part) =>
			part.data as {
				round: number;
				agreed: boolean;
				reason: string;
				remainingObjections: string[];
			},
	);
const resultOf = (parts: readonly StreamPart[]) =>
	ofType(parts, "data-council-result")[0]?.data as
		| { improvedDraft: string; endReason: string; rounds: { round: number }[] }
		| undefined;

beforeEach(() => {
	modelCalls = 0;
	beforeModelCall = undefined;
	handle = undefined;
});

afterEach(async () => {
	setPlatformForTesting(undefined);
	setKnowledgeBaseForTesting(undefined);
	await handle?.close?.();
});

describe("POST /api/marketing/council: rejections before any model call", () => {
	it("answers 413 for an oversized body", async () => {
		await installDatabase(true);
		await installPlatform();

		const response = await POST(post({ draft: "d", padding: "x".repeat(600_000) }));

		expect(response.status).toBe(413);
		expect(modelCalls).toBe(0);
	});

	it.each([
		["invalid JSON", "{not json"],
		["an unknown field", { draft: "d", tone: "soft" }],
		["no draft", {}],
		["an empty draft", { draft: "" }],
		["a blank draft", { draft: " \n " }],
		["a draft over 2000 characters", { draft: "あ".repeat(2001) }],
		["an unknown model", { draft: "d", modelId: "not-a-model" }],
		["maxRounds 0", { draft: "d", maxRounds: 0 }],
		["maxRounds 7", { draft: "d", maxRounds: 7 }],
		["a fractional maxRounds", { draft: "d", maxRounds: 2.5 }],
		["one persona", { draft: "d", personaIds: ["consumer"] }],
		["six personas", { draft: "d", personaIds: ["a", "b", "c", "d", "e", "f"] }],
		["a duplicated persona", { draft: "d", personaIds: ["consumer", "consumer"] }],
	])("answers 400 invalid-request for %s", async (_name, body) => {
		await installDatabase(true);
		await installPlatform();

		const response = await POST(post(body));

		expect(response.status).toBe(400);
		expect((await errorOf(response)).code).toBe("invalid-request");
		expect(modelCalls).toBe(0);
	});

	it("accepts a draft of exactly 2000 characters", async () => {
		await installDatabase(true);
		await installPlatform();

		const response = await POST(post({ draft: "あ".repeat(2000) }));

		expect(response.status).toBe(200);
		await response.text();
	});

	it("answers 400 for a persona id that does not exist, without echoing it or calling the model", async () => {
		await installDatabase(true);
		await installPlatform();

		const response = await POST(post({ draft: DRAFT, personaIds: ["consumer", "ghost-<b>"] }));

		expect(response.status).toBe(400);
		const error = await errorOf(response);
		expect(error.code).toBe("invalid-request");
		expect(error.message).not.toContain("ghost");
		expect(modelCalls).toBe(0);
	});

	it("answers 503 provider-unavailable with the seeding guidance when nothing is seeded (local)", async () => {
		await installDatabase(false);
		await installPlatform({
			VITEST: "1",
			AI_TEST_RUN_MODE: "local",
		});

		const response = await POST(post({ draft: DRAFT }));

		expect(response.status).toBe(503);
		const error = await errorOf(response);
		expect(error.code).toBe("provider-unavailable");
		expect(error.message).toContain("seed:samples");
		expect(modelCalls).toBe(0);
	});

	it("answers 503 when the database cannot be reached", async () => {
		await installPlatform();
		setKnowledgeBaseForTesting(undefined);
		(globalThis as Record<symbol, unknown>)[Symbol.for("from-genai-to-agentic-ai.knowledge-base")] =
			Promise.reject(new KnowledgeBaseUnavailableError());

		const response = await POST(post({ draft: DRAFT }));

		expect(response.status).toBe(503);
		expect((await errorOf(response)).code).toBe("provider-unavailable");
		expect(modelCalls).toBe(0);
	});

	it("checks in order: shape, then database, then persona ids, then the rate limit, then the model", async () => {
		await installDatabase(true);
		// Past the guard the request ends at once, so no live model is ever called.
		await installPlatform(LIVE_ENV, (platform) => ({
			gateway: {
				...platform.gateway,
				resolve: async () => {
					throw new CapabilityUnsupportedError("structuredOutput", "gpt-test", "OpenAI");
				},
			},
		}));

		// None of the rejections below spends the live quota of one request.
		const badShape = await POST(post({ draft: "" }));
		const badId = await POST(post({ draft: DRAFT, personaIds: ["consumer", "ghost"] }));
		const first = await POST(post({ draft: DRAFT }));
		const second = await POST(post({ draft: DRAFT }));

		expect(badShape.status).toBe(400);
		expect((await errorOf(badShape)).code).toBe("invalid-request");
		expect(badId.status).toBe(400);
		expect((await errorOf(badId)).code).toBe("invalid-request");
		expect(first.status).toBe(400);
		expect((await errorOf(first)).code).toBe("capability-unsupported");
		expect(second.status).toBe(429);
		expect((await errorOf(second)).code).toBe("rate-limited");
	});

	it("does not spend the live quota on an unseeded catalog", async () => {
		await installDatabase(false);
		await installPlatform(LIVE_ENV);

		const first = await POST(post({ draft: DRAFT }));
		const second = await POST(post({ draft: DRAFT }));

		expect(first.status).toBe(503);
		expect(second.status).toBe(503);
	});

	it("answers 400 capability-unsupported when the model has no structured output, before any LLM call", async () => {
		await installDatabase(true);
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

		const response = await POST(post({ draft: DRAFT }));

		expect(response.status).toBe(400);
		expect((await errorOf(response)).code).toBe("capability-unsupported");
		expect(required).toEqual(["structuredOutput"]);
		expect(modelCalls).toBe(0);
	});

	it("passes the model the request names to the gateway, and none when it names none", async () => {
		await installDatabase(true);
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

		await POST(post({ draft: DRAFT, modelId }));
		expect(asked?.modelId).toBe(modelId);

		await POST(post({ draft: DRAFT }));
		expect(asked).not.toHaveProperty("modelId");
	});
});

describe("POST /api/marketing/council: a council in mock mode", () => {
	it("runs the sample draft to agreement: an objection remains in round 1, none in round 2", async () => {
		await installDatabase(false);
		await installPlatform();

		const response = await POST(post({ draft: DRAFT }));
		const parts = await partsOf(response);

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("text/event-stream");
		const verdicts = verdictsOf(parts);
		expect(verdicts.map((verdict) => [verdict.round, verdict.agreed])).toEqual([
			[1, false],
			[2, true],
		]);
		expect(verdicts[0]?.remainingObjections.length).toBeGreaterThan(0);
		expect(verdicts[1]?.remainingObjections).toEqual([]);
		const result = resultOf(parts);
		expect(result?.endReason).toBe("agreed");
		expect(result?.improvedDraft).toContain("【保温ボトル】");
		expect(result?.rounds.map((round) => round.round)).toEqual([1, 2]);
		expect(modelCalls).toBe(8);
	});

	it("does not count agreement while an objection remains (CL-12), then agrees in round 2", async () => {
		await installDatabase(false);
		await installPlatform();

		const parts = await partsOf(await POST(post({ draft: M3_6_SAMPLE_DRAFTS.objections })));

		expect(resultOf(parts)?.endReason).toBe("agreed");
		expect(verdictsOf(parts).map((verdict) => verdict.round)).toEqual([1, 2]);
		expect(verdictsOf(parts)[0]?.remainingObjections).toEqual(["保証期間の記載が無い"]);
		expect(resultOf(parts)?.rounds).toHaveLength(2);
	});

	it("names the speaker in every turn, in the seeded order, three per round", async () => {
		await installDatabase(false);
		await installPlatform();

		const turns = turnsOf(await partsOf(await POST(post({ draft: DRAFT }))));

		expect(turns.map((turn) => [turn.round, turn.personaId, turn.personaName])).toEqual([
			[1, "marketer-strict", "厳しいマーケター"],
			[1, "consumer", "購入を検討する生活者"],
			[1, "seo-specialist", "SEO 担当者"],
			[2, "marketer-strict", "厳しいマーケター"],
			[2, "consumer", "購入を検討する生活者"],
			[2, "seo-specialist", "SEO 担当者"],
		]);
		expect(turns.every((turn) => turn.text.length > 0)).toBe(true);
	});

	it("streams each round's turns and then its verdict, then one result, with running ids on events", async () => {
		await installDatabase(false);
		await installPlatform();

		const parts = await partsOf(await POST(post({ draft: DRAFT })));

		const types = parts.map((part) => part.type).filter((type) => type.startsWith("data-council"));
		// Each verdict follows its own round's turns, not the end of the run.
		expect(types).toEqual([
			...Array(3).fill("data-council-turn"),
			"data-council-verdict",
			...Array(3).fill("data-council-turn"),
			"data-council-verdict",
			"data-council-result",
		]);
		expect(ofType(parts, "data-council-turn").map((part) => part.id)).toEqual([
			"turn-1",
			"turn-2",
			"turn-3",
			"turn-4",
			"turn-5",
			"turn-6",
		]);
		expect(ofType(parts, "data-council-verdict").map((part) => part.id)).toEqual([
			"verdict-1",
			"verdict-2",
		]);
	});

	it("streams the verdict of round 1 before round 2 starts, and keeps it when round 2 fails", async () => {
		// Calls 1-3 are round 1's personas and 4 its judge; every later call fails.
		beforeModelCall = (callIndex) => {
			if (callIndex >= 5) throw new Error("upstream said: key sk-secret-555 rejected");
		};
		await installDatabase(false);
		await installPlatform();

		const parts = await partsOf(await POST(post({ draft: DRAFT })));

		expect(verdictsOf(parts)).toHaveLength(1);
		expect(verdictsOf(parts)[0]).toMatchObject({ round: 1, agreed: false });
		expect(turnsOf(parts).filter((turn) => turn.round === 1)).toHaveLength(3);
		expect(parts.some((part) => part.type === "error")).toBe(true);
		expect(resultOf(parts)).toBeUndefined();
		expect(JSON.stringify(parts)).not.toContain("sk-secret-555");
		expect(
			parts.map((part) => part.type).filter((type) => type.startsWith("data-council")),
		).toEqual([
			...Array(3).fill("data-council-turn"),
			"data-council-verdict",
			// Round 2: the three statements that failed, then the stream ends in an error.
			...Array(3).fill("data-council-turn"),
		]);
	});

	it("stops at maxRounds with the draft so far", async () => {
		await installDatabase(false);
		await installPlatform();

		const parts = await partsOf(await POST(post({ draft: DRAFT, maxRounds: 1 })));

		const result = resultOf(parts);
		expect(result?.endReason).toBe("max-rounds");
		expect(result?.rounds).toHaveLength(1);
		expect(turnsOf(parts)).toHaveLength(3);
		expect(verdictsOf(parts)).toHaveLength(1);
		expect(result?.improvedDraft).toContain("保温ボトル");
		expect(modelCalls).toBe(4);
	});

	it("uses the default round limit when the request names none", () => {
		expect(DEFAULT_COUNCIL.maxRounds).toBe(3);
		expect(DEFAULT_COUNCIL.personaIds).toEqual(["marketer-strict", "consumer", "seo-specialist"]);
	});

	it("speaks only the requested personas, in the catalog's order, not the request's", async () => {
		await installDatabase(false);
		await installPlatform();

		const parts = await partsOf(
			await POST(post({ draft: DRAFT, personaIds: ["seo-specialist", "marketer-strict"] })),
		);

		const turns = turnsOf(parts);
		expect(new Set(turns.map((turn) => turn.personaId))).toEqual(
			new Set(["marketer-strict", "seo-specialist"]),
		);
		expect(turns.slice(0, 2).map((turn) => turn.personaId)).toEqual([
			"marketer-strict",
			"seo-specialist",
		]);
	});

	it("writes a turn to the stream before the next LLM call finishes (Req 6.3)", async () => {
		let release: () => void = () => {};
		const hold = new Promise<void>((resolve) => {
			release = resolve;
		});
		// Call 2 is the second persona: hold it and see what the client already has.
		beforeModelCall = async (callIndex) => {
			if (callIndex === 2) await hold;
		};
		await installDatabase(false);
		await installPlatform();

		const response = await POST(post({ draft: DRAFT }));
		const reader = (response.body as ReadableStream<Uint8Array>).getReader();
		const decoder = new TextDecoder();
		let received = "";
		const started = Date.now();
		while (!received.includes("data-council-turn")) {
			const { value, done } = await reader.read();
			if (done || Date.now() - started > 5_000) break;
			received += decoder.decode(value, { stream: true });
		}
		while (modelCalls < 2 && Date.now() - started < 5_000) {
			await new Promise((resolve) => setTimeout(resolve, 5));
		}

		try {
			expect(modelCalls).toBe(2);
			const early = parseParts(received);
			expect(turnsOf(early)[0]).toMatchObject({ round: 1, personaId: "marketer-strict" });
			expect(resultOf(early)).toBeUndefined();
			expect(verdictsOf(early)).toEqual([]);
		} finally {
			release();
		}
		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			received += decoder.decode(value, { stream: true });
		}
		expect(resultOf(parseParts(received))?.endReason).toBe("agreed");
	});

	it("stops at an abort: no further LLM call, no verdict and no result", async () => {
		const controller = new AbortController();
		beforeModelCall = (callIndex) => {
			// The second persona's call: the client goes away.
			if (callIndex === 2) controller.abort(new DOMException("Stopped", "AbortError"));
		};
		await installDatabase(false);
		await installPlatform();

		const response = await POST(post({ draft: DRAFT }, { signal: controller.signal }));
		const parts = await partsOf(response).catch(() => [] as StreamPart[]);

		expect(modelCalls).toBe(2);
		expect(resultOf(parts)).toBeUndefined();
		expect(verdictsOf(parts)).toEqual([]);
	});

	it("keeps provider failures out of the stream (a fixed message, no internals), with no result", async () => {
		await installDatabase(false);
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

		const parts = await partsOf(await POST(post({ draft: DRAFT })));

		expect(parts.some((part) => part.type === "error")).toBe(true);
		expect(JSON.stringify(parts)).not.toContain("sk-secret-999");
		expect(resultOf(parts)).toBeUndefined();
		expect(verdictsOf(parts)).toEqual([]);
	});

	it("keeps the message of an unexpected error out of the stream", async () => {
		await installDatabase(false);
		await installPlatform(MOCK_ENV, () => ({
			clock: {
				now: () => NOW,
				timeoutSignal: () => {
					throw new Error("clock broke: key sk-secret-777");
				},
			},
		}));

		const parts = await partsOf(await POST(post({ draft: DRAFT })));

		const error = parts.find((part) => part.type === "error");
		expect(error?.errorText).toBeDefined();
		expect(JSON.stringify(parts)).not.toContain("sk-secret-777");
		expect(resultOf(parts)).toBeUndefined();
	});

	it("does not invent a result for a draft without a script: the stream ends in an error", async () => {
		await installDatabase(false);
		await installPlatform();

		const parts = await partsOf(await POST(post({ draft: "台本の無い文案" })));

		expect(parts.some((part) => part.type === "error")).toBe(true);
		expect(resultOf(parts)).toBeUndefined();
	});
});
