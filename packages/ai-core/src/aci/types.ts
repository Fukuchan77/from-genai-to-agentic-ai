import type { Tool, ToolSet } from "ai";
import type { z } from "zod";
import type { FeatureId, RequiredEnvVariable } from "../config/feature-requirements";
import type { Clock } from "../ports/clock";
import type { JsonSchemaNode } from "./description-check";
import type { FatalLatch } from "./fatal";

/** Risk class of a tool. M1 registers only `read-only` tools (constitution principle 6). */
export const TOOL_RISKS = ["read-only", "write", "destructive"] as const;
export type ToolRisk = (typeof TOOL_RISKS)[number];

/** Failure classes shared with 003 Req 1.3. M1 produces only `recoverable` and `timeout`. */
export type ToolFailureKind = "recoverable" | "fatal" | "timeout";

export interface ToolFailure {
	readonly kind: ToolFailureKind;
	/** Learner-facing summary. Never contains secrets, raw tool arguments or stack traces. */
	readonly summary: string;
	readonly nextAction?: string | undefined;
}

/** The value a converted tool returns to the model (Req 5.8). */
export type ToolOutcome<T> =
	| { readonly ok: true; readonly data: T }
	| { readonly ok: false; readonly failure: ToolFailure };

/** Per-run settings every converted tool receives (Req 6.4). */
export interface ToolRuntime {
	readonly clock: Clock;
	/** Upper bound for one tool execution, from `AGENT_TOOL_TIMEOUT_MS`. */
	readonly toolTimeoutMs: number;
	/**
	 * This run's fatal-error latch. Omit it to keep M1's behaviour, where every tool error is
	 * recoverable and the loop continues.
	 */
	readonly fatal?: FatalLatch | undefined;
}

export interface AciToolContext {
	/** Aborts when the caller aborts or the effective tool timeout elapses. */
	readonly abortSignal: AbortSignal;
	readonly clock: Clock;
	readonly toolCallId: string;
}

export interface AciToolDefinition<INPUT, OUTPUT> {
	readonly name: string;
	readonly description: string;
	readonly inputSchema: z.ZodType<INPUT>;
	/**
	 * Set for a tool whose input is described by a JSON Schema from outside, such as an MCP server's
	 * (003 CL-25). The model receives this schema as it is, the description check reads it with
	 * `checkJsonSchemaDescription`, and `inputSchema` only validates the input before the call (the
	 * server validates it again).
	 */
	readonly externalInputSchema?: JsonSchemaNode | undefined;
	readonly risk: ToolRisk;
	/** Can only shorten `ToolRuntime.toolTimeoutMs`, never extend it. */
	readonly timeoutMs?: number | undefined;
	/** Feature whose environment variables must be set for the tool to be registered. */
	readonly requiredFeature?: FeatureId | undefined;
	execute(input: INPUT, context: AciToolContext): Promise<OUTPUT> | OUTPUT;
}

declare const aciToolBrand: unique symbol;

interface AciToolMetadata {
	/**
	 * Type-level mark that only `defineAciTool` adds, so a hand-built object is a type error where an
	 * `AciTool` is required. `buildToolSet` also checks the origin at run time (W3 review L12).
	 */
	readonly [aciToolBrand]: true;
	readonly name: string;
	readonly description: string;
	/** The Zod schema the tool was defined with (the model receives its JSON Schema). */
	readonly inputSchema: z.ZodType;
	readonly risk: ToolRisk;
	readonly timeoutMs: number | undefined;
	readonly requiredFeature: FeatureId | undefined;
}

/** A tool that is not yet an AI SDK `Tool`; `toTool` converts it with a `ToolRuntime`. */
export interface AciTool<INPUT, OUTPUT> extends AciToolMetadata {
	toTool(runtime: ToolRuntime): Tool<INPUT, ToolOutcome<OUTPUT>>;
}

/**
 * An `AciTool` of any input and output type. `Tool<INPUT>` is invariant in `INPUT`, so a list of
 * differently typed tools (`buildToolSet`'s argument) needs this erased form.
 */
export interface AnyAciTool extends AciToolMetadata {
	toTool(runtime: ToolRuntime): Tool;
}

/**
 * Which features are usable in this process. A tool with a `requiredFeature` is registered
 * only when the value for that feature is `true`.
 */
export type ToolAvailability = Readonly<Partial<Record<FeatureId, boolean>>>;

export interface DisabledTool {
	readonly name: string;
	readonly reason: string;
	readonly requiredEnv: readonly RequiredEnvVariable[];
}

declare const guardedToolSetBrand: unique symbol;

/**
 * A `ToolSet` that passed the risk check of `buildToolSet`. The brand symbol is not exported,
 * so only `buildToolSet` can produce one; a raw `ToolSet` is a type error where this is required.
 */
export type GuardedToolSet<TOOLS extends ToolSet = ToolSet> = TOOLS & {
	readonly [guardedToolSetBrand]: true;
};

export interface BuiltToolSet {
	readonly tools: GuardedToolSet;
	readonly disabled: readonly DisabledTool[];
}
