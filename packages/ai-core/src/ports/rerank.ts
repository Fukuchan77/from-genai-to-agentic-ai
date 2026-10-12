import { createCohere } from "@ai-sdk/cohere";
import { rerank as aiRerank } from "ai";
import { z } from "zod";
import { PlatformError } from "../errors";
import { defaultRerankModel } from "../models/catalog";
import { raceWithAbort } from "./abort";

export interface RerankCandidate {
	readonly id: string;
	readonly text: string;
}

export interface RerankScore {
	readonly id: string;
	readonly score: number;
}

export interface RerankOptions {
	/** How many candidates to return at most. */
	readonly topN: number;
	readonly signal?: AbortSignal;
}

/** Re-scores candidates against a query with a model that reads both together (plan C2). */
export interface RerankProvider {
	readonly modelId: string;
	rerank(
		query: string,
		candidates: readonly RerankCandidate[],
		options: RerankOptions,
	): Promise<readonly RerankScore[]>;
}

export interface RerankSdkRequest {
	readonly query: string;
	readonly documents: readonly string[];
	readonly topN: number;
	readonly abortSignal: AbortSignal;
}

/** The one call that reaches the network. Tests replace it; its result is validated before use. */
export type RerankSdkCall = (request: RerankSdkRequest) => Promise<unknown>;

export interface CohereRerankOptions {
	/** Defaults to the catalog's rerank model. */
	readonly modelId?: string;
	/** Defaults to 10 seconds. */
	readonly timeoutMs?: number;
	readonly sdk?: RerankSdkCall;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const PROVIDER = "cohere";

const rankingSchema = z.object({
	ranking: z.array(
		z.object({
			originalIndex: z.number().int().nonnegative(),
			score: z.number().finite(),
		}),
	),
});

function createSdkCall(apiKey: string, modelId: string): RerankSdkCall {
	return (request) =>
		aiRerank({
			model: createCohere({ apiKey }).reranking(modelId),
			documents: [...request.documents],
			query: request.query,
			topN: request.topN,
			// A failed rerank is skipped by the caller (CL-11), so retrying only delays the answer.
			maxRetries: 0,
			abortSignal: request.abortSignal,
		});
}

function describeFailure(cause: unknown): Record<string, unknown> {
	if (!(cause instanceof Error)) return {};
	const status = (cause as { readonly statusCode?: unknown }).statusCode;
	return {
		errorName: cause.name,
		...(typeof status === "number" ? { status } : {}),
	};
}

function unavailable(message: string, details: Record<string, unknown> = {}): PlatformError {
	return new PlatformError("source-unavailable", message, { provider: PROVIDER, ...details });
}

export function createCohereRerank(
	apiKey: string,
	options: CohereRerankOptions = {},
): RerankProvider {
	const modelId = options.modelId ?? defaultRerankModel().id;
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const call = options.sdk ?? createSdkCall(apiKey, modelId);

	return {
		modelId,
		async rerank(query, candidates, { topN, signal }) {
			if (!Number.isInteger(topN) || topN < 1) {
				throw new PlatformError("invalid-request", "topN は 1 以上の整数で指定してください。");
			}
			if (signal?.aborted) throw signal.reason;
			if (candidates.length === 0) return [];

			const controller = new AbortController();
			const abortFromCaller = () => controller.abort(signal?.reason);
			signal?.addEventListener("abort", abortFromCaller, { once: true });
			let timedOut = false;
			const timer = setTimeout(() => {
				timedOut = true;
				controller.abort(new DOMException("Rerank timed out", "TimeoutError"));
			}, timeoutMs);

			let raw: unknown;
			try {
				raw = await raceWithAbort(
					call({
						query,
						documents: candidates.map((candidate) => candidate.text),
						topN: Math.min(topN, candidates.length),
						abortSignal: controller.signal,
					}),
					controller.signal,
				);
			} catch (cause) {
				if (signal?.aborted) throw signal.reason;
				if (timedOut) throw unavailable("Rerank がタイムアウトしました。", { reason: "timeout" });
				// Provider messages may echo the key, the query, or candidate text, so only a closed
				// classification (error name, HTTP status) goes into the details.
				throw unavailable("Rerank に失敗しました。", describeFailure(cause));
			} finally {
				clearTimeout(timer);
				signal?.removeEventListener("abort", abortFromCaller);
			}

			const parsed = rankingSchema.safeParse(raw);
			if (!parsed.success) {
				throw unavailable("Rerank の応答が想定した形式ではありません。", {
					issues: parsed.error.issues.map((issue) => issue.path.join(".")),
				});
			}
			const seen = new Set<number>();
			const scored = parsed.data.ranking.map((row) => {
				const candidate = candidates[row.originalIndex];
				if (candidate === undefined || seen.has(row.originalIndex)) {
					throw unavailable("Rerank の応答に不正なインデックスが含まれています。", {
						issues: ["ranking.originalIndex"],
					});
				}
				seen.add(row.originalIndex);
				return { id: candidate.id, score: row.score };
			});
			return scored.sort((left, right) => right.score - left.score).slice(0, topN);
		},
	};
}
