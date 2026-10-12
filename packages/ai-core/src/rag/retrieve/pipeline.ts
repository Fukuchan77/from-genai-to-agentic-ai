import type { LanguageModel } from "ai";
import { DEFAULT_RAG } from "../../config/defaults";
import type { ResolvedEmbeddingModel } from "../../models";
import { type Clock, systemClock } from "../../ports/clock";
import type { RerankProvider } from "../../ports/rerank";
import type { StructuredUsage } from "../../structured";
import { assertKnowledgeBaseCompatible, embedQuery } from "../embedding";
import { buildFullTextQuery, toSearchText } from "../ingest/search-text";
import type { KnowledgeStore, ScoredChunk } from "../store";
import { generateHypotheticalAnswer } from "./hyde";
import { expandQuery } from "./multi-query";
import { reciprocalRankFusion } from "./rrf";
import {
	createTraceBuilder,
	type RerankOutcome,
	type RetrievalSettings,
	type RetrievalTrace,
	type StageEvent,
	type TraceBuilder,
} from "./trace";

// The retrieval pipeline (plan C7). This file owns the order of the stages and the "no evidence"
// decision; SQL lives in the store and the pure ranking maths in `rrf.ts`.

export interface RetrievalDeps {
	readonly store: KnowledgeStore;
	readonly embedding: Pick<ResolvedEmbeddingModel, "model" | "entry">;
	/**
	 * The model for the query-transform stages: HyDE (free text) and Multi-Query (a structured
	 * output). One model serves both, so a caller checks its structured-output capability once.
	 */
	readonly structuredModel: LanguageModel;
	/** `undefined` when no Rerank provider is configured (no API key). */
	readonly rerank: RerankProvider | undefined;
	readonly clock?: Clock;
}

export interface RunRetrievalParams {
	readonly question: string;
	readonly settings: RetrievalSettings;
	readonly deps: RetrievalDeps;
	readonly onStage?: (event: StageEvent) => void;
	/**
	 * Called with the trace so far each time a stage finishes or is skipped, so a caller can show
	 * the intermediate results while retrieval is still running (Req 2.11).
	 */
	readonly onTrace?: (trace: RetrievalTrace) => void;
	readonly signal?: AbortSignal;
}

export interface RetrievalResult {
	/** The chunks the answer may use; empty when there is no evidence. */
	readonly chunks: ScoredChunk[];
	readonly trace: RetrievalTrace;
	readonly usage: StructuredUsage;
	/** True when no vector candidate reached the threshold (CL-1). */
	readonly noEvidence: boolean;
}

const DISABLED = "無効";
const NO_EVIDENCE = "根拠となる候補がありません";

function addUsage(total: StructuredUsage, extra: StructuredUsage): StructuredUsage {
	return {
		inputTokens: total.inputTokens + extra.inputTokens,
		outputTokens: total.outputTokens + extra.outputTokens,
		totalTokens: total.totalTokens + extra.totalTokens,
		cacheReadTokens: total.cacheReadTokens + extra.cacheReadTokens,
	};
}

const NO_USAGE: StructuredUsage = {
	inputTokens: 0,
	outputTokens: 0,
	totalTokens: 0,
	cacheReadTokens: 0,
};

export async function runRetrieval(params: RunRetrievalParams): Promise<RetrievalResult> {
	const { question, settings, deps, signal } = params;
	signal?.throwIfAborted();
	const trace = createTraceBuilder({
		settings,
		clock: deps.clock ?? systemClock,
		onStage: (event) => {
			params.onStage?.(event);
			if (event.status !== "running") params.onTrace?.(trace.build());
		},
	});
	let usage = NO_USAGE;

	const meta = await deps.store.getMeta();
	assertKnowledgeBaseCompatible(meta, deps.embedding);
	if (!meta) {
		// An empty knowledge base has nothing to match; skip the embedding call as well.
		trace.skip("vector-search", "ナレッジベースが空です");
		trace.setRerank(rerankWithoutEvidence(settings, deps));
		return { chunks: [], trace: trace.build(), usage, noEvidence: true };
	}

	const { methods } = settings;
	let searchText = question;
	if (methods.hyde) {
		trace.begin("hyde");
		const hypothetical = await generateHypotheticalAnswer({
			model: deps.structuredModel,
			question,
			...(signal ? { abortSignal: signal } : {}),
		});
		usage = addUsage(usage, hypothetical.usage);
		trace.setHypotheticalAnswer(hypothetical.text);
		trace.done("hyde");
		searchText = hypothetical.text;
	} else {
		trace.skip("hyde", DISABLED);
	}

	let queries = [searchText];
	if (methods.multiQuery) {
		trace.begin("multi-query");
		const expanded = await expandQuery({
			model: deps.structuredModel,
			question: searchText,
			...(signal ? { abortSignal: signal } : {}),
		});
		usage = addUsage(usage, expanded.usage);
		trace.setSubQueries(expanded.subQueries);
		trace.done("multi-query");
		queries = expanded.subQueries;
	} else {
		trace.skip("multi-query", DISABLED);
	}
	const search = await searchAll({ queries, settings, deps, trace, signal });
	if (!search.vectorHit) {
		// CL-1: only the vector search decides "no evidence"; full-text hits never rescue it.
		trace.skip("fusion", NO_EVIDENCE);
		trace.setRerank(rerankWithoutEvidence(settings, deps));
		trace.skip("rerank", NO_EVIDENCE);
		return { chunks: [], trace: trace.build(), usage, noEvidence: true };
	}

	const fused = fuse(search, trace);
	const ranked = await rerankCandidates({ question, fused, settings, deps, trace, signal });
	const final = ranked.slice(0, settings.topK);
	trace.setFinal(final);
	return { chunks: final, trace: trace.build(), usage, noEvidence: false };
}

interface SearchOutcome {
	readonly vector: readonly (readonly ScoredChunk[])[];
	readonly fullText: readonly (readonly ScoredChunk[])[];
	/** True when at least one vector search returned a candidate at or above the threshold. */
	readonly vectorHit: boolean;
}

async function searchAll(params: {
	readonly queries: readonly string[];
	readonly settings: RetrievalSettings;
	readonly deps: RetrievalDeps;
	readonly trace: TraceBuilder;
	readonly signal: AbortSignal | undefined;
}): Promise<SearchOutcome> {
	const { queries, settings, deps, trace, signal } = params;
	const filter = settings.filter ? { filter: settings.filter } : {};
	const abort = signal ? { signal } : {};
	const hybrid = settings.methods.hybrid;

	trace.begin("vector-search");
	if (hybrid) trace.begin("full-text-search");
	const perQuery = await Promise.all(
		queries.map(async (query) => {
			const vectorSearch = async () => {
				const embedding = await embedQuery({ resolved: deps.embedding, value: query, ...abort });
				return deps.store.searchByVector({
					embedding,
					limit: settings.pool,
					minSimilarity: settings.minSimilarity,
					...filter,
				});
			};
			const fullTextQuery = hybrid ? buildFullTextQuery(toSearchText(query)) : undefined;
			const fullTextSearch = async () =>
				fullTextQuery === undefined
					? []
					: deps.store.searchByFullText({ query: fullTextQuery, limit: settings.pool, ...filter });
			const [vector, fullText] = await Promise.all([vectorSearch(), fullTextSearch()]);
			return { query, vector, fullText, searchedFullText: fullTextQuery !== undefined };
		}),
	);
	signal?.throwIfAborted();

	for (const entry of perQuery) trace.addVector(entry.query, entry.vector);
	trace.done("vector-search");
	if (!hybrid) {
		trace.skip("full-text-search", DISABLED);
	} else {
		if (perQuery.some((entry) => entry.searchedFullText)) {
			for (const entry of perQuery) {
				if (entry.searchedFullText) trace.addFullText(entry.query, entry.fullText);
			}
			trace.done("full-text-search");
		} else {
			trace.skip("full-text-search", "検索できる語がありません");
		}
	}
	return {
		vector: perQuery.map((entry) => entry.vector),
		fullText: perQuery.filter((entry) => entry.searchedFullText).map((entry) => entry.fullText),
		vectorHit: perQuery.some((entry) => entry.vector.length > 0),
	};
}

/** Merges every ranking with RRF; a single ranking keeps its own scores and order. */
function fuse(search: SearchOutcome, trace: TraceBuilder): ScoredChunk[] {
	const rankings = [...search.vector, ...search.fullText].filter((ranking) => ranking.length > 0);
	if (rankings.length <= 1) {
		const only = rankings[0] ?? [];
		trace.skip("fusion", "統合する検索結果が 1 つだけです");
		trace.setFused(only);
		return [...only];
	}
	trace.begin("fusion");
	const byId = new Map<string, ScoredChunk>();
	// Vector candidates first, so a chunk found by both searches keeps its similarity.
	for (const ranking of rankings) {
		for (const row of ranking) {
			const known = byId.get(row.chunk.id);
			if (!known || (known.similarity === undefined && row.similarity !== undefined)) {
				byId.set(row.chunk.id, row);
			}
		}
	}
	const fused: ScoredChunk[] = [];
	for (const { id, score } of reciprocalRankFusion(
		rankings.map((ranking) => ranking.map((row) => row.chunk.id)),
		DEFAULT_RAG.rrfK,
	)) {
		const row = byId.get(id);
		if (row) fused.push({ ...row, score });
	}
	trace.setFused(fused);
	trace.done("fusion");
	return fused;
}

/** The Rerank outcome when retrieval stops before the stage: on, but there was nothing to rerank. */
function rerankWithoutEvidence(settings: RetrievalSettings, deps: RetrievalDeps): RerankOutcome {
	if (!settings.methods.rerank) return { status: "disabled" };
	return deps.rerank ? { status: "skipped" } : { status: "skipped", reason: "api-key-missing" };
}

/**
 * Re-scores the fused candidates. A missing provider or a failing call never stops the answer:
 * the fused order is kept and the reason is recorded (Req 2.6, CL-11). An abort is not a failure.
 */
async function rerankCandidates(params: {
	readonly question: string;
	readonly fused: readonly ScoredChunk[];
	readonly settings: RetrievalSettings;
	readonly deps: RetrievalDeps;
	readonly trace: TraceBuilder;
	readonly signal: AbortSignal | undefined;
}): Promise<readonly ScoredChunk[]> {
	const { question, fused, settings, deps, trace, signal } = params;
	if (!settings.methods.rerank) {
		trace.setRerank({ status: "disabled" });
		trace.skip("rerank", DISABLED);
		return fused;
	}
	const provider = deps.rerank;
	if (!provider) {
		trace.setRerank({ status: "skipped", reason: "api-key-missing" });
		trace.skip("rerank", "Rerank の API キーが未設定のためスキップしました");
		return fused;
	}
	trace.begin("rerank");
	try {
		const candidates = fused.slice(0, settings.pool);
		const scores = await provider.rerank(
			question,
			candidates.map((row) => ({ id: row.chunk.id, text: row.chunk.body })),
			{ topN: settings.topK, ...(signal ? { signal } : {}) },
		);
		const byId = new Map(candidates.map((row) => [row.chunk.id, row]));
		const reranked: ScoredChunk[] = [];
		for (const { id, score } of scores.slice(0, settings.topK)) {
			const row = byId.get(id);
			if (row) reranked.push({ ...row, score });
		}
		if (reranked.length === 0) throw new Error("rerank returned no known candidate");
		trace.setReranked(reranked);
		trace.setRerank({ status: "applied" });
		trace.done("rerank");
		return reranked;
	} catch (error) {
		if (signal?.aborted) throw error;
		trace.setRerank({ status: "skipped", reason: "provider-error" });
		trace.skip("rerank", "Rerank の呼び出しに失敗したため統合後の順位を使います");
		return fused;
	}
}
