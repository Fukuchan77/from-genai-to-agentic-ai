import type { GuardedAgent } from "@platform/ai-core/agents";
import { defineScenario, M1_2_SCENARIOS, type ScenarioDefinition } from "@platform/ai-core/mock";
import { MODEL_CATALOG } from "@platform/ai-core/models";
import type { HttpFetcher } from "@platform/ai-core/ports";
import { createFakeClock } from "@platform/ai-core/testing";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseStreamErrorText } from "@/lib/server/errors";
import { createPlatform, type Platform, setPlatformForTesting } from "@/lib/server/platform";
import { POST } from "./route";

// Every created GuardedAgent is recorded, together with the options it was created with.
const created = vi.hoisted(() => ({
	agents: [] as unknown[],
	options: [] as { signal: AbortSignal }[],
}));

// The history adapter is wrapped so a test can observe its inputs or make it fail.
const adapter = vi.hoisted(() => ({
	calls: 0,
	failWith: undefined as Error | undefined,
}));

vi.mock("@platform/ai-core/chat", async (importOriginal) => {
	const original = await importOriginal<typeof import("@platform/ai-core/chat")>();
	return {
		...original,
		adaptHistoryForModel: ((...args: Parameters<typeof original.adaptHistoryForModel>) => {
			adapter.calls += 1;
			if (adapter.failWith) throw adapter.failWith;
			return original.adaptHistoryForModel(...args);
		}) as typeof original.adaptHistoryForModel,
	};
});

vi.mock("@platform/ai-core/agents", async (importOriginal) => {
	const original = await importOriginal<typeof import("@platform/ai-core/agents")>();
	return {
		...original,
		createGuardedAgent: ((options: { signal: AbortSignal }) => {
			const guarded = original.createGuardedAgent(options as never);
			created.agents.push(guarded);
			created.options.push(options);
			return guarded;
		}) as typeof original.createGuardedAgent,
	};
});

const MOCK_ENV = { VITEST: "1", AI_TEST_RUN_MODE: "mock" } as const;
const MOCK_MODEL = "mock:general-v1";

const LOOPING_SCENARIO: ScenarioDefinition = defineScenario({
	id: "test/agent-loop",
	turns: [
		{
			match: { purpose: "chat", lastUserTextIncludes: "計算して" },
			respond: {
				toolCalls: [{ toolName: "calculator", input: { expression: "1 + 2" } }],
				usage: { inputTokens: 10, outputTokens: 2 },
			},
		},
	],
});

const EMPTY_CASSETTES = {
	async get() {
		return undefined;
	},
	async put() {},
} as never;

async function mockPlatform(overrides: Partial<Platform> = {}): Promise<Platform> {
	const platform = await createPlatform({
		env: MOCK_ENV,
		clock: createFakeClock(1_000),
		gateway: {
			mock: { scenarios: [...M1_2_SCENARIOS, LOOPING_SCENARIO], cassettes: EMPTY_CASSETTES },
		},
		recording: { store: { async write() {} } as never },
	});
	return { ...platform, ...overrides };
}

afterEach(() => {
	setPlatformForTesting(undefined);
	created.agents.length = 0;
	created.options.length = 0;
	adapter.calls = 0;
	adapter.failWith = undefined;
});

function agentRequest(
	text: string,
	extra: Record<string, unknown> = {},
	signal?: AbortSignal,
): Request {
	return new Request("http://localhost/api/agent/tools", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			id: "agent-1",
			messages: [{ id: "u1", role: "user", parts: [{ type: "text", text }] }],
			modelId: MOCK_MODEL,
			personaId: "general-assistant",
			...extra,
		}),
		...(signal ? { signal } : {}),
	});
}

type Chunk = { type: string; [key: string]: unknown };

async function readChunks(response: Response): Promise<Chunk[]> {
	const text = await response.text();
	return text
		.split("\n\n")
		.map((event) => event.trim())
		.filter((event) => event.startsWith("data: ") && event !== "data: [DONE]")
		.map((event) => JSON.parse(event.slice("data: ".length)) as Chunk);
}

/** A history whose tool part does not match the weather tool's schema. */
function invalidToolPartRequest(): Request {
	return new Request("http://localhost/api/agent/tools", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			id: "agent-1",
			messages: [
				{
					id: "a1",
					role: "assistant",
					parts: [
						{
							type: "tool-weather",
							toolCallId: "c1",
							state: "output-available",
							input: { city: 42, leak: "TOP-SECRET" },
							output: {},
						},
					],
				},
				{ id: "u1", role: "user", parts: [{ type: "text", text: "続けて" }] },
			],
			modelId: MOCK_MODEL,
			personaId: "general-assistant",
		}),
	});
}

/** A fetcher whose request never settles on its own; it reports when a request has started. */
function hangingFetcher() {
	let resolveStarted: () => void = () => {};
	const started = new Promise<void>((resolve) => {
		resolveStarted = resolve;
	});
	const fetcher: HttpFetcher = {
		fetch: () => {
			resolveStarted();
			return new Promise(() => {});
		},
	};
	return { fetcher, started };
}

describe("POST /api/agent/tools", () => {
	it("streams tool parts in order, then the answer, with run metadata (Req 5.1, 5.5, 5.6)", async () => {
		setPlatformForTesting(await mockPlatform());

		const response = await POST(agentRequest("東京の天気を教えて"));

		expect(response.status).toBe(200);
		expect(response.headers.get("x-vercel-ai-ui-message-stream")).toBe("v1");
		const chunks = await readChunks(response);
		const types = chunks.map((chunk) => chunk.type);
		const indexOf = (type: string) => types.indexOf(type);
		expect(indexOf("tool-input-available")).toBeGreaterThan(-1);
		expect(indexOf("tool-output-available")).toBeGreaterThan(indexOf("tool-input-available"));
		expect(indexOf("text-delta")).toBeGreaterThan(indexOf("tool-output-available"));
		const call = chunks.find((chunk) => chunk.type === "tool-input-available");
		expect(call).toMatchObject({ toolName: "weather", input: { city: "Tokyo" } });
		const output = chunks.find((chunk) => chunk.type === "tool-output-available");
		expect(output?.output).toMatchObject({ ok: true });

		const finish = chunks.find((chunk) => chunk.type === "finish");
		expect(finish?.messageMetadata).toMatchObject({
			modelId: MOCK_MODEL,
			modelName: MODEL_CATALOG[MOCK_MODEL].displayName,
			toolsCalled: ["weather"],
			run: { stopReason: "completed", steps: 2, toolsCalled: ["weather"] },
		});
		const start = chunks.find((chunk) => chunk.type === "start");
		expect(start?.messageMetadata).toMatchObject({ personaId: "general-assistant" });
		expect(start?.messageMetadata).not.toHaveProperty("run");
	});

	it("reports the step limit as the stop reason in the finish metadata (Req 6.2)", async () => {
		const platform = await mockPlatform();
		setPlatformForTesting({
			...platform,
			config: { ...platform.config, agent: { ...platform.config.agent, maxSteps: 1 } },
		});

		const chunks = await readChunks(await POST(agentRequest("計算して")));

		const finish = chunks.find((chunk) => chunk.type === "finish");
		expect(finish?.messageMetadata).toMatchObject({
			run: { stopReason: "step-limit", steps: 1, toolsCalled: ["calculator"] },
		});
	});

	it("lists tools that need unset settings as disabledTools from the server's config (Req 5.4)", async () => {
		setPlatformForTesting(await mockPlatform());

		const chunks = await readChunks(await POST(agentRequest("東京の天気を教えて")));

		for (const type of ["start", "finish"]) {
			const metadata = chunks.find((chunk) => chunk.type === type)?.messageMetadata;
			expect(metadata).toMatchObject({
				disabledTools: [{ name: "webSearch", requiredEnv: ["TAVILY_API_KEY"] }],
			});
		}
	});

	it("registers the web search tool and lists nothing when the key is configured (Req 5.4)", async () => {
		const platform = await mockPlatform();
		setPlatformForTesting({
			...platform,
			config: {
				...platform.config,
				credentials: { ...platform.config.credentials, tavily: "tvly-test-placeholder" },
			},
		});

		const chunks = await readChunks(await POST(agentRequest("東京の天気を教えて")));

		const start = chunks.find((chunk) => chunk.type === "start");
		expect(start?.messageMetadata).toMatchObject({ disabledTools: [] });
		const guarded = created.agents[0] as GuardedAgent;
		expect(Object.keys(guarded.agent.tools ?? {})).toContain("webSearch");
	});

	it("never takes tool availability from the request body", async () => {
		setPlatformForTesting(await mockPlatform());

		const response = await POST(
			agentRequest("東京の天気を教えて", {
				disabledTools: [],
				availability: { "web-search": true },
			}),
		);

		expect(response.status).toBe(400);
		expect(created.agents).toHaveLength(0);
	});

	it("creates a separate GuardedAgent per request with that request's signal (ADR-6)", async () => {
		setPlatformForTesting(await mockPlatform());
		// A Request keeps a dependent signal of the one passed in, so compare with `request.signal`.
		const first = agentRequest("東京の天気を教えて", {}, new AbortController().signal);
		const second = agentRequest("東京の天気を教えて", {}, new AbortController().signal);

		await readChunks(await POST(first));
		await readChunks(await POST(second));

		expect(created.agents).toHaveLength(2);
		expect(created.agents[0]).not.toBe(created.agents[1]);
		expect(created.options[0]?.signal).toBe(first.signal);
		expect(created.options[1]?.signal).toBe(second.signal);
	});

	it("turns a tool that exceeds AGENT_TOOL_TIMEOUT_MS into a timeout result and keeps looping (Req 6.4)", async () => {
		const clock = createFakeClock(1_000);
		const platform = await mockPlatform();
		const { fetcher, started } = hangingFetcher();
		setPlatformForTesting({
			...platform,
			clock,
			ports: { ...platform.ports, http: fetcher },
			toolRuntime: { clock, toolTimeoutMs: platform.config.agent.toolTimeoutMs },
		});

		const reading = POST(agentRequest("東京の天気を教えて")).then(readChunks);
		await started;
		clock.advanceBy(platform.config.agent.toolTimeoutMs);
		const chunks = await reading;

		const output = chunks.find((chunk) => chunk.type === "tool-output-available");
		expect(output?.output).toMatchObject({ ok: false, failure: { kind: "timeout" } });
		expect(chunks.some((chunk) => chunk.type === "text-delta")).toBe(true);
		const finish = chunks.find((chunk) => chunk.type === "finish");
		expect(finish?.messageMetadata).toMatchObject({
			run: { stopReason: "completed", steps: 2, toolsCalled: ["weather"] },
		});
	});

	it("aborts the run and the running tool when the request is aborted (Req 6.3)", async () => {
		const platform = await mockPlatform();
		const { fetcher, started } = hangingFetcher();
		setPlatformForTesting({ ...platform, ports: { ...platform.ports, http: fetcher } });
		const controller = new AbortController();

		const response = await POST(agentRequest("東京の天気を教えて", {}, controller.signal));
		const reading = readChunks(response).catch(() => []);
		await started;
		controller.abort();
		await reading;

		const guarded = created.agents[0] as GuardedAgent;
		expect(guarded.abortSignal.aborted).toBe(true);
		await expect(guarded.done).resolves.toMatchObject({ stopReason: "aborted" });
	});

	it("sends a provider failure as a fixed stream error without the raw message (plan Error Handling)", async () => {
		const platform = await mockPlatform();
		const failing = new MockLanguageModelV4({
			doStream: async () => {
				throw new Error("upstream said: api-key=sk-secret-value");
			},
		});
		setPlatformForTesting({
			...platform,
			gateway: {
				...platform.gateway,
				resolve: async () => ({ model: failing, entry: MODEL_CATALOG[MOCK_MODEL], mode: "mock" }),
			},
		});

		const response = await POST(agentRequest("東京の天気を教えて"));
		const body = await response.text();

		expect(body).not.toContain("sk-secret-value");
		const chunks = body
			.split("\n\n")
			.filter((event) => event.startsWith("data: {"))
			.map((event) => JSON.parse(event.slice(6)) as Chunk);
		const error = chunks.find((chunk) => chunk.type === "error");
		expect(error).toBeDefined();
		expect(parseStreamErrorText(String(error?.errorText)).code).toBe("provider-unavailable");
		const guarded = created.agents[0] as GuardedAgent;
		await expect(guarded.done).resolves.toMatchObject({
			stopReason: "error",
			error: { code: "unexpected" },
		});
	});

	it("requires a model that supports tools and resolves it before creating the agent", async () => {
		const platform = await mockPlatform();
		const resolve = vi.fn(platform.gateway.resolve);
		setPlatformForTesting({ ...platform, gateway: { ...platform.gateway, resolve } });

		await readChunks(await POST(agentRequest("東京の天気を教えて")));

		expect(resolve).toHaveBeenCalledWith(
			expect.objectContaining({ purpose: "chat", modelId: MOCK_MODEL, require: ["tools"] }),
		);
	});

	it("rejects a malformed body before creating an agent (Req 3.11)", async () => {
		setPlatformForTesting(await mockPlatform());

		const response = await POST(agentRequest("hi", { modelId: "no-such-model" }));

		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ error: { code: "invalid-request" } });
		expect(created.agents).toHaveLength(0);
	});

	it("rejects tool parts that do not match the tool schemas with a fixed message", async () => {
		setPlatformForTesting(await mockPlatform());

		const response = await POST(invalidToolPartRequest());

		expect(response.status).toBe(400);
		const text = await response.text();
		expect(text).toContain("invalid-request");
		expect(text).not.toContain("TOP-SECRET");
	});

	it("does not adapt a history that failed validation", async () => {
		setPlatformForTesting(await mockPlatform());

		const response = await POST(invalidToolPartRequest());

		expect(response.status).toBe(400);
		expect(adapter.calls).toBe(0);
	});

	it("reports a failure after validation as unexpected, not as invalid-request", async () => {
		setPlatformForTesting(await mockPlatform());
		adapter.failWith = new Error("adapter exploded: TOP-SECRET");

		const response = await POST(agentRequest("東京の天気を教えて"));

		expect(response.status).toBe(500);
		const text = await response.text();
		expect(text).toContain("unexpected");
		expect(text).not.toContain("invalid-request");
		expect(text).not.toContain("TOP-SECRET");
	});
});
