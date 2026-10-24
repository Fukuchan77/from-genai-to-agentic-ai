import type { Profile } from "@platform/ai-core/marketing";
import {
	NO_VALID_RECOMMENDATION_REASON,
	PROFILE_INSTRUCTIONS,
	RECOMMEND_INSTRUCTIONS,
} from "@platform/ai-core/marketing";
import { M3_6_SAMPLE_MESSAGES } from "@platform/ai-core/mock";
import { CapabilityUnsupportedError, MODEL_CATALOG } from "@platform/ai-core/models";
import { createPgliteDatabase, type RagDatabaseHandle } from "@platform/ai-core/rag";
import { createFakeClock } from "@platform/ai-core/testing";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

let handle: RagDatabaseHandle;
/** Every `doGenerate` of the resolved model, as the system prompt and the user prompt text. */
let modelCalls: number;
let calls: { system: string; prompt: string }[];
let beforeModelCall: ((callIndex: number) => Promise<void> | void) | undefined;
/** Replaces the text of the model's answer for a call, keyed by which step is asking. */
let answers: { profile?: () => string; recommend?: () => string };

const INVALID = "this is not json";

function textOf(prompt: readonly { role: string; content: unknown }[], role: string): string {
	return prompt
		.filter((message) => message.role === role)
		.map((message) =>
			typeof message.content === "string"
				? message.content
				: (message.content as { type: string; text?: string }[])
						.map((part) => part.text ?? "")
						.join(""),
		)
		.join("\n");
}

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
					const system = textOf(options.prompt, "system");
					calls.push({ system, prompt: textOf(options.prompt, "user") });
					await beforeModelCall?.(modelCalls);
					const result = await model.doGenerate(options);
					const step = system.includes(PROFILE_INSTRUCTIONS)
						? "profile"
						: system.includes(RECOMMEND_INSTRUCTIONS)
							? "recommend"
							: undefined;
					const replacement = step ? answers[step]?.() : undefined;
					return replacement === undefined
						? result
						: { ...result, content: [{ type: "text", text: replacement }] };
				};
				return { ...resolved, model: wrapped };
			},
		} as never,
		...adjust(platform),
	});
}

const message = (role: "user" | "assistant", text: string, id = "m") => ({
	id,
	role,
	parts: [{ type: "text", text }],
});

function post(body: unknown, init: RequestInit = {}): Request {
	return new Request("http://localhost/api/marketing/recommend", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: typeof body === "string" ? body : JSON.stringify(body),
		...init,
	});
}

const first = (extra: object = {}) => ({
	id: "chat-1",
	messages: [message("user", M3_6_SAMPLE_MESSAGES.first, "u1")],
	...extra,
});

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

/**
 * The assistant message `useChat` would hold after this stream: text parts joined from
 * `text-delta`, and every `data-*` part as the client stores it (type, id, data).
 */
function assistantMessageFrom(parts: readonly StreamPart[], id: string) {
	const uiParts: Record<string, unknown>[] = [{ type: "step-start" }];
	let text = "";
	for (const part of parts) {
		if (part.type === "text-delta") text += (part as unknown as { delta: string }).delta;
		else if (part.type.startsWith("data-"))
			uiParts.push({ type: part.type, id: part.id, data: part.data });
	}
	if (text !== "") uiParts.push({ type: "text", text, state: "done" });
	return { id, role: "assistant", parts: uiParts };
}

const partsOf = async (response: Response) => parseParts(await response.text());
const errorOf = async (response: Response) =>
	(await response.json()).error as { code: string; message: string };
const ofType = (parts: readonly StreamPart[], type: string) =>
	parts.filter((part) => part.type === type);

interface ProfileData {
	interests: string[];
	budgetYen: number | null;
	concerns: string[];
}
interface RecommendationData {
	items: {
		productId: string;
		name: string;
		priceYen: number;
		reason: string;
		overBudget: boolean;
	}[];
	dropped: number;
	reason?: string;
}
const profilesOf = (parts: readonly StreamPart[]) =>
	ofType(parts, "data-marketing-profile").map((part) => part.data as unknown as ProfileData);
const recommendationOf = (parts: readonly StreamPart[]) =>
	ofType(parts, "data-marketing-recommendation")[0]?.data as RecommendationData | undefined;

beforeAll(async () => {
	handle = await createPgliteDatabase();
});

afterAll(async () => {
	await handle.close();
});

beforeEach(() => {
	modelCalls = 0;
	calls = [];
	beforeModelCall = undefined;
	answers = {};
	setKnowledgeBaseForTesting(handle);
});

afterEach(() => {
	setPlatformForTesting(undefined);
	setKnowledgeBaseForTesting(undefined);
});

describe("POST /api/marketing/recommend: rejections before any model call", () => {
	it("answers 413 for an oversized body", async () => {
		await installPlatform();

		const response = await POST(post({ ...first(), padding: "x".repeat(600_000) }));

		expect(response.status).toBe(413);
		expect(modelCalls).toBe(0);
	});

	it.each([
		["invalid JSON", "{not json"],
		["an unknown field", first({ extra: 1 })],
		["no id", { messages: first().messages }],
		["no messages", { id: "c", messages: [] }],
		["an assistant message last", { id: "c", messages: [message("assistant", "hi")] }],
		["a blank last message", { id: "c", messages: [message("user", "  ")] }],
		["a system message", { id: "c", messages: [{ ...message("user", "x"), role: "system" }] }],
		["an unknown model", first({ modelId: "not-a-model" })],
		["a file part", { id: "c", messages: [{ id: "m", role: "user", parts: [{ type: "file" }] }] }],
		["a negative budget", first({ profile: { interests: [], budgetYen: -1, concerns: [] } })],
		["a profile with an unknown field", first({ profile: { interests: [], x: 1 } })],
	])("answers 400 invalid-request for %s", async (_name, body) => {
		await installPlatform();

		const response = await POST(post(body));

		expect(response.status).toBe(400);
		expect((await errorOf(response)).code).toBe("invalid-request");
		expect(modelCalls).toBe(0);
	});

	it("answers 400 limit-exceeded for more than 50 messages and for text over 8000 characters", async () => {
		await installPlatform();
		const many = Array.from({ length: 51 }, (_, index) =>
			message(index % 2 === 0 ? "user" : "assistant", "a", `m${index}`),
		);

		const tooMany = await POST(post({ id: "c", messages: many }));
		const tooLong = await POST(post({ id: "c", messages: [message("user", "あ".repeat(8_001))] }));

		expect(tooMany.status).toBe(400);
		expect(tooLong.status).toBe(400);
		expect(modelCalls).toBe(0);
	});

	it("rate-limits only in live mode, after the other checks", async () => {
		await installPlatform(LIVE_ENV, (platform) => ({
			gateway: {
				...platform.gateway,
				resolve: async () => {
					throw new CapabilityUnsupportedError("structuredOutput", "gpt-test", "OpenAI");
				},
			},
		}));
		// Live mode has a catalog only when it is seeded; seed it through the mock-mode helper.
		const { seedMarketing } = await import("@platform/ai-core/marketing");
		await seedMarketing({ db: handle.db });

		const rejected = await POST(post({ id: "c", messages: [] }));
		const firstRequest = await POST(post(first()));
		const second = await POST(post(first()));

		expect(rejected.status).toBe(400);
		expect(firstRequest.status).toBe(400);
		expect((await errorOf(firstRequest)).code).toBe("capability-unsupported");
		expect(second.status).toBe(429);
		expect((await errorOf(second)).code).toBe("rate-limited");
	});

	it("answers 503 provider-unavailable for an unseeded catalog, before any model call", async () => {
		const empty = await createPgliteDatabase();
		setKnowledgeBaseForTesting(empty);
		try {
			await installPlatform({ ...LIVE_ENV, CHAT_RATE_LIMIT_MAX: "100" });

			const response = await POST(post(first()));

			expect(response.status).toBe(503);
			const error = await errorOf(response);
			expect(error.code).toBe("provider-unavailable");
			expect(error.message).toContain("seed:samples");
			expect(modelCalls).toBe(0);
		} finally {
			setKnowledgeBaseForTesting(undefined);
			await empty.close();
		}
	});

	it("answers 400 capability-unsupported when the model has no structured output", async () => {
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

		const response = await POST(post(first()));

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

		await POST(post(first({ modelId })));
		expect(asked?.modelId).toBe(modelId);

		await POST(post(first()));
		expect(asked).not.toHaveProperty("modelId");
	});
});

describe("POST /api/marketing/recommend: a conversation in mock mode", () => {
	it("streams the profile, then the recommendation with the over-budget mark and the dropped count", async () => {
		await installPlatform();

		const response = await POST(post(first()));
		const parts = await partsOf(response);

		expect(response.status).toBe(200);
		const types = parts.map((part) => part.type).filter((type) => type.startsWith("data-"));
		expect(types).toEqual(["data-marketing-profile", "data-marketing-recommendation"]);
		expect(ofType(parts, "data-marketing-profile")[0]?.id).toBe("profile");
		expect(profilesOf(parts)[0]).toEqual({
			interests: ["ランニング", "シューズ"],
			budgetYen: 10_000,
			concerns: [],
		});
		expect(ofType(parts, "data-marketing-recommendation")[0]?.id).toBe("recommendation");
		const recommendation = recommendationOf(parts);
		expect(recommendation?.dropped).toBe(1);
		expect(recommendation?.items.map((item) => item.productId)).toEqual(["P-006", "P-010"]);
		const shoes = recommendation?.items[0];
		expect(shoes?.overBudget).toBe(true);
		expect(shoes?.name).toEqual(expect.any(String));
		expect(shoes?.priceYen).toBeGreaterThan(10_000);
		expect(recommendation?.items[1]?.overBudget).toBe(false);
		expect(parts.some((part) => part.type === "error")).toBe(false);
		expect(modelCalls).toBe(2);
	});

	it("streams a short fixed assistant text after the data parts", async () => {
		await installPlatform();

		const parts = await partsOf(await POST(post(first())));

		const types = parts.map((part) => part.type);
		expect(types.filter((type) => type.startsWith("text-"))).toEqual([
			"text-start",
			"text-delta",
			"text-end",
		]);
		expect(types.indexOf("text-start")).toBeGreaterThan(
			types.indexOf("data-marketing-recommendation"),
		);
		const delta = ofType(parts, "text-delta")[0] as unknown as { delta: string };
		// Built by code from the result (2 items here), never the model's free text.
		expect(delta.delta).toBe("2 件をおすすめします。");
	});

	it("streams the fixed reason as the text when nothing could be recommended", async () => {
		answers.recommend = () =>
			JSON.stringify({ recommendations: [{ productId: "P-999", reason: "model free text" }] });
		await installPlatform();

		const parts = await partsOf(await POST(post(first())));

		const delta = ofType(parts, "text-delta")[0] as unknown as { delta: string };
		expect(delta.delta).toBe(NO_VALID_RECOMMENDATION_REASON);
	});

	it("streams no text when the recommendation failed", async () => {
		answers.recommend = () => INVALID;
		await installPlatform();

		const parts = await partsOf(await POST(post(first())));

		expect(ofType(parts, "text-delta")).toHaveLength(0);
	});

	it("accepts turn 1's own assistant message as history in turn 2 and updates the profile", async () => {
		await installPlatform();
		const firstParts = await partsOf(await POST(post(first())));
		const known = profilesOf(firstParts)[0] as ProfileData;
		// The history is built from what the route really streamed, not hand-written.
		const assistant = assistantMessageFrom(firstParts, "a1");
		expect(assistant.parts.map((part) => part.type)).toEqual([
			"step-start",
			"data-marketing-profile",
			"data-marketing-recommendation",
			"text",
		]);
		calls = [];

		const second = await POST(
			post({
				id: "chat-1",
				messages: [
					message("user", M3_6_SAMPLE_MESSAGES.first, "u1"),
					assistant,
					message("user", M3_6_SAMPLE_MESSAGES.second, "u2"),
				],
				profile: known,
			}),
		);
		expect(second.status).toBe(200);
		const parts = await partsOf(second);

		expect(profilesOf(parts)).toEqual([
			{
				interests: ["ランニング", "シューズ", "通勤中の音環境"],
				budgetYen: 5_000,
				concerns: ["電車の騒音"],
			},
		]);
		// The model sees the assistant's text only, never the data parts' JSON.
		const extractionPrompt = calls[0]?.prompt ?? "";
		expect(extractionPrompt).toContain("2 件をおすすめします。");
		expect(extractionPrompt).not.toContain("data-marketing");
		expect(extractionPrompt).not.toContain("productId");
		// The extraction saw the profile the client held, not an empty one.
		expect(extractionPrompt).toContain("ランニング");
		const recommendation = recommendationOf(parts);
		expect(recommendation?.dropped).toBe(0);
		expect(recommendation?.items.map((item) => item.productId)).toEqual(["P-001", "P-004"]);
		expect(recommendation?.items.every((item) => !item.overBudget)).toBe(true);
	});

	it("accepts an assistant message that holds data parts only", async () => {
		await installPlatform();

		const response = await POST(
			post({
				id: "c",
				messages: [
					message("user", M3_6_SAMPLE_MESSAGES.first, "u1"),
					{
						id: "a1",
						role: "assistant",
						parts: [
							{ type: "data-marketing-profile", id: "profile", data: {}, text: "FORGED-DATA-TEXT" },
						],
					},
					message("user", M3_6_SAMPLE_MESSAGES.second, "u2"),
				],
			}),
		);

		expect(response.status).toBe(200);
		await response.text();
		// Only text parts are read: a stray `text` field on a data part never reaches a model.
		expect(calls.map((call) => call.prompt).join("\n")).not.toContain("FORGED-DATA-TEXT");
	});

	it("starts from an empty profile when the client sends none", async () => {
		await installPlatform();

		await partsOf(await POST(post(first())));

		expect(calls[0]?.prompt).toContain('"interests":[]');
		expect(calls[0]?.prompt).toContain('"budgetYen":null');
	});

	it("recommends for the newest user message and applies the budget of the updated profile", async () => {
		await installPlatform();

		const parts = await partsOf(await POST(post(first())));

		const recommendCall = calls.find((call) => call.system.includes(RECOMMEND_INSTRUCTIONS));
		expect(recommendCall?.prompt).toContain(M3_6_SAMPLE_MESSAGES.first);
		expect(recommendCall?.prompt).toContain("10000");
		expect(recommendationOf(parts)?.items[0]?.reason).toContain("予算");
	});

	it("removes ids the catalog does not have and says so when nothing is left", async () => {
		answers.recommend = () =>
			JSON.stringify({
				recommendations: [
					{ productId: "P-998", reason: "なし" },
					{ productId: "P-999", reason: "なし" },
				],
			});
		await installPlatform();

		const parts = await partsOf(await POST(post(first())));

		const recommendation = recommendationOf(parts);
		expect(recommendation?.items).toEqual([]);
		expect(recommendation?.dropped).toBe(2);
		expect(recommendation?.reason).toBe(NO_VALID_RECOMMENDATION_REASON);
		expect(parts.some((part) => part.type === "error")).toBe(false);
	});

	it("writes no profile part when the extraction failed, and still recommends with the profile it had", async () => {
		answers.profile = () => INVALID;
		await installPlatform();
		const known: Profile = { interests: ["ランニング"], budgetYen: 3_000, concerns: [] };

		const parts = await partsOf(await POST(post(first({ profile: known }))));

		expect(profilesOf(parts)).toEqual([]);
		const recommendation = recommendationOf(parts);
		expect(recommendation).toBeDefined();
		// The budget of the profile the client holds decides the over-budget mark.
		expect(recommendation?.items.find((item) => item.productId === "P-010")?.overBudget).toBe(
			(recommendation?.items.find((item) => item.productId === "P-010")?.priceYen ?? 0) > 3_000,
		);
		expect(parts.some((part) => part.type === "error")).toBe(false);
	});

	it("writes no profile part for an unchanged profile with nothing sent either", async () => {
		answers.profile = () => INVALID;
		await installPlatform();

		const parts = await partsOf(await POST(post(first())));

		expect(ofType(parts, "data-marketing-profile")).toHaveLength(0);
		expect(ofType(parts, "data-marketing-recommendation")).toHaveLength(1);
	});

	it("ends in output-invalid with a fixed message when the recommendation stays invalid, keeping the profile", async () => {
		answers.recommend = () => INVALID;
		await installPlatform();

		const response = await POST(post(first()));
		const parts = await partsOf(response);

		expect(response.status).toBe(200);
		expect(profilesOf(parts)).toHaveLength(1);
		expect(ofType(parts, "data-marketing-recommendation")).toHaveLength(0);
		const error = ofType(parts, "error")[0];
		const parsed = JSON.parse(error?.errorText ?? "{}") as { code: string; message: string };
		expect(parsed.code).toBe("output-invalid");
		expect(parsed.message).toContain("期待した形式");
		expect(Object.keys(parsed).sort()).toEqual(["code", "message"]);
		expect(error?.errorText).not.toContain(INVALID);
	});

	it("stops at an abort during the extraction: the recommendation is never asked for", async () => {
		const controller = new AbortController();
		beforeModelCall = (callIndex) => {
			if (callIndex === 1) controller.abort(new DOMException("Stopped", "AbortError"));
		};
		await installPlatform();

		const response = await POST(post(first(), { signal: controller.signal }));
		const parts = await partsOf(response).catch(() => [] as StreamPart[]);

		expect(modelCalls).toBe(1);
		expect(ofType(parts, "data-marketing-recommendation")).toHaveLength(0);
	});

	it("makes no model call at all when the request is already aborted", async () => {
		const controller = new AbortController();
		controller.abort(new DOMException("Stopped", "AbortError"));
		await installPlatform();

		const response = await POST(post(first(), { signal: controller.signal }));
		const parts = await partsOf(response).catch(() => [] as StreamPart[]);

		expect(modelCalls).toBe(0);
		expect(ofType(parts, "data-marketing-profile")).toHaveLength(0);
		expect(ofType(parts, "data-marketing-recommendation")).toHaveLength(0);
	});

	it("keeps provider failures out of the stream", async () => {
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

		const parts = await partsOf(await POST(post(first())));

		const error = ofType(parts, "error")[0];
		expect(error?.errorText).toBeDefined();
		expect(JSON.stringify(parts)).not.toContain("sk-secret-999");
		expect(ofType(parts, "data-marketing-recommendation")).toHaveLength(0);
	});

	it("keeps the message of an error thrown inside a step out of the stream", async () => {
		await installPlatform();
		answers.profile = () => {
			throw new Error("boom: key sk-secret-777");
		};

		const parts = await partsOf(await POST(post(first())));

		expect(JSON.stringify(parts)).not.toContain("sk-secret-777");
	});
});
