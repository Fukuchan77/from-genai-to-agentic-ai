import { M2_1_SAMPLE_QUESTIONS, M2_CORPUS_TEXT } from "@platform/ai-core/mock";
import { CapabilityUnsupportedError, ModelSelectionError } from "@platform/ai-core/models";
import {
	createKnowledgeStore,
	createPgliteDatabase,
	ingestDocuments,
	KnowledgeBaseUnavailableError,
	NO_EVIDENCE_MESSAGE,
	type RagDatabaseHandle,
	type RagResult,
	type RetrievalTrace,
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
const NOW = Date.parse("2026-10-12T00:00:00.000Z");
const NO_METHODS = { hyde: false, multiQuery: false, hybrid: false, rerank: false };

let handle: RagDatabaseHandle;
let languageModelCalls: number;

/** Counts every call that reaches a language model, whatever the purpose. */
function countModelCalls(platform: Awaited<ReturnType<typeof createPlatform>>) {
	const resolve = platform.gateway.resolve.bind(platform.gateway);
	return {
		...platform.gateway,
		resolve: async (request: Parameters<typeof resolve>[0]) => {
			const resolved = await resolve(request);
			const { model } = resolved;
			const wrapped = Object.create(model) as typeof model;
			wrapped.doGenerate = async (options) => {
				languageModelCalls += 1;
				return model.doGenerate(options);
			};
			wrapped.doStream = async (options) => {
				languageModelCalls += 1;
				return model.doStream(options);
			};
			return { ...resolved, model: wrapped };
		},
	};
}

async function installPlatform(
	env: Record<string, string> = MOCK_ENV,
	adjust: (platform: Awaited<ReturnType<typeof createPlatform>>) => object = () => ({}),
) {
	const platform = await createPlatform({ env, clock: createFakeClock(NOW) });
	setPlatformForTesting({
		...platform,
		gateway: countModelCalls(platform) as never,
		...adjust(platform),
	});
	return platform;
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

function post(body: unknown, init: RequestInit = {}): Request {
	return new Request("http://localhost/api/rag/query", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: typeof body === "string" ? body : JSON.stringify(body),
		...init,
	});
}

function query(question: string, settings: object = {}, extra: object = {}) {
	return { id: "q-1", question, settings, ...extra };
}

interface StreamPart {
	type: string;
	id?: string;
	delta?: string;
	data?: unknown;
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

async function errorOf(response: Response) {
	return (await response.json()).error as { code: string; message: string };
}

function resultOf(parts: readonly StreamPart[]): RagResult {
	return parts.find((part) => part.type === "data-rag-result")?.data as RagResult;
}

/** The newest trace: it replaces the earlier ones under the same id and holds everything. */
function traceOf(parts: readonly StreamPart[]): RetrievalTrace {
	return parts.findLast((part) => part.type === "data-rag-trace")?.data as RetrievalTrace;
}

beforeAll(async () => {
	handle = await createPgliteDatabase();
});

afterAll(async () => {
	await handle.close();
});

beforeEach(async () => {
	languageModelCalls = 0;
	vi.mocked(getKnowledgeBase).mockImplementation(async () => handle);
	await createKnowledgeStore(handle.db).reset();
});

afterEach(() => {
	setPlatformForTesting(undefined);
});

describe("POST /api/rag/query: rejections before any model call", () => {
	it("answers 413 for an oversized body", async () => {
		await installPlatform();

		const response = await POST(post({ ...query("q"), padding: "x".repeat(600_000) }));

		expect(response.status).toBe(413);
		expect((await errorOf(response)).code).toBe("payload-too-large");
		expect(languageModelCalls).toBe(0);
	});

	it.each([
		["invalid JSON", "{not json"],
		["an unknown field", query("質問", {}, { root: "/etc" })],
		["an empty question", query("")],
		["a question over 2000 characters", query("あ".repeat(2_001))],
		["topK above 20", query("質問", { topK: 21 })],
		["minSimilarity above 1", query("質問", { minSimilarity: 1.5 })],
		["an unknown method", query("質問", { methods: { magic: true } })],
		["an unknown model", query("質問", {}, { modelId: "not-a-model" })],
	])("answers 400 invalid-request for %s", async (_, body) => {
		await installPlatform();

		const response = await POST(post(body));

		expect(response.status).toBe(400);
		expect((await errorOf(response)).code).toBe("invalid-request");
		expect(languageModelCalls).toBe(0);
	});

	it("rate-limits only in live mode, after the other checks", async () => {
		await ingestCorpus();
		await installPlatform(LIVE_ENV, () => ({}));

		const rejected = await POST(post(query("", {})));
		expect(rejected.status).toBe(400);
		const second = await POST(post(query("質問")));
		const third = await POST(post(query("質問")));

		expect(second.status).not.toBe(429);
		expect(third.status).toBe(429);
		expect((await errorOf(third)).code).toBe("rate-limited");
	});

	it("does not rate-limit in mock mode", async () => {
		await installPlatform({ ...MOCK_ENV, CHAT_RATE_LIMIT_MAX: "1" });

		const statuses = [];
		for (let index = 0; index < 3; index += 1) {
			statuses.push((await POST(post(query("質問")))).status);
		}

		expect(statuses).toEqual([200, 200, 200]);
	});

	it("answers 400 capability-unsupported before any model call when HyDE needs structured output", async () => {
		await ingestCorpus();
		await installPlatform(MOCK_ENV, (platform) => ({
			gateway: {
				...countModelCalls(platform),
				resolve: async (request: { purpose: string; require?: readonly string[] }) => {
					// A model without structured output: only requests that require it are refused.
					if (request.require?.includes("structuredOutput")) {
						throw new CapabilityUnsupportedError(
							"structuredOutput",
							"mock:general-v1",
							"Deterministic Mock Model",
						);
					}
					return countModelCalls(platform).resolve(request as never);
				},
			},
		}));

		const hyde = await POST(post(query("質問", { methods: { ...NO_METHODS, hyde: true } })));
		const multi = await POST(post(query("質問", { methods: { ...NO_METHODS, multiQuery: true } })));
		const plain = await POST(post(query("質問")));

		expect(hyde.status).toBe(400);
		expect((await errorOf(hyde)).code).toBe("capability-unsupported");
		expect(multi.status).toBe(400);
		expect((await errorOf(multi)).code).toBe("capability-unsupported");
		expect(languageModelCalls).toBe(0);
		// the plain (naive) query does not need structured output
		expect(plain.status).toBe(200);
	});

	it("answers 400 invalid-request naming AI_MODEL_EMBEDDING when no embedding model is configured", async () => {
		await installPlatform(MOCK_ENV, (platform) => ({
			gateway: {
				...countModelCalls(platform),
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

		const response = await POST(post(query("質問")));

		expect(response.status).toBe(400);
		const error = await errorOf(response);
		expect(error.code).toBe("invalid-request");
		expect(error.message).toContain("AI_MODEL_EMBEDDING");
		expect(languageModelCalls).toBe(0);
	});

	it("answers 503 provider-unavailable when the knowledge base cannot be reached", async () => {
		await installPlatform();
		vi.mocked(getKnowledgeBase).mockRejectedValueOnce(
			new KnowledgeBaseUnavailableError("Postgres に接続できません。"),
		);

		const response = await POST(post(query("質問")));

		expect(response.status).toBe(503);
		expect((await errorOf(response)).code).toBe("provider-unavailable");
	});
});

describe("POST /api/rag/query: the stream", () => {
	it("streams stages, the trace, the answer text and the result with its citations", async () => {
		await ingestCorpus();
		await installPlatform();

		const response = await POST(post(query(M2_1_SAMPLE_QUESTIONS.answer, { topK: 3 })));
		const parts = await partsOf(response);

		expect(response.status).toBe(200);
		const types = parts.map((part) => part.type);
		const lastTrace = types.lastIndexOf("data-rag-trace");
		expect(
			types
				.slice(0, lastTrace)
				.every((type) => ["start", "data-rag-stage", "data-rag-trace"].includes(type)),
		).toBe(true);
		// intermediate results arrive as retrieval proceeds: several traces under the one id
		expect(types.filter((type) => type === "data-rag-trace").length).toBeGreaterThanOrEqual(2);
		expect(
			parts.filter((part) => part.type === "data-rag-trace").every((part) => part.id === "trace"),
		).toBe(true);
		expect(types.indexOf("text-start")).toBeGreaterThan(lastTrace);
		expect(types.indexOf("text-end")).toBeLessThan(types.indexOf("data-rag-result"));
		const stageIds = parts.filter((part) => part.type === "data-rag-stage").map((part) => part.id);
		expect(stageIds).toContain("stage-vector-search");
		expect(stageIds).toContain("stage-generate");

		const result = resultOf(parts);
		expect(result.noEvidence).toBe(false);
		expect(result.answer).toContain("[1]");
		expect(result.citations[0]).toMatchObject({ label: 1, cited: true });
		expect(result.citations[0]?.excerpt).toContain("RAG");
		const text = parts
			.filter((part) => part.type === "text-delta")
			.map((part) => part.delta)
			.join("");
		expect(text).toContain("RAG は");
	});

	it("removes a footnote outside the retrieved range and reports it", async () => {
		await ingestCorpus();
		await installPlatform();

		const parts = await partsOf(await POST(post(query(M2_1_SAMPLE_QUESTIONS.outOfRange))));

		const result = resultOf(parts);
		expect(result.removedCitations).toEqual([9]);
		expect(result.answer).not.toContain("[9]");
		expect(result.answer).toContain("[1]");
	});

	it("answers 'no evidence' without calling a language model when nothing reaches the threshold", async () => {
		await ingestCorpus();
		await installPlatform();

		const parts = await partsOf(await POST(post(query("今日の天気はどうですか。"))));

		const result = resultOf(parts);
		expect(result.noEvidence).toBe(true);
		expect(result.answer).toBe(NO_EVIDENCE_MESSAGE);
		expect(result.citations).toEqual([]);
		expect(languageModelCalls).toBe(0);
	});

	it("answers 'no evidence' for an empty knowledge base", async () => {
		await installPlatform();

		const parts = await partsOf(await POST(post(query(M2_1_SAMPLE_QUESTIONS.answer))));

		expect(resultOf(parts).noEvidence).toBe(true);
		expect(languageModelCalls).toBe(0);
	});

	it("searches with the hypothetical answer when HyDE is on, and records it in the trace", async () => {
		await ingestCorpus();
		await installPlatform();

		const parts = await partsOf(
			await POST(
				post(query(M2_1_SAMPLE_QUESTIONS.hyde, { methods: { ...NO_METHODS, hyde: true } })),
			),
		);

		const trace = traceOf(parts);
		expect(trace.hypotheticalAnswer).toBe(M2_CORPUS_TEXT.whyRag);
		const result = resultOf(parts);
		expect(result.noEvidence).toBe(false);
		expect(result.citations[0]?.excerpt).toContain("言語モデルの知識は学習時点で固定");
	});

	it("without HyDE the same question finds nothing (the mock embedding has no sense of meaning)", async () => {
		await ingestCorpus();
		await installPlatform();

		const parts = await partsOf(await POST(post(query(M2_1_SAMPLE_QUESTIONS.hyde))));

		expect(resultOf(parts).noEvidence).toBe(true);
	});

	it("searches with three sub-queries when Multi-Query is on", async () => {
		await ingestCorpus();
		await installPlatform();

		const parts = await partsOf(
			await POST(
				post(
					query(M2_1_SAMPLE_QUESTIONS.multiQuery, {
						topK: 5,
						methods: { ...NO_METHODS, multiQuery: true },
					}),
				),
			),
		);

		const trace = traceOf(parts);
		expect(trace.subQueries).toEqual([
			M2_CORPUS_TEXT.hybridOverview,
			M2_CORPUS_TEXT.scoreScales,
			M2_CORPUS_TEXT.rrf,
		]);
		expect(trace.vector).toHaveLength(3);
		expect(resultOf(parts).citations.length).toBeGreaterThanOrEqual(3);
	});

	it("uses the pseudo Rerank in mock mode and reports it as applied", async () => {
		await ingestCorpus();
		await installPlatform();

		const parts = await partsOf(
			await POST(
				post(query(M2_1_SAMPLE_QUESTIONS.answer, { methods: { ...NO_METHODS, rerank: true } })),
			),
		);

		expect(resultOf(parts).rerank).toEqual({ status: "applied" });
	});

	it("records a skipped Rerank stage in the result when no provider is configured", async () => {
		await ingestCorpus();
		await installPlatform(MOCK_ENV, (platform) => ({
			ports: { ...platform.ports, rerank: undefined },
		}));

		const parts = await partsOf(
			await POST(
				post(query(M2_1_SAMPLE_QUESTIONS.answer, { methods: { ...NO_METHODS, rerank: true } })),
			),
		);

		const result = resultOf(parts);
		expect(result.rerank).toEqual({ status: "skipped", reason: "api-key-missing" });
		expect(result.citations.length).toBeGreaterThan(0);
	});

	it("starts no model call and sends no result when the request is already aborted", async () => {
		await ingestCorpus();
		await installPlatform();
		const controller = new AbortController();
		controller.abort();

		const response = await POST(
			post(query(M2_1_SAMPLE_QUESTIONS.answer), { signal: controller.signal }),
		);
		const parts = await partsOf(response);

		expect(parts.some((part) => part.type === "data-rag-result")).toBe(false);
		expect(languageModelCalls).toBe(0);
	});

	it("sends a fixed error part, without internals, when the answer model fails", async () => {
		await ingestCorpus();
		await installPlatform(MOCK_ENV, (platform) => ({
			gateway: {
				...countModelCalls(platform),
				resolve: async (request: { purpose: string }) => {
					const resolved = await platform.gateway.resolve(request as never);
					if (request.purpose !== "chat") return resolved;
					const failing = Object.create(resolved.model) as typeof resolved.model;
					failing.doStream = async () => {
						throw new Error("upstream said: key sk-secret-999 rejected");
					};
					return { ...resolved, model: failing };
				},
			},
		}));

		const response = await POST(post(query(M2_1_SAMPLE_QUESTIONS.answer)));
		const parts = await partsOf(response);

		const error = parts.find((part) => part.type === "error");
		expect(error?.errorText).toBeDefined();
		expect(error?.errorText).not.toContain("sk-secret-999");
		expect(JSON.parse(error?.errorText ?? "{}").code).toBe("provider-unavailable");
		expect(parts.some((part) => part.type === "data-rag-result")).toBe(false);
	});

	it("resolves the chat model, and the structured model when needed, with the requested modelId", async () => {
		await ingestCorpus();
		const requests: { purpose: string; modelId?: string }[] = [];
		await installPlatform(MOCK_ENV, (platform) => ({
			gateway: {
				...countModelCalls(platform),
				resolve: async (request: { purpose: string; modelId?: string }) => {
					requests.push(request);
					return countModelCalls(platform).resolve(request as never);
				},
			},
		}));

		await partsOf(
			await POST(
				post(
					query("質問", { methods: { ...NO_METHODS, hyde: true } }, { modelId: "mock:judge-v1" }),
				),
			),
		);

		expect(requests.map((request) => [request.purpose, request.modelId])).toEqual([
			["chat", "mock:judge-v1"],
			["structured", "mock:judge-v1"],
		]);
	});
});

describe("POST /api/rag/query: generated SSE fixtures used by the E2E specs", () => {
	it("matches the generated SSE fixture of an answer with stages, trace and citations (Req 1.17)", async () => {
		await ingestCorpus();
		await installPlatform();

		const response = await POST(
			post(
				query(M2_1_SAMPLE_QUESTIONS.answer, {
					methods: { ...NO_METHODS, hybrid: true, rerank: true },
				}),
			),
		);

		expect(response.status).toBe(200);
		verifyOrWriteFixture("rag-query.sse", await response.text());
	});

	it("matches the generated SSE fixture of a no-evidence answer from an empty knowledge base (Req 1.17)", async () => {
		await installPlatform();

		const response = await POST(post(query("存在しない話題について教えてください。")));

		expect(response.status).toBe(200);
		verifyOrWriteFixture("rag-query-no-evidence.sse", await response.text());
	});
});
