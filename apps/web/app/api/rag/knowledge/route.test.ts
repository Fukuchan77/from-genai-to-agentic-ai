import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	getModelEntry,
	MODEL_DEFAULTS,
	ModelSelectionError,
	OllamaUnavailableError,
} from "@platform/ai-core/models";
import {
	createKnowledgeStore,
	createPgliteDatabase,
	ingestDocuments,
	KnowledgeBaseUnavailableError,
	type RagDatabaseHandle,
} from "@platform/ai-core/rag";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createPlatform,
	getKnowledgeBase,
	type Platform,
	setPlatformForTesting,
} from "@/lib/server/platform";
import { GET } from "./route";

vi.mock("@/lib/server/platform", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/server/platform")>();
	return { ...original, getKnowledgeBase: vi.fn(original.getKnowledgeBase) };
});

const MOCK_ENV = { VITEST: "1", AI_TEST_RUN_MODE: "mock" } as const;
const LOCAL_ENV = { VITEST: "1", AI_TEST_RUN_MODE: "local" } as const;

let handle: RagDatabaseHandle;
let knowledgeDir: string;
let corpusDir: string;

async function platformWith(env: Record<string, string>, overrides: Partial<Platform> = {}) {
	const platform = await createPlatform({
		env,
		knowledgeRoots: { knowledge: knowledgeDir, evalCorpus: corpusDir },
	});
	setPlatformForTesting({ ...platform, ...overrides });
	return platform;
}

beforeAll(async () => {
	handle = await createPgliteDatabase();
});

afterAll(async () => {
	await handle.close();
});

beforeEach(async () => {
	vi.mocked(getKnowledgeBase).mockImplementation(async () => handle);
	knowledgeDir = await mkdtemp(path.join(tmpdir(), "rag-knowledge-"));
	corpusDir = await mkdtemp(path.join(tmpdir(), "rag-corpus-"));
	await createKnowledgeStore(handle.db).reset();
});

afterEach(async () => {
	setPlatformForTesting(undefined);
	await rm(knowledgeDir, { recursive: true, force: true });
	await rm(corpusDir, { recursive: true, force: true });
});

describe("GET /api/rag/knowledge", () => {
	it("reports an empty knowledge base, the embedding model and the ingestable files", async () => {
		await writeFile(path.join(knowledgeDir, "notes.md"), "# メモ\n\n本文");
		await writeFile(path.join(knowledgeDir, "README.md"), "# readme");
		await writeFile(path.join(knowledgeDir, "scan.txt"), "unsupported");
		await writeFile(path.join(corpusDir, "01-overview.md"), "# 概要\n\n本文");
		await platformWith(MOCK_ENV);

		const response = await GET();

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("application/json");
		expect(await response.json()).toEqual({
			embedding: { modelId: "mock:embedding-v1", dimensions: 768 },
			knowledgeBase: { embeddingModelId: null, documents: [] },
			available: { knowledge: ["notes.md"], evalCorpus: ["01-overview.md"] },
			rerank: { available: true },
		});
	});

	it("lists ingested documents and the embedding model the base was built with", async () => {
		await writeFile(path.join(knowledgeDir, "notes.md"), "# メモ\n\n本文です。");
		const platform = await platformWith(MOCK_ENV);
		const embedding = await platform.gateway.resolveEmbedding();
		await ingestDocuments({
			db: handle.db,
			embedding,
			source: "knowledge",
			root: knowledgeDir,
			files: ["notes.md"],
			tags: ["memo"],
			clock: platform.clock,
		});

		const body = await (await GET()).json();

		expect(body.knowledgeBase.embeddingModelId).toBe("mock:embedding-v1");
		expect(body.knowledgeBase.documents).toEqual([
			expect.objectContaining({
				id: "kb:notes.md",
				title: "メモ",
				sourceType: "markdown",
				tags: ["memo"],
				chunkCount: 1,
				ingestedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
			}),
		]);
	});

	it("answers 503 provider-unavailable with start-up guidance when Postgres is unreachable", async () => {
		await platformWith(LOCAL_ENV, {
			gateway: {
				resolveEmbedding: async () => ({
					entry: getModelEntry(MODEL_DEFAULTS.local.ollama.embedding),
				}),
			} as never,
		});
		vi.mocked(getKnowledgeBase).mockRejectedValueOnce(new KnowledgeBaseUnavailableError());

		const response = await GET();
		const text = await response.text();

		expect(response.status).toBe(503);
		expect(JSON.parse(text).error).toMatchObject({ code: "provider-unavailable" });
		expect(JSON.parse(text).error.message).toContain("mise run services:up:db");
		expect(text).not.toMatch(/stack|ECONNREFUSED|postgres:\/\//);
	});

	it("answers 503 when Ollama cannot serve the embedding model", async () => {
		await platformWith(LOCAL_ENV, {
			gateway: {
				resolveEmbedding: async () => {
					throw new OllamaUnavailableError("http://localhost:11434", "unreachable");
				},
			} as never,
		});

		const response = await GET();

		expect(response.status).toBe(503);
		expect((await response.json()).error.message).toContain("ollama serve");
	});

	it("reports embedding: null when the provider has no embedding model, still listing documents", async () => {
		await writeFile(path.join(knowledgeDir, "notes.md"), "# メモ\n\n本文");
		await platformWith(MOCK_ENV, {
			gateway: {
				resolveEmbedding: async () => {
					throw new ModelSelectionError({
						reason: "no-default",
						mode: "live",
						provider: "anthropic",
						purpose: "embedding",
					});
				},
			} as never,
		});

		const response = await GET();
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.embedding).toBeNull();
		expect(body.available.knowledge).toEqual(["notes.md"]);
	});

	it("does not hide other embedding configuration errors as null", async () => {
		await platformWith(MOCK_ENV, {
			gateway: {
				resolveEmbedding: async () => {
					throw new ModelSelectionError({ reason: "unknown-model", mode: "mock", modelId: "nope" });
				},
			} as never,
		});

		const response = await GET();

		expect(response.status).toBe(400);
	});

	it("derives rerank availability from COHERE_API_KEY outside mock mode, without leaking the key", async () => {
		const stubGateway = {
			resolveEmbedding: async () => ({
				entry: getModelEntry(MODEL_DEFAULTS.local.ollama.embedding),
			}),
		} as never;
		await platformWith(
			{ ...LOCAL_ENV, COHERE_API_KEY: "test-cohere-key" },
			{ gateway: stubGateway },
		);
		const withKey = await GET();
		const withKeyText = await withKey.text();
		await platformWith(LOCAL_ENV, { gateway: stubGateway });
		const withoutKey = await (await GET()).json();

		expect(JSON.parse(withKeyText).rerank).toEqual({ available: true });
		expect(withKeyText).not.toContain("test-cohere-key");
		expect(withoutKey.rerank).toEqual({ available: false, reason: "api-key-missing" });
	});

	it("lists nothing for a directory that does not exist", async () => {
		await platformWith(MOCK_ENV);
		await rm(corpusDir, { recursive: true, force: true });
		await mkdir(path.join(knowledgeDir, "sub.md"));

		const body = await (await GET()).json();

		expect(body.available).toEqual({ knowledge: [], evalCorpus: [] });
	});
});
