import { DEFAULT_WORKFLOW_LIMITS } from "../config";
import { PlatformError } from "../errors";

export type WorkflowLimits = { readonly [K in keyof typeof DEFAULT_WORKFLOW_LIMITS]: number };

/** `undefined` keeps the default. */
export type WorkflowLimitOverrides = { readonly [K in keyof WorkflowLimits]?: number | undefined };

/**
 * Rejects a caller-supplied count that is not a positive integer or exceeds `max` (CL-3). The
 * workflows own no `ToolLoopAgent`, so these limits are what bounds their LLM calls.
 */
export function assertWithinLimit(name: string, value: number, max: number): void {
	if (!Number.isInteger(value) || value < 1) {
		throw new PlatformError("invalid-request", `${name} は 1 以上の整数で指定してください。`, {
			name,
			value,
			max,
		});
	}
	if (value > max) {
		throw new PlatformError("invalid-request", `${name} は ${max} 以下で指定してください。`, {
			name,
			value,
			max,
		});
	}
}

/**
 * The shipped defaults with the given overrides applied. An override may lower a limit but never
 * raise it above the default, and `undefined` keeps the default.
 */
export function resolveWorkflowLimits(overrides: WorkflowLimitOverrides = {}): WorkflowLimits {
	const limits: Record<string, number> = { ...DEFAULT_WORKFLOW_LIMITS };
	for (const [name, value] of Object.entries(overrides)) {
		if (value === undefined) continue;
		assertWithinLimit(name, value, DEFAULT_WORKFLOW_LIMITS[name as keyof WorkflowLimits]);
		limits[name] = value;
	}
	return Object.freeze(limits) as WorkflowLimits;
}
