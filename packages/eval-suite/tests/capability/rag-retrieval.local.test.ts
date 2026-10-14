// Capability (plan C16, Req 2.9, 2.2): which retrieval method finds the labelled chunks more often,
// measured with real local models (Ollama embeddings and the default local chat model). It runs only under
// `mise run test:local`; everywhere else `describeLocal` reports it as skipped with the reason, so
// the gate never counts it as passed. The corpus is ingested into a throwaway in-memory PGlite,
// never into the running knowledge base.
//
// What the assertions pin is that the pipeline runs to completion for every question and every
// combination. The recall figures and the structured-output compliance rate are observations
// printed as tables: they depend on the model and the corpus, so no ranking of methods is asserted.
import path from "node:path";
import { loadPlatformConfig } from "@platform/ai-core/config";
import {
	createModelGateway,
	type ResolvedEmbeddingModel,
	type ResolvedModel,
} from "@platform/ai-core/models";
import { createCohereRerank, type RerankProvider } from "@platform/ai-core/ports";
import {
	compareMethods,
	createKnowledgeStore,
	createPgliteDatabase,
	type EvalQuestion,
	expandQuery,
	ingestDocuments,
	type KnowledgeStore,
	listIngestableFiles,
	loadEvalSet,
	type MethodCombination,
	type RagDatabaseHandle,
	type RetrievalMethods,
	runRetrieval,
} from "@platform/ai-core/rag";
import { StructuredOutputError } from "@platform/ai-core/structured";
import { describeLocal } from "@platform/ai-core/testing";
import { afterAll, expect } from "vitest";

/**
 * Every question runs through every combination: about 26 minutes for 32 questions alone on an
 * 8.8B model (research.md "M2 実測（W6）"), about an hour when other processes compete for the
 * machine. `RAG_EVAL_QUESTIONS=<n>` shortens it.
 */
const COMPARISON_TIMEOUT_MS = 10_800_000;
const LOCAL_MODEL_TIMEOUT_MS = 3_600_000;
/**
 * `RAG_EVAL_QUESTIONS=<n>` runs only the first `n` questions: a quick check that the evaluation runs
 * end to end. A comparison for the record uses all of them.
 */
function questionLimit(): number | undefined {
	const raw = process.env.RAG_EVAL_QUESTIONS;
	if (raw === undefined || raw === "") return undefined;
	const limit = Number(raw);
	if (!Number.isInteger(limit) || limit < 1) {
		throw new Error(`RAG_EVAL_QUESTIONS must be a positive integer, got "${raw}"`);
	}
	return limit;
}

/** Questions the evaluation corpus cannot answer, to see where their similarity lies (I-8). */
const OUT_OF_SCOPE_QUESTIONS = [
	"明日の東京の天気は何ですか。",
	"カレーライスを美味しく作るコツを教えてください。",
	"サッカーのワールドカップで一番優勝回数が多い国はどこですか。",
	"富士山の標高は何メートルですか。",
	"新幹線で東京から大阪まで何分かかりますか。",
	"猫の健康的な体重の目安を教えてください。",
	"確定申告の期限はいつですか。",
	"ピアノを独学で始めるにはどうすればよいですか。",
] as const;
const TOP_K = 5;
const POOL = 20;
/** Ranking is compared without the "no evidence" threshold; the threshold has its own test. */
const RANKING_MIN_SIMILARITY = 0;
const DEFAULT_THRESHOLD = 0.5;

const RAG_FIXTURES = path.resolve(import.meta.dirname, "../../../ai-core/fixtures/rag");
const CORPUS_ROOT = path.join(RAG_FIXTURES, "corpus");

const OFF: RetrievalMethods = { hyde: false, multiQuery: false, hybrid: false, rerank: false };

interface Harness {
	readonly handle: RagDatabaseHandle;
	readonly store: KnowledgeStore;
	readonly embedding: ResolvedEmbeddingModel;
	readonly structuredModel: ResolvedModel;
	readonly rerank: RerankProvider | undefined;
	readonly questions: readonly EvalQuestion[];
}

let harness: Promise<Harness> | undefined;

/** Built on first use inside a test, so a skipped run never touches Ollama or the database. */
function getHarness(): Promise<Harness> {
	harness ??= (async () => {
		const config = loadPlatformConfig();
		expect(config.mode).toBe("local");
		const gateway = createModelGateway({ config });
		const embedding = await gateway.resolveEmbedding();
		const structuredModel = await gateway.resolve({
			purpose: "structured",
			require: ["structuredOutput"],
		});
		const handle = await createPgliteDatabase();
		const result = await ingestDocuments({
			db: handle.db,
			embedding,
			source: "eval-corpus",
			root: CORPUS_ROOT,
			files: await listIngestableFiles(CORPUS_ROOT),
		});
		expect(result.skipped).toEqual([]);
		return {
			handle,
			store: createKnowledgeStore(handle.db),
			embedding,
			structuredModel,
			rerank: config.credentials.cohere ? createCohereRerank(config.credentials.cohere) : undefined,
			questions: (await loadEvalSet(path.join(RAG_FIXTURES, "eval-set.json"))).slice(
				0,
				questionLimit(),
			),
		};
	})();
	return harness;
}

afterAll(async () => {
	if (harness) await (await harness).handle.close();
});

function percent(value: number): string {
	return `${(value * 100).toFixed(1)}%`;
}

describeLocal("RAG retrieval methods on local models", (it) => {
	it(
		"compares mean recall@k per method combination and runs every question to completion",
		async () => {
			const { store, embedding, structuredModel, rerank, questions } = await getHarness();
			const combinations: MethodCombination<RetrievalMethods>[] = [
				{ label: "naive", methods: OFF },
				{ label: "hybrid", methods: { ...OFF, hybrid: true } },
				{ label: "hyde", methods: { ...OFF, hyde: true } },
				{ label: "multi-query", methods: { ...OFF, multiQuery: true } },
				{
					label: "hyde+multi-query+hybrid",
					methods: { ...OFF, hyde: true, multiQuery: true, hybrid: true },
				},
			];
			if (rerank) {
				combinations.push(
					{ label: "naive+rerank", methods: { ...OFF, rerank: true } },
					{
						label: "all+rerank",
						methods: { hyde: true, multiQuery: true, hybrid: true, rerank: true },
					},
				);
			}

			let structuredFailures = 0;
			const comparison = await compareMethods(
				questions,
				async (item, methods) => {
					try {
						const { chunks } = await runRetrieval({
							question: item.question,
							settings: {
								topK: TOP_K,
								minSimilarity: RANKING_MIN_SIMILARITY,
								pool: POOL,
								methods,
							},
							deps: { store, embedding, structuredModel: structuredModel.model, rerank },
						});
						return chunks.map((hit) => hit.chunk.id);
					} catch (error) {
						// The model never produced a valid structured output: count it, retrieve nothing.
						if (error instanceof StructuredOutputError) {
							structuredFailures += 1;
							return [];
						}
						throw error;
					}
				},
				{ combinations, k: TOP_K },
			);

			const rows = comparison.combinations.map((entry) => ({
				combination: entry.label,
				[`mean recall@${comparison.k}`]: percent(entry.meanRecall),
				[`hit rate@${comparison.k}`]: percent(entry.hitRate),
			}));
			console.table(rows);
			// Which method helped on which question: recall@k per question and combination.
			console.table(
				questions.map((item, index) => ({
					question: item.id,
					...Object.fromEntries(
						comparison.combinations.map((entry) => [
							entry.label,
							percent(entry.perQuestion[index]?.recall ?? 0),
						]),
					),
				})),
			);
			if (!rerank) {
				console.info(
					"Rerank combinations skipped: COHERE_API_KEY is not set (Rerank is optional, Req 2.6).",
				);
			}
			console.info(
				`Questions: ${questions.length}; model: ${structuredModel.entry.id}; embedding: ${embedding.entry.id}; structured-output failures: ${structuredFailures}`,
			);

			expect(comparison.combinations.map((entry) => entry.label)).toEqual(
				combinations.map((entry) => entry.label),
			);
			for (const entry of comparison.combinations) {
				expect(entry.perQuestion, entry.label).toHaveLength(questions.length);
			}
			// Plumbing, not a method ranking: if even plain vector search finds none of the labelled
			// chunks, the corpus, the labels or the embedding model are wired wrongly.
			const naive = comparison.combinations.find((entry) => entry.label === "naive");
			expect(naive?.meanRecall).toBeGreaterThan(0);
		},
		COMPARISON_TIMEOUT_MS,
	);

	it(
		"observes how often the local structured model returns three valid Multi-Query sub-queries (regenerations)",
		async () => {
			const { structuredModel, questions } = await getHarness();
			const attemptCounts: number[] = [];
			let failures = 0;
			for (const item of questions) {
				try {
					const { attempts } = await expandQuery({
						model: structuredModel.model,
						question: item.question,
					});
					attemptCounts.push(attempts);
				} catch (error) {
					if (!(error instanceof StructuredOutputError)) throw error;
					failures += 1;
				}
			}
			const firstTry = attemptCounts.filter((attempts) => attempts === 1).length;
			const regenerated = attemptCounts.filter((attempts) => attempts > 1).length;
			console.table([
				{
					model: structuredModel.entry.id,
					questions: questions.length,
					"valid on first try": `${firstTry} (${percent(firstTry / questions.length)})`,
					"valid after regeneration": regenerated,
					"all attempts invalid": failures,
					"extra attempts": attemptCounts.reduce((sum, attempts) => sum + attempts - 1, 0),
				},
			]);
			// Only completion is asserted: every question ended as a valid result or a typed failure.
			expect(attemptCounts.length + failures).toBe(questions.length);
		},
		LOCAL_MODEL_TIMEOUT_MS,
	);

	it(
		"measures where the top-1 cosine similarity of in-scope and out-of-scope questions lies against the default threshold (I-8)",
		async () => {
			const { store, embedding, questions } = await getHarness();
			async function topSimilarity(question: string): Promise<number> {
				const { chunks } = await runRetrieval({
					question,
					settings: { topK: 1, minSimilarity: RANKING_MIN_SIMILARITY, pool: POOL, methods: OFF },
					deps: { store, embedding, structuredModel: undefined as never, rerank: undefined },
				});
				return chunks[0]?.similarity ?? 0;
			}
			const inScope: number[] = [];
			for (const item of questions) inScope.push(await topSimilarity(item.question));
			const outOfScope: number[] = [];
			for (const question of OUT_OF_SCOPE_QUESTIONS) outOfScope.push(await topSimilarity(question));

			function summarize(label: string, values: readonly number[]) {
				const sorted = [...values].sort((a, b) => a - b);
				// Nearest rank (the upper value when the position falls between two): for n = 8 the median
				// is the 5th value, not the mean of the 4th and 5th.
				const quantile = (fraction: number) =>
					sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))] ?? 0;
				const atOrAbove = values.filter((value) => value >= DEFAULT_THRESHOLD).length;
				return {
					questions: label,
					count: values.length,
					min: sorted[0]?.toFixed(3),
					"p25 (nearest rank)": quantile(0.25).toFixed(3),
					"median (nearest rank)": quantile(0.5).toFixed(3),
					"p75 (nearest rank)": quantile(0.75).toFixed(3),
					max: sorted.at(-1)?.toFixed(3),
					[`top-1 >= ${DEFAULT_THRESHOLD}`]: `${atOrAbove}/${values.length}`,
				};
			}
			console.info(`embedding: ${embedding.entry.id}`);
			console.table([summarize("in scope", inScope), summarize("out of scope", outOfScope)]);

			// Only completion is asserted: whether the two distributions separate is the observation.
			expect(inScope).toHaveLength(questions.length);
			expect(outOfScope).toHaveLength(OUT_OF_SCOPE_QUESTIONS.length);
		},
		LOCAL_MODEL_TIMEOUT_MS,
	);
});
