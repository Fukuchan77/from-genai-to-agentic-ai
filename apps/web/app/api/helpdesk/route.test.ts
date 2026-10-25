import { createTicketStore, FAQ_DIRECTORY } from "@platform/ai-core/helpdesk";
import { M3_2_SAMPLE_INQUIRIES } from "@platform/ai-core/mock";
import { CapabilityUnsupportedError, ModelSelectionError } from "@platform/ai-core/models";
import {
	createKnowledgeStore,
	createPgliteDatabase,
	ingestDocuments,
	KnowledgeBaseUnavailableError,
	listIngestableFiles,
	type RagDatabaseHandle,
} from "@platform/ai-core/rag";
import { createFakeClock } from "@platform/ai-core/testing";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createPlatform,
	getHelpdeskStore,
	setKnowledgeBaseForTesting,
	setPlatformForTesting,
} from "@/lib/server/platform";
import { verifyOrWriteFixture } from "../../../../../scripts/e2e/generate-sse-fixtures.mjs";
import { POST } from "./route";

vi.mock("@/lib/server/platform", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/server/platform")>();
	return { ...original, getHelpdeskStore: vi.fn(original.getHelpdeskStore) };
});

const MOCK_ENV = { VITEST: "1", AI_TEST_RUN_MODE: "mock" } as const;
const LIVE_ENV = {
	VITEST: "1",
	AI_TEST_RUN_MODE: "live",
	AI_LIVE_PROVIDER: "openai",
	OPENAI_API_KEY: "test-key",
	CHAT_RATE_LIMIT_MAX: "1",
} as const;
const NOW = Date.parse("2026-10-18T00:00:00.000Z");

let handle: RagDatabaseHandle;
/** Every `doGenerate` of the resolved chat model, in order, with the hook the test installed. */
let modelCalls: number;
/** The prompt of every `doGenerate`, in order. */
let modelPrompts: string[];
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
					modelPrompts.push(JSON.stringify(options.prompt));
					await beforeModelCall?.(modelCalls);
					return model.doGenerate(options);
				};
				return { ...resolved, model: wrapped };
			},
			resolveEmbedding: platform.gateway.resolveEmbedding.bind(platform.gateway),
		} as never,
		...adjust(platform),
	});
}

async function ingestFaq(): Promise<void> {
	const platform = await createPlatform({ env: MOCK_ENV, clock: createFakeClock(NOW) });
	await ingestDocuments({
		db: handle.db,
		embedding: await platform.gateway.resolveEmbedding(),
		source: "knowledge",
		root: FAQ_DIRECTORY,
		files: await listIngestableFiles(FAQ_DIRECTORY),
		reset: true,
		clock: createFakeClock(NOW),
	});
}

function post(body: unknown, init: RequestInit = {}): Request {
	return new Request("http://localhost/api/helpdesk", {
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
	messageMetadata?: { ticketId?: string; status?: string };
	errorText?: string;
}

function parseParts(text: string): StreamPart[] {
	return text
		.split("\n\n")
		.map((chunk) => chunk.trim())
		.filter((chunk) => chunk.startsWith("data: ") && chunk !== "data: [DONE]")
		.map((chunk) => JSON.parse(chunk.slice("data: ".length)) as StreamPart);
}

async function partsOf(response: Response): Promise<StreamPart[]> {
	return parseParts(await response.text());
}

async function errorOf(response: Response) {
	return (await response.json()).error as { code: string; message: string };
}

const resultOf = (parts: readonly StreamPart[]) =>
	parts.find((part) => part.type === "data-helpdesk-result")?.data as
		| { ticketId: string; status: string; answer?: string; reason?: string; remaining?: string[] }
		| undefined;

beforeAll(async () => {
	handle = await createPgliteDatabase();
});

afterAll(async () => {
	await handle.close();
});

beforeEach(async () => {
	modelCalls = 0;
	modelPrompts = [];
	beforeModelCall = undefined;
	setKnowledgeBaseForTesting(handle);
	await createKnowledgeStore(handle.db).reset();
	await createTicketStore(handle.db).reset();
	vi.mocked(getHelpdeskStore).mockClear();
});

afterEach(() => {
	setPlatformForTesting(undefined);
	setKnowledgeBaseForTesting(undefined);
});

describe("POST /api/helpdesk: rejections before any model call", () => {
	it("answers 413 for an oversized body", async () => {
		await installPlatform();

		const response = await POST(post({ inquiry: "q", padding: "x".repeat(600_000) }));

		expect(response.status).toBe(413);
		expect(modelCalls).toBe(0);
	});

	it.each([
		["invalid JSON", "{not json"],
		["an unknown field", { inquiry: "q", root: "/etc" }],
		["no inquiry", {}],
		["an empty inquiry", { inquiry: "" }],
		["a blank inquiry", { inquiry: "  \n " }],
		["an unknown model", { inquiry: "q", modelId: "not-a-model" }],
		["maxSteps 0", { inquiry: "q", maxSteps: 0 }],
		["maxSteps 31", { inquiry: "q", maxSteps: 31 }],
		["a fractional maxSteps", { inquiry: "q", maxSteps: 2.5 }],
	])("answers 400 invalid-request for %s", async (_name, body) => {
		await installPlatform();

		const response = await POST(post(body));

		expect(response.status).toBe(400);
		expect((await errorOf(response)).code).toBe("invalid-request");
		expect(modelCalls).toBe(0);
	});

	it("answers 400 for an inquiry over 4,000 characters, and accepts exactly 4,000", async () => {
		await ingestFaq();
		await installPlatform();

		const tooLong = await POST(post({ inquiry: "あ".repeat(4_001) }));
		const exact = await POST(post({ inquiry: "あ".repeat(4_000), maxSteps: 1 }));

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

		const rejected = await POST(post({ inquiry: "" }));
		const first = await POST(post({ inquiry: "q" }));
		const second = await POST(post({ inquiry: "q" }));

		expect(rejected.status).toBe(400);
		expect(first.status).toBe(400);
		expect((await errorOf(first)).code).toBe("capability-unsupported");
		expect(second.status).toBe(429);
		expect((await errorOf(second)).code).toBe("rate-limited");
	});

	it.each(["tools", "structuredOutput"])(
		"answers 400 capability-unsupported when the model lacks %s, before any LLM call",
		async (capability) => {
			await installPlatform(MOCK_ENV, (platform) => ({
				gateway: {
					...platform.gateway,
					resolve: async (request: { require?: readonly string[] }) => {
						if (request.require?.includes(capability)) {
							throw new CapabilityUnsupportedError(capability as never, "mock:general-v1", "Mock");
						}
						return platform.gateway.resolve(request as never);
					},
					resolveEmbedding: platform.gateway.resolveEmbedding.bind(platform.gateway),
				},
			}));

			const response = await POST(post({ inquiry: M3_2_SAMPLE_INQUIRIES.resolved }));

			expect(response.status).toBe(400);
			expect((await errorOf(response)).code).toBe("capability-unsupported");
			expect(modelCalls).toBe(0);
			expect(vi.mocked(getHelpdeskStore)).not.toHaveBeenCalled();
		},
	);

	it("answers 400 naming AI_MODEL_EMBEDDING when no embedding model is configured", async () => {
		await installPlatform(MOCK_ENV, (platform) => ({
			gateway: {
				...platform.gateway,
				resolve: platform.gateway.resolve.bind(platform.gateway),
				resolveEmbedding: async () => {
					throw new ModelSelectionError({
						reason: "no-default",
						mode: "live",
						provider: "anthropic",
						purpose: "chat",
					});
				},
			},
		}));

		const response = await POST(post({ inquiry: "q" }));

		expect(response.status).toBe(400);
		expect((await errorOf(response)).message).toContain("AI_MODEL_EMBEDDING");
		expect(modelCalls).toBe(0);
	});

	it("answers 503 provider-unavailable with the start-up guidance when the database cannot be reached", async () => {
		await installPlatform();
		vi.mocked(getHelpdeskStore).mockRejectedValueOnce(new KnowledgeBaseUnavailableError());

		const response = await POST(post({ inquiry: M3_2_SAMPLE_INQUIRIES.resolved }));

		expect(response.status).toBe(503);
		const error = await errorOf(response);
		expect(error.code).toBe("provider-unavailable");
		expect(error.message).toContain("services:up:db");
		expect(modelCalls).toBe(0);
	});
});

describe("POST /api/helpdesk: a run in mock mode", () => {
	it("resolves a ticket: the dashboard parts, the final answer, and the row in the database", async () => {
		await ingestFaq();
		await installPlatform();

		const response = await POST(post({ inquiry: M3_2_SAMPLE_INQUIRIES.resolved }));
		const parts = await partsOf(response);

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("text/event-stream");
		const result = resultOf(parts);
		expect(result).toMatchObject({ ticketId: "T-0001", status: "resolved" });
		expect(result?.answer).toContain("認証アプリの時刻");
		const plans = parts.filter((part) => part.type === "data-helpdesk-plan");
		expect(new Set(plans.map((part) => part.id))).toEqual(new Set(["plan"]));
		expect(plans.at(-1)?.data?.tasks).toMatchObject([{ state: "done" }, { state: "done" }]);
		expect(
			parts.some((part) => part.type === "data-helpdesk-progress" && part.id === "progress"),
		).toBe(true);
		expect(parts.find((part) => part.type === "message-metadata")?.messageMetadata).toEqual({
			ticketId: "T-0001",
			status: "resolved",
		});
		const store = await getHelpdeskStore();
		expect(await store.get("T-0001")).toMatchObject({
			status: "resolved",
			answer: result?.answer,
			inquiry: M3_2_SAMPLE_INQUIRIES.resolved,
		});
		expect((await store.revisions("T-0001")).map((revision) => revision.revision)).toEqual([0]);
	});

	it("tells the planner which documents the knowledge base holds", async () => {
		await ingestFaq();
		await installPlatform();

		await partsOf(await POST(post({ inquiry: M3_2_SAMPLE_INQUIRIES.resolved, maxSteps: 1 })));

		expect(modelPrompts[0]).toContain("VPN 接続手順");
		expect(modelPrompts[0]).toContain("パスワードの再設定");
	});

	it("escalates a ticket that the knowledge cannot settle, with the unresolved reason", async () => {
		await ingestFaq();
		await installPlatform();

		const parts = await partsOf(await POST(post({ inquiry: M3_2_SAMPLE_INQUIRIES.unresolved })));

		const result = resultOf(parts);
		expect(result).toMatchObject({ ticketId: "T-0001", status: "escalated" });
		expect(result?.reason).toContain("担当者の確認が必要");
		const ticket = await (await getHelpdeskStore()).get("T-0001");
		expect(ticket).toMatchObject({ status: "escalated", escalationReason: result?.reason });
		expect(ticket?.answer).toBeUndefined();
	});

	it("replans: a second revision with its diff is stored and shown", async () => {
		await ingestFaq();
		await installPlatform();

		const parts = await partsOf(await POST(post({ inquiry: M3_2_SAMPLE_INQUIRIES.replanned })));

		expect(resultOf(parts)).toMatchObject({ status: "resolved" });
		const withDiff = parts.filter((part) => part.type === "data-helpdesk-plan" && part.data?.diff);
		expect(withDiff.length).toBeGreaterThan(1);
		expect(
			parts.filter((part) => part.type === "data-helpdesk-plan").at(-1)?.data?.diff,
		).toBeDefined();
		expect(withDiff[0]?.data).toMatchObject({
			revision: 1,
			diff: { added: ["t3"], removed: ["t2"], changed: [] },
		});
		const revisions = await (await getHelpdeskStore()).revisions("T-0001");
		expect(revisions.map((revision) => revision.revision)).toEqual([0, 1]);
		expect(revisions[1]?.reason).toContain("接続方法");
	});

	it("leaves the ticket open at the step limit and lists what was not run", async () => {
		await ingestFaq();
		await installPlatform();

		const parts = await partsOf(
			await POST(post({ inquiry: M3_2_SAMPLE_INQUIRIES.resolved, maxSteps: 2 })),
		);

		// plan (1) + t1 (2): t2 would be the third step.
		expect(resultOf(parts)).toMatchObject({ status: "open", remaining: ["t2"] });
		expect(await (await getHelpdeskStore()).get("T-0001")).toMatchObject({
			status: "open",
			stoppedReason: "step-limit",
			stepsUsed: 2,
		});
		expect(parts.find((part) => part.type === "message-metadata")?.messageMetadata).toEqual({
			ticketId: "T-0001",
			status: "open",
		});
	});

	it("escalates a ticket whose plan stays invalid after the regenerations, and runs no task", async () => {
		await ingestFaq();
		await installPlatform();

		const parts = await partsOf(await POST(post({ inquiry: M3_2_SAMPLE_INQUIRIES.invalidPlan })));

		const result = resultOf(parts);
		expect(result).toMatchObject({ ticketId: "T-0001", status: "escalated" });
		expect(result?.reason).toContain("計画");
		// The plan was asked for three times (the first and two regenerations) and nothing else.
		expect(modelCalls).toBe(3);
		const store = await getHelpdeskStore();
		expect(await store.get("T-0001")).toMatchObject({ status: "escalated" });
		expect(await store.revisions("T-0001")).toEqual([]);
	});

	it("escalates for lack of a source when the knowledge base is empty", async () => {
		await installPlatform();

		const parts = await partsOf(await POST(post({ inquiry: M3_2_SAMPLE_INQUIRIES.resolved })));

		expect(resultOf(parts)).toMatchObject({ status: "escalated" });
		expect(resultOf(parts)?.reason).toContain("根拠");
	});

	it("writes a state change to the stream before the next LLM call finishes (Req 2.5)", async () => {
		await ingestFaq();
		let release: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		// Call 1 is the plan, call 2 the first task: hold it and see what the client already has.
		beforeModelCall = async (callIndex) => {
			if (callIndex === 2) await gate;
		};
		await installPlatform();

		const response = await POST(post({ inquiry: M3_2_SAMPLE_INQUIRIES.resolved }));
		const reader = (response.body as ReadableStream<Uint8Array>).getReader();
		const decoder = new TextDecoder();
		let received = "";
		const started = Date.now();
		// Read until the part that announces the first task has arrived.
		while (!received.includes('"current":"t1"')) {
			const { value, done } = await reader.read();
			if (done || Date.now() - started > 5_000) break;
			received += decoder.decode(value, { stream: true });
		}
		// The run is then held inside its first task call.
		while (modelCalls < 2 && Date.now() - started < 5_000) {
			await new Promise((resolve) => setTimeout(resolve, 5));
		}

		try {
			expect(modelCalls).toBe(2);
			const early = parseParts(received);
			expect(early.some((part) => part.type === "data-helpdesk-plan")).toBe(true);
			expect(early.some((part) => part.type === "data-helpdesk-progress")).toBe(true);
			expect(early.some((part) => part.type === "data-helpdesk-result")).toBe(false);
		} finally {
			// Always let the held run finish, so it cannot leak into the next test.
			release();
		}
		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			received += decoder.decode(value, { stream: true });
		}
		expect(resultOf(parseParts(received))).toMatchObject({ status: "resolved" });
	});

	it("stops at an abort: no further LLM call, and the ticket is left open as aborted", async () => {
		await ingestFaq();
		const controller = new AbortController();
		beforeModelCall = (callIndex) => {
			// The first task's call: the client goes away.
			if (callIndex === 2) controller.abort(new DOMException("Stopped", "AbortError"));
		};
		await installPlatform();

		const response = await POST(
			post({ inquiry: M3_2_SAMPLE_INQUIRIES.resolved }, { signal: controller.signal }),
		);
		await response.text().catch(() => undefined);

		expect(modelCalls).toBe(2);
		expect(await (await getHelpdeskStore()).get("T-0001")).toMatchObject({
			status: "open",
			stoppedReason: "aborted",
		});
	});

	it("keeps provider failures out of the stream (a fixed message, no internals)", async () => {
		await ingestFaq();
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
				resolveEmbedding: platform.gateway.resolveEmbedding.bind(platform.gateway),
			},
		}));

		const parts = await partsOf(await POST(post({ inquiry: M3_2_SAMPLE_INQUIRIES.resolved })));

		const error = parts.find((part) => part.type === "error");
		expect(error?.errorText).toBeDefined();
		expect(error?.errorText).not.toContain("sk-secret-999");
	});
});

describe("POST /api/helpdesk: generated SSE fixtures used by the E2E specs", () => {
	it("matches the generated SSE fixture of a resolved run with a plan revision and its diff", async () => {
		await ingestFaq();
		await installPlatform();

		const response = await POST(post({ inquiry: M3_2_SAMPLE_INQUIRIES.replanned }));

		expect(response.status).toBe(200);
		verifyOrWriteFixture("helpdesk.sse", await response.text());
	});
});
