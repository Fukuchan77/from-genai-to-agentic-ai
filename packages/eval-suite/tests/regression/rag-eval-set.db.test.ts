// Regression (plan C16, Req 2.9, 2.12): the plumbing behind the RAG retrieval evaluation. The
// evaluation corpus is ingested into a throwaway in-memory PGlite, never into the running
// knowledge base. With the deterministic `mock` embedding the question text `=` the chunk body, so
// every gold chunk must come back first. This proves the dataset and the retrieval harness are
// wired correctly; it says nothing about which retrieval method is better (only the `local`
// capability evaluation can, see `tests/capability/rag-retrieval.local.test.ts`).
import path from "node:path";
import { createDeterministicEmbeddingModel } from "@platform/ai-core/mock";
import { getModelEntry } from "@platform/ai-core/models";
import {
	compareMethods,
	createKnowledgeStore,
	createPgliteDatabase,
	type EvalQuestion,
	ingestDocuments,
	KNOWLEDGE_BASE_DIMENSIONS,
	type KnowledgeChunk,
	type KnowledgeStore,
	listIngestableFiles,
	loadEvalSet,
	MIN_EVAL_QUESTIONS,
	type RagDatabaseHandle,
	runRetrieval,
} from "@platform/ai-core/rag";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RAG_FIXTURES = path.resolve(import.meta.dirname, "../../../ai-core/fixtures/rag");
const CORPUS_ROOT = path.join(RAG_FIXTURES, "corpus");
const EVAL_SET_PATH = path.join(RAG_FIXTURES, "eval-set.json");

const embedding = {
	mode: "mock",
	entry: getModelEntry("mock:embedding-v1"),
	model: createDeterministicEmbeddingModel({ dimensions: KNOWLEDGE_BASE_DIMENSIONS }),
} as const;

/** PGlite start-up plus ingesting the corpus: about 2 s alone, several times that on a loaded machine. */
const SETUP_TIMEOUT_MS = 90_000;

let handle: RagDatabaseHandle | undefined;
let store: KnowledgeStore;
let questions: readonly EvalQuestion[];
let chunksById: Map<string, KnowledgeChunk>;

beforeAll(async () => {
	const created = await createPgliteDatabase();
	handle = created;
	store = createKnowledgeStore(created.db);
	const files = await listIngestableFiles(CORPUS_ROOT);
	const result = await ingestDocuments({
		db: created.db,
		embedding,
		source: "eval-corpus",
		root: CORPUS_ROOT,
		files,
	});
	expect(result.skipped).toEqual([]);
	questions = await loadEvalSet(EVAL_SET_PATH);
	const goldIds = [...new Set(questions.flatMap((entry) => entry.goldChunkIds))];
	chunksById = new Map((await store.getChunks(goldIds)).map((chunk) => [chunk.id, chunk]));
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
	await handle?.close();
});

describe("the labelled RAG question set", () => {
	it("has at least the minimum number of questions", () => {
		expect(questions.length).toBeGreaterThanOrEqual(MIN_EVAL_QUESTIONS);
	});

	it("only labels chunk IDs that exist in the ingested evaluation corpus", () => {
		const missing = questions.flatMap((entry) =>
			entry.goldChunkIds.filter((id) => !chunksById.has(id)).map((id) => `${entry.id}: ${id}`),
		);
		expect(missing).toEqual([]);
	});

	it("labels chunks of the eval: documents only, never the learner's kb: documents", () => {
		for (const chunk of chunksById.values()) {
			expect(chunk.documentId.startsWith("eval:"), chunk.id).toBe(true);
		}
	});
});

describe("the retrieval harness with the deterministic mock embedding", () => {
	it(
		"returns every gold chunk first through compareMethods when the question is the chunk body (recall@1 = 1.0)",
		async () => {
			// One question per gold chunk, worded as the chunk body: the harness the `local` comparison
			// uses (`compareMethods`) must score each of them as found at rank 1.
			const bodyQuestions = questions.flatMap((entry) =>
				entry.goldChunkIds.map((goldId) => {
					const gold = chunksById.get(goldId);
					if (!gold) throw new Error(`${entry.id}: gold chunk ${goldId} is missing`);
					return {
						...entry,
						id: `${entry.id}/${goldId}`,
						question: gold.body,
						goldChunkIds: [goldId],
					};
				}),
			);
			const noEvidenceIds: string[] = [];
			const comparison = await compareMethods(
				bodyQuestions,
				async (item, methods) => {
					const { chunks, noEvidence } = await runRetrieval({
						question: item.question,
						settings: { topK: 1, minSimilarity: 0.5, pool: 20, methods },
						deps: { store, embedding, structuredModel: undefined as never, rerank: undefined },
					});
					if (noEvidence) noEvidenceIds.push(item.id);
					return chunks.map((hit) => hit.chunk.id);
				},
				{
					combinations: [
						{
							label: "naive",
							methods: { hyde: false, multiQuery: false, hybrid: false, rerank: false },
						},
					],
					k: 1,
				},
			);
			expect(noEvidenceIds).toEqual([]);
			const [naive] = comparison.combinations;
			expect(naive?.perQuestion).toHaveLength(bodyQuestions.length);
			expect(bodyQuestions.length).toBeGreaterThanOrEqual(questions.length);
			expect(naive?.perQuestion.filter((result) => result.recall !== 1)).toEqual([]);
			expect(naive?.meanRecall).toBe(1);
		},
		SETUP_TIMEOUT_MS,
	);
});
