import {
	type Instructions,
	type LanguageModel,
	type LanguageModelUsage,
	type StepResult,
	type StopCondition,
	ToolLoopAgent,
	type ToolLoopAgentSettings,
	type ToolSet,
} from "ai";
import type { GuardedToolSet } from "../aci/types";
import { ConfigError } from "../config/load";
import { PlatformError } from "../errors";
import type { Clock } from "../ports/clock";
import { createRunStopConditions } from "./stop-conditions";
import { type AbortCause, deriveStopReason, type StopReason } from "./stop-reason";

/** The most tools one agent may hold (constitution principle 2). */
export const MAX_AGENT_TOOLS = 20;

/** Per-run loop limits (ADR-6). Every value is a positive integer. */
export interface LoopLimits {
	readonly maxSteps: number;
	readonly maxTotalTokens: number;
	readonly maxDurationMs: number;
	/** Upper bound for one tool execution; `buildToolSet` applies it through `ToolRuntime`. */
	readonly toolTimeoutMs: number;
}

const LOOP_LIMIT_FIELDS = [
	"maxSteps",
	"maxTotalTokens",
	"maxDurationMs",
	"toolTimeoutMs",
] as const satisfies readonly (keyof LoopLimits)[];

export interface AgentTokenTotals {
	readonly input: number;
	readonly output: number;
	readonly cacheRead: number;
	readonly reasoning: number;
}

export interface AgentRunError {
	readonly name: string;
	readonly message: string;
}

/** What one run did and why it stopped (Req 5.6, 6.2, 6.5). Frozen once finalised. */
export interface AgentRunSummary {
	readonly stopReason: StopReason;
	/** Completed steps when the run stopped. */
	readonly steps: number;
	/** Sum of every completed step's `usage`. */
	readonly totalTokens: AgentTokenTotals;
	/** Measured with the injected `Clock` from the agent's creation. */
	readonly elapsedMs: number;
	/** Tool names in call order, duplicates included. */
	readonly toolsCalled: readonly string[];
	/** Set only when `stopReason === "error"`. */
	readonly error: AgentRunError | undefined;
}

/** Receives the summary once per run (UI metadata and tests in M1; traces and eval reports in 004). */
export interface RunObserver {
	onRunEnd(summary: AgentRunSummary): void;
}

export interface GuardedAgentOptions<TOOLS extends ToolSet> {
	readonly model: LanguageModel;
	readonly instructions: Instructions;
	/** Only `buildToolSet` produces one; a raw `ToolSet` is a type error (constitution 6). */
	readonly tools: GuardedToolSet<TOOLS>;
	readonly limits: LoopLimits;
	readonly clock: Clock;
	/** The caller's abort (`request.signal` in a Route Handler). */
	readonly signal: AbortSignal;
	readonly observers?: readonly RunObserver[] | undefined;
}

/** The `run` message metadata sent with the UI stream's `finish` chunk. */
export interface RunMessageMetadata {
	readonly run: AgentRunSummary;
}

/**
 * One run of a guarded `ToolLoopAgent`. Create one per run (ADR-6): the start time, the stop
 * condition record and the step totals live inside this object and are never shared.
 */
export interface GuardedAgent<TOOLS extends ToolSet = ToolSet> {
	/** Pass to `createAgentUIStreamResponse` as `agent`. */
	readonly agent: ToolLoopAgent<never, TOOLS>;
	/**
	 * The caller's signal composed with the `maxDurationMs` timeout. Pass to
	 * `createAgentUIStreamResponse` as `abortSignal`; it reaches the LLM calls and the tools.
	 */
	readonly abortSignal: AbortSignal;
	/** `clock.now()` when the agent was created; the run's start time. */
	readonly startedAt: number;
	/** Pass to `createAgentUIStreamResponse` as `messageMetadata`; adds `run` to `finish`. */
	readonly messageMetadata: (options: {
		readonly part: { readonly type: string };
	}) => RunMessageMetadata | undefined;
	/**
	 * Pass to `createAgentUIStreamResponse` as `onError`. Finalises the summary (`aborted` /
	 * `timeout` when the composed signal aborted, `error` otherwise) and returns a learner-facing
	 * message that never contains the raw error.
	 */
	readonly onError: (error: unknown) => string;
	/** The finalised summary. Throws `PlatformError` before the run has ended. */
	summary(): AgentRunSummary;
	/** Resolves with the summary once it is finalised. */
	readonly done: Promise<AgentRunSummary>;
}

const ERROR_TEXT: Readonly<Record<StopReason, string>> = {
	completed: "エージェントの実行中にエラーが発生しました。",
	"step-limit": "エージェントの実行中にエラーが発生しました。",
	"token-budget": "エージェントの実行中にエラーが発生しました。",
	error: "エージェントの実行中にエラーが発生しました。",
	aborted: "エージェントの実行を中断しました。",
	timeout: "実行時間の上限に達したため、エージェントを停止しました。",
};

const MAX_ERROR_MESSAGE_LENGTH = 200;

function assertValidLimits(limits: LoopLimits): void {
	for (const field of LOOP_LIMIT_FIELDS) {
		const value = limits[field];
		if (!Number.isSafeInteger(value) || value <= 0) {
			throw new ConfigError(
				`LoopLimits.${field} は正の整数にしてください（指定された値: ${String(value)}）。`,
			);
		}
	}
}

function assertToolCount(tools: ToolSet): void {
	const count = Object.keys(tools).length;
	if (count > MAX_AGENT_TOOLS) {
		throw new ConfigError(
			`エージェントに登録できるツールは ${MAX_AGENT_TOOLS} 個までです（指定された数: ${count}）。`,
		);
	}
}

function runError(error: unknown): AgentRunError {
	const name = error instanceof Error ? error.name : "UnknownError";
	const message = error instanceof Error ? error.message : String(error);
	return { name, message: message.slice(0, MAX_ERROR_MESSAGE_LENGTH) };
}

/**
 * Creates the guarded agent for one run. The three stop conditions (step limit, token budget,
 * deadline) are always set, the composed abort signal enforces `maxDurationMs` even while an LLM
 * call hangs, and the run summary is finalised exactly once — by `onEnd` on a normal end, by the
 * composed signal's `abort` event, or by `onError` — whichever comes first.
 */
export function createGuardedAgent<TOOLS extends ToolSet>(
	options: GuardedAgentOptions<TOOLS>,
): GuardedAgent<TOOLS> {
	assertValidLimits(options.limits);
	assertToolCount(options.tools);

	const { clock, limits } = options;
	const observers = [...(options.observers ?? [])];
	const startedAt = clock.now();
	const { stopWhen, record } = createRunStopConditions({ limits, clock, startedAt });
	const timeoutSignal = clock.timeoutSignal(limits.maxDurationMs);
	const abortSignal = AbortSignal.any([options.signal, timeoutSignal]);

	let steps = 0;
	const totals = { input: 0, output: 0, cacheRead: 0, reasoning: 0 };
	const toolsCalled: string[] = [];
	let finalSummary: AgentRunSummary | undefined;
	let resolveDone: (summary: AgentRunSummary) => void = () => {};
	const done = new Promise<AgentRunSummary>((resolve) => {
		resolveDone = resolve;
	});

	function abortCause(): AbortCause | undefined {
		if (!abortSignal.aborted) return undefined;
		// AbortSignal.any adopts the reason of the first source signal that aborted.
		return timeoutSignal.aborted && abortSignal.reason === timeoutSignal.reason
			? "timeout"
			: "caller";
	}

	function finalise(error?: unknown): AgentRunSummary {
		if (finalSummary !== undefined) return finalSummary;
		abortSignal.removeEventListener("abort", onAbort);
		const abort = abortCause();
		const errored = abort === undefined && error !== undefined;
		const summary: AgentRunSummary = Object.freeze({
			stopReason: deriveStopReason({ ...(abort ? { abort } : {}), errored, fired: record }),
			steps,
			totalTokens: Object.freeze({ ...totals }),
			elapsedMs: clock.now() - startedAt,
			toolsCalled: Object.freeze([...toolsCalled]),
			error: errored ? Object.freeze(runError(error)) : undefined,
		});
		finalSummary = summary;
		resolveDone(summary);
		for (const observer of observers) {
			try {
				observer.onRunEnd(summary);
			} catch {
				// An observer must not change the run's outcome or starve the other observers.
			}
		}
		return summary;
	}

	function onAbort(): void {
		finalise();
	}

	function addUsage(usage: LanguageModelUsage): void {
		totals.input += usage.inputTokens ?? 0;
		totals.output += usage.outputTokens ?? 0;
		totals.cacheRead += usage.inputTokenDetails?.cacheReadTokens ?? 0;
		totals.reasoning += usage.outputTokenDetails?.reasoningTokens ?? 0;
	}

	const onStepEnd = (step: StepResult<TOOLS>): void => {
		if (finalSummary !== undefined) return;
		steps += 1;
		addUsage(step.usage);
		for (const call of step.toolCalls) toolsCalled.push(call.toolName);
	};
	// The cast resolves `ToolsContextSettings<TOOLS>`, a conditional type TypeScript cannot evaluate
	// for a generic TOOLS. ACI tools take no `toolsContext`, so the settings need none.
	const settings = {
		model: options.model,
		instructions: options.instructions,
		tools: options.tools,
		stopWhen: stopWhen satisfies StopCondition<TOOLS>[],
		onStepEnd,
		onEnd: () => {
			finalise();
		},
	} as unknown as ToolLoopAgentSettings<never, TOOLS>;
	const agent = new ToolLoopAgent<never, TOOLS>(settings);

	if (abortSignal.aborted) finalise();
	else abortSignal.addEventListener("abort", onAbort, { once: true });

	return Object.freeze({
		agent,
		abortSignal,
		startedAt,
		done,
		// In AI SDK v7 the UI stream can see `finish` before `streamText` runs `onEnd` (onEnd fires in
		// the flush after `finish` is forwarded), so `finish` finalises too. Every step has ended and
		// every stop condition has been evaluated by then, so the result equals the `onEnd` one.
		messageMetadata: ({ part }: { readonly part: { readonly type: string } }) =>
			part.type === "finish" ? { run: finalise() } : undefined,
		onError: (error: unknown) => ERROR_TEXT[finalise(error).stopReason],
		summary: () => {
			if (finalSummary === undefined) {
				throw new PlatformError(
					"invalid-request",
					"エージェントの実行が終わる前に実行サマリは取得できません。",
				);
			}
			return finalSummary;
		},
	});
}
