import { isStepCount, type LanguageModelUsage, type StepResult, type ToolSet } from "ai";
import type { Clock } from "../ports/clock";

/** The stop conditions a guarded agent always sets (Req 6.1); the names match `StopReason`. */
export const STOP_CONDITION_NAMES = ["step-limit", "token-budget", "timeout"] as const;

export type StopConditionName = (typeof STOP_CONDITION_NAMES)[number];

/** The only part of an AI SDK `StepResult` the stop conditions read. */
export interface StepUsageView {
	readonly usage: Pick<LanguageModelUsage, "inputTokens" | "outputTokens">;
}

/**
 * A stop condition over the minimal step shape. Because it only reads `usage`, it is assignable to
 * the AI SDK `StopCondition<TOOLS>` for every tool set, so it can go straight into `stopWhen`.
 */
export type GuardStopCondition = (options: {
	steps: readonly StepUsageView[];
}) => boolean | PromiseLike<boolean>;

/**
 * Which stop conditions fired during one run. `fired()` lists them in the canonical order of
 * `STOP_CONDITION_NAMES`, not in firing order: the SDK evaluates all conditions concurrently, so
 * firing order is not meaningful; `deriveStopReason` applies its own priority.
 */
export interface StopConditionRecord {
	fired(): readonly StopConditionName[];
	has(name: StopConditionName): boolean;
}

/** The writable side of a record; only the stop conditions of the same run mark it. */
export interface StopConditionRecorder extends StopConditionRecord {
	mark(name: StopConditionName): void;
}

/**
 * Creates an empty record for one run. Create one per run (ADR-6): a record shared between runs
 * would leak one run's stop reason into another.
 */
export function createStopConditionRecord(): StopConditionRecorder {
	const fired = new Set<StopConditionName>();
	return {
		fired: () => Object.freeze(STOP_CONDITION_NAMES.filter((name) => fired.has(name))),
		has: (name) => fired.has(name),
		mark: (name) => {
			fired.add(name);
		},
	};
}

function assertPositiveInteger(value: number, name: string): void {
	if (!Number.isInteger(value) || value <= 0) {
		throw new RangeError(`${name} must be a positive integer`);
	}
}

function recordIf(
	record: StopConditionRecorder,
	name: StopConditionName,
	reached: boolean,
): boolean {
	if (reached) record.mark(name);
	return reached;
}

/**
 * Stops when the number of completed steps reaches `maxSteps`. Delegates the comparison to AI SDK
 * `isStepCount` (equality on the step count) so the semantics stay those of the SDK.
 */
export function stepLimit(maxSteps: number, record: StopConditionRecorder): GuardStopCondition {
	assertPositiveInteger(maxSteps, "maxSteps");
	const atLimit = isStepCount(maxSteps);
	return async ({ steps }) => {
		// `isStepCount` only reads `steps.length`, so the narrowed step view is safe to pass through.
		const reached = await atLimit({ steps: steps as unknown as StepResult<ToolSet>[] });
		return recordIf(record, "step-limit", reached);
	};
}

/**
 * Stops when the sum of `inputTokens + outputTokens` over all completed steps reaches
 * `maxTotalTokens`. Evaluated only when a step completes, so the step that crosses the budget runs
 * to completion (Req 6.1 approximation). Missing counts are treated as zero.
 */
export function tokenBudget(
	maxTotalTokens: number,
	record: StopConditionRecorder,
): GuardStopCondition {
	assertPositiveInteger(maxTotalTokens, "maxTotalTokens");
	return ({ steps }) => {
		let total = 0;
		for (const { usage } of steps) total += (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
		return recordIf(record, "token-budget", total >= maxTotalTokens);
	};
}

/**
 * Stops when `clock.now() - startedAt` reaches `maxDurationMs`. `startedAt` defaults to the time the
 * condition is created; pass the run start time explicitly when the run started earlier. Evaluated
 * only when a step completes; a hung LLM call is cut by the composed abort signal instead (C8).
 */
export function deadline(
	clock: Clock,
	maxDurationMs: number,
	record: StopConditionRecorder,
	startedAt: number = clock.now(),
): GuardStopCondition {
	assertPositiveInteger(maxDurationMs, "maxDurationMs");
	return () => recordIf(record, "timeout", clock.now() - startedAt >= maxDurationMs);
}

export interface RunStopConditionsOptions {
	readonly limits: {
		readonly maxSteps: number;
		readonly maxTotalTokens: number;
		readonly maxDurationMs: number;
	};
	readonly clock: Clock;
	/** The run start time (`clock.now()` when the run's agent was created). */
	readonly startedAt: number;
}

export interface RunStopConditions {
	/**
	 * Pass as `ToolLoopAgent`'s `stopWhen` directly (the SDK's `Arrayable` takes a mutable array, so
	 * this is a fresh array per run). Order: step-limit, token-budget, timeout.
	 */
	readonly stopWhen: GuardStopCondition[];
	readonly record: StopConditionRecord;
}

/** Creates the three mandatory stop conditions of one run, bound to a fresh record. */
export function createRunStopConditions(options: RunStopConditionsOptions): RunStopConditions {
	const { limits, clock, startedAt } = options;
	const record = createStopConditionRecord();
	return Object.freeze({
		stopWhen: [
			stepLimit(limits.maxSteps, record),
			tokenBudget(limits.maxTotalTokens, record),
			deadline(clock, limits.maxDurationMs, record, startedAt),
		],
		record: Object.freeze({ fired: record.fired, has: record.has }),
	});
}
