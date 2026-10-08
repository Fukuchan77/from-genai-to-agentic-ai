import { type Tool, type ToolExecutionOptions, tool } from "ai";
import { ConfigError } from "../config/load";
import { PlatformError } from "../errors";
import { raceWithAbort } from "../ports/abort";
import {
	type AciTool,
	type AciToolDefinition,
	TOOL_RISKS,
	type ToolFailure,
	type ToolOutcome,
	type ToolRuntime,
} from "./types";

const TOOL_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/u;

/** Every object `defineAciTool` returned. Module-private, so nothing else can register a tool. */
const definedTools = new WeakSet<object>();

/**
 * True only for an object returned by `defineAciTool`; copies and hand-built look-alikes are
 * false. `buildToolSet` uses it so the name check, timeout and `ToolOutcome` conversion cannot be
 * bypassed.
 */
export function isDefinedAciTool(value: object): boolean {
	return definedTools.has(value);
}
const TIMEOUT_NEXT_ACTION = "入力を小さくして再試行するか、ツールを使わずに回答してください。";
const FAILURE_NEXT_ACTION = "入力を見直して再試行するか、ツールを使わずに回答してください。";

/**
 * A failure a tool reports on purpose. Its `summary` and `nextAction` are shown to the model
 * as they are, so they must not contain secrets or raw tool arguments.
 */
export class ToolExecutionError extends Error {
	readonly summary: string;
	readonly nextAction: string | undefined;

	constructor(summary: string, options: { readonly nextAction?: string } = {}) {
		super(summary);
		this.name = "ToolExecutionError";
		this.summary = summary;
		this.nextAction = options.nextAction;
	}
}

function isPositiveInteger(value: number): boolean {
	return Number.isSafeInteger(value) && value > 0;
}

/** A tool's own limit can only shorten the configured limit (Req 6.4). */
export function effectiveToolTimeoutMs(
	definitionTimeoutMs: number | undefined,
	runtimeTimeoutMs: number,
): number {
	return Math.min(definitionTimeoutMs ?? runtimeTimeoutMs, runtimeTimeoutMs);
}

function assertValidDefinition<INPUT, OUTPUT>(definition: AciToolDefinition<INPUT, OUTPUT>): void {
	if (!TOOL_NAME.test(definition.name)) {
		throw new ConfigError(
			`ツール名「${definition.name}」は英字で始まる64文字以内の英数字・_・- にしてください。`,
		);
	}
	if (!(TOOL_RISKS as readonly string[]).includes(definition.risk)) {
		throw new ConfigError(
			`ツール「${definition.name}」のリスク区分は ${TOOL_RISKS.join(" / ")} のいずれかにしてください。`,
		);
	}
	if (definition.timeoutMs !== undefined && !isPositiveInteger(definition.timeoutMs)) {
		throw new ConfigError(`ツール「${definition.name}」の timeoutMs は正の整数にしてください。`);
	}
}

export function assertValidToolRuntime(runtime: ToolRuntime): void {
	if (!isPositiveInteger(runtime.toolTimeoutMs)) {
		throw new ConfigError("ツールの時間上限（AGENT_TOOL_TIMEOUT_MS）は正の整数にしてください。");
	}
}

function failureFrom(name: string, error: unknown): ToolFailure {
	if (error instanceof ToolExecutionError) {
		return {
			kind: "recoverable",
			summary: error.summary,
			...(error.nextAction === undefined ? {} : { nextAction: error.nextAction }),
		};
	}
	if (error instanceof PlatformError) {
		// PlatformError messages are learner-facing Japanese text without secrets by convention.
		return { kind: "recoverable", summary: error.message, nextAction: FAILURE_NEXT_ACTION };
	}
	const errorName = error instanceof Error ? error.name : typeof error;
	return {
		kind: "recoverable",
		summary: `ツール「${name}」の実行に失敗しました（${errorName}）。`,
		nextAction: FAILURE_NEXT_ACTION,
	};
}

async function executeWithGuards<INPUT, OUTPUT>(
	definition: AciToolDefinition<INPUT, OUTPUT>,
	runtime: ToolRuntime,
	timeoutMs: number,
	input: INPUT,
	options: ToolExecutionOptions<unknown>,
): Promise<ToolOutcome<OUTPUT>> {
	const callerSignal = options.abortSignal;
	if (callerSignal?.aborted) throw callerSignal.reason;

	const timeoutSignal = runtime.clock.timeoutSignal(timeoutMs);
	const abortSignal = callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal;
	try {
		const data = await raceWithAbort(
			Promise.resolve().then(() =>
				definition.execute(input, {
					abortSignal,
					clock: runtime.clock,
					toolCallId: options.toolCallId,
				}),
			),
			abortSignal,
		);
		return { ok: true, data };
	} catch (error) {
		if (abortSignal.aborted) {
			// The first signal to abort decides: a learner's stop propagates, a timeout becomes a result.
			if (timeoutSignal.aborted && abortSignal.reason === timeoutSignal.reason) {
				return {
					ok: false,
					failure: {
						kind: "timeout",
						summary: `ツール「${definition.name}」が時間上限（${timeoutMs} ミリ秒）内に完了しませんでした。`,
						nextAction: TIMEOUT_NEXT_ACTION,
					},
				};
			}
			throw abortSignal.reason;
		}
		return { ok: false, failure: failureFrom(definition.name, error) };
	}
}

/**
 * Defines a tool with a required risk class. Conversion to an AI SDK `Tool` happens later with a
 * `ToolRuntime`, which supplies the clock and the configured timeout.
 *
 * Declared as a const arrow function: the `tool-risk-declared` repo rule treats every
 * `defineAciTool(` / `defineAciTool<...>(` token sequence as a call, a function declaration included.
 */
export const defineAciTool = <INPUT, OUTPUT>(
	definition: AciToolDefinition<INPUT, OUTPUT>,
): AciTool<INPUT, OUTPUT> => {
	assertValidDefinition(definition);
	const aciTool = Object.freeze({
		name: definition.name,
		description: definition.description,
		risk: definition.risk,
		timeoutMs: definition.timeoutMs,
		requiredFeature: definition.requiredFeature,
		toTool(runtime: ToolRuntime): Tool<INPUT, ToolOutcome<OUTPUT>> {
			assertValidToolRuntime(runtime);
			const timeoutMs = effectiveToolTimeoutMs(definition.timeoutMs, runtime.toolTimeoutMs);
			return tool({
				description: definition.description,
				inputSchema: definition.inputSchema,
				execute: (input, options) =>
					executeWithGuards(definition, runtime, timeoutMs, input, options),
			});
		},
	});
	definedTools.add(aciTool);
	// The brand is type-only; `definedTools` is the run-time proof of origin.
	return aciTool as typeof aciTool & AciTool<INPUT, OUTPUT>;
};
