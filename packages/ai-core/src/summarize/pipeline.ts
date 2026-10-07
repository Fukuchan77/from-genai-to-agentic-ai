import {
	type DeepPartial,
	type LanguageModel,
	type LanguageModelUsage,
	NoObjectGeneratedError,
	Output,
	streamText,
} from "ai";
import type { z } from "zod";
import type { ModelEntry } from "../models/types";
import { type CachePolicy, cachePolicyFor } from "./cache-policy";
import {
	type IntegrationOptions,
	integrationGroups,
	OUTPUT_RESERVE_TOKENS,
	planSummary,
	type SummaryPlan,
	type SummaryStrategy,
} from "./plan";
import {
	buildChunkPrompt,
	buildIntegrationPrompt,
	buildSummaryPrompt,
	type SummaryPrompt,
} from "./prompts";
import { type AttemptNumber, type AttemptOutcome, withRegeneration } from "./retry";
import { formatSchemaIssues, type Summary, type SummaryInput, summarySchemaFor } from "./schema";
import { loadSource, type SourceDeps } from "./source";

/** Recorded with every summary (Req 4.8, 4.12; plan Data Model "SummaryMeta"). */
export interface SummaryMeta {
	readonly strategy: SummaryStrategy;
	readonly estimatedInputTokens: number;
	/** Input tokens the provider reported, summed over every call (chunks, integration, retries). */
	readonly actualInputTokens: number | undefined;
	readonly chunks: number;
	/** Summed cache reads; only for providers whose cache policy records them. */
	readonly cacheReadTokens: number | undefined;
	/** Attempts of the call that produced the final summary, regenerations included. */
	readonly attempts: AttemptNumber;
}

/**
 * `partial` is a provisional, unvalidated rendering aid; `restart` tells the consumer to discard it;
 * only `final` is a schema-validated summary (Req 4.3, 4.5). `meta` follows `final`.
 */
export type SummaryEvent =
	| { readonly type: "partial"; readonly summary: DeepPartial<Summary> }
	| { readonly type: "restart"; readonly attempt: number; readonly issues: readonly string[] }
	| { readonly type: "final"; readonly summary: Summary }
	| { readonly type: "meta"; readonly meta: SummaryMeta };

/** The model is resolved by the caller (ModelGateway); `entry` is its catalog entry. */
export interface SummaryDeps {
	readonly model: LanguageModel;
	readonly entry: ModelEntry;
	readonly abortSignal?: AbortSignal;
}

interface UsageTotals {
	inputTokens: number | undefined;
	cacheReadTokens: number | undefined;
}

function addDefined(total: number | undefined, value: number | undefined): number | undefined {
	return value === undefined ? total : (total ?? 0) + value;
}

function issuesFromText(text: string | undefined, schema: z.ZodType<Summary>): string[] {
	let value: unknown;
	try {
		value = JSON.parse(text ?? "");
	} catch {
		return ["(root): 出力を JSON として解析できませんでした。"];
	}
	const parsed = schema.safeParse(value);
	return parsed.success
		? ["(root): 出力を検証できませんでした。"]
		: formatSchemaIssues(parsed.error);
}

/**
 * Ollama runs a request with its server default context length (a few thousand tokens) unless
 * `num_ctx` is given, and silently truncates a longer prompt. The planner budgets against the
 * catalog `contextWindow` (ADR-9), so every Ollama summary call runs with exactly that window.
 */
function runtimeOptions(entry: ModelEntry): {
	providerOptions?: { ollama: { options: { num_ctx: number } } };
} {
	if (entry.provider !== "ollama") return {};
	return { providerOptions: { ollama: { options: { num_ctx: entry.contextWindow } } } };
}

interface CallContext {
	readonly deps: SummaryDeps;
	readonly schema: z.ZodType<Summary>;
	readonly usage: UsageTotals;
}

async function* generateSummaryObject(
	prompt: SummaryPrompt,
	context: CallContext,
	emitPartials: boolean,
): AsyncGenerator<SummaryEvent, AttemptOutcome<Summary>> {
	const streamErrors: unknown[] = [];
	const result = streamText({
		model: context.deps.model,
		instructions: prompt.instructions,
		messages: prompt.messages,
		output: Output.object({ schema: context.schema }),
		maxOutputTokens: Math.min(OUTPUT_RESERVE_TOKENS, context.deps.entry.maxOutputTokens),
		...runtimeOptions(context.deps.entry),
		...(context.deps.abortSignal ? { abortSignal: context.deps.abortSignal } : {}),
		// Errors are rethrown below; the default handler would log them with their content.
		onError: ({ error }) => {
			streamErrors.push(error);
		},
	});
	for await (const partial of result.partialOutputStream) {
		if (emitPartials) yield { type: "partial", summary: partial };
	}
	try {
		const value = await result.output;
		recordUsage(context.usage, await result.usage);
		return { ok: true, value };
	} catch (error) {
		// A provider error part (e.g. an overload sent mid-stream) also makes `output` reject with
		// NoObjectGeneratedError; it is not a schema failure, so it is rethrown unchanged (Req 4.4).
		if (streamErrors.length > 0) throw streamErrors[0];
		if (!NoObjectGeneratedError.isInstance(error)) throw error;
		if (error.usage) recordUsage(context.usage, error.usage);
		return { ok: false, issues: issuesFromText(error.text, context.schema) };
	}
}

function recordUsage(totals: UsageTotals, usage: LanguageModelUsage): void {
	totals.inputTokens = addDefined(totals.inputTokens, usage.inputTokens);
	totals.cacheReadTokens = addDefined(
		totals.cacheReadTokens,
		usage.inputTokenDetails.cacheReadTokens,
	);
}

const discardRestart = () => undefined;

function restartEvent(notice: { attempt: number; issues: readonly string[] }): SummaryEvent {
	return { type: "restart", attempt: notice.attempt, issues: notice.issues };
}

function promptOptions(cachePolicy: CachePolicy, feedback: readonly string[] | undefined) {
	return { cachePolicy, ...(feedback ? { feedback } : {}) };
}

/**
 * Integrates groups of partial summaries (no events) until all of them fit one integration prompt
 * of the context budget; `integrationGroups` refuses when merging cannot progress (W3 review L14).
 * A group of one is carried over without a call.
 */
async function* mergeUntilOneGroup(
	partials: readonly Summary[],
	options: IntegrationOptions,
	call: { readonly context: CallContext; readonly cachePolicy: CachePolicy },
): AsyncGenerator<SummaryEvent, Summary[]> {
	let current = [...partials];
	let groups = integrationGroups(current, options, call.context.deps.entry);
	while (groups.length > 1) {
		const next: Summary[] = [];
		for (const group of groups) {
			if (group.length === 1) {
				next.push(...group);
				continue;
			}
			const merged = yield* withRegeneration(
				(_attempt, feedback) =>
					generateSummaryObject(
						buildIntegrationPrompt(
							{ partials: group, ...options },
							promptOptions(call.cachePolicy, feedback),
						),
						call.context,
						false,
					),
				discardRestart,
			);
			next.push(merged.value);
		}
		current = next;
		groups = integrationGroups(current, options, call.context.deps.entry);
	}
	return current;
}

/**
 * Streams one summary for `plan`. `whole` makes one call; `staged` summarizes each chunk (no events)
 * and then streams the integration of the partial summaries. Every call is regenerated at most
 * twice on a schema failure, after which `SummaryValidationError` is thrown.
 */
export async function* streamSummary(
	plan: SummaryPlan,
	deps: SummaryDeps,
): AsyncGenerator<SummaryEvent, void> {
	const cachePolicy = cachePolicyFor(deps.entry);
	const context: CallContext = {
		deps,
		schema: summarySchemaFor({ withChapters: plan.withChapters }),
		usage: { inputTokens: undefined, cacheReadTokens: undefined },
	};
	const title = plan.title ? { title: plan.title } : {};

	let finalPrompt: (feedback: readonly string[] | undefined) => SummaryPrompt;
	if (plan.strategy === "whole") {
		const text = plan.chunks[0] ?? "";
		finalPrompt = (feedback) =>
			buildSummaryPrompt(
				{ text, withChapters: plan.withChapters, ...title },
				promptOptions(cachePolicy, feedback),
			);
	} else {
		const partials: Summary[] = [];
		for (const [index, text] of plan.chunks.entries()) {
			const chunk = yield* withRegeneration(
				(_attempt, feedback) =>
					generateSummaryObject(
						buildChunkPrompt(
							{ text, index, total: plan.chunks.length, withChapters: plan.withChapters, ...title },
							promptOptions(cachePolicy, feedback),
						),
						context,
						false,
					),
				discardRestart,
			);
			partials.push(chunk.value);
		}
		const merged = yield* mergeUntilOneGroup(
			partials,
			{ withChapters: plan.withChapters, ...title },
			{ context, cachePolicy },
		);
		finalPrompt = (feedback) =>
			buildIntegrationPrompt(
				{ partials: merged, withChapters: plan.withChapters, ...title },
				promptOptions(cachePolicy, feedback),
			);
	}

	const final = yield* withRegeneration(
		(_attempt, feedback) => generateSummaryObject(finalPrompt(feedback), context, true),
		restartEvent,
	);
	yield { type: "final", summary: final.value };
	yield {
		type: "meta",
		meta: {
			strategy: plan.strategy,
			estimatedInputTokens: plan.estimatedInputTokens,
			actualInputTokens: context.usage.inputTokens,
			chunks: plan.chunks.length,
			cacheReadTokens: cachePolicy.recordsCacheReads ? context.usage.cacheReadTokens : undefined,
			attempts: final.attempts,
		},
	};
}

/** Loads the source (failing before any LLM call, Req 4.7/4.11), plans, and streams the summary. */
export async function* summarizeSource(
	input: SummaryInput,
	deps: SummaryDeps & Omit<SourceDeps, "signal">,
): AsyncGenerator<SummaryEvent, void> {
	const source = await loadSource(input, {
		http: deps.http,
		transcripts: deps.transcripts,
		...(deps.clock ? { clock: deps.clock } : {}),
		...(deps.abortSignal ? { signal: deps.abortSignal } : {}),
	});
	yield* streamSummary(planSummary(source, deps.entry), deps);
}

/** Consumes `streamSummary` and returns only the validated summary and its meta. */
export async function summarize(
	plan: SummaryPlan,
	deps: SummaryDeps,
): Promise<{ readonly summary: Summary; readonly meta: SummaryMeta }> {
	let summary: Summary | undefined;
	let meta: SummaryMeta | undefined;
	for await (const event of streamSummary(plan, deps)) {
		if (event.type === "final") summary = event.summary;
		if (event.type === "meta") meta = event.meta;
	}
	if (!summary || !meta) throw new Error("streamSummary ended without a final summary");
	return { summary, meta };
}
