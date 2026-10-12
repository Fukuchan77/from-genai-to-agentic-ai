import { defineScenario, M1_2_SCENARIOS, type ScenarioDefinition } from "@platform/ai-core/mock";
import {
	CapabilityUnsupportedError,
	MODEL_CATALOG,
	OllamaUnavailableError,
} from "@platform/ai-core/models";
import { createTextStreamModel } from "@platform/ai-core/testing";
import { afterEach, describe, expect, it } from "vitest";
import { parseStreamErrorText } from "@/lib/server/errors";
import { createPlatform, type Platform, setPlatformForTesting } from "@/lib/server/platform";
import { verifyOrWriteFixture } from "../../../../../scripts/e2e/generate-sse-fixtures.mjs";
import { POST } from "./route";

const MOCK_ENV = { VITEST: "1", AI_TEST_RUN_MODE: "mock" } as const;
const MOCK_MODEL = "mock:general-v1";

const SCENARIOS: readonly ScenarioDefinition[] = [
	defineScenario({
		id: "test/chat-reasoning",
		turns: [
			{
				match: { purpose: "chat", lastUserTextIncludes: "推論して" },
				respond: {
					reasoning: "まず考えます。",
					text: "答えです。",
					usage: { inputTokens: 12, outputTokens: 5, cacheReadTokens: 3 },
				},
			},
		],
	}),
];

// Mock cassettes are never consulted by these scenarios; an empty store keeps the test hermetic.
const EMPTY_CASSETTES = {
	async get() {
		return undefined;
	},
	async put() {},
} as never;

async function mockPlatform(overrides: Partial<Platform> = {}): Promise<Platform> {
	const platform = await createPlatform({
		env: MOCK_ENV,
		gateway: { mock: { scenarios: SCENARIOS, cassettes: EMPTY_CASSETTES } },
		recording: { store: { async write() {} } as never },
	});
	return { ...platform, ...overrides };
}

afterEach(() => setPlatformForTesting(undefined));

// --- Request / stream helpers (route tests of tasks 23 and 24 follow the same shape) ---

interface UiMessageInput {
	readonly id: string;
	readonly role: "user" | "assistant";
	readonly parts: readonly Record<string, unknown>[];
	readonly metadata?: unknown;
}

function userMessage(text: string, id = "u1"): UiMessageInput {
	return { id, role: "user", parts: [{ type: "text", text }] };
}

function chatRequest(
	messages: readonly UiMessageInput[],
	extra: Record<string, unknown> = {},
	signal?: AbortSignal,
): Request {
	return new Request("http://localhost/api/chat", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			id: "chat-1",
			messages,
			modelId: MOCK_MODEL,
			personaId: "general-assistant",
			...extra,
		}),
		...(signal ? { signal } : {}),
	});
}

type Chunk = { type: string; [key: string]: unknown };

/** Reads an AI SDK UI message stream (SSE) into its JSON chunks. */
async function readChunks(response: Response): Promise<Chunk[]> {
	const text = await response.text();
	return text
		.split("\n\n")
		.map((event) => event.trim())
		.filter((event) => event.startsWith("data: ") && event !== "data: [DONE]")
		.map((event) => JSON.parse(event.slice("data: ".length)) as Chunk);
}

describe("POST /api/chat", () => {
	it("streams text, reasoning and message metadata in mock mode (Req 3.1, 3.4, 3.7)", async () => {
		setPlatformForTesting(await mockPlatform());

		const response = await POST(chatRequest([userMessage("推論してください")]));

		expect(response.status).toBe(200);
		expect(response.headers.get("x-vercel-ai-ui-message-stream")).toBe("v1");
		const chunks = await readChunks(response);
		const types = chunks.map((chunk) => chunk.type);
		expect(types).toContain("reasoning-delta");
		expect(types).toContain("text-delta");
		const start = chunks.find((chunk) => chunk.type === "start");
		expect(start?.messageMetadata).toMatchObject({
			modelId: MOCK_MODEL,
			modelName: MODEL_CATALOG[MOCK_MODEL].displayName,
			provider: "mock",
			personaId: "general-assistant",
		});
		expect(start?.messageMetadata).not.toHaveProperty("usage");
		const finish = chunks.find((chunk) => chunk.type === "finish");
		expect(finish?.messageMetadata).toMatchObject({
			modelId: MOCK_MODEL,
			usage: { inputTokens: 12, outputTokens: 5, cacheReadTokens: 3 },
		});
	});

	it("uses the persona prompt with the catalog model name as the system prompt (Req 3.10)", async () => {
		const model = createTextStreamModel("ok");
		const platform = await mockPlatform();
		setPlatformForTesting({
			...platform,
			gateway: {
				...platform.gateway,
				resolve: async () => ({ model, entry: MODEL_CATALOG[MOCK_MODEL], mode: "mock" }),
			},
		});

		await readChunks(await POST(chatRequest([userMessage("hi")], { personaId: "python-mentor" })));

		const prompt = model.doStreamCalls[0]?.prompt ?? [];
		expect(prompt[0]?.role).toBe("system");
		expect(JSON.stringify(prompt[0])).toContain("Deterministic Mock Model");
	});

	it("drops reasoning from the history sent after a model switch (Req 3.3)", async () => {
		const model = createTextStreamModel("ok");
		const platform = await mockPlatform();
		setPlatformForTesting({
			...platform,
			gateway: {
				...platform.gateway,
				resolve: async () => ({ model, entry: MODEL_CATALOG[MOCK_MODEL], mode: "mock" }),
			},
		});
		// The answer was produced by another catalog model before the learner switched.
		const previous = Object.values(MODEL_CATALOG).find((entry) => entry.provider === "anthropic");
		if (!previous) throw new Error("catalog has no anthropic model");
		const history: UiMessageInput[] = [
			userMessage("最初の質問", "u1"),
			{
				id: "a1",
				role: "assistant",
				metadata: { modelId: previous.id, provider: previous.provider },
				parts: [
					{ type: "reasoning", text: "秘密の推論" },
					{ type: "text", text: "最初の答え" },
				],
			},
			userMessage("次の質問", "u2"),
		];

		await readChunks(await POST(chatRequest(history)));

		const sent = JSON.stringify(model.doStreamCalls[0]?.prompt);
		expect(sent).toContain("最初の答え");
		expect(sent).not.toContain("秘密の推論");
		expect(sent).not.toContain('"reasoning"');
	});

	it("aborts generation when the request is aborted (Req 3.5, 6.3)", async () => {
		const model = createTextStreamModel("ok");
		const platform = await mockPlatform();
		setPlatformForTesting({
			...platform,
			gateway: {
				...platform.gateway,
				resolve: async () => ({ model, entry: MODEL_CATALOG[MOCK_MODEL], mode: "mock" }),
			},
		});
		const controller = new AbortController();

		const response = await POST(chatRequest([userMessage("hi")], {}, controller.signal));
		await readChunks(response);
		controller.abort();

		const signal = model.doStreamCalls[0]?.abortSignal;
		expect(signal).toBeDefined();
		expect(signal?.aborted).toBe(true);
	});

	it("converts a mid-stream provider failure to a code and Japanese message (Req 3.6)", async () => {
		const failing = createTextStreamModel("x");
		failing.doStream = async () => {
			throw new Error("secret upstream detail sk-abc");
		};
		const platform = await mockPlatform();
		setPlatformForTesting({
			...platform,
			gateway: {
				...platform.gateway,
				resolve: async () => ({ model: failing, entry: MODEL_CATALOG[MOCK_MODEL], mode: "mock" }),
			},
		});

		const response = await POST(chatRequest([userMessage("hi")]));

		const chunks = await readChunks(response);
		const error = chunks.find((chunk) => chunk.type === "error");
		expect(error).toBeDefined();
		const parsed = parseStreamErrorText(String(error?.errorText));
		expect(parsed.code).toBe("provider-unavailable");
		expect(parsed.message).toMatch(/[ぁ-ん]/u);
		expect(JSON.stringify(chunks)).not.toContain("sk-abc");
	});

	it("requires image input only when the newest message carries an image (Req 3.9)", async () => {
		const requests: { require?: readonly string[] }[] = [];
		const platform = await mockPlatform();
		setPlatformForTesting({
			...platform,
			gateway: {
				...platform.gateway,
				resolve: async (request) => {
					requests.push(request);
					if (request.require?.includes("imageInput")) {
						throw new CapabilityUnsupportedError(
							"imageInput",
							MOCK_MODEL,
							"Deterministic Mock Model",
						);
					}
					return platform.gateway.resolve(request);
				},
			},
		});
		const image = {
			type: "file",
			mediaType: "image/png",
			url: "data:image/png;base64,iVBORw0KGgo=",
		};

		const rejected = await POST(
			chatRequest([{ id: "u1", role: "user", parts: [{ type: "text", text: "見て" }, image] }]),
		);
		expect(rejected.status).toBe(400);
		expect(((await rejected.json()) as { error: { code: string } }).error.code).toBe(
			"capability-unsupported",
		);
		expect(requests[0]?.require).toEqual(["imageInput"]);

		// An image in older history is replaced by a placeholder, not rejected.
		const accepted = await POST(
			chatRequest([
				{ id: "u1", role: "user", parts: [image] },
				{ id: "a1", role: "assistant", parts: [{ type: "text", text: "はい" }] },
				userMessage("こんにちは", "u2"),
			]),
		);
		expect(accepted.status).toBe(200);
		await readChunks(accepted);
		expect(requests[1]?.require ?? []).toEqual([]);
	});

	it("rejects malformed requests and invalid parts with 400 invalid-request", async () => {
		setPlatformForTesting(await mockPlatform());

		const badBody = await POST(chatRequest([userMessage("hi")], { modelId: "no-such-model" }));
		expect(badBody.status).toBe(400);

		const badPart = await POST(
			chatRequest([{ id: "u1", role: "user", parts: [{ type: "text", text: 42 }] }]),
		);
		expect(badPart.status).toBe(400);
		expect(((await badPart.json()) as { error: { code: string } }).error.code).toBe(
			"invalid-request",
		);
	});

	it("returns 503 provider-unavailable when the gateway cannot reach the provider (Req 3.8)", async () => {
		const platform = await mockPlatform();
		setPlatformForTesting({
			...platform,
			gateway: {
				...platform.gateway,
				resolve: async () => {
					throw new OllamaUnavailableError("http://127.0.0.1:11434", "unreachable");
				},
			},
		});

		const response = await POST(chatRequest([userMessage("hi")]));

		expect(response.status).toBe(503);
	});

	it("matches the generated SSE fixture used by the E2E specs (Req 1.17)", async () => {
		// The shared m1-2 scenarios are what the real server answers with in mock mode.
		setPlatformForTesting(
			await createPlatform({
				env: MOCK_ENV,
				gateway: { mock: { scenarios: M1_2_SCENARIOS, cassettes: EMPTY_CASSETTES } },
				recording: { store: { async write() {} } as never },
			}),
		);

		const response = await POST(chatRequest([userMessage("こんにちは")]));

		verifyOrWriteFixture("chat-greeting.sse", await response.text());
	});
});
