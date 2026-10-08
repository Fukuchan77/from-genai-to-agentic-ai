import type { StopConditionName, StopConditionRecord } from "./stop-conditions";

/** The closed vocabulary of why an agent loop stopped (Req 6.2). */
export const STOP_REASONS = Object.freeze([
	"completed",
	"step-limit",
	"token-budget",
	"timeout",
	"aborted",
	"error",
] as const);

export type StopReason = (typeof STOP_REASONS)[number];

/**
 * Which side of the composed abort signal aborted the run: the caller's signal (the learner pressed
 * stop; `request.signal` in a Route Handler) or the run's own `maxDurationMs` timeout signal.
 */
export type AbortCause = "caller" | "timeout";

export interface StopReasonInput {
	/** Set when the composed abort signal aborted; omit when the run was not aborted. */
	readonly abort?: AbortCause;
	/** True when the run ended with an unhandled error that is not an abort. */
	readonly errored: boolean;
	/** The stop conditions that fired, as a list or the run's `StopConditionRecord`. */
	readonly fired: readonly StopConditionName[] | StopConditionRecord;
}

/** Fired stop conditions from the most to the least significant. */
const FIRED_PRIORITY: readonly StopConditionName[] = ["timeout", "token-budget", "step-limit"];

/**
 * Derives the single stop reason of a run. Priority: abort (`aborted` for the caller, `timeout` for
 * the duration signal) → `error` → fired stop condition (`timeout` → `token-budget` →
 * `step-limit`) → `completed`. Several conditions can fire on the same step because the SDK
 * evaluates them all; the fixed priority keeps the result deterministic.
 */
export function deriveStopReason(input: StopReasonInput): StopReason {
	if (input.abort === "caller") return "aborted";
	if (input.abort === "timeout") return "timeout";
	if (input.errored) return "error";
	const fired = "has" in input.fired ? input.fired.fired() : input.fired;
	return FIRED_PRIORITY.find((name) => fired.includes(name)) ?? "completed";
}
