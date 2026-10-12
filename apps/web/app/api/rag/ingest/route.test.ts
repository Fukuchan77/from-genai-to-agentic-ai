import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDeterministicEmbeddingModel } from "@platform/ai-core/mock";
import {
	getModelEntry,
	MODEL_DEFAULTS,
	ModelSelectionError,
	type ResolvedEmbeddingModel,
} from "@platform/ai-core/models";
import {
	createKnowledgeStore,
	createPgliteDatabase,
	KnowledgeBaseUnavailableError,
	type RagDatabaseHandle,
} from "@platform/ai-core/rag";
import { buildTextPdf, createFakeClock } from "@platform/ai-core/testing";
import { APICallError } from "ai";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createPlatform, getKnowledgeBase, setPlatformForTesting } from "@/lib/server/platform";
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
const INGESTED_AT = Date.parse("2026-10-12T00:00:00.000Z");
const GUIDE = "# 手引き\n\n本文です。\n\n## 検索\n\nベクトル検索を使います。";

let handle: RagDatabaseHandle;
let knowledgeDir: string;
let corpusDir: string;
let embeddingCalls: number;

function mockEmbedding(model = createDeterministicEmbeddingModel({ dimensions: 768 })) {
	const counting = {
		...model,
		doEmbed: async (options: Parameters<typeof model.doEmbed>[0]) => {
			embeddingCalls += 1;
			return model.doEmbed(options);
		},
	};
	return {
		model: counting,
		entry: getModelEntry("mock:embedding-v1"),
		mode: "mock",
	} satisfies ResolvedEmbeddingModel;
}

async function installPlatform(
	env: Record<string, string> = MOCK_ENV,
	embedding: () => Promise<ResolvedEmbeddingModel> = async () => mockEmbedding(),
) {
	const platform = await createPlatform({
		env,
		clock: createFakeClock(INGESTED_AT),
		knowledgeRoots: { knowledge: knowledgeDir, evalCorpus: corpusDir },
	});
	setPlatformForTesting({
		...platform,
		gateway: { ...platform.gateway, resolveEmbedding: embedding } as never,
	});
}

function post(body: unknown, init: RequestInit = {}): Request {
	return new Request("http://localhost/api/rag/ingest", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: typeof body === "string" ? body : JSON.stringify(body),
		...init,
	});
}

async function errorOf(response: Response) {
	return (await response.json()).error as {
		code: string;
		message: string;
		details?: { reason?: string };
	};
}

beforeAll(async () => {
	handle = await createPgliteDatabase();
});

afterAll(async () => {
	await handle.close();
});

beforeEach(async () => {
	embeddingCalls = 0;
	vi.mocked(getKnowledgeBase).mockImplementation(async () => handle);
	knowledgeDir = await mkdtemp(path.join(tmpdir(), "rag-ingest-knowledge-"));
	corpusDir = await mkdtemp(path.join(tmpdir(), "rag-ingest-corpus-"));
	await createKnowledgeStore(handle.db).reset();
});

afterEach(async () => {
	setPlatformForTesting(undefined);
	await rm(knowledgeDir, { recursive: true, force: true });
	await rm(corpusDir, { recursive: true, force: true });
});

describe("POST /api/rag/ingest", () => {
	it("ingests the named files and returns the IngestResult", async () => {
		await writeFile(path.join(knowledgeDir, "guide.md"), GUIDE);
		await installPlatform();

		const response = await POST(post({ source: "knowledge", files: ["guide.md"], tags: ["rag"] }));

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			ingested: [{ documentId: "kb:guide.md", title: "手引き", chunks: 2 }],
			skipped: [],
			embeddingModelId: "mock:embedding-v1",
		});
		const documents = await createKnowledgeStore(handle.db).listDocuments();
		expect(documents.map((document) => [document.id, document.tags, document.ingestedAt])).toEqual([
			["kb:guide.md", ["rag"], "2026-10-12T00:00:00.000Z"],
		]);
	});

	it("ingests the evaluation corpus under the eval: prefix", async () => {
		await writeFile(path.join(corpusDir, "01-overview.md"), GUIDE);
		await installPlatform();

		const body = await (
			await POST(post({ source: "eval-corpus", files: ["01-overview.md"] }))
		).json();

		expect(body.ingested[0].documentId).toBe("eval:01-overview.md");
	});

	it("ingests every supported file of the directory when files is omitted", async () => {
		await writeFile(path.join(knowledgeDir, "b.md"), "# B\n\n本文");
		await writeFile(path.join(knowledgeDir, "a.pdf"), buildTextPdf(["page text"]));
		await writeFile(path.join(knowledgeDir, "README.md"), "# readme");
		await writeFile(path.join(knowledgeDir, "notes.txt"), "ignored");
		await installPlatform();

		const body = await (await POST(post({ source: "knowledge" }))).json();

		expect(body.ingested.map((entry: { documentId: string }) => entry.documentId)).toEqual([
			"kb:a.pdf",
			"kb:b.md",
		]);
		expect(body.skipped).toEqual([]);
	});

	it("reports unsupported, empty, oversized and missing files in skipped instead of rejecting", async () => {
		await writeFile(path.join(knowledgeDir, "good.md"), GUIDE);
		await writeFile(path.join(knowledgeDir, "notes.txt"), "plain");
		await writeFile(path.join(knowledgeDir, "scan.pdf"), buildTextPdf([""]));
		await installPlatform();

		const response = await POST(
			post({ source: "knowledge", files: ["good.md", "notes.txt", "scan.pdf", "absent.md"] }),
		);
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.ingested).toHaveLength(1);
		expect(body.skipped).toEqual([
			{ file: "notes.txt", reason: "unsupported-format" },
			{ file: "scan.pdf", reason: "no-text" },
			{ file: "absent.md", reason: "not-found" },
		]);
	});

	describe("rejections before any embedding call", () => {
		it("answers 413 for an oversized body", async () => {
			await installPlatform();
			const huge = { source: "knowledge", files: ["a.md"], tags: ["x".repeat(600_000)] };

			const response = await POST(post(huge));

			expect(response.status).toBe(413);
			expect((await errorOf(response)).code).toBe("payload-too-large");
			expect(embeddingCalls).toBe(0);
		});

		it.each([
			["invalid JSON", "{not json"],
			["an unknown field", { source: "knowledge", root: "/etc" }],
			["an unknown source", { source: "uploads" }],
			["a path-traversing file name", { source: "knowledge", files: ["../secret.md"] }],
			["a nested file name", { source: "knowledge", files: ["sub/doc.md"] }],
			["a hidden file name", { source: "knowledge", files: [".env"] }],
			[
				"too many files",
				{ source: "knowledge", files: Array.from({ length: 51 }, (_, i) => `f${i}.md`) },
			],
			[
				"too many tags",
				{ source: "knowledge", tags: Array.from({ length: 11 }, (_, i) => `t${i}`) },
			],
			["a long tag", { source: "knowledge", tags: ["x".repeat(41)] }],
		])("answers 400 invalid-request for %s", async (_, body) => {
			await installPlatform();

			const response = await POST(post(body));

			expect(response.status).toBe(400);
			expect((await errorOf(response)).code).toBe("invalid-request");
			expect(embeddingCalls).toBe(0);
		});

		it("answers 400 invalid-request for a symlink that leaves the knowledge directory", async () => {
			const outside = await mkdtemp(path.join(tmpdir(), "rag-outside-"));
			try {
				await writeFile(path.join(outside, "secret.md"), "# 秘密\n\n本文");
				await symlink(path.join(outside, "secret.md"), path.join(knowledgeDir, "link.md"));
				await installPlatform();

				const response = await POST(post({ source: "knowledge", files: ["link.md"] }));

				expect(response.status).toBe(400);
				expect((await errorOf(response)).code).toBe("invalid-request");
				expect(await createKnowledgeStore(handle.db).listDocuments()).toEqual([]);
			} finally {
				await rm(outside, { recursive: true, force: true });
			}
		});

		it("rate-limits only in live mode, after the other checks and without consuming quota on a rejection", async () => {
			await writeFile(path.join(knowledgeDir, "guide.md"), GUIDE);
			await installPlatform(LIVE_ENV);

			const rejected = await POST(post({ source: "knowledge", root: "/etc" }));
			const first = await POST(post({ source: "knowledge", files: ["guide.md"] }));
			const second = await POST(post({ source: "knowledge", files: ["guide.md"] }));

			expect(rejected.status).toBe(400);
			expect(first.status).toBe(200);
			expect(second.status).toBe(429);
			expect((await errorOf(second)).code).toBe("rate-limited");
		});

		it("does not rate-limit in mock mode", async () => {
			await writeFile(path.join(knowledgeDir, "guide.md"), GUIDE);
			await installPlatform({ ...MOCK_ENV, CHAT_RATE_LIMIT_MAX: "1" });

			const statuses = [];
			for (let i = 0; i < 3; i += 1) {
				statuses.push((await POST(post({ source: "knowledge", files: ["guide.md"] }))).status);
			}

			expect(statuses).toEqual([200, 200, 200]);
		});
	});

	describe("embedding and knowledge base errors", () => {
		it("answers 400 with reset guidance when the embedding model differs from the base's", async () => {
			await writeFile(path.join(knowledgeDir, "guide.md"), GUIDE);
			await installPlatform();
			await POST(post({ source: "knowledge", files: ["guide.md"] }));
			await installPlatform(MOCK_ENV, async () => ({
				...mockEmbedding(),
				entry: getModelEntry(MODEL_DEFAULTS.local.ollama.embedding),
			}));

			const response = await POST(post({ source: "knowledge", files: ["guide.md"] }));
			const error = await errorOf(response);

			expect(response.status).toBe(400);
			expect(error.code).toBe("invalid-request");
			expect(error.message).toContain("reset");
			expect(error.details).toEqual({ reason: "embedding-model-changed" });
			expect(error.message).toContain("mock:embedding-v1");
		});

		it("rebuilds the base with reset: true and another embedding model", async () => {
			await writeFile(path.join(knowledgeDir, "guide.md"), GUIDE);
			await installPlatform();
			await POST(post({ source: "knowledge", files: ["guide.md"] }));
			await installPlatform(MOCK_ENV, async () => ({
				...mockEmbedding(),
				entry: getModelEntry(MODEL_DEFAULTS.local.ollama.embedding),
			}));

			const response = await POST(post({ source: "knowledge", files: ["guide.md"], reset: true }));

			expect(response.status).toBe(200);
			expect((await response.json()).embeddingModelId).toBe(MODEL_DEFAULTS.local.ollama.embedding);
		});

		it("answers 502 output-invalid when the embedding is not 768-dimensional", async () => {
			await writeFile(path.join(knowledgeDir, "guide.md"), GUIDE);
			await installPlatform(MOCK_ENV, async () =>
				mockEmbedding(createDeterministicEmbeddingModel({ dimensions: 16 })),
			);

			const response = await POST(post({ source: "knowledge", files: ["guide.md"] }));

			expect(response.status).toBe(502);
			expect((await errorOf(response)).code).toBe("output-invalid");
			expect(await createKnowledgeStore(handle.db).listDocuments()).toEqual([]);
		});

		it("explains AI_MODEL_EMBEDDING when the provider has no embedding model", async () => {
			await installPlatform(MOCK_ENV, async () => {
				throw new ModelSelectionError({
					reason: "no-default",
					mode: "live",
					provider: "anthropic",
					purpose: "embedding",
				});
			});

			const response = await POST(post({ source: "knowledge" }));
			const error = await errorOf(response);

			expect(response.status).toBe(400);
			expect(error.code).toBe("invalid-request");
			expect(error.message).toContain("AI_MODEL_EMBEDDING");
			expect(error.message).toMatch(/API キー/);
		});

		it("answers 503 with start-up guidance when Postgres is unreachable", async () => {
			await installPlatform();
			vi.mocked(getKnowledgeBase).mockRejectedValueOnce(new KnowledgeBaseUnavailableError());

			const response = await POST(post({ source: "knowledge" }));
			const error = await errorOf(response);

			expect(response.status).toBe(503);
			expect(error.code).toBe("provider-unavailable");
			expect(error.message).toContain("mise run services:up:db");
		});

		it("turns an embedding provider failure into 503 without echoing provider details", async () => {
			await writeFile(path.join(knowledgeDir, "guide.md"), GUIDE);
			await installPlatform(MOCK_ENV, async () => {
				const failing = mockEmbedding();
				return {
					...failing,
					model: {
						...failing.model,
						doEmbed: async () => {
							throw new APICallError({
								message: "401 invalid api key sk-secret-value",
								url: "https://api.example.test/v1/embeddings",
								requestBodyValues: { input: "本文" },
								statusCode: 401,
							});
						},
					},
				};
			});

			const response = await POST(post({ source: "knowledge", files: ["guide.md"] }));
			const text = await response.text();

			expect(response.status).toBe(503);
			expect(JSON.parse(text).error.code).toBe("provider-unavailable");
			expect(text).not.toMatch(/sk-secret-value|api\.example\.test/);
		});

		it("does not turn a programming error into a provider failure", async () => {
			await installPlatform(MOCK_ENV, async () => {
				throw new TypeError("undefined is not a function");
			});

			const response = await POST(post({ source: "knowledge" }));

			expect(response.status).toBe(500);
			expect((await errorOf(response)).code).toBe("unexpected");
		});
	});

	describe("cancellation", () => {
		it("passes request.signal through: an aborted request embeds nothing and writes nothing", async () => {
			await writeFile(path.join(knowledgeDir, "guide.md"), GUIDE);
			await installPlatform();
			const controller = new AbortController();
			controller.abort(new DOMException("stop", "AbortError"));

			await POST(post({ source: "knowledge", files: ["guide.md"] }, { signal: controller.signal }));

			expect(embeddingCalls).toBe(0);
			expect(await createKnowledgeStore(handle.db).listDocuments()).toEqual([]);
		});
	});
});
