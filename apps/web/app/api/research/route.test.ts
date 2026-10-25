import { PlatformError } from "@platform/ai-core/errors";
import { M3_4_SAMPLE_THEMES } from "@platform/ai-core/mock";
import { CapabilityUnsupportedError, MODEL_CATALOG } from "@platform/ai-core/models";
import { createFakeClock } from "@platform/ai-core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createPlatform,
	setArxivClientForTesting,
	setPlatformForTesting,
} from "@/lib/server/platform";
import { verifyOrWriteFixture } from "../../../../../scripts/e2e/generate-sse-fixtures.mjs";
import { POST } from "./route";

const MOCK_ENV = { VITEST: "1", AI_TEST_RUN_MODE: "mock" } as const;
const LIVE_ENV = {
	VITEST: "1",
	AI_TEST_RUN_MODE: "live",
	AI_LIVE_PROVIDER: "openai",
	OPENAI_API_KEY: "test-key",
	CHAT_RATE_LIMIT_MAX: "1",
} as const;
const NOW = Date.parse("2026-10-18T00:00:00.000Z");

/** Every `doGenerate` of the resolved chat model, with the hook the test installed. */
let modelCalls: number;
let beforeModelCall: ((callIndex: number) => Promise<void> | void) | undefined;

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

function post(body: unknown, init: RequestInit = {}): Request {
	return new Request("http://localhost/api/research", {
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

interface ResultData {
	report: string;
	warnings: string[];
	missing: { agent: string; reason: string }[];
}
interface UsageData {
	byRole: Record<string, unknown>;
	total: { totalTokens: number };
	calls: number;
	maxCalls: number;
}

const resultOf = (parts: readonly StreamPart[]) =>
	parts.find((part) => part.type === "data-research-result")?.data as ResultData | undefined;
const usageParts = (parts: readonly StreamPart[]) =>
	parts.filter((part) => part.type === "data-research-usage");
const eventsOf = (parts: readonly StreamPart[]) =>
	parts
		.filter((part) => part.type === "data-research-event")
		.map((part) => part.data as { agent: string; kind: string; detail: Record<string, unknown> });

beforeEach(() => {
	modelCalls = 0;
	beforeModelCall = undefined;
	setArxivClientForTesting(undefined);
});

afterEach(() => {
	setPlatformForTesting(undefined);
	setArxivClientForTesting(undefined);
});

describe("POST /api/research: rejections before any model call", () => {
	it("answers 413 for an oversized body", async () => {
		await installPlatform();

		const response = await POST(post({ theme: "t", padding: "x".repeat(600_000) }));

		expect(response.status).toBe(413);
		expect(modelCalls).toBe(0);
	});

	it.each([
		["invalid JSON", "{not json"],
		["an unknown field", { theme: "t", sources: ["x"] }],
		["no theme", {}],
		["an empty theme", { theme: "" }],
		["a blank theme", { theme: "  \n " }],
		["an unknown model", { theme: "t", modelId: "not-a-model" }],
		["maxSubagentCalls 0", { theme: "t", maxSubagentCalls: 0 }],
		["maxSubagentCalls 21", { theme: "t", maxSubagentCalls: 21 }],
		["a fractional maxSubagentCalls", { theme: "t", maxSubagentCalls: 2.5 }],
	])("answers 400 invalid-request for %s", async (_name, body) => {
		await installPlatform();

		const response = await POST(post(body));

		expect(response.status).toBe(400);
		expect((await errorOf(response)).code).toBe("invalid-request");
		expect(modelCalls).toBe(0);
	});

	it("answers 400 for a theme over 500 characters, and accepts exactly 500", async () => {
		await installPlatform();

		const tooLong = await POST(post({ theme: "あ".repeat(501) }));
		const exact = await POST(post({ theme: "あ".repeat(500) }));

		expect(tooLong.status).toBe(400);
		expect(exact.status).toBe(200);
		await exact.text();
	});

	it("rate-limits only in live mode, after the other checks", async () => {
		// Past the guard the request ends at once, so no live model is ever called.
		await installPlatform(LIVE_ENV, (platform) => ({
			gateway: {
				...platform.gateway,
				resolve: async () => {
					throw new CapabilityUnsupportedError("tools", "gpt-test", "OpenAI");
				},
			},
		}));

		const rejected = await POST(post({ theme: "" }));
		const first = await POST(post({ theme: "t" }));
		const second = await POST(post({ theme: "t" }));

		expect(rejected.status).toBe(400);
		expect(first.status).toBe(400);
		expect((await errorOf(first)).code).toBe("capability-unsupported");
		expect(second.status).toBe(429);
		expect((await errorOf(second)).code).toBe("rate-limited");
	});

	it("answers 400 capability-unsupported when the model has no tools, before any LLM call", async () => {
		let required: readonly string[] | undefined;
		await installPlatform(MOCK_ENV, (platform) => ({
			gateway: {
				...platform.gateway,
				resolve: async (request: { require?: readonly string[] }) => {
					required = request.require;
					throw new CapabilityUnsupportedError("tools", "mock:general-v1", "Mock");
				},
			},
		}));

		const response = await POST(post({ theme: M3_4_SAMPLE_THEMES.default }));

		expect(response.status).toBe(400);
		expect((await errorOf(response)).code).toBe("capability-unsupported");
		expect(required).toEqual(["tools"]);
		expect(modelCalls).toBe(0);
	});

	it("passes the model the request names to the gateway", async () => {
		const modelId = Object.keys(MODEL_CATALOG)[0] as string;
		let asked: { modelId?: string } | undefined;
		await installPlatform(MOCK_ENV, (platform) => ({
			gateway: {
				...platform.gateway,
				resolve: async (request: { modelId?: string }) => {
					asked = request;
					throw new CapabilityUnsupportedError("tools", modelId, "Mock");
				},
			},
		}));

		await POST(post({ theme: "t", modelId }));
		expect(asked?.modelId).toBe(modelId);

		await POST(post({ theme: "t" }));
		expect(asked).not.toHaveProperty("modelId");
	});

	it("does not reach arXiv or the model for a rejected request", async () => {
		await installPlatform();
		let arxivCalls = 0;
		setArxivClientForTesting({
			search: async () => {
				arxivCalls += 1;
				return [];
			},
			getAbstract: async () => undefined,
		});

		await POST(post({ theme: "" }));

		expect(arxivCalls).toBe(0);
		expect(modelCalls).toBe(0);
	});
});

describe("POST /api/research: a run in mock mode", () => {
	it("completes the sample theme: events by agent, the usage, and the report with its warning", async () => {
		await installPlatform();

		const parts = await partsOf(await POST(post({ theme: M3_4_SAMPLE_THEMES.default })));

		const events = eventsOf(parts);
		expect(new Set(events.map((event) => event.agent))).toEqual(
			new Set(["supervisor", "search", "reading", "market"]),
		);
		expect(events.some((event) => event.kind === "card")).toBe(true);
		const result = resultOf(parts);
		expect(result?.report).toContain("# 階層型エージェントの最新動向");
		expect(result?.report).not.toContain("未取得の手法 X");
		expect(result?.warnings).toHaveLength(1);
		expect(result?.warnings[0]).toContain("2412.99999");
		expect(result?.missing).toEqual([]);
		expect(modelCalls).toBe(12);
	});

	it("shows the usage as one state part that is replaced, ending with the four roles and the calls", async () => {
		await installPlatform();

		const parts = await partsOf(await POST(post({ theme: M3_4_SAMPLE_THEMES.default })));

		const usages = usageParts(parts);
		expect(usages.length).toBeGreaterThan(1);
		expect(new Set(usages.map((part) => part.id))).toEqual(new Set(["usage"]));
		const last = usages.at(-1)?.data as unknown as UsageData;
		expect(Object.keys(last.byRole).sort()).toEqual(["market", "reading", "search", "supervisor"]);
		expect(last.calls).toBe(4);
		expect(last.maxCalls).toBe(8);
		expect(last.total.totalTokens).toBeGreaterThan(0);
	});

	it("puts the result after the last event and the last usage", async () => {
		await installPlatform();

		const parts = await partsOf(await POST(post({ theme: M3_4_SAMPLE_THEMES.default })));

		const resultIndex = parts.findIndex((part) => part.type === "data-research-result");
		const lastEvent = parts.map((part) => part.type).lastIndexOf("data-research-event");
		const lastUsage = parts.map((part) => part.type).lastIndexOf("data-research-usage");
		expect(resultIndex).toBeGreaterThan(lastEvent);
		expect(resultIndex).toBeGreaterThan(lastUsage);
		expect(parts.filter((part) => part.type === "data-research-result")).toHaveLength(1);
	});

	it("names the gap of the partial-failure theme in the report and in the result", async () => {
		await installPlatform();

		const parts = await partsOf(await POST(post({ theme: M3_4_SAMPLE_THEMES.partialFailure })));

		const result = resultOf(parts);
		expect(result?.missing.map((item) => item.agent)).toEqual(["reading"]);
		expect(result?.report).toContain("## 調査できなかった観点");
		expect(eventsOf(parts).some((e) => e.agent === "reading" && e.kind === "error")).toBe(true);
	});

	it("applies the call limit of the request and says which calls were left out", async () => {
		await installPlatform();

		const parts = await partsOf(
			await POST(post({ theme: M3_4_SAMPLE_THEMES.default, maxSubagentCalls: 2 })),
		);

		const result = resultOf(parts);
		const usage = usageParts(parts).at(-1)?.data as unknown as UsageData;
		expect(usage.calls).toBe(2);
		expect(usage.maxCalls).toBe(2);
		expect(result?.missing.map((item) => item.agent)).toEqual(["reading", "market"]);
		expect(result?.missing[0]?.reason).toContain("回数");
	});

	it("uses the default call limit when the request names none", async () => {
		await installPlatform();

		const parts = await partsOf(await POST(post({ theme: M3_4_SAMPLE_THEMES.default })));

		const last = usageParts(parts).at(-1)?.data as unknown as UsageData;
		expect(last.maxCalls).toBe(8);
	});

	it("goes on when arXiv cannot be reached and records the searches as gaps (Req 4.7)", async () => {
		await installPlatform();
		setArxivClientForTesting({
			search: async () => {
				throw new PlatformError("source-unavailable", "arXiv から論文を取得できませんでした。");
			},
			getAbstract: async () => undefined,
		});

		const response = await POST(post({ theme: M3_4_SAMPLE_THEMES.default }));
		const parts = await partsOf(response);

		expect(response.status).toBe(200);
		const result = resultOf(parts);
		expect(result?.missing.filter((item) => item.agent === "search")).toHaveLength(2);
		expect(result?.report).toContain("## 調査できなかった観点");
		expect(parts.some((part) => part.type === "error")).toBe(false);
	});

	it("writes an event to the stream before the next LLM call finishes (Req 4.9)", async () => {
		let release: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		// Call 1 is the supervisor, call 2 the search sub-agent: hold it and see what the client has.
		beforeModelCall = async (callIndex) => {
			if (callIndex === 2) await gate;
		};
		await installPlatform();

		const response = await POST(post({ theme: M3_4_SAMPLE_THEMES.default }));
		const reader = (response.body as ReadableStream<Uint8Array>).getReader();
		const decoder = new TextDecoder();
		let received = "";
		const started = Date.now();
		while (!received.includes('"kind":"call"')) {
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
			expect(eventsOf(early)[0]).toMatchObject({ agent: "supervisor", kind: "call" });
			expect(early.some((part) => part.type === "data-research-result")).toBe(false);
		} finally {
			release();
		}
		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			received += decoder.decode(value, { stream: true });
		}
		expect(resultOf(parseParts(received))?.report).toContain("# 階層型エージェントの最新動向");
	});

	it("stops at an abort: no further LLM call and no result", async () => {
		const controller = new AbortController();
		beforeModelCall = (callIndex) => {
			// The search sub-agent's first call: the client goes away.
			if (callIndex === 2) controller.abort(new DOMException("Stopped", "AbortError"));
		};
		await installPlatform();

		const response = await POST(
			post({ theme: M3_4_SAMPLE_THEMES.default }, { signal: controller.signal }),
		);
		const parts = await partsOf(response).catch(() => [] as StreamPart[]);

		expect(modelCalls).toBe(2);
		expect(resultOf(parts)).toBeUndefined();
	});

	it("keeps provider failures out of the stream (a fixed message, no internals), with no result", async () => {
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

		const parts = await partsOf(await POST(post({ theme: M3_4_SAMPLE_THEMES.default })));

		const error = parts.find((part) => part.type === "error");
		expect(error?.errorText).toBeDefined();
		expect(error?.errorText).not.toContain("sk-secret-999");
		expect(resultOf(parts)).toBeUndefined();
	});

	it("keeps the message of an unexpected error out of the stream", async () => {
		await installPlatform(MOCK_ENV, () => ({
			clock: {
				now: () => NOW,
				timeoutSignal: () => {
					throw new Error("clock broke: key sk-secret-777");
				},
			},
		}));

		const parts = await partsOf(await POST(post({ theme: M3_4_SAMPLE_THEMES.default })));

		const error = parts.find((part) => part.type === "error");
		expect(error?.errorText).toBeDefined();
		expect(JSON.stringify(parts)).not.toContain("sk-secret-777");
		expect(resultOf(parts)).toBeUndefined();
	});

	it("does not invent a result for a theme without a script: the stream ends in an error", async () => {
		await installPlatform();

		const parts = await partsOf(await POST(post({ theme: "台本の無いテーマ" })));

		expect(parts.some((part) => part.type === "error")).toBe(true);
		expect(resultOf(parts)).toBeUndefined();
	});
});

describe("POST /api/research: generated SSE fixtures used by the E2E specs", () => {
	it("matches the generated SSE fixture of the default theme with a removed-citation warning", async () => {
		await installPlatform();

		const response = await POST(post({ theme: M3_4_SAMPLE_THEMES.default }));

		expect(response.status).toBe(200);
		verifyOrWriteFixture("research.sse", await response.text());
	});

	it("matches the generated SSE fixture of the partial-failure theme with a missing item", async () => {
		await installPlatform();

		const response = await POST(post({ theme: M3_4_SAMPLE_THEMES.partialFailure }));

		expect(response.status).toBe(200);
		verifyOrWriteFixture("research-partial.sse", await response.text());
	});
});
