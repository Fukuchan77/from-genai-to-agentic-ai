import type { Clock } from "../../ports/clock";
import type { ScoredChunk, SearchFilter } from "../store";

// Types and the builder of the retrieval trace (plan C7). The pipeline owns the order of the
// stages; this file only records what happened, so the UI and the tests read one plain-data shape.

/** The four retrieval methods a caller can switch on and off (Req 2.7). */
export interface RetrievalMethods {
	readonly hyde: boolean;
	readonly multiQuery: boolean;
	readonly hybrid: boolean;
	readonly rerank: boolean;
}

export interface RetrievalSettings {
	/** How many chunks the answer may use. */
	readonly topK: number;
	/** Vector candidates with a lower cosine similarity are dropped; equal is kept. */
	readonly minSimilarity: number;
	/** How many candidates each search returns (`candidatePool`). */
	readonly pool: number;
	readonly filter?: SearchFilter;
	readonly methods: RetrievalMethods;
}

export type RetrievalStage =
	| "hyde"
	| "multi-query"
	| "vector-search"
	| "full-text-search"
	| "fusion"
	| "rerank";

/** Sent to the caller while retrieval runs (streaming progress). */
export interface StageEvent {
	readonly stage: RetrievalStage;
	readonly status: "running" | "done" | "skipped";
	readonly detail?: string;
}

/** A stage that finished or was skipped, with the time it took. */
export interface StageRecord {
	readonly stage: RetrievalStage;
	readonly status: "done" | "skipped";
	readonly durationMs: number;
	readonly detail?: string;
}

export type RerankSkipReason = "api-key-missing" | "provider-error";

export interface RerankOutcome {
	readonly status: "applied" | "skipped" | "disabled";
	readonly reason?: RerankSkipReason;
}

export interface SearchCandidates {
	readonly query: string;
	readonly candidates: readonly ScoredChunk[];
}

export interface RetrievalTrace {
	readonly settings: RetrievalSettings;
	readonly hypotheticalAnswer?: string;
	readonly subQueries?: readonly string[];
	readonly vector: readonly SearchCandidates[];
	readonly fullText: readonly SearchCandidates[];
	/** The merged ranking; `score` is the fused score. */
	readonly fused: readonly ScoredChunk[];
	readonly reranked?: readonly ScoredChunk[];
	readonly rerank: RerankOutcome;
	/** The chunks that went on to the answer. */
	readonly final: readonly ScoredChunk[];
	readonly stages: readonly StageRecord[];
}

export interface TraceBuilderOptions {
	readonly settings: RetrievalSettings;
	/** Source of the stage durations. */
	readonly clock: Clock;
	readonly onStage?: (event: StageEvent) => void;
}

export interface TraceBuilder {
	/** Marks a stage as running and starts its timer. */
	begin(stage: RetrievalStage, detail?: string): void;
	/** Finishes a stage that was begun. */
	done(stage: RetrievalStage, detail?: string): void;
	/** Records a stage as skipped, with the reason; works with or without a prior `begin`. */
	skip(stage: RetrievalStage, reason: string): void;
	setHypotheticalAnswer(text: string): void;
	setSubQueries(queries: readonly string[]): void;
	addVector(query: string, candidates: readonly ScoredChunk[]): void;
	addFullText(query: string, candidates: readonly ScoredChunk[]): void;
	setFused(rows: readonly ScoredChunk[]): void;
	setReranked(rows: readonly ScoredChunk[]): void;
	/** Defaults to `{ status: "disabled" }` until set. */
	setRerank(outcome: RerankOutcome): void;
	setFinal(rows: readonly ScoredChunk[]): void;
	/** A snapshot: later calls do not change a trace that was already built. */
	build(): RetrievalTrace;
}

export function createTraceBuilder(options: TraceBuilderOptions): TraceBuilder {
	const { clock, onStage } = options;
	const settings = structuredClone(options.settings);
	const startedAt = new Map<RetrievalStage, number>();
	const stages: StageRecord[] = [];
	const vector: SearchCandidates[] = [];
	const fullText: SearchCandidates[] = [];
	let hypotheticalAnswer: string | undefined;
	let subQueries: readonly string[] | undefined;
	let fused: readonly ScoredChunk[] = [];
	let reranked: readonly ScoredChunk[] | undefined;
	let rerank: RerankOutcome = { status: "disabled" };
	let final: readonly ScoredChunk[] = [];

	function emit(event: StageEvent): void {
		onStage?.(event);
	}

	function finish(stage: RetrievalStage, status: "done" | "skipped", detail: string | undefined) {
		const started = startedAt.get(stage);
		startedAt.delete(stage);
		stages.push({
			stage,
			status,
			durationMs: started === undefined ? 0 : clock.now() - started,
			...(detail === undefined ? {} : { detail }),
		});
		emit({ stage, status, ...(detail === undefined ? {} : { detail }) });
	}

	return {
		begin(stage, detail) {
			startedAt.set(stage, clock.now());
			emit({ stage, status: "running", ...(detail === undefined ? {} : { detail }) });
		},
		done: (stage, detail) => finish(stage, "done", detail),
		skip: (stage, reason) => finish(stage, "skipped", reason),
		setHypotheticalAnswer(text) {
			hypotheticalAnswer = text;
		},
		setSubQueries(queries) {
			subQueries = [...queries];
		},
		addVector(query, candidates) {
			vector.push({ query, candidates: [...candidates] });
		},
		addFullText(query, candidates) {
			fullText.push({ query, candidates: [...candidates] });
		},
		setFused(rows) {
			fused = [...rows];
		},
		setReranked(rows) {
			reranked = [...rows];
		},
		setRerank(outcome) {
			rerank = { ...outcome };
		},
		setFinal(rows) {
			final = [...rows];
		},
		build() {
			return {
				settings: structuredClone(settings),
				...(hypotheticalAnswer === undefined ? {} : { hypotheticalAnswer }),
				...(subQueries === undefined ? {} : { subQueries: [...subQueries] }),
				vector: vector.map((entry) => ({ ...entry, candidates: [...entry.candidates] })),
				fullText: fullText.map((entry) => ({ ...entry, candidates: [...entry.candidates] })),
				fused: [...fused],
				...(reranked === undefined ? {} : { reranked: [...reranked] }),
				rerank: { ...rerank },
				final: [...final],
				stages: stages.map((record) => ({ ...record })),
			};
		},
	};
}
