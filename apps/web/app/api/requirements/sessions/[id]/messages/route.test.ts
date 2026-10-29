import { M3_5_SAMPLE_ANSWERS, M3_5_SAMPLE_OVERVIEWS } from "@platform/ai-core/mock";
import { CapabilityUnsupportedError } from "@platform/ai-core/models";
import {
	createInterviewState,
	EMPTY_REQUIREMENTS,
	getRequirementsSessions,
	REQUIREMENT_DOCUMENT_HEADINGS,
	type RequirementsSession,
} from "@platform/ai-core/requirements";
import { createFakeClock } from "@platform/ai-core/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPlatform, setPlatformForTesting } from "@/lib/server/platform";
import { getSessionRegistry, resetSessionRegistriesForTesting } from "@/lib/server/sessions";
import { verifyOrWriteFixture } from "../../../../../../../../scripts/e2e/generate-sse-fixtures.mjs";
import { POST as startSession } from "../../route";
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
const PERSONAS = ["persona-1", "persona-2", "persona-3"].map((id) => ({
	id,
	name: id,
	role: "r",
	goals: ["g"],
}));
const SEED_QUESTIONS = PERSONAS.map((persona, index) => ({
	id: `q-1-${index + 1}`,
	personaId: persona.id,
	text: "質問",
}));

let modelCalls: number;
let platformClock = createFakeClock(NOW);
/** Runs before the n-th model call (1-based, counted from the start of the test). */
let beforeModelCall: ((callIndex: number) => Promise<void> | void) | undefined;
/** Runs after the n-th call returned its result. */
let afterModelCall: ((callIndex: number) => void) | undefined;
/** Returns text to answer a call with (an invalid output) instead of the scenario's. */
let corrupt: ((callIndex: number, promptText: string) => string | undefined) | undefined;
/** Runs inside `gateway.resolve`, before it answers; the argument counts the resolves since it was set. */
let beforeResolve: ((resolveIndex: number) => Promise<void> | void) | undefined;
let resolveCount = 0;

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
				if (beforeResolve) {
					resolveCount += 1;
					await beforeResolve(resolveCount);
				}
				const resolved = await resolve(request);
				const { model } = resolved;
				const wrapped = Object.create(model) as typeof model;
				wrapped.doGenerate = async (options) => {
					modelCalls += 1;
					const index = modelCalls;
					await beforeModelCall?.(index);
					const bad = corrupt?.(index, JSON.stringify(options.prompt));
					if (bad !== undefined) {
						const result = await Promise.resolve(model.doGenerate(options)).catch(() => undefined);
						return { ...(result as object), content: [{ type: "text", text: bad }] } as never;
					}
					const result = await model.doGenerate(options);
					afterModelCall?.(index);
					return result;
				};
				return { ...resolved, model: wrapped };
			},
		} as never,
		...adjust(platform),
	});
}

function messagesRequest(id: string, body: unknown, init: RequestInit = {}): Request {
	return new Request(`http://localhost/api/requirements/sessions/${id}/messages`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: typeof body === "string" ? body : JSON.stringify(body),
		...init,
	});
}

const send = (id: string, body: unknown, init: RequestInit = {}) =>
	POST(messagesRequest(id, body, init), { params: Promise.resolve({ id }) });

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
	(await response.json()).error as {
		code: string;
		message: string;
		details?: { reason?: string };
	};
const ofType = (parts: readonly StreamPart[], type: string) =>
	parts.filter((part) => part.type === type);

const nextQuestions = (parts: readonly StreamPart[]): Created["questions"] => {
	const data = ofType(parts, "data-requirements-questions")[0]?.data as
		| { questions: Created["questions"] }
		| undefined;
	return data?.questions ?? [];
};

const sessions = () => getRequirementsSessions(getSessionRegistry, platformClock);

function seed(overrides: Partial<RequirementsSession> = {}): string {
	const id = crypto.randomUUID();
	sessions().create(id, () => ({
		overview: "概要",
		personas: PERSONAS,
		state: createInterviewState({ maxRounds: 5 }),
		questions: SEED_QUESTIONS,
		document: null,
		...overrides,
	}));
	return id;
}

interface Created {
	sessionId: string;
	questions: { id: string; personaId: string; text: string }[];
}

/** Starts an interview through the real `/api/requirements/sessions` handler. */
async function start(overview: string, maxRounds?: number): Promise<Created> {
	const response = await startSession(
		new Request("http://localhost/api/requirements/sessions", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ overview, ...(maxRounds ? { maxRounds } : {}) }),
		}),
	);
	return (await response.json()) as Created;
}

const answersFor = (
	questions: readonly { id: string }[],
	texts: readonly string[],
	count = texts.length,
) => ({
	answers: questions.slice(0, count).map((question, index) => ({
		questionId: question.id,
		text: texts[index] as string,
	})),
});

const DEFAULT_ROUND1 = M3_5_SAMPLE_ANSWERS.default[0] as readonly string[];
const DEFAULT_ROUND2 = M3_5_SAMPLE_ANSWERS.default[1] as readonly string[];

/** Plays round 1 of the default script and returns the parts. */
async function playRound(
	created: Created,
	script: "default" | "limit",
	roundIndex: number,
	questions = created.questions,
) {
	const texts = M3_5_SAMPLE_ANSWERS[script][roundIndex] as readonly string[];
	const response = await send(created.sessionId, answersFor(questions, texts));
	return { response, parts: await partsOf(response) };
}

beforeEach(() => {
	modelCalls = 0;
	beforeModelCall = undefined;
	afterModelCall = undefined;
	corrupt = undefined;
	beforeResolve = undefined;
	resolveCount = 0;
	resetSessionRegistriesForTesting();
});

afterEach(() => {
	setPlatformForTesting(undefined);
	resetSessionRegistriesForTesting();
});

describe("POST .../messages: 404 for a session that is not there", () => {
	it("answers 404 for an unknown id, with the shared error shape", async () => {
		await installPlatform();

		const response = await send(crypto.randomUUID(), {
			answers: [{ questionId: "q-1-1", text: "a" }],
		});

		expect(response.status).toBe(404);
		expect((await errorOf(response)).code).toBe("invalid-request");
		expect(modelCalls).toBe(0);
	});

	it("answers 404 for an id that cannot be a session id, without a lookup error", async () => {
		await installPlatform();

		const response = await send("not-a-uuid", { answers: [{ questionId: "q-1-1", text: "a" }] });

		expect(response.status).toBe(404);
	});

	it("looks the session up before it reads the body", async () => {
		await installPlatform();

		const bad = await send(crypto.randomUUID(), "{not json");
		const huge = await send(crypto.randomUUID(), { padding: "x".repeat(600_000) });

		expect(bad.status).toBe(404);
		expect(huge.status).toBe(404);
	});

	it("answers 404 once the session has been idle for over 10 minutes", async () => {
		await installPlatform();
		const id = seed();
		platformClock.advanceBy(600_001);

		const response = await send(id, { answers: [{ questionId: "q-1-1", text: "a" }] });

		expect(response.status).toBe(404);
	});

	it("answers 404 for a disposed session", async () => {
		await installPlatform();
		const id = seed();
		sessions().dispose(id);

		const response = await send(id, { answers: [{ questionId: "q-1-1", text: "a" }] });

		expect(response.status).toBe(404);
	});

	it("finds a session that /api/requirements/sessions made (one shared registry)", async () => {
		await installPlatform();
		const created = await start(M3_5_SAMPLE_OVERVIEWS.default);

		const { response } = await playRound(created, "default", 0);

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("text/event-stream");
	});
});

describe("POST .../messages: rejections before any model call", () => {
	it("answers 413 for an oversized body, leaving the session as it was", async () => {
		await installPlatform();
		const id = seed();

		const response = await send(id, { answers: [], padding: "x".repeat(600_000) });

		expect(response.status).toBe(413);
		expect(modelCalls).toBe(0);
	});

	it.each([
		["invalid JSON", "{not json"],
		["no answers field", {}],
		["no answers", { answers: [] }],
		[
			"11 answers",
			{
				answers: Array.from({ length: 11 }, (_, i) => ({ questionId: `q-1-${i}`, text: "a" })),
			},
		],
		["an unknown field", { answers: [{ questionId: "q-1-1", text: "a" }], extra: 1 }],
		["an empty text", { answers: [{ questionId: "q-1-1", text: "" }] }],
		["a blank text", { answers: [{ questionId: "q-1-1", text: "  \n" }] }],
		[
			"a text over 2000 characters",
			{ answers: [{ questionId: "q-1-1", text: "あ".repeat(2001) }] },
		],
		["a missing questionId", { answers: [{ text: "a" }] }],
		[
			"the same question twice",
			{
				answers: [
					{ questionId: "q-1-1", text: "a" },
					{ questionId: "q-1-1", text: "b" },
				],
			},
		],
	])("answers 400 invalid-request for %s", async (_name, body) => {
		await installPlatform();
		const id = seed();

		const response = await send(id, body);

		expect(response.status).toBe(400);
		expect((await errorOf(response)).code).toBe("invalid-request");
		expect(modelCalls).toBe(0);
		expect(sessions().get(id)?.state.answers).toEqual([]);
	});

	it("accepts a text of exactly 2000 characters and 10 answers (the schema upper bounds)", async () => {
		await installPlatform();
		const questions = Array.from({ length: 10 }, (_, i) => ({
			id: `q-1-${i + 1}`,
			personaId: "persona-1",
			text: "質問",
		}));
		const id = seed({ questions });

		const response = await send(id, {
			answers: questions.map((q, i) => ({
				questionId: q.id,
				text: i === 0 ? "あ".repeat(2000) : "a",
			})),
		});

		// It passes the guard and starts; the mock has no script for these answers, so the stream
		// reports an error, but the status is the stream's 200.
		expect(response.status).toBe(200);
	});

	it("answers 400 for a questionId the session never asked, naming nothing from the request", async () => {
		await installPlatform();
		const id = seed();

		const response = await send(id, { answers: [{ questionId: "q-9-9<script>", text: "a" }] });

		expect(response.status).toBe(400);
		const body = await errorOf(response);
		expect(body.code).toBe("invalid-request");
		expect(body.message).not.toContain("q-9-9");
		expect(modelCalls).toBe(0);
		expect(sessions().get(id)?.state.answers).toEqual([]);
	});

	it("answers 400 when one of several questionIds is unknown, recording none of the answers", async () => {
		await installPlatform();
		const id = seed();

		const response = await send(id, {
			answers: [
				{ questionId: "q-1-1", text: "a" },
				{ questionId: "q-1-9", text: "b" },
			],
		});

		expect(response.status).toBe(400);
		expect(modelCalls).toBe(0);
		expect(sessions().get(id)?.state.answers).toEqual([]);
	});

	it("answers 400 for a question of an earlier round: only the current round's questions take answers", async () => {
		await installPlatform();
		const old = SEED_QUESTIONS;
		const current = PERSONAS.map((persona, index) => ({
			id: `q-2-${index + 1}`,
			personaId: persona.id,
			text: "次の質問",
		}));
		const id = seed({
			questions: [...old, ...current],
			state: { ...createInterviewState({ maxRounds: 5 }), round: 1 },
		});

		const stale = await send(id, { answers: [{ questionId: "q-1-1", text: "a" }] });

		expect(stale.status).toBe(400);
		expect(modelCalls).toBe(0);
	});

	it("checks the questionId (400) before the completed state (409) only for ids that never existed", async () => {
		await installPlatform();
		const id = seed({
			state: { ...createInterviewState({ maxRounds: 5 }), round: 1, completed: true },
			document: "# 要件定義書\n",
		});

		const unknown = await send(id, { answers: [{ questionId: "q-7-7", text: "a" }] });
		const known = await send(id, { answers: [{ questionId: "q-1-1", text: "a" }] });

		expect(unknown.status).toBe(400);
		expect(known.status).toBe(409);
	});

	it("answers 409 invalid-request for a completed interview, before any model call", async () => {
		await installPlatform();
		const id = seed({
			state: { ...createInterviewState({ maxRounds: 5 }), round: 1, completed: true },
			document: "# 要件定義書\n",
		});

		const response = await send(id, { answers: [{ questionId: "q-1-1", text: "a" }] });

		expect(response.status).toBe(409);
		const body = await errorOf(response);
		expect(body.code).toBe("invalid-request");
		expect(body.message).not.toBe("");
		expect(body.details).toEqual({ reason: "completed" });
		expect(modelCalls).toBe(0);
		expect(sessions().get(id)?.document).toBe("# 要件定義書\n");
	});

	it("checks the body (400, 409) before the rate limit (429), and limits only in live mode", async () => {
		await installPlatform(LIVE_ENV, (platform) => ({
			gateway: {
				...platform.gateway,
				resolve: async () => {
					throw new CapabilityUnsupportedError("structuredOutput", "gpt-test", "OpenAI");
				},
			},
		}));
		const open = seed();
		const completed = seed({ state: { ...createInterviewState(), round: 1, completed: true } });
		const body = { answers: [{ questionId: "q-1-1", text: "a" }] };

		const badBody = await send(open, {});
		const unknownQuestion = await send(open, { answers: [{ questionId: "q-8-8", text: "a" }] });
		const done = await send(completed, body);
		const first = await send(open, body);
		const second = await send(open, body);

		expect(badBody.status).toBe(400);
		expect(unknownQuestion.status).toBe(400);
		expect(done.status).toBe(409);
		expect(first.status).toBe(400);
		expect((await errorOf(first)).code).toBe("capability-unsupported");
		expect(second.status).toBe(429);
		expect((await errorOf(second)).code).toBe("rate-limited");
	});

	it("resolves the session's model with structured output required, before any LLM call", async () => {
		const asked: { modelId?: string; require?: readonly string[]; purpose?: string }[] = [];
		await installPlatform(MOCK_ENV, (platform) => ({
			gateway: {
				...platform.gateway,
				resolve: async (request: { modelId?: string; require?: readonly string[] }) => {
					asked.push(request);
					throw new CapabilityUnsupportedError("structuredOutput", "m", "Mock");
				},
			},
		}));
		const withModel = seed({ modelId: "chosen-model" });
		const without = seed();
		const body = { answers: [{ questionId: "q-1-1", text: "a" }] };

		const first = await send(withModel, body);
		await send(without, body);

		expect(first.status).toBe(400);
		expect((await errorOf(first)).code).toBe("capability-unsupported");
		expect(asked[0]).toMatchObject({
			purpose: "chat",
			modelId: "chosen-model",
			require: ["structuredOutput"],
		});
		expect(asked[1]).not.toHaveProperty("modelId");
		expect(modelCalls).toBe(0);
	});
});

describe("POST .../messages: a round of the interview (default script)", () => {
	it("updates the preview after each answer, then judges, then asks the next questions", async () => {
		await installPlatform();
		const created = await start(M3_5_SAMPLE_OVERVIEWS.default);

		const { parts } = await playRound(created, "default", 0);

		const previews = ofType(parts, "data-requirements-preview");
		expect(previews).toHaveLength(3);
		expect(previews.every((part) => part.id === "preview")).toBe(true);
		const counts = previews.map((part) => {
			const data = part.data as Record<string, unknown[]>;
			return (
				(data.functional?.length ?? 0) +
				(data.nonFunctional?.length ?? 0) +
				(data.constraints?.length ?? 0)
			);
		});
		expect(counts).toEqual([1, 3, 4]);
		const firstPreview = previews[0]?.data as { functional: { text: string; personaId: string }[] };
		expect(firstPreview.functional).toEqual([
			{ text: "問い合わせの内容から担当部署を自動で判定して振り分ける", personaId: "persona-1" },
		]);

		const judgements = ofType(parts, "data-requirements-judgement");
		expect(judgements).toHaveLength(1);
		expect(judgements[0]?.id).toBe("judgement-1");
		expect(judgements[0]?.data).toEqual({
			round: 1,
			sufficient: false,
			missing: ["応答時間の目標値", "運用にかけられる予算の上限"],
			forcedEnd: false,
		});

		const questions = ofType(parts, "data-requirements-questions");
		expect(questions).toHaveLength(1);
		expect(questions[0]?.id).toBe("questions-2");
		const next = questions[0]?.data as {
			round: number;
			questions: { id: string; personaId: string; text: string }[];
		};
		expect(next.round).toBe(2);
		expect(next.questions.map((q) => q.id)).toEqual(["q-2-1", "q-2-2", "q-2-3"]);
		expect(next.questions.map((q) => q.personaId)).toEqual(["persona-1", "persona-2", "persona-3"]);

		const order = parts
			.map((part) => part.type)
			.filter((type) => type.startsWith("data-requirements"));
		expect(order).toEqual([
			"data-requirements-preview",
			"data-requirements-preview",
			"data-requirements-preview",
			"data-requirements-judgement",
			"data-requirements-questions",
		]);
		expect(ofType(parts, "error")).toHaveLength(0);
	});

	it("records the round in the session: answers, requirements, the verdict, the new questions, no document", async () => {
		await installPlatform();
		const created = await start(M3_5_SAMPLE_OVERVIEWS.default);

		const { parts } = await playRound(created, "default", 0);

		const stored = sessions().get(created.sessionId);
		expect(stored?.state.round).toBe(1);
		expect(stored?.state.completed).toBe(false);
		expect(stored?.state.forcedEnd).toBe(false);
		expect(stored?.state.missing).toEqual(["応答時間の目標値", "運用にかけられる予算の上限"]);
		expect(stored?.state.answers.map((a) => [a.questionId, a.personaId, a.round, a.text])).toEqual(
			created.questions.map((q, i) => [q.id, q.personaId, 0, DEFAULT_ROUND1[i]]),
		);
		expect(stored?.questions.map((q) => q.id)).toEqual([
			"q-1-1",
			"q-1-2",
			"q-1-3",
			"q-2-1",
			"q-2-2",
			"q-2-3",
		]);
		expect(stored?.document).toBeNull();
		const lastPreview = ofType(parts, "data-requirements-preview").at(-1)?.data as Record<
			string,
			{ text: string }[]
		>;
		expect(stored?.state.requirements.constraints.map((c) => c.text)).toEqual(
			lastPreview.constraints?.map((c) => c.text),
		);
	});

	it("finishes on a sufficient verdict: the judgement, no questions, and the document stored", async () => {
		await installPlatform();
		const created = await start(M3_5_SAMPLE_OVERVIEWS.default);
		const first = await playRound(created, "default", 0);
		const next = nextQuestions(first.parts);

		const { parts } = await playRound(created, "default", 1, next);

		const judgement = ofType(parts, "data-requirements-judgement");
		expect(judgement).toHaveLength(1);
		expect(judgement[0]?.id).toBe("judgement-2");
		expect(judgement[0]?.data).toEqual({
			round: 2,
			sufficient: true,
			missing: [],
			forcedEnd: false,
		});
		expect(ofType(parts, "data-requirements-questions")).toHaveLength(0);
		const stored = sessions().get(created.sessionId);
		expect(stored?.state).toMatchObject({ round: 2, completed: true, forcedEnd: false });
		expect(stored?.document).toContain(REQUIREMENT_DOCUMENT_HEADINGS.functional);
		expect(stored?.document).toContain("問い合わせの内容から担当部署を自動で判定して振り分ける");
		expect(stored?.document).toContain("年間の運用費は 120 万円まで");
		// Not a forced end: the missing list of round 1 is gone and nothing is listed as missing.
		expect(stored?.document).not.toContain("応答時間の目標値");
		expect(stored?.questions).toHaveLength(6);
	});

	it("answers 409 to a third request once the interview is complete", async () => {
		await installPlatform();
		const created = await start(M3_5_SAMPLE_OVERVIEWS.default);
		const first = await playRound(created, "default", 0);
		const next = nextQuestions(first.parts);
		await playRound(created, "default", 1, next);
		const calls = modelCalls;

		const again = await send(created.sessionId, answersFor(next, DEFAULT_ROUND2));

		expect(again.status).toBe(409);
		expect(modelCalls).toBe(calls);
	});

	it("takes a partial round: answers to some questions advance the round all the same", async () => {
		await installPlatform();
		const created = await start(M3_5_SAMPLE_OVERVIEWS.default);

		const response = await send(
			created.sessionId,
			answersFor(created.questions, DEFAULT_ROUND1, 1),
		);
		const parts = await partsOf(response);

		expect(ofType(parts, "data-requirements-preview")).toHaveLength(1);
		const stored = sessions().get(created.sessionId);
		expect(stored?.state.answers).toHaveLength(1);
		expect(stored?.state.round).toBe(1);
	});

	it("keeps the order of the answers in the request, not the order of the questions", async () => {
		await installPlatform();
		const created = await start(M3_5_SAMPLE_OVERVIEWS.default);
		const reversed = {
			answers: [0, 2, 1].map((i) => ({
				questionId: created.questions[i]?.id as string,
				text: DEFAULT_ROUND1[i] as string,
			})),
		};

		const response = await send(created.sessionId, reversed);
		await response.text();

		expect(
			sessions()
				.get(created.sessionId)
				?.state.answers.map((a) => a.questionId),
		).toEqual(["q-1-1", "q-1-3", "q-1-2"]);
	});

	it("ends with a mid-stream output-invalid and commits nothing when the extraction of an answer stays invalid, then a retry works", async () => {
		await installPlatform();
		const created = await start(M3_5_SAMPLE_OVERVIEWS.default);
		corrupt = (_index, prompt) => (prompt.includes(DEFAULT_ROUND1[2] as string) ? "{}" : undefined);

		const { parts } = await playRound(created, "default", 0);

		const errors = ofType(parts, "error");
		expect(errors).toHaveLength(1);
		expect(JSON.parse(errors[0]?.errorText as string).code).toBe("output-invalid");
		expect(ofType(parts, "data-requirements-judgement")).toHaveLength(0);
		const stored = sessions().get(created.sessionId);
		expect(stored?.state.round).toBe(0);
		expect(stored?.state.answers).toEqual([]);
		expect(stored?.questions).toHaveLength(3);

		corrupt = undefined;
		const retry = await playRound(created, "default", 0);
		expect(ofType(retry.parts, "error")).toHaveLength(0);
		expect(sessions().get(created.sessionId)?.state.round).toBe(1);
	});

	it("keeps provider failures out of the stream", async () => {
		await installPlatform();
		const created = await start(M3_5_SAMPLE_OVERVIEWS.default);
		beforeModelCall = (index) => {
			if (index === 6) throw new Error("upstream said: key sk-secret-999 rejected");
		};

		const response = await send(created.sessionId, answersFor(created.questions, DEFAULT_ROUND1));
		const text = await response.text();

		expect(text).not.toContain("sk-secret-999");
		const error = parseParts(text).find((part) => part.type === "error");
		expect(JSON.parse(error?.errorText as string)).toEqual({
			code: "unexpected",
			message: expect.any(String),
		});
	});
});

describe("POST .../messages: the round limit (limit script)", () => {
	it("forces the end at the limit: the judgement says forcedEnd and the document lists what is missing", async () => {
		await installPlatform();
		const created = await start(M3_5_SAMPLE_OVERVIEWS.limit);
		let questions = created.questions;
		const judgements: Record<string, unknown>[] = [];

		for (let round = 0; round < 5; round += 1) {
			const { parts } = await playRound(created, "limit", round, questions);
			judgements.push(
				ofType(parts, "data-requirements-judgement")[0]?.data as Record<string, unknown>,
			);
			const asked = ofType(parts, "data-requirements-questions")[0];
			if (round < 4) {
				expect(asked).toBeDefined();
				expect(sessions().get(created.sessionId)?.state.completed).toBe(false);
				expect(sessions().get(created.sessionId)?.document).toBeNull();
				questions = nextQuestions(asked ? [asked] : []);
			} else {
				expect(asked).toBeUndefined();
			}
		}

		expect(judgements.map((j) => [j.round, j.sufficient, j.forcedEnd])).toEqual([
			[1, false, false],
			[2, false, false],
			[3, false, false],
			[4, false, false],
			[5, false, true],
		]);
		const stored = sessions().get(created.sessionId);
		expect(stored?.state).toMatchObject({ round: 5, completed: true, forcedEnd: true });
		expect(stored?.document).toContain("第 5 回の時点で決まっていない項目");
		expect(stored?.document).not.toContain("第 4 回の時点で決まっていない項目");
		expect(stored?.questions).toHaveLength(15);
	});

	it("honours a smaller maxRounds the session was started with", async () => {
		await installPlatform();
		const created = await start(M3_5_SAMPLE_OVERVIEWS.limit, 1);
		// The scripted judge prompt names 5 rounds, so a limit of 1 has no scripted verdict: the
		// round ends in a stream error, and nothing is committed.
		const { parts } = await playRound(created, "limit", 0);

		expect(ofType(parts, "error")).toHaveLength(1);
		expect(sessions().get(created.sessionId)?.state.round).toBe(0);
	});
});

describe("POST .../messages: failures leave the session consistent", () => {
	it("commits nothing when the judge output stays invalid: a mid-stream output-invalid, then a retry works", async () => {
		await installPlatform();
		const created = await start(M3_5_SAMPLE_OVERVIEWS.default);
		let failing = true;
		corrupt = (_index, prompt) => (failing && prompt.includes("これは第") ? "{}" : undefined);

		const failed = await playRound(created, "default", 0);

		expect(ofType(failed.parts, "data-requirements-judgement")).toHaveLength(0);
		expect(ofType(failed.parts, "data-requirements-questions")).toHaveLength(0);
		const error = ofType(failed.parts, "error")[0];
		const body = JSON.parse(error?.errorText as string) as { code: string; message: string };
		expect(body.code).toBe("output-invalid");
		expect(body.message).not.toBe("");
		const stored = sessions().get(created.sessionId);
		expect(stored?.state.round).toBe(0);
		expect(stored?.state.answers).toEqual([]);
		expect(stored?.state.requirements).toEqual(EMPTY_REQUIREMENTS);
		expect(stored?.questions).toHaveLength(3);
		expect(stored?.document).toBeNull();

		failing = false;
		const retried = await playRound(created, "default", 0);

		expect(ofType(retried.parts, "error")).toHaveLength(0);
		expect(sessions().get(created.sessionId)?.state.round).toBe(1);
		expect(sessions().get(created.sessionId)?.state.answers).toHaveLength(3);
	});

	it("commits nothing, and shows no verdict, when the next questions cannot be asked", async () => {
		await installPlatform();
		const created = await start(M3_5_SAMPLE_OVERVIEWS.default);
		corrupt = (_index, prompt) => (prompt.includes("第 2 ラウンドの質問") ? "{}" : undefined);

		const { parts } = await playRound(created, "default", 0);

		expect(ofType(parts, "error")).toHaveLength(1);
		expect(ofType(parts, "data-requirements-judgement")).toHaveLength(0);
		const stored = sessions().get(created.sessionId);
		expect(stored?.state.round).toBe(0);
		expect(stored?.state.answers).toEqual([]);
		expect(stored?.questions).toHaveLength(3);
	});

	it("commits nothing when the client leaves during the judgement, and starts no further call", async () => {
		await installPlatform();
		const created = await start(M3_5_SAMPLE_OVERVIEWS.default);
		const controller = new AbortController();
		// Calls 1 and 2 made the session; 3-5 are the extractions; 6 is the judgement.
		beforeModelCall = (index) => {
			if (index === 6) controller.abort(new DOMException("Stopped", "AbortError"));
		};

		const response = await send(created.sessionId, answersFor(created.questions, DEFAULT_ROUND1), {
			signal: controller.signal,
		});
		await response.text().catch(() => undefined);

		expect(modelCalls).toBe(6);
		const stored = sessions().get(created.sessionId);
		expect(stored?.state.round).toBe(0);
		expect(stored?.state.answers).toEqual([]);
		expect(stored?.questions).toHaveLength(3);
		expect(stored?.document).toBeNull();
	});

	it("commits nothing when the client leaves right after the last model call returned", async () => {
		await installPlatform();
		const created = await start(M3_5_SAMPLE_OVERVIEWS.default);
		const controller = new AbortController();
		// Call 7 asks the next round's questions; the client is gone once it has returned.
		afterModelCall = (index) => {
			if (index === 7) controller.abort(new DOMException("Stopped", "AbortError"));
		};

		const response = await send(created.sessionId, answersFor(created.questions, DEFAULT_ROUND1), {
			signal: controller.signal,
		});
		const parts = await partsOf(response).catch(() => []);

		expect(modelCalls).toBe(7);
		const stored = sessions().get(created.sessionId);
		expect(stored?.state.round).toBe(0);
		expect(stored?.questions).toHaveLength(3);
		expect(ofType(parts, "data-requirements-judgement")).toHaveLength(0);
	});

	it("answers 409 to a second request while a round is running, and runs again once it is over", async () => {
		await installPlatform();
		const created = await start(M3_5_SAMPLE_OVERVIEWS.default);
		let release: () => void = () => undefined;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		beforeModelCall = async (index) => {
			if (index === 3) await gate;
		};

		const running = send(created.sessionId, answersFor(created.questions, DEFAULT_ROUND1));
		await Promise.resolve();
		const response = await running;
		const second = await send(created.sessionId, answersFor(created.questions, DEFAULT_ROUND1));
		release();
		await response.text();

		expect(second.status).toBe(409);
		const busy = await errorOf(second);
		expect(busy.code).toBe("invalid-request");
		expect(busy.details).toEqual({ reason: "busy" });
		expect(sessions().get(created.sessionId)?.state.answers).toHaveLength(3);

		const done = await playRound(
			created,
			"default",
			0,
			(sessions().get(created.sessionId)?.questions ?? []).slice(3),
		);
		expect(ofType(done.parts, "error")).toHaveLength(0);
		expect(sessions().get(created.sessionId)?.state.round).toBe(2);
	});

	it("lets only one of two concurrent identical requests run: the second must not replay round 1 as round 2", async () => {
		await installPlatform();
		const created = await start(M3_5_SAMPLE_OVERVIEWS.default);
		const body = answersFor(created.questions, DEFAULT_ROUND1);
		let release: () => void = () => undefined;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		// The first resolve waits until the second request has been sent.
		beforeResolve = (index) => (index === 1 ? gate : undefined);

		const first = send(created.sessionId, body);
		const second = send(created.sessionId, body);
		await Promise.resolve();
		await new Promise((resolve) => setTimeout(resolve, 20));
		release();
		const responses = await Promise.all([first, second]);
		await Promise.all(responses.map((response) => response.text()));

		expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
		const stored = sessions().get(created.sessionId);
		expect(stored?.state.round).toBe(1);
		expect(stored?.state.answers).toHaveLength(3);
	});

	it("takes the lock before the model is resolved, so a request that fails to resolve releases it", async () => {
		await installPlatform();
		const created = await start(M3_5_SAMPLE_OVERVIEWS.default);
		const body = answersFor(created.questions, DEFAULT_ROUND1);
		beforeResolve = (index) => {
			if (index === 1) throw new Error("resolve failed");
		};

		const failed = await send(created.sessionId, body);
		await failed.text();
		beforeResolve = undefined;
		const retry = await send(created.sessionId, body);
		await retry.text();

		expect(failed.status).toBe(500);
		expect(retry.status).toBe(200);
	});

	it("releases the running mark after a failed round", async () => {
		await installPlatform();
		const created = await start(M3_5_SAMPLE_OVERVIEWS.default);
		corrupt = (_index, prompt) => (prompt.includes("これは第") ? "{}" : undefined);
		await (await send(created.sessionId, answersFor(created.questions, DEFAULT_ROUND1))).text();
		corrupt = undefined;

		const retry = await send(created.sessionId, answersFor(created.questions, DEFAULT_ROUND1));

		expect(retry.status).toBe(200);
		await retry.text();
		expect(sessions().get(created.sessionId)?.state.round).toBe(1);
	});
});

describe("POST .../messages: session activity (clock)", () => {
	it("counts the start of a request as activity: a long round does not let the session lapse", async () => {
		await installPlatform();
		const created = await start(M3_5_SAMPLE_OVERVIEWS.default);
		platformClock.advanceBy(400_000);
		beforeModelCall = (index) => {
			if (index === 6) platformClock.advanceBy(300_000);
		};

		await (await send(created.sessionId, answersFor(created.questions, DEFAULT_ROUND1))).text();

		expect(sessions().get(created.sessionId)?.state.round).toBe(1);
	});

	it("counts the end of a round as activity too", async () => {
		await installPlatform();
		const created = await start(M3_5_SAMPLE_OVERVIEWS.default);
		beforeModelCall = (index) => {
			if (index === 6) platformClock.advanceBy(500_000);
		};

		await (await send(created.sessionId, answersFor(created.questions, DEFAULT_ROUND1))).text();
		platformClock.advanceBy(500_000);

		expect(sessions().get(created.sessionId)).toBeDefined();
	});
});

describe("POST .../messages: an abort starts no further model call", () => {
	it("stops before the judgement when the client leaves after the last extraction", async () => {
		await installPlatform();
		const created = await start(M3_5_SAMPLE_OVERVIEWS.default);
		const controller = new AbortController();
		afterModelCall = (index) => {
			if (index === 5) controller.abort(new DOMException("Stopped", "AbortError"));
		};

		const response = await send(created.sessionId, answersFor(created.questions, DEFAULT_ROUND1), {
			signal: controller.signal,
		});
		await response.text().catch(() => undefined);

		expect(modelCalls).toBe(5);
		expect(sessions().get(created.sessionId)?.state.answers).toEqual([]);
	});

	it("stops before the next questions when the client leaves after the judgement", async () => {
		await installPlatform();
		const created = await start(M3_5_SAMPLE_OVERVIEWS.default);
		const controller = new AbortController();
		afterModelCall = (index) => {
			if (index === 6) controller.abort(new DOMException("Stopped", "AbortError"));
		};

		const response = await send(created.sessionId, answersFor(created.questions, DEFAULT_ROUND1), {
			signal: controller.signal,
		});
		await response.text().catch(() => undefined);

		expect(modelCalls).toBe(6);
		expect(sessions().get(created.sessionId)?.state.round).toBe(0);
	});
});

describe("POST .../messages: session activity", () => {
	it("counts a request as activity: the idle timer starts again", async () => {
		await installPlatform();
		const created = await start(M3_5_SAMPLE_OVERVIEWS.default);
		platformClock.advanceBy(400_000);

		await (await send(created.sessionId, answersFor(created.questions, DEFAULT_ROUND1))).text();
		platformClock.advanceBy(400_000);

		expect(sessions().get(created.sessionId)).toBeDefined();
		platformClock.advanceBy(200_001);
		expect(sessions().get(created.sessionId)).toBeUndefined();
	});
});

describe("POST .../messages: generated SSE fixtures used by the E2E specs", () => {
	it("matches the generated SSE fixture of one round: previews, the judgement and the next questions", async () => {
		await installPlatform();
		const spy = vi
			.spyOn(crypto, "randomUUID")
			.mockReturnValue("00000000-0000-4000-8000-000000000001");
		try {
			const created = await start(M3_5_SAMPLE_OVERVIEWS.default);
			const texts = M3_5_SAMPLE_ANSWERS.default[0] as readonly string[];

			const response = await send(created.sessionId, answersFor(created.questions, texts));

			expect(response.status).toBe(200);
			verifyOrWriteFixture("requirements.sse", await response.text());
		} finally {
			spy.mockRestore();
		}
	});
});
