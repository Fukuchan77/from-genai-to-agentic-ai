import { M2_3_SAMPLE_TASKS, M2_4_SAMPLE_TASKS } from "@platform/ai-core/mock";
import { PATTERN_DEMO_NAMES } from "@platform/ai-core/patterns";
import { createFakeClock } from "@platform/ai-core/testing";
import { WORKFLOW_DEMO_NAMES } from "@platform/ai-core/workflows";
import { APICallError, wrapLanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPlatform, type Platform, setPlatformForTesting } from "@/lib/server/platform";
import { verifyOrWriteFixture } from "../../../../../scripts/e2e/generate-sse-fixtures.mjs";
import { POST } from "./route";

const MOCK_ENV = { VITEST: "1", AI_TEST_RUN_MODE: "mock" } as const;
const LIVE_ENV = {
	VITEST: "1",
	AI_TEST_RUN_MODE: "live",
	AI_LIVE_PROVIDER: "openai",
	OPENAI_API_KEY: "test-key",
	CHAT_RATE_LIMIT_MAX: "2",
} as const;

const WORKFLOW_TASKS: Record<(typeof WORKFLOW_DEMO_NAMES)[number], string> = {
	"prompt-chaining": M2_3_SAMPLE_TASKS.promptChain.ok,
	routing: M2_3_SAMPLE_TASKS.routing.technical,
	"model-routing": M2_3_SAMPLE_TASKS.modelRouting.easy,
	"parallel-sectioning": M2_3_SAMPLE_TASKS.sectioning,
	"parallel-voting": M2_3_SAMPLE_TASKS.voting,
	"orchestrator-workers": M2_3_SAMPLE_TASKS.orchestrator.three,
	"evaluator-optimizer": M2_3_SAMPLE_TASKS.evaluator.improves,
};

const PATTERN_TASKS: Record<(typeof PATTERN_DEMO_NAMES)[number], string> = {
	"passive-goal-creator": M2_4_SAMPLE_TASKS.passiveGoal.sufficient,
	"prompt-response-optimizer": M2_4_SAMPLE_TASKS.optimizer.prompt,
	"single-path-plan": M2_4_SAMPLE_TASKS.singlePath,
	"multi-path-plan": M2_4_SAMPLE_TASKS.multiPath,
	"self-reflection": M2_4_SAMPLE_TASKS.selfReflection,
	"cross-reflection": M2_4_SAMPLE_TASKS.crossReflection,
	"role-based-cooperation": M2_4_SAMPLE_TASKS.roleBased,
};

async function install(
	env: Record<string, string> = MOCK_ENV,
	overrides: Partial<Platform> = {},
): Promise<Platform> {
	const platform = {
		...(await createPlatform({ env, clock: createFakeClock(1_000) })),
		...overrides,
	};
	setPlatformForTesting(platform);
	return platform;
}

function post(body: unknown, init: RequestInit = {}): Request {
	return new Request("http://localhost/api/workflows", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: typeof body === "string" ? body : JSON.stringify(body),
		...init,
	});
}

async function errorOf(response: Response) {
	return (await response.json()).error as { code: string; message: string };
}

afterEach(() => {
	setPlatformForTesting(undefined);
});

describe("POST /api/workflows: every name completes in mock mode", () => {
	it.each(WORKFLOW_DEMO_NAMES)("runs the workflow %s", async (name) => {
		await install();

		const response = await POST(post({ kind: "workflow", name, task: WORKFLOW_TASKS[name] }));

		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body).toMatchObject({ name, usage: { llmCalls: expect.any(Number) } });
		expect(body.result).toBeDefined();
		expect(body.usage.llmCalls).toBeGreaterThan(0);
	});

	it.each(PATTERN_DEMO_NAMES)("runs the pattern %s", async (name) => {
		await install();

		const response = await POST(post({ kind: "pattern", name, task: PATTERN_TASKS[name] }));

		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body).toMatchObject({ name, usage: { llmCalls: expect.any(Number) } });
		expect(body.result).toBeDefined();
	});

	it("returns the pattern's own result shape (a vote with its ballots)", async () => {
		await install();

		const body = await (
			await POST(
				post({
					kind: "workflow",
					name: "parallel-voting",
					task: M2_3_SAMPLE_TASKS.voting,
					options: { votes: 2 },
				}),
			)
		).json();

		expect(body.result).toMatchObject({ outcome: "tie", tiedLabels: ["賛成", "反対"] });
	});
});

describe("POST /api/workflows: agent limits", () => {
	it("runs the role-based pattern with the platform's agent limits", async () => {
		await install({ ...MOCK_ENV, AGENT_MAX_STEPS: "1" });

		const response = await POST(
			post({ kind: "pattern", name: "role-based-cooperation", task: M2_4_SAMPLE_TASKS.roleBased }),
		);

		const body = await response.json();
		expect(response.status).toBe(200);
		expect(body.result.outputs[0].run).toMatchObject({ stopReason: "step-limit", steps: 1 });
	});
});

describe("POST /api/workflows: rejections before any model call", () => {
	async function expectRejectedWithoutModel(
		request: Request,
		status: number,
		code: string,
		env: Record<string, string> = MOCK_ENV,
	) {
		const platform = await install(env);
		const resolve = vi.spyOn(platform.gateway, "resolve");

		const response = await POST(request);

		expect(response.status).toBe(status);
		expect((await errorOf(response)).code).toBe(code);
		expect(resolve).not.toHaveBeenCalled();
	}

	it("413 for a body over the size limit", async () => {
		await expectRejectedWithoutModel(
			post({ kind: "workflow", name: "routing", task: "x".repeat(600 * 1024) }),
			413,
			"payload-too-large",
		);
	});

	it.each([
		["malformed JSON", "{not json"],
		["a non-object body", "[]"],
		["an unknown key", { kind: "workflow", name: "routing", task: "x", extra: 1 }],
		["a missing kind", { name: "routing", task: "x" }],
		["a kind outside the vocabulary", { kind: "graph", name: "routing", task: "x" }],
		["a name outside the vocabulary", { kind: "workflow", name: "graph-of-thoughts", task: "x" }],
		[
			"a pattern name under kind workflow",
			{ kind: "workflow", name: "self-reflection", task: "x" },
		],
		["a workflow name under kind pattern", { kind: "pattern", name: "routing", task: "x" }],
		["an empty task", { kind: "workflow", name: "routing", task: "" }],
		["a blank task", { kind: "workflow", name: "routing", task: "  \n " }],
		["a non-string task", { kind: "workflow", name: "routing", task: 5 }],
		["an array as options", { kind: "workflow", name: "routing", task: "x", options: [] }],
		["null options", { kind: "workflow", name: "routing", task: "x", options: null }],
	])("400 for %s", async (_label, body) => {
		await expectRejectedWithoutModel(post(body), 400, "invalid-request");
	});

	it("names the offending field when the kind and the name do not belong together", async () => {
		await install();

		const response = await POST(post({ kind: "workflow", name: "self-reflection", task: "x" }));

		expect(response.status).toBe(400);
		expect((await errorOf(response)).message).toContain("name");
	});

	it("accepts a task of exactly 4000 characters and rejects 4001 (characters, not UTF-16 units)", async () => {
		await install();
		const exact = await POST(
			post({ kind: "workflow", name: "prompt-chaining", task: "あ".repeat(4000) }),
		);
		// No scenario matches this task, so the run fails after the guard: that is a 503, not a 400.
		expect(exact.status).not.toBe(400);

		await expectRejectedWithoutModel(
			post({ kind: "workflow", name: "prompt-chaining", task: "あ".repeat(4001) }),
			400,
			"invalid-request",
		);
		await expectRejectedWithoutModel(
			post({ kind: "workflow", name: "prompt-chaining", task: "😀".repeat(4001) }),
			400,
			"invalid-request",
		);
		// 3000 emoji are 6000 UTF-16 units but 3000 characters: within the limit.
		const emoji = await POST(
			post({ kind: "workflow", name: "prompt-chaining", task: "😀".repeat(3000) }),
		);
		expect(emoji.status).not.toBe(400);
	});

	it.each([
		["votes over the limit", "workflow", "parallel-voting", { votes: 10 }],
		[
			"more aspects than sections",
			"workflow",
			"parallel-sectioning",
			{ aspects: Array.from({ length: 9 }, (_, i) => `a${i}`) },
		],
		["iterations over the cap", "workflow", "evaluator-optimizer", { maxIterations: 9 }],
		["subtasks over the limit", "workflow", "orchestrator-workers", { maxSubtasks: 7 }],
		["candidates over the limit", "pattern", "multi-path-plan", { candidates: 6 }],
		["reflection iterations over the cap", "pattern", "self-reflection", { maxIterations: 9 }],
		["an unknown option", "workflow", "routing", { unexpected: true }],
		["a wrongly typed option", "workflow", "parallel-voting", { votes: "3" }],
	])("400 for options with %s", async (_label, kind, name, options) => {
		await expectRejectedWithoutModel(
			post({ kind, name, task: "x", options }),
			400,
			"invalid-request",
		);
	});

	it("keeps the rejected option's name and value out of the error", async () => {
		await install();

		const response = await POST(
			post({
				kind: "workflow",
				name: "routing",
				task: "x",
				options: { "SECRET-KEY": "SECRET-VALUE" },
			}),
		);

		const text = await response.text();
		expect(response.status).toBe(400);
		expect(text).not.toContain("SECRET");
	});
});

describe("POST /api/workflows: rate limit (live only)", () => {
	function liveGateway(base: Platform["gateway"]): Platform["gateway"] {
		return base;
	}

	it("does not rate limit in mock mode", async () => {
		await install({ ...MOCK_ENV, CHAT_RATE_LIMIT_MAX: "1" });

		for (let call = 0; call < 3; call += 1) {
			const response = await POST(
				post({ kind: "workflow", name: "parallel-voting", task: M2_3_SAMPLE_TASKS.voting }),
			);
			expect(response.status).toBe(200);
		}
	});

	it("answers 429 after the window is used up in live mode, counting only valid requests", async () => {
		const mock = await createPlatform({ env: MOCK_ENV, clock: createFakeClock(1_000) });
		await install(LIVE_ENV, { gateway: liveGateway(mock.gateway) });
		const valid = () =>
			post({ kind: "workflow", name: "parallel-voting", task: M2_3_SAMPLE_TASKS.voting });

		// An invalid request is refused before the limiter, so it spends no quota.
		const invalid = [
			{ kind: "workflow", name: "nope", task: "x" },
			{ kind: "workflow", name: "self-reflection", task: "x" },
			{ kind: "pattern", name: "routing", task: "x" },
			{ kind: "workflow", name: "routing", task: " " },
			{ kind: "workflow", name: "routing", task: "😀".repeat(4001) },
		];
		for (const body of invalid) expect((await POST(post(body))).status).toBe(400);
		expect((await POST(valid())).status).toBe(200);
		expect((await POST(valid())).status).toBe(200);
		const limited = await POST(valid());

		expect(limited.status).toBe(429);
		expect((await errorOf(limited)).code).toBe("rate-limited");
		expect(limited.headers.get("retry-after")).not.toBeNull();
	});

	it("refuses an over-limit option with 400 before it can spend live quota", async () => {
		const mock = await createPlatform({ env: MOCK_ENV, clock: createFakeClock(1_000) });
		await install({ ...LIVE_ENV, CHAT_RATE_LIMIT_MAX: "1" }, { gateway: mock.gateway });

		const refused = await POST(
			post({
				kind: "workflow",
				name: "parallel-voting",
				task: M2_3_SAMPLE_TASKS.voting,
				options: { votes: 10 },
			}),
		);
		const allowed = await POST(
			post({ kind: "workflow", name: "parallel-voting", task: M2_3_SAMPLE_TASKS.voting }),
		);

		expect(refused.status).toBe(400);
		expect(allowed.status).toBe(200);
	});
});

describe("POST /api/workflows: failures after the guard", () => {
	function gatewayWithModel(
		base: Platform["gateway"],
		model: MockLanguageModelV4,
	): Platform["gateway"] {
		return {
			...base,
			resolve: async (request) => {
				const resolved = await base.resolve(request);
				return { ...resolved, model };
			},
		};
	}

	it("502 output-invalid when the model never returns a valid structured output", async () => {
		const mock = await createPlatform({ env: MOCK_ENV, clock: createFakeClock(1_000) });
		const broken = new MockLanguageModelV4({
			doGenerate: {
				content: [{ type: "text", text: "not json at all" }],
				finishReason: { unified: "stop", raw: undefined },
				usage: {
					inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
					outputTokens: { total: 1, text: 1, reasoning: 0 },
				},
				warnings: [],
			},
		});
		await install(MOCK_ENV, { gateway: gatewayWithModel(mock.gateway, broken) });

		const response = await POST(
			post({ kind: "workflow", name: "routing", task: M2_3_SAMPLE_TASKS.routing.technical }),
		);

		expect(response.status).toBe(502);
		expect((await errorOf(response)).code).toBe("output-invalid");
	});

	it("503 provider-unavailable, with no provider text, when the provider call fails", async () => {
		const mock = await createPlatform({ env: MOCK_ENV, clock: createFakeClock(1_000) });
		const failing = new MockLanguageModelV4({
			doGenerate: async () => {
				throw new APICallError({
					message: "upstream said SECRET-PROVIDER-TEXT",
					url: "https://example.invalid",
					requestBodyValues: { prompt: "SECRET-PROMPT" },
				});
			},
		});
		await install(MOCK_ENV, { gateway: gatewayWithModel(mock.gateway, failing) });

		const response = await POST(
			post({ kind: "workflow", name: "prompt-chaining", task: M2_3_SAMPLE_TASKS.promptChain.ok }),
		);

		const text = await response.text();
		expect(response.status).toBe(503);
		expect(text).toContain("provider-unavailable");
		expect(text).not.toContain("SECRET");
	});

	it.each([
		["workflow", "parallel-voting", M2_3_SAMPLE_TASKS.voting],
		["workflow", "parallel-sectioning", M2_3_SAMPLE_TASKS.sectioning],
		["workflow", "orchestrator-workers", M2_3_SAMPLE_TASKS.orchestrator.three],
		["workflow", "evaluator-optimizer", M2_3_SAMPLE_TASKS.evaluator.improves],
		["pattern", "multi-path-plan", M2_4_SAMPLE_TASKS.multiPath],
		["pattern", "single-path-plan", M2_4_SAMPLE_TASKS.singlePath],
		["pattern", "role-based-cooperation", M2_4_SAMPLE_TASKS.roleBased],
	])(
		"503, not 502, when the provider fails inside the parallel or looping %s %s",
		async (kind, name, task) => {
			const mock = await createPlatform({ env: MOCK_ENV, clock: createFakeClock(1_000) });
			const failing = new MockLanguageModelV4({
				doGenerate: async () => {
					throw new APICallError({
						message: "upstream said SECRET-PROVIDER-TEXT",
						url: "https://example.invalid",
						requestBodyValues: {},
						isRetryable: false,
					});
				},
			});
			await install(MOCK_ENV, { gateway: gatewayWithModel(mock.gateway, failing) });

			const response = await POST(post({ kind, name, task }));

			const text = await response.text();
			expect(response.status).toBe(503);
			expect(text).toContain("provider-unavailable");
			expect(text).not.toContain("SECRET");
		},
	);

	it("503 when the mock has no response for the task", async () => {
		await install();

		const response = await POST(
			post({ kind: "workflow", name: "routing", task: "どのシナリオにも無い入力です。" }),
		);

		expect(response.status).toBe(503);
		expect((await errorOf(response)).code).toBe("provider-unavailable");
	});

	it("400 when Cross-Reflection has no distinct judge model", async () => {
		const mock = await createPlatform({ env: MOCK_ENV, clock: createFakeClock(1_000) });
		const chat = await mock.gateway.resolve({ purpose: "chat" });
		await install(MOCK_ENV, { gateway: { ...mock.gateway, resolve: async () => chat } });

		const response = await POST(
			post({
				kind: "pattern",
				name: "cross-reflection",
				task: M2_4_SAMPLE_TASKS.crossReflection,
			}),
		);

		expect(response.status).toBe(400);
		expect((await errorOf(response)).message).toContain("AI_MODEL_JUDGE");
	});
});

describe("POST /api/workflows: abort", () => {
	function capturingGateway(base: Platform["gateway"]) {
		const signals: (AbortSignal | undefined)[] = [];
		const gateway: Platform["gateway"] = {
			...base,
			resolve: async (request) => {
				const resolved = await base.resolve(request);
				return {
					...resolved,
					model: wrapLanguageModel({
						model: resolved.model,
						middleware: {
							specificationVersion: "v4",
							async wrapGenerate({ doGenerate, params }) {
								signals.push(params.abortSignal);
								return doGenerate();
							},
						},
					}),
				};
			},
		};
		return { gateway, signals };
	}

	it("hands the request's signal to the model calls of a workflow and of a pattern", async () => {
		const mock = await createPlatform({ env: MOCK_ENV, clock: createFakeClock(1_000) });
		const captured = capturingGateway(mock.gateway);
		await install(MOCK_ENV, { gateway: captured.gateway });
		const controller = new AbortController();

		await POST(
			post(
				{ kind: "workflow", name: "parallel-voting", task: M2_3_SAMPLE_TASKS.voting },
				{ signal: controller.signal },
			),
		);
		await POST(
			post(
				{
					kind: "pattern",
					name: "passive-goal-creator",
					task: M2_4_SAMPLE_TASKS.passiveGoal.sufficient,
				},
				{ signal: controller.signal },
			),
		);
		controller.abort();

		expect(captured.signals.length).toBeGreaterThanOrEqual(4);
		expect(captured.signals.every((signal) => signal?.aborted === true)).toBe(true);
	});

	it("calls no model when the request was already aborted", async () => {
		const mock = await createPlatform({ env: MOCK_ENV, clock: createFakeClock(1_000) });
		const captured = capturingGateway(mock.gateway);
		await install(MOCK_ENV, { gateway: captured.gateway });
		const controller = new AbortController();
		controller.abort();

		await POST(
			post(
				{ kind: "workflow", name: "prompt-chaining", task: M2_3_SAMPLE_TASKS.promptChain.ok },
				{ signal: controller.signal },
			),
		);

		expect(captured.signals).toHaveLength(0);
	});
});

describe("POST /api/workflows: generated SSE fixture used by the E2E specs", () => {
	it("matches the generated SSE fixture (JSON) of an Evaluator-Optimizer run that misses the pass score (Req 1.17)", async () => {
		await install();

		const response = await POST(
			post({
				kind: "workflow",
				name: "evaluator-optimizer",
				task: M2_3_SAMPLE_TASKS.evaluator.stalls,
			}),
		);

		expect(response.status).toBe(200);
		verifyOrWriteFixture(
			"workflows-evaluator-optimizer.json",
			`${JSON.stringify(await response.json(), null, "\t")}\n`,
		);
	});
});
