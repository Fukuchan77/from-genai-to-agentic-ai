import { MockLanguageModelV4 } from "ai/test";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getModelEntry, type ResolvedEmbeddingModel } from "../../models";
import { createFakeClock } from "../../ports/clock";
import type { RerankProvider } from "../../ports/rerank";
import { createObjectModel } from "../../testing";
import { createPgliteDatabase, type RagDatabaseHandle } from "../db";
import { embedTexts, type KnowledgeBaseMeta } from "../embedding";
import { toSearchText } from "../ingest/search-text";
import { createLexicalRerank } from "../lexical-rerank";
import { createKnowledgeStore, type KnowledgeStore } from "../store";
import { type RetrievalDeps, type RunRetrievalParams, runRetrieval } from "./pipeline";
import type { RetrievalSettings, StageEvent } from "./trace";

const MOCK_ENTRY = getModelEntry("mock:embedding-v1");
const META: KnowledgeBaseMeta = { embeddingModelId: "mock:embedding-v1", dimensions: 768 };

let handle: RagDatabaseHandle;
let store: KnowledgeStore;

/** Unit vector along one axis; two different axes have cosine similarity 0. */
function axis(index: number): number[] {
	return Array.from({ length: 768 }, (_, position) => (position === index ? 1 : 0));
}

/**
 * A text-to-vector table. Unknown text maps to an unused axis, so it is unrelated to every
 * stored chunk (similarity 0).
 */
function tableEmbedding(table: Record<string, number[]>): ResolvedEmbeddingModel {
	return {
		mode: "mock",
		entry: MOCK_ENTRY,
		model: {
			specificationVersion: "v4",
			provider: "mock",
			modelId: "table",
			maxEmbeddingsPerCall: Number.POSITIVE_INFINITY,
			supportsParallelCalls: true,
			async doEmbed({ values }) {
				return { embeddings: values.map((value) => table[value] ?? axis(767)), warnings: [] };
			},
		},
	};
}

interface SeedChunk {
	readonly id: string;
	readonly body: string;
	readonly vector: number[];
	readonly document?: string;
	readonly tags?: string[];
}

async function seed(chunks: readonly SeedChunk[]): Promise<void> {
	const documents = new Map<string, SeedChunk[]>();
	for (const chunk of chunks) {
		const key = chunk.document ?? "doc.md";
		documents.set(key, [...(documents.get(key) ?? []), chunk]);
	}
	for (const [name, members] of documents) {
		await store.replaceDocument(
			{ id: `kb:${name}`, title: name, sourceType: "markdown", tags: members[0]?.tags ?? [] },
			members.map((member, ordinal) => ({
				id: member.id,
				ordinal,
				headingPath: ["見出し"],
				page: null,
				body: member.body,
				searchText: toSearchText(member.body),
			})),
			members.map((member) => member.vector),
			META,
		);
	}
}

const BASE_SETTINGS: RetrievalSettings = {
	topK: 3,
	minSimilarity: 0.5,
	pool: 20,
	methods: { hyde: false, multiQuery: false, hybrid: false, rerank: false },
};

function deps(overrides: Partial<RetrievalDeps> = {}): RetrievalDeps {
	return {
		store,
		embedding: tableEmbedding({ 質問A: axis(0) }),
		// The naive pipeline never calls a language model.
		structuredModel: undefined as never,
		rerank: undefined,
		clock: createFakeClock(0),
		...overrides,
	};
}

function run(
	overrides: Omit<Partial<RunRetrievalParams>, "settings"> & {
		settings?: Partial<RetrievalSettings>;
	} = {},
	depOverrides: Partial<RetrievalDeps> = {},
) {
	const { settings, ...rest } = overrides;
	return runRetrieval({
		question: "質問A",
		settings: { ...BASE_SETTINGS, ...settings },
		deps: deps(depOverrides),
		...rest,
	});
}

beforeAll(async () => {
	handle = await createPgliteDatabase();
});

afterAll(async () => {
	await handle.close();
});

beforeEach(async () => {
	await handle.db.execute(sql`TRUNCATE rag_chunks, rag_documents, rag_meta CASCADE`);
	store = createKnowledgeStore(handle.db, { clock: createFakeClock(0) });
});

describe("runRetrieval (naive)", () => {
	it("returns the top k chunks ordered by similarity", async () => {
		const near = (weight: number) => {
			const vector = axis(0).map((value) => value * weight);
			vector[1] = Math.sqrt(1 - weight * weight);
			return vector;
		};
		await seed([
			{ id: "c-low", body: "低い", vector: near(0.6) },
			{ id: "c-top", body: "最上位", vector: near(0.99) },
			{ id: "c-mid", body: "中位", vector: near(0.8) },
			{ id: "c-mid2", body: "中位2", vector: near(0.7) },
		]);
		const result = await run();
		expect(result.chunks.map((row) => row.chunk.id)).toEqual(["c-top", "c-mid", "c-mid2"]);
		expect(result.chunks).toHaveLength(BASE_SETTINGS.topK);
		expect(result.trace.final.map((row) => row.chunk.id)).toEqual(["c-top", "c-mid", "c-mid2"]);
		expect(result.noEvidence).toBe(false);
	});

	it("keeps a chunk whose similarity equals the threshold and drops one just above it", async () => {
		const vector = axis(0).map((value) => value * 0.8);
		vector[1] = 0.6;
		await seed([{ id: "c1", body: "一", vector }]);
		const probe = await run({ settings: { minSimilarity: -1 } });
		const similarity = probe.chunks[0]?.similarity;
		expect(similarity).toBeGreaterThan(0.7);

		const equal = await run({ settings: { minSimilarity: similarity ?? 0 } });
		expect(equal.chunks.map((row) => row.chunk.id)).toEqual(["c1"]);

		const above = await run({ settings: { minSimilarity: (similarity ?? 0) + 1e-6 } });
		expect(above.chunks).toEqual([]);
		expect(above.noEvidence).toBe(true);
	});

	it("reports no evidence when no vector candidate reaches the threshold", async () => {
		await seed([{ id: "c1", body: "無関係", vector: axis(5) }]);
		const result = await run();
		expect(result.chunks).toEqual([]);
		expect(result.noEvidence).toBe(true);
		expect(result.trace.final).toEqual([]);
	});

	it("reports no evidence for an empty knowledge base without calling the embedding model", async () => {
		let embedCalls = 0;
		const embedding = tableEmbedding({});
		const counting: ResolvedEmbeddingModel = {
			...embedding,
			model: {
				...embedding.model,
				async doEmbed(options) {
					embedCalls += 1;
					return embedding.model.doEmbed(options);
				},
			},
		};
		const result = await run({}, { embedding: counting });
		expect(result.chunks).toEqual([]);
		expect(result.noEvidence).toBe(true);
		expect(embedCalls).toBe(0);
	});

	it("rejects a question embedded with another model than the knowledge base's", async () => {
		await seed([{ id: "c1", body: "一", vector: axis(0) }]);
		const other = getModelEntry("mock:embedding-v1");
		const mismatched = tableEmbedding({});
		await expect(
			run({}, { embedding: { ...mismatched, entry: { ...other, id: "other:embedding" } } }),
		).rejects.toMatchObject({ code: "invalid-request" });
	});

	it("restricts the search to the document filter and the tag filter", async () => {
		await seed([
			{ id: "in-a", body: "A", vector: axis(0), document: "a.md", tags: ["alpha"] },
			{ id: "in-b", body: "B", vector: axis(0), document: "b.md", tags: ["beta"] },
		]);
		const byDocument = await run({ settings: { filter: { documentIds: ["kb:b.md"] } } });
		expect(byDocument.chunks.map((row) => row.chunk.id)).toEqual(["in-b"]);
		const byTag = await run({ settings: { filter: { tags: ["alpha"] } } });
		expect(byTag.chunks.map((row) => row.chunk.id)).toEqual(["in-a"]);
		expect(byTag.trace.settings.filter).toEqual({ tags: ["alpha"] });
	});

	it("reports the stage events in order and records the vector candidates", async () => {
		await seed([{ id: "c1", body: "一", vector: axis(0) }]);
		const events: StageEvent[] = [];
		const result = await run({ onStage: (event) => events.push(event) });
		const vectorEvents = events.filter((event) => event.stage === "vector-search");
		expect(vectorEvents.map((event) => event.status)).toEqual(["running", "done"]);
		expect(result.trace.vector).toHaveLength(1);
		expect(result.trace.vector[0]?.query).toBe("質問A");
		expect(result.trace.vector[0]?.candidates.map((row) => row.chunk.id)).toEqual(["c1"]);
		expect(result.trace.fullText).toEqual([]);
		expect(result.trace.rerank).toEqual({ status: "disabled" });
	});

	it("does not start when the signal is already aborted", async () => {
		await seed([{ id: "c1", body: "一", vector: axis(0) }]);
		const controller = new AbortController();
		controller.abort();
		await expect(run({ signal: controller.signal })).rejects.toThrow();
	});

	it("embeds the question exactly once", async () => {
		await seed([{ id: "c1", body: "一", vector: axis(0) }]);
		const seen: string[] = [];
		const base = tableEmbedding({ 質問A: axis(0) });
		const spying: ResolvedEmbeddingModel = {
			...base,
			model: {
				...base.model,
				async doEmbed(options) {
					seen.push(...options.values);
					return base.model.doEmbed(options);
				},
			},
		};
		await run({}, { embedding: spying });
		expect(seen).toEqual(["質問A"]);
		// embedTexts is what ingestion uses; the import keeps the dimension contract visible here.
		expect(await embedTexts({ resolved: base, values: ["質問A"] })).toHaveLength(1);
	});
});

function spyStore(inner: KnowledgeStore) {
	const calls = {
		vector: [] as number[],
		fullText: [] as { query: string | undefined; limit: number }[],
	};
	const spied: KnowledgeStore = {
		...inner,
		searchByVector(searchParams) {
			calls.vector.push(searchParams.limit);
			return inner.searchByVector(searchParams);
		},
		searchByFullText(searchParams) {
			calls.fullText.push({ query: searchParams.query, limit: searchParams.limit });
			return inner.searchByFullText(searchParams);
		},
	};
	return { spied, calls };
}

const HYBRID = { methods: { hyde: false, multiQuery: false, hybrid: true, rerank: false } };

describe("runRetrieval (hybrid)", () => {
	const embedding = () => tableEmbedding({ 全文検索: axis(0) });

	it("merges the vector and full-text candidates into one ranking", async () => {
		await seed([
			{ id: "vec-only", body: "意味が近い文書", vector: axis(0) },
			{ id: "text-only", body: "全文検索の仕組みを説明する", vector: axis(5) },
			{ id: "neither", body: "無関係な話題", vector: axis(6) },
		]);
		const result = await run(
			{ question: "全文検索", settings: HYBRID },
			{ embedding: embedding() },
		);
		expect(result.chunks.map((row) => row.chunk.id).sort()).toEqual(["text-only", "vec-only"]);
		expect(result.trace.vector[0]?.candidates.map((row) => row.chunk.id)).toEqual(["vec-only"]);
		expect(result.trace.fullText[0]?.candidates.map((row) => row.chunk.id)).toEqual(["text-only"]);
		expect(result.trace.fused.map((row) => row.chunk.id).sort()).toEqual(["text-only", "vec-only"]);
	});

	it("returns a chunk found by both searches once, ranked above single hits", async () => {
		await seed([
			{ id: "both", body: "全文検索の文書", vector: axis(0) },
			{ id: "vec-only", body: "別の話", vector: axis(0) },
			{ id: "text-only", body: "全文検索を使う", vector: axis(5) },
		]);
		const result = await run(
			{ question: "全文検索", settings: HYBRID },
			{ embedding: embedding() },
		);
		const ids = result.chunks.map((row) => row.chunk.id);
		expect(ids.filter((id) => id === "both")).toHaveLength(1);
		expect(ids[0]).toBe("both");
		expect(new Set(ids).size).toBe(ids.length);
		// rank 1 in both lists: 1/(60+1) + 1/(60+1)
		expect(result.trace.fused[0]?.score).toBeCloseTo(2 / 61, 10);
	});

	it("matches Japanese text through the segmented search text", async () => {
		await seed([
			{ id: "ja", body: "ベクトル検索と全文検索を組み合わせるハイブリッド検索", vector: axis(0) },
		]);
		const { spied, calls } = spyStore(store);
		const result = await run(
			{ question: "ハイブリッド検索", settings: HYBRID },
			{ store: spied, embedding: tableEmbedding({ ハイブリッド検索: axis(3) }) },
		);
		// the vector search misses (similarity 0), the full-text search hits, and CL-1 still says no evidence
		expect(calls.fullText).toHaveLength(1);
		expect(result.trace.fullText[0]?.candidates.map((row) => row.chunk.id)).toEqual(["ja"]);
	});

	it("says no evidence when only the full-text search hits (CL-1)", async () => {
		await seed([{ id: "text-only", body: "全文検索の説明", vector: axis(5) }]);
		const result = await run(
			{ question: "全文検索", settings: HYBRID },
			{ embedding: embedding() },
		);
		expect(result.trace.fullText[0]?.candidates).toHaveLength(1);
		expect(result.chunks).toEqual([]);
		expect(result.noEvidence).toBe(true);
		expect(result.trace.final).toEqual([]);
	});

	it("does not search full text when the question has no usable words", async () => {
		await seed([{ id: "c1", body: "文書", vector: axis(0) }]);
		const { spied, calls } = spyStore(store);
		const result = await run(
			{ question: "あ", settings: HYBRID },
			{ store: spied, embedding: tableEmbedding({ あ: axis(0) }) },
		);
		expect(calls.fullText).toHaveLength(0);
		expect(result.chunks.map((row) => row.chunk.id)).toEqual(["c1"]);
		expect(result.trace.stages.find((stage) => stage.stage === "full-text-search")?.status).toBe(
			"skipped",
		);
	});

	it("caps both searches at the candidate pool", async () => {
		await seed([{ id: "c1", body: "全文検索", vector: axis(0) }]);
		const { spied, calls } = spyStore(store);
		await run(
			{ question: "全文検索", settings: { ...HYBRID, pool: 7 } },
			{ store: spied, embedding: embedding() },
		);
		expect(calls.vector).toEqual([7]);
		expect(calls.fullText.map((call) => call.limit)).toEqual([7]);
	});

	it("does not search full text when hybrid is off", async () => {
		await seed([{ id: "c1", body: "全文検索", vector: axis(0) }]);
		const { spied, calls } = spyStore(store);
		await run({ question: "全文検索" }, { store: spied, embedding: embedding() });
		expect(calls.fullText).toHaveLength(0);
	});

	it("starts the vector and full-text searches without waiting for each other", async () => {
		await seed([{ id: "c1", body: "全文検索", vector: axis(0) }]);
		let releaseVector: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			releaseVector = resolve;
		});
		let fullTextStartedWhileVectorPending = false;
		const slow: KnowledgeStore = {
			...store,
			async searchByVector(searchParams) {
				await gate;
				return store.searchByVector(searchParams);
			},
			searchByFullText(searchParams) {
				fullTextStartedWhileVectorPending = true;
				releaseVector();
				return store.searchByFullText(searchParams);
			},
		};
		await run({ question: "全文検索", settings: HYBRID }, { store: slow, embedding: embedding() });
		expect(fullTextStartedWhileVectorPending).toBe(true);
	});
});

const NO_USAGE_V4 = {
	inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
	outputTokens: { total: 0, text: 0, reasoning: 0 },
};

/**
 * One model for both query-transform stages: it answers the HyDE prompt with free text and the
 * Multi-Query prompt with JSON, as the structured model does in the real pipeline.
 */
function transformModel(options: {
	hypothetical?: string;
	queries?: readonly string[];
	hydeUsage?: [number, number];
	queriesUsage?: [number, number];
}) {
	const usage = (pair: [number, number] | undefined) =>
		pair
			? {
					inputTokens: { total: pair[0], noCache: pair[0], cacheRead: 0, cacheWrite: 0 },
					outputTokens: { total: pair[1], text: pair[1], reasoning: 0 },
				}
			: NO_USAGE_V4;
	return new MockLanguageModelV4({
		doGenerate: async (callOptions) => {
			const isHyde = JSON.stringify(callOptions.prompt).includes("hypothetical passage");
			return {
				content: [
					{
						type: "text",
						text: isHyde
							? (options.hypothetical ?? "")
							: JSON.stringify({ queries: options.queries ?? [] }),
					},
				],
				finishReason: { unified: "stop", raw: undefined },
				usage: usage(isHyde ? options.hydeUsage : options.queriesUsage),
				warnings: [],
			};
		},
	});
}

const HYDE = { methods: { hyde: true, multiQuery: false, hybrid: false, rerank: false } };
const MULTI = { methods: { hyde: false, multiQuery: true, hybrid: false, rerank: false } };
const HYDE_AND_MULTI = { methods: { hyde: true, multiQuery: true, hybrid: false, rerank: false } };
const SUB_QUERIES = ["観点その一", "観点その二", "観点その三"];

describe("runRetrieval (HyDE and Multi-Query)", () => {
	it("searches with the embedding of the hypothetical answer, not of the question", async () => {
		await seed([{ id: "by-answer", body: "資料", vector: axis(0) }]);
		const result = await run(
			{ settings: HYDE },
			{
				structuredModel: transformModel({ hypothetical: "仮想回答テキスト" }),
				embedding: tableEmbedding({ 質問A: axis(9), 仮想回答テキスト: axis(0) }),
			},
		);
		expect(result.chunks.map((row) => row.chunk.id)).toEqual(["by-answer"]);
		expect(result.trace.hypotheticalAnswer).toBe("仮想回答テキスト");
		expect(result.trace.vector.map((entry) => entry.query)).toEqual(["仮想回答テキスト"]);
	});

	it("reports the hyde stage before the search", async () => {
		await seed([{ id: "c", body: "資料", vector: axis(0) }]);
		const events: StageEvent[] = [];
		await run(
			{ settings: HYDE, onStage: (event) => events.push(event) },
			{
				structuredModel: transformModel({ hypothetical: "仮想回答テキスト" }),
				embedding: tableEmbedding({ 仮想回答テキスト: axis(0) }),
			},
		);
		const order = events.map((event) => `${event.stage}:${event.status}`);
		expect(order.indexOf("hyde:running")).toBeLessThan(order.indexOf("hyde:done"));
		expect(order.indexOf("hyde:done")).toBeLessThan(order.indexOf("vector-search:running"));
	});

	it("runs one search per sub-query and records the sub-queries", async () => {
		await seed([
			{ id: "c1", body: "一", vector: axis(0) },
			{ id: "c2", body: "二", vector: axis(1) },
			{ id: "c3", body: "三", vector: axis(2) },
		]);
		const result = await run(
			{ settings: { ...MULTI, topK: 5 } },
			{
				structuredModel: createObjectModel({ queries: SUB_QUERIES }),
				embedding: tableEmbedding({
					観点その一: axis(0),
					観点その二: axis(1),
					観点その三: axis(2),
				}),
			},
		);
		expect(result.trace.subQueries).toEqual(SUB_QUERIES);
		expect(result.trace.vector.map((entry) => entry.query)).toEqual(SUB_QUERIES);
		expect(result.chunks.map((row) => row.chunk.id).sort()).toEqual(["c1", "c2", "c3"]);
	});

	it("embeds the sub-queries concurrently", async () => {
		await seed([{ id: "c1", body: "一", vector: axis(0) }]);
		const base = tableEmbedding({ 観点その一: axis(0) });
		let active = 0;
		let peak = 0;
		const concurrent: ResolvedEmbeddingModel = {
			...base,
			model: {
				...base.model,
				async doEmbed(options) {
					active += 1;
					peak = Math.max(peak, active);
					await new Promise((resolve) => setTimeout(resolve, 5));
					active -= 1;
					return base.model.doEmbed(options);
				},
			},
		};
		await run(
			{ settings: MULTI },
			{ structuredModel: createObjectModel({ queries: SUB_QUERIES }), embedding: concurrent },
		);
		expect(peak).toBe(SUB_QUERIES.length);
	});

	it("finds evidence when only one sub-query reaches the threshold", async () => {
		await seed([{ id: "c2", body: "二", vector: axis(1) }]);
		const result = await run(
			{ settings: MULTI },
			{
				structuredModel: createObjectModel({ queries: SUB_QUERIES }),
				embedding: tableEmbedding({ 観点その二: axis(1) }),
			},
		);
		expect(result.noEvidence).toBe(false);
		expect(result.chunks.map((row) => row.chunk.id)).toEqual(["c2"]);
	});

	it("says no evidence when no sub-query reaches the threshold", async () => {
		await seed([{ id: "c9", body: "九", vector: axis(9) }]);
		const result = await run(
			{ settings: MULTI },
			{
				structuredModel: createObjectModel({ queries: SUB_QUERIES }),
				embedding: tableEmbedding({}),
			},
		);
		expect(result.noEvidence).toBe(true);
		expect(result.chunks).toEqual([]);
	});

	it("expands the hypothetical answer into sub-queries when both methods are on", async () => {
		await seed([{ id: "c1", body: "一", vector: axis(0) }]);
		const structuredModel = transformModel({
			hypothetical: "仮想回答テキスト",
			queries: SUB_QUERIES,
		});
		const result = await run(
			{ settings: HYDE_AND_MULTI },
			{ structuredModel, embedding: tableEmbedding({ 観点その一: axis(0) }) },
		);
		// the second call (Multi-Query) is given the hypothetical answer, not the original question
		expect(JSON.stringify(structuredModel.doGenerateCalls[1]?.prompt)).toContain(
			"仮想回答テキスト",
		);
		expect(result.trace.hypotheticalAnswer).toBe("仮想回答テキスト");
		expect(result.trace.subQueries).toEqual(SUB_QUERIES);
		expect(result.trace.vector.map((entry) => entry.query)).toEqual(SUB_QUERIES);
	});

	it("adds the token usage of the hypothetical answer and the sub-query generation", async () => {
		await seed([{ id: "c1", body: "一", vector: axis(0) }]);
		const result = await run(
			{ settings: HYDE_AND_MULTI },
			{
				structuredModel: transformModel({
					hypothetical: "仮想回答テキスト",
					queries: SUB_QUERIES,
					hydeUsage: [10, 4],
					queriesUsage: [20, 6],
				}),
				embedding: tableEmbedding({ 観点その一: axis(0) }),
			},
		);
		expect(result.usage.inputTokens).toBe(30);
		expect(result.usage.outputTokens).toBe(10);
	});
});

const RERANK = { methods: { hyde: false, multiQuery: false, hybrid: false, rerank: true } };

/** Three chunks the vector search ranks a, b, c (descending similarity); only c matches the words. */
async function seedForRerank(): Promise<void> {
	const near = (weight: number) => {
		const vector = axis(0).map((value) => value * weight);
		vector[1] = Math.sqrt(1 - weight * weight);
		return vector;
	};
	await seed([
		{ id: "a", body: "天気の話題", vector: near(0.99) },
		{ id: "b", body: "料理のレシピ", vector: near(0.9) },
		{ id: "c", body: "再順位付けは候補を並べ替える", vector: near(0.8) },
	]);
}

describe("runRetrieval (Rerank)", () => {
	const embedding = () => tableEmbedding({ 再順位付けの並べ替え: axis(0) });

	it("reorders the candidates with the Rerank provider and keeps the top k", async () => {
		await seedForRerank();
		const result = await run(
			{ question: "再順位付けの並べ替え", settings: { ...RERANK, topK: 2 } },
			{ embedding: embedding(), rerank: createLexicalRerank() },
		);
		expect(result.trace.fused.map((row) => row.chunk.id)).toEqual(["a", "b", "c"]);
		expect(result.chunks.map((row) => row.chunk.id)[0]).toBe("c");
		expect(result.chunks).toHaveLength(2);
		expect(result.trace.reranked?.map((row) => row.chunk.id)).toEqual(
			result.chunks.map((row) => row.chunk.id),
		);
		expect(result.trace.rerank).toEqual({ status: "applied" });
	});

	it("skips the stage and records api-key-missing when no provider is configured", async () => {
		await seedForRerank();
		const events: StageEvent[] = [];
		const result = await run(
			{
				question: "再順位付けの並べ替え",
				settings: RERANK,
				onStage: (event) => events.push(event),
			},
			{ embedding: embedding(), rerank: undefined },
		);
		expect(result.trace.rerank).toEqual({ status: "skipped", reason: "api-key-missing" });
		expect(result.chunks.map((row) => row.chunk.id)).toEqual(["a", "b", "c"]);
		expect(result.trace.reranked).toBeUndefined();
		expect(events.filter((event) => event.stage === "rerank").map((event) => event.status)).toEqual(
			["skipped"],
		);
	});

	it("records disabled when Rerank is off, even with a provider configured", async () => {
		await seedForRerank();
		let called = 0;
		const provider: RerankProvider = {
			modelId: "spy",
			async rerank() {
				called += 1;
				return [];
			},
		};
		const result = await run(
			{ question: "再順位付けの並べ替え" },
			{ embedding: embedding(), rerank: provider },
		);
		expect(called).toBe(0);
		expect(result.trace.rerank).toEqual({ status: "disabled" });
	});

	it("falls back to the fused order and records provider-error when the provider fails", async () => {
		await seedForRerank();
		const failing: RerankProvider = {
			modelId: "failing",
			async rerank() {
				throw new Error("rerank backend down");
			},
		};
		const result = await run(
			{ question: "再順位付けの並べ替え", settings: RERANK },
			{ embedding: embedding(), rerank: failing },
		);
		expect(result.noEvidence).toBe(false);
		expect(result.chunks.map((row) => row.chunk.id)).toEqual(["a", "b", "c"]);
		expect(result.trace.rerank).toEqual({ status: "skipped", reason: "provider-error" });
	});

	it("does not swallow an abort raised during Rerank", async () => {
		await seedForRerank();
		const controller = new AbortController();
		const aborting: RerankProvider = {
			modelId: "aborting",
			async rerank() {
				controller.abort();
				throw controller.signal.reason;
			},
		};
		await expect(
			run(
				{ question: "再順位付けの並べ替え", settings: RERANK, signal: controller.signal },
				{ embedding: embedding(), rerank: aborting },
			),
		).rejects.toThrow();
	});

	it("sends the question and the fused chunk texts to the provider and asks for topK", async () => {
		await seedForRerank();
		const seen: { query: string; ids: string[]; texts: string[]; topN: number }[] = [];
		const spy: RerankProvider = {
			modelId: "spy",
			async rerank(query, candidates, options) {
				seen.push({
					query,
					ids: candidates.map((candidate) => candidate.id),
					texts: candidates.map((candidate) => candidate.text),
					topN: options.topN,
				});
				return candidates
					.slice(0, options.topN)
					.map((candidate, index) => ({ id: candidate.id, score: 10 - index }));
			},
		};
		const spied = await run(
			{ question: "再順位付けの並べ替え", settings: { ...RERANK, topK: 2 } },
			{ embedding: embedding(), rerank: spy },
		);
		expect(spied.trace.reranked?.map((row) => row.score)).toEqual([10, 9]);
		expect(seen).toEqual([
			{
				query: "再順位付けの並べ替え",
				ids: ["a", "b", "c"],
				texts: ["天気の話題", "料理のレシピ", "再順位付けは候補を並べ替える"],
				topN: 2,
			},
		]);
	});

	it("does not call Rerank when there is no evidence", async () => {
		await seed([{ id: "x", body: "無関係", vector: axis(9) }]);
		let called = 0;
		const provider: RerankProvider = {
			modelId: "spy",
			async rerank() {
				called += 1;
				return [];
			},
		};
		const result = await run({ settings: RERANK }, { rerank: provider });
		expect(called).toBe(0);
		expect(result.noEvidence).toBe(true);
		expect(result.trace.stages.map((record) => record.stage)).toContain("rerank");
		expect(result.trace.stages.find((record) => record.stage === "rerank")?.status).toBe("skipped");
	});

	it("does not report 'disabled' when Rerank is on but the search found no evidence (review F-3)", async () => {
		await seed([{ id: "x", body: "無関係", vector: axis(9) }]);
		const withProvider = await run({ settings: RERANK }, { rerank: createLexicalRerank() });
		const withoutProvider = await run({ settings: RERANK }, { rerank: undefined });
		const off = await run({}, { rerank: createLexicalRerank() });

		expect(withProvider.trace.rerank).toEqual({ status: "skipped" });
		expect(withoutProvider.trace.rerank).toEqual({ status: "skipped", reason: "api-key-missing" });
		expect(off.trace.rerank).toEqual({ status: "disabled" });
	});

	it("reports the same for an empty knowledge base", async () => {
		const result = await run({ settings: RERANK }, { rerank: undefined });

		expect(result.trace.rerank).toEqual({ status: "skipped", reason: "api-key-missing" });
	});

	it("falls back when the provider returns no candidate the pipeline knows", async () => {
		await seedForRerank();
		const unknownIds: RerankProvider = {
			modelId: "unknown-ids",
			async rerank() {
				return [{ id: "not-a-candidate", score: 1 }];
			},
		};
		const result = await run(
			{ question: "再順位付けの並べ替え", settings: RERANK },
			{ embedding: embedding(), rerank: unknownIds },
		);
		expect(result.chunks.map((row) => row.chunk.id)).toEqual(["a", "b", "c"]);
		expect(result.trace.rerank).toEqual({ status: "skipped", reason: "provider-error" });
	});
});

const STAGE_ORDER = [
	"hyde",
	"multi-query",
	"vector-search",
	"full-text-search",
	"fusion",
	"rerank",
] as const;

describe("runRetrieval (all 16 method combinations)", () => {
	const combinations = Array.from({ length: 16 }, (_, bits) => ({
		hyde: Boolean(bits & 1),
		multiQuery: Boolean(bits & 2),
		hybrid: Boolean(bits & 4),
		rerank: Boolean(bits & 8),
	}));

	for (const methods of combinations) {
		const label = Object.entries(methods)
			.filter(([, on]) => on)
			.map(([name]) => name)
			.join("+");
		it(`runs the stages in order and records skips for ${label || "naive"}`, async () => {
			await seed([{ id: "c1", body: "全文検索の資料", vector: axis(0) }]);
			const events: StageEvent[] = [];
			const result = await run(
				{ question: "全文検索", settings: { methods }, onStage: (event) => events.push(event) },
				{
					structuredModel: transformModel({
						hypothetical: "全文検索の仮想回答",
						queries: SUB_QUERIES,
					}),
					embedding: tableEmbedding({
						全文検索: axis(0),
						全文検索の仮想回答: axis(0),
						観点その一: axis(0),
						観点その二: axis(0),
						観点その三: axis(0),
					}),
					rerank: createLexicalRerank(),
				},
			);
			expect(result.noEvidence).toBe(false);
			expect(result.chunks.map((row) => row.chunk.id)).toEqual(["c1"]);

			expect(result.trace.stages.map((record) => record.stage)).toEqual([...STAGE_ORDER]);
			const status = (stage: (typeof STAGE_ORDER)[number]) =>
				result.trace.stages.find((record) => record.stage === stage)?.status;
			expect(status("hyde")).toBe(methods.hyde ? "done" : "skipped");
			expect(status("multi-query")).toBe(methods.multiQuery ? "done" : "skipped");
			expect(status("vector-search")).toBe("done");
			expect(status("full-text-search")).toBe(methods.hybrid ? "done" : "skipped");
			expect(status("fusion")).toBe(methods.multiQuery || methods.hybrid ? "done" : "skipped");
			expect(status("rerank")).toBe(methods.rerank ? "done" : "skipped");
			expect(result.trace.rerank.status).toBe(methods.rerank ? "applied" : "disabled");

			// every record has a matching terminal event, and "running" never follows it
			for (const stage of STAGE_ORDER) {
				const forStage = events.filter((event) => event.stage === stage).map((e) => e.status);
				const last = forStage.at(-1);
				expect(["done", "skipped"]).toContain(last);
				expect(forStage.filter((state) => state !== "running")).toHaveLength(1);
			}
		});
	}
});
