import type { LanguageModel } from "ai";
import { DEFAULT_RAG } from "../config/defaults";
import { PlatformError } from "../errors";
import type { StructuredUsage } from "../structured";
import { type Citation, NO_EVIDENCE_MESSAGE, resolveCitations, streamRagAnswer } from "./answer";
import type { QuerySettings } from "./request-schema";
import {
	type RerankOutcome,
	type RetrievalDeps,
	type RetrievalSettings,
	type RetrievalStage,
	type RetrievalTrace,
	runRetrieval,
} from "./retrieve";

// The query use case (plan C8): retrieval, then a grounded answer, as one ordered event stream.
// The Route Handler maps these events to UI message parts and does nothing else with them.

/** The stages shown while a query runs: the retrieval stages plus the answer generation. */
export type RagStage = RetrievalStage | "generate";

export interface RagStageEvent {
	readonly type: "stage";
	readonly stage: RagStage;
	readonly status: "running" | "done" | "skipped";
	readonly detail?: string;
}

export interface RagTraceEvent {
	readonly type: "trace";
	readonly trace: RetrievalTrace;
}

export interface RagResult {
	/** The answer after citation resolution: footnotes outside the retrieved range are removed. */
	readonly answer: string;
	readonly citations: Citation[];
	readonly removedCitations: number[];
	readonly noEvidence: boolean;
	readonly rerank: RerankOutcome;
	readonly settings: RetrievalSettings;
	readonly usage: StructuredUsage;
}

/**
 * Closed set of events: `stage` / `trace` (interleaved while retrieving; each trace holds
 * everything recorded so far, the last one is complete) → `text-delta`* → `result`.
 */
export type RagEvent =
	| RagStageEvent
	| RagTraceEvent
	| { readonly type: "text-delta"; readonly text: string }
	| { readonly type: "result"; readonly result: RagResult };

/** Retrieval dependencies plus the model that writes the answer. */
export interface RagQueryDeps extends RetrievalDeps {
	readonly chatModel: LanguageModel;
}

export interface RagQueryRequest {
	readonly question: string;
	readonly settings: QuerySettings;
}

/** Shown to the client when retrieval fails for a reason that is not ours to explain. */
const RETRIEVAL_FAILED_MESSAGE =
	"検索に失敗しました。ナレッジベースと埋め込みモデルの設定を確認して、もう一度お試しください。";

/** Shown to the client when the answer model fails; the cause (URLs, keys) is never forwarded. */
const GENERATION_FAILED_MESSAGE =
	"回答の生成に失敗しました。しばらくしてからもう一度お試しください。";

/**
 * Platform errors (a changed embedding model, an unreachable knowledge base, a bad model output)
 * and aborts keep their meaning. Anything else came from a provider or the driver and may hold
 * keys, URLs or SQL, so only a fixed message goes on.
 */
function toRetrievalFailure(error: unknown, signal: AbortSignal): unknown {
	if (signal.aborted || error instanceof PlatformError) return error;
	return new PlatformError("provider-unavailable", RETRIEVAL_FAILED_MESSAGE);
}

function toRetrievalSettings(settings: QuerySettings): RetrievalSettings {
	return {
		topK: settings.topK,
		minSimilarity: settings.minSimilarity,
		pool: DEFAULT_RAG.candidatePool,
		filter: {
			...(settings.filter.documentIds ? { documentIds: settings.filter.documentIds } : {}),
			...(settings.filter.tags ? { tags: settings.filter.tags } : {}),
		},
		methods: settings.methods,
	};
}

/** Runs `retrieval` and yields the stage events it reports while it is still running. */
async function* withRetrievalEvents<T>(
	start: (emit: (event: RagStageEvent | RagTraceEvent) => void) => Promise<T>,
): AsyncGenerator<RagStageEvent | RagTraceEvent, T> {
	const queue: (RagStageEvent | RagTraceEvent)[] = [];
	let wake: (() => void) | undefined;
	let settled = false;
	const notify = () => {
		wake?.();
		wake = undefined;
	};
	const outcome = start((event) => {
		queue.push(event);
		notify();
	}).then(
		(value) => ({ ok: true as const, value }),
		(error: unknown) => ({ ok: false as const, error }),
	);
	void outcome.then(() => {
		settled = true;
		notify();
	});
	while (true) {
		const next = queue.shift();
		if (next) {
			yield next;
			continue;
		}
		if (settled) break;
		await new Promise<void>((resolve) => {
			wake = resolve;
			if (queue.length > 0 || settled) notify();
		});
	}
	const result = await outcome;
	if (!result.ok) throw result.error;
	return result.value;
}

function addChatUsage(
	base: StructuredUsage,
	usage: {
		inputTokens?: number | undefined;
		outputTokens?: number | undefined;
		totalTokens?: number | undefined;
		inputTokenDetails?: { cacheReadTokens?: number | undefined } | undefined;
	},
): StructuredUsage {
	const input = usage.inputTokens ?? 0;
	const output = usage.outputTokens ?? 0;
	return {
		inputTokens: base.inputTokens + input,
		outputTokens: base.outputTokens + output,
		totalTokens: base.totalTokens + (usage.totalTokens ?? input + output),
		cacheReadTokens: base.cacheReadTokens + (usage.inputTokenDetails?.cacheReadTokens ?? 0),
	};
}

export async function* streamRagQuery(
	deps: RagQueryDeps,
	request: RagQueryRequest,
	signal?: AbortSignal,
): AsyncGenerator<RagEvent, void> {
	signal?.throwIfAborted();
	// Stops a retrieval that is still running when the consumer stops reading.
	const inner = new AbortController();
	const effectiveSignal = signal ? AbortSignal.any([signal, inner.signal]) : inner.signal;
	try {
		const settings = toRetrievalSettings(request.settings);
		let retrieval: Awaited<ReturnType<typeof runRetrieval>>;
		try {
			retrieval = yield* withRetrievalEvents((emit) =>
				runRetrieval({
					question: request.question,
					settings,
					deps,
					onTrace: (trace) => emit({ type: "trace", trace }),
					onStage: (event) =>
						emit({
							type: "stage",
							stage: event.stage,
							status: event.status,
							...(event.detail === undefined ? {} : { detail: event.detail }),
						}),
					signal: effectiveSignal,
				}),
			);
		} catch (error) {
			throw toRetrievalFailure(error, effectiveSignal);
		}
		effectiveSignal.throwIfAborted();
		yield { type: "trace", trace: retrieval.trace };
		// The consumer may have aborted while it handled the trace; no LLM call starts after that.
		effectiveSignal.throwIfAborted();

		let usage = retrieval.usage;
		let text: string;
		if (retrieval.noEvidence) {
			yield { type: "stage", stage: "generate", status: "skipped", detail: "根拠がありません" };
			text = NO_EVIDENCE_MESSAGE;
			yield { type: "text-delta", text };
		} else {
			yield { type: "stage", stage: "generate", status: "running" };
			const answer = streamRagAnswer({
				chatModel: deps.chatModel,
				question: request.question,
				chunks: retrieval.chunks,
				signal: effectiveSignal,
			});
			text = "";
			try {
				for await (const part of answer.fullStream) {
					if (part.type === "error") throw part.error;
					if (part.type === "text-delta") {
						text += part.text;
						yield { type: "text-delta", text: part.text };
					}
				}
				effectiveSignal.throwIfAborted();
				usage = addChatUsage(usage, await answer.usage);
			} catch {
				// An abort is the caller's decision, not a provider failure.
				if (effectiveSignal.aborted) throw effectiveSignal.reason;
				throw new PlatformError("provider-unavailable", GENERATION_FAILED_MESSAGE);
			}
			yield { type: "stage", stage: "generate", status: "done" };
		}

		const resolved = resolveCitations(text, retrieval.chunks);
		yield {
			type: "result",
			result: {
				answer: resolved.answer,
				citations: resolved.citations,
				removedCitations: resolved.removedCitations,
				noEvidence: retrieval.noEvidence,
				rerank: retrieval.trace.rerank,
				settings: retrieval.trace.settings,
				usage,
			},
		};
	} finally {
		inner.abort();
	}
}
