import type { AgentRunSummary } from "@platform/ai-core/agents";
import { M2_1_SAMPLE_QUESTIONS } from "@platform/ai-core/mock";
import { ModelSelectionError } from "@platform/ai-core/models";
import {
	type AgenticRagSummary,
	createKnowledgeStore,
	createPgliteDatabase,
	ingestDocuments,
	type RagDatabaseHandle,
} from "@platform/ai-core/rag";
import { createFakeClock } from "@platform/ai-core/testing";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createPlatform, getKnowledgeBase, setPlatformForTesting } from "@/lib/server/platform";
import { verifyOrWriteFixture } from "../../../../../../scripts/e2e/generate-sse-fixtures.mjs";
import { POST } from "./route";

vi.mock("@/lib/server/platform", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/server/platform")>();
	return { ...original, getKnowledgeBase: vi.fn(original.getKnowledgeBase) };
});

const MOCK_ENV = { VITEST: "1", AI_TEST_RUN_MODE: "mock" } as const;
const LIVE_ENV = {
	VITEST: "1",
	AI_TEST_RUN_MODE: "live",
	AI_LIVE_PROVIDER: "openai",
	OPENAI_API_KEY: "test-key",
	CHAT_RATE_LIMIT_MAX: "1",
} as const;
const MOCK_MODEL = "mock:general-v1";
// The request shape is the agent route's; the persona is required there and unused here.
const PERSONA = "general-assistant";
const NOW = Date.parse("2026-10-12T00:00:00.000Z");

let handle: RagDatabaseHandle;
let modelCalls: number;

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
				wrapped.doStream = async (options) => {
					modelCalls += 1;
					return model.doStream(options);
				};
				return { ...resolved, model: wrapped };
			},
		} as never,
		...adjust(platform),
	});
}

async function ingestCorpus(): Promise<void> {
	const platform = await createPlatform({ env: MOCK_ENV, clock: createFakeClock(NOW) });
	await ingestDocuments({
		db: handle.db,
		embedding: await platform.gateway.resolveEmbedding(),
		source: "eval-corpus",
		root: platform.knowledgeRoots.evalCorpus,
		files: [
			"01-rag-overview.md",
			"02-chunking.md",
			"03-embeddings-and-search.md",
			"04-hybrid-and-rrf.md",
			"05-rerank-and-evaluation.md",
			"06-agentic-rag.md",
		],
		reset: true,
		clock: createFakeClock(NOW),
	});
}

function userMessage(text: string) {
	return { id: "m-1", role: "user", parts: [{ type: "text", text }] };
}

function post(body: unknown, init: RequestInit = {}): Request {
	return new Request("http://localhost/api/rag/agent", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: typeof body === "string" ? body : JSON.stringify(body),
		...init,
	});
}

function ask(question: string, extra: object = {}) {
	return {
		id: "chat-1",
		messages: [userMessage(question)],
		modelId: MOCK_MODEL,
		personaId: PERSONA,
		...extra,
	};
}

interface StreamPart {
	type: string;
	toolName?: string;
	output?: unknown;
	messageMetadata?: { run?: AgentRunSummary; rag?: AgenticRagSummary };
	errorText?: string;
}

async function partsOf(response: Response): Promise<StreamPart[]> {
	const text = await response.text();
	return text
		.split("\n\n")
		.map((chunk) => chunk.trim())
		.filter((chunk) => chunk.startsWith("data: ") && chunk !== "data: [DONE]")
		.map((chunk) => JSON.parse(chunk.slice("data: ".length)) as StreamPart);
}

function finishMetadata(parts: readonly StreamPart[]) {
	return parts.find((part) => part.type === "finish")?.messageMetadata;
}

async function errorOf(response: Response) {
	return (await response.json()).error as { code: string; message: string };
}

beforeAll(async () => {
	handle = await createPgliteDatabase();
});

afterAll(async () => {
	await handle.close();
});

beforeEach(async () => {
	modelCalls = 0;
	vi.mocked(getKnowledgeBase).mockImplementation(async () => handle);
	await createKnowledgeStore(handle.db).reset();
});

afterEach(() => {
	setPlatformForTesting(undefined);
});

describe("POST /api/rag/agent: rejections before any model call", () => {
	it("answers 413 for an oversized body", async () => {
		await installPlatform();

		const response = await POST(post({ ...ask("q"), padding: "x".repeat(600_000) }));

		expect(response.status).toBe(413);
		expect(modelCalls).toBe(0);
	});

	it.each([
		["invalid JSON", "{not json"],
		["an unknown field", ask("質問", { root: "/etc" })],
		["no messages", { id: "chat-1", messages: [], modelId: MOCK_MODEL, personaId: PERSONA }],
		["an unknown model", ask("質問", { modelId: "not-a-model" })],
	])("answers 400 invalid-request for %s", async (_, body) => {
		await installPlatform();

		const response = await POST(post(body));

		expect(response.status).toBe(400);
		expect((await errorOf(response)).code).toBe("invalid-request");
		expect(modelCalls).toBe(0);
	});

	it("rate-limits only in live mode, after the other checks", async () => {
		await installPlatform(LIVE_ENV);

		const rejected = await POST(
			post({ id: "chat-1", messages: [], modelId: MOCK_MODEL, personaId: PERSONA }),
		);
		const first = await POST(post(ask("質問")));
		const second = await POST(post(ask("質問")));

		expect(rejected.status).toBe(400);
		expect(first.status).not.toBe(429);
		expect(second.status).toBe(429);
		expect((await errorOf(second)).code).toBe("rate-limited");
	});

	it("answers 400 invalid-request naming AI_MODEL_EMBEDDING when no embedding model is configured", async () => {
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

		const response = await POST(post(ask("質問")));

		expect(response.status).toBe(400);
		expect((await errorOf(response)).message).toContain("AI_MODEL_EMBEDDING");
		expect(modelCalls).toBe(0);
	});

	it("answers 400 capability-unsupported when the model does not support tools", async () => {
		await installPlatform(MOCK_ENV, (platform) => ({
			gateway: {
				...platform.gateway,
				resolve: async (request: { require?: readonly string[] }) => {
					const { CapabilityUnsupportedError } = await import("@platform/ai-core/models");
					if (request.require?.includes("tools")) {
						throw new CapabilityUnsupportedError("tools", "mock:general-v1", "Mock");
					}
					return platform.gateway.resolve(request as never);
				},
			},
		}));

		const response = await POST(post(ask("質問")));

		expect(response.status).toBe(400);
		expect((await errorOf(response)).code).toBe("capability-unsupported");
		expect(modelCalls).toBe(0);
	});
});

describe("POST /api/rag/agent: the agent run", () => {
	it("searches the knowledge base, then answers with a footnote it can be checked against", async () => {
		await ingestCorpus();
		await installPlatform();

		const response = await POST(post(ask(M2_1_SAMPLE_QUESTIONS.agenticSearch)));
		const parts = await partsOf(response);

		expect(response.status).toBe(200);
		const toolParts = parts.filter((part) => part.type.startsWith("tool-"));
		expect(toolParts.length).toBeGreaterThan(0);
		expect(parts.some((part) => part.type === "tool-input-available")).toBe(true);
		const toolInput = parts.find((part) => part.type === "tool-input-available") as
			| { toolName: string }
			| undefined;
		expect(toolInput?.toolName).toBe("searchKnowledgeBase");

		const metadata = finishMetadata(parts);
		expect(metadata?.rag?.searched).toBe(true);
		expect(metadata?.rag?.searchCount).toBe(1);
		expect(metadata?.rag?.answer).toContain("[1]");
		expect(metadata?.rag?.citations[0]).toMatchObject({ label: 1, cited: true });
		expect(metadata?.rag?.citations[0]?.excerpt).toContain("Agentic RAG");
		expect(metadata?.rag?.removedCitations).toEqual([]);
	});

	it("reports searched: false when the agent answers without searching", async () => {
		await ingestCorpus();
		await installPlatform();

		const parts = await partsOf(await POST(post(ask(M2_1_SAMPLE_QUESTIONS.agenticNoSearch))));

		expect(parts.some((part) => part.type.startsWith("tool-"))).toBe(false);
		const metadata = finishMetadata(parts);
		expect(metadata?.rag).toMatchObject({ searched: false, searchCount: 0, citations: [] });
		expect(metadata?.run?.toolsCalled).toEqual([]);
	});

	it("carries the run summary and its stop reason next to the RAG summary", async () => {
		await ingestCorpus();
		await installPlatform();

		const metadata = finishMetadata(
			await partsOf(await POST(post(ask(M2_1_SAMPLE_QUESTIONS.agenticSearch)))),
		);

		expect(metadata?.run?.stopReason).toBe("completed");
		expect(metadata?.run?.toolsCalled).toEqual(["searchKnowledgeBase"]);
		expect(metadata?.run?.steps).toBe(2);
		expect(Object.keys(metadata ?? {}).sort()).toEqual(["rag", "run"]);
	});

	it("starts every request with a fresh citation registry (labels restart at 1)", async () => {
		await ingestCorpus();
		await installPlatform();

		const first = finishMetadata(
			await partsOf(await POST(post(ask(M2_1_SAMPLE_QUESTIONS.agenticSearch)))),
		);
		const second = finishMetadata(
			await partsOf(await POST(post(ask(M2_1_SAMPLE_QUESTIONS.agenticSearch)))),
		);

		expect(first?.rag?.citations.map((citation) => citation.label)).toEqual([1]);
		expect(second?.rag?.citations.map((citation) => citation.label)).toEqual([1]);
	});

	it("gives the model only the searchKnowledgeBase tool", async () => {
		await ingestCorpus();
		await installPlatform();
		const seenTools: string[][] = [];
		await installPlatform(MOCK_ENV, (platform) => ({
			gateway: {
				...platform.gateway,
				resolve: async (request: never) => {
					const resolved = await platform.gateway.resolve(request);
					const wrapped = Object.create(resolved.model) as typeof resolved.model;
					wrapped.doStream = async (options) => {
						seenTools.push((options.tools ?? []).map((tool) => tool.name));
						return resolved.model.doStream(options);
					};
					return { ...resolved, model: wrapped };
				},
			},
		}));

		await partsOf(await POST(post(ask(M2_1_SAMPLE_QUESTIONS.agenticSearch))));

		expect(seenTools.length).toBeGreaterThan(0);
		for (const names of seenTools) expect(names).toEqual(["searchKnowledgeBase"]);
	});

	it("ends with an abort part, no tool run and no RAG summary when the request is already aborted", async () => {
		await ingestCorpus();
		await installPlatform();
		const controller = new AbortController();
		controller.abort();

		const response = await POST(
			post(ask(M2_1_SAMPLE_QUESTIONS.agenticSearch), { signal: controller.signal }),
		);
		const parts = await partsOf(response);

		expect(parts.some((part) => part.type === "abort")).toBe(true);
		expect(parts.some((part) => part.type === "tool-output-available")).toBe(false);
		expect(finishMetadata(parts)?.rag?.searched ?? false).toBe(false);
	});

	it("keeps provider failures out of the stream (a fixed message, no internals)", async () => {
		await ingestCorpus();
		await installPlatform(MOCK_ENV, (platform) => ({
			gateway: {
				...platform.gateway,
				resolve: async (request: never) => {
					const resolved = await platform.gateway.resolve(request);
					const failing = Object.create(resolved.model) as typeof resolved.model;
					failing.doStream = async () => {
						throw new Error("upstream said: key sk-secret-999 rejected");
					};
					return { ...resolved, model: failing };
				},
			},
		}));

		const parts = await partsOf(await POST(post(ask(M2_1_SAMPLE_QUESTIONS.agenticSearch))));

		const error = parts.find((part) => part.type === "error");
		expect(error?.errorText).toBeDefined();
		expect(error?.errorText).not.toContain("sk-secret-999");
	});
});

describe("POST /api/rag/agent: generated SSE fixtures used by the E2E specs", () => {
	it("matches the generated SSE fixture of a run that searches and cites (Req 1.17)", async () => {
		await ingestCorpus();
		await installPlatform();

		const response = await POST(post(ask(M2_1_SAMPLE_QUESTIONS.agenticSearch)));

		expect(response.status).toBe(200);
		verifyOrWriteFixture("rag-agent-search.sse", await response.text());
	});

	it("matches the generated SSE fixture of a run that answers without searching (Req 1.17)", async () => {
		await ingestCorpus();
		await installPlatform();

		const response = await POST(post(ask(M2_1_SAMPLE_QUESTIONS.agenticNoSearch)));

		expect(response.status).toBe(200);
		verifyOrWriteFixture("rag-agent-no-search.sse", await response.text());
	});
});
