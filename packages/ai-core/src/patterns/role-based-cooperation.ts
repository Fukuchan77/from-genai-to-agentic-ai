import { AISDKError, type LanguageModel } from "ai";
import type { GuardedToolSet } from "../aci/types";
import {
	type AgentRunSummary,
	createGuardedAgent,
	type LoopLimits,
	type StopReason,
} from "../agents";
import { PlatformError } from "../errors";
import type { Clock } from "../ports/clock";
import {
	assertWithinLimit,
	resolveWorkflowLimits,
	type WorkflowLimitOverrides,
} from "../workflows/limits";

/** One role: its own instructions, model and tools (a research role may search, a reviewer may not). */
export interface Role {
	readonly name: string;
	readonly instructions: string;
	readonly model: LanguageModel;
	readonly tools: GuardedToolSet;
}

export interface RoleOutput {
	readonly role: string;
	/** Empty when the role ended before producing text (error, abort, timeout). */
	readonly output: string;
	readonly run: AgentRunSummary;
}

export interface CooperationResult {
	readonly outputs: readonly RoleOutput[];
	/** The output of the last role that produced one. */
	readonly final: string;
	/** Present when the hand-off ended before every role ran. */
	readonly stopped?: "budget-exhausted" | StopReason;
}

export interface CooperateByRoleParams {
	readonly roles: readonly Role[];
	readonly task: string;
	/** `maxTotalTokens` is shared by all roles; the other limits apply to each role's own run. */
	readonly budget: LoopLimits;
	readonly clock: Clock;
	readonly signal: AbortSignal;
	readonly limits?: WorkflowLimitOverrides | undefined;
	/**
	 * Notified right after each role finishes, in role order, with the same `RoleOutput` object that
	 * lands in `outputs`; the next role starts only after the returned promise settles. A role that
	 * ended in `error`, `aborted` or `timeout` is notified too (with empty `output`), and it is the
	 * last notification. A role that never ran (budget spent, signal already aborted) or whose
	 * environment error is rethrown is not notified.
	 *
	 * A notification that throws or rejects is swallowed: a failing observer (for example a closed UI
	 * stream) must not change the hand-off or its result.
	 */
	readonly onRoleOutput?: ((output: RoleOutput) => void | Promise<void>) | undefined;
}

/** A role that ended like this made no usable output, so the hand-off ends. */
const FATAL_STOPS: ReadonlySet<StopReason> = new Set(["error", "aborted", "timeout"]);

function isEnvironmentError(error: unknown): boolean {
	return (
		AISDKError.isInstance(error) ||
		(error instanceof PlatformError && error.code !== "output-invalid")
	);
}

function assertValidRoles(roles: readonly Role[], maxRoles: number): void {
	assertWithinLimit("roles", roles.length, maxRoles);
	const names = roles.map((role) => role.name);
	if (new Set(names).size !== names.length) {
		throw new PlatformError("invalid-request", "役割の名前は重複させないでください。");
	}
}

function promptFor(role: string, task: string, earlier: readonly RoleOutput[]): string {
	return [
		`[役割: ${role}]\n<task>\n${task}\n</task>`,
		...earlier.map((entry) => `<previous role="${entry.role}">\n${entry.output}\n</previous>`),
	].join("\n\n");
}

async function notify(
	onRoleOutput: CooperateByRoleParams["onRoleOutput"],
	entry: RoleOutput,
): Promise<void> {
	try {
		await onRoleOutput?.(entry);
	} catch {
		// An observer failure is not an agent failure.
	}
}

function tokensUsed(run: AgentRunSummary): number {
	return run.totalTokens.input + run.totalTokens.output;
}

/**
 * Role-Based Cooperation (Req 4.7): roles work in order, each as its own guarded `ToolLoopAgent`,
 * and each sees the task and what the earlier roles produced. All roles share one token budget
 * (CL-8): a role gets what is left as its `maxTotalTokens`, and when nothing is left the next role
 * does not run. A role that ends in `error`, `aborted` or `timeout` ends the hand-off too. Either
 * way the result keeps what was produced and names why it stopped.
 *
 * This is the one place in `patterns/` that builds an agent loop; the other patterns are plain
 * compositions of model calls.
 */
export async function cooperateByRole(params: CooperateByRoleParams): Promise<CooperationResult> {
	const limits = resolveWorkflowLimits(params.limits);
	assertValidRoles(params.roles, limits.maxRoles);

	const outputs: RoleOutput[] = [];
	let final = "";
	let remaining = params.budget.maxTotalTokens;
	let stopped: CooperationResult["stopped"];
	for (const role of params.roles) {
		if (params.signal.aborted) {
			stopped = "aborted";
			break;
		}
		if (remaining <= 0) {
			stopped = "budget-exhausted";
			break;
		}
		const guarded = createGuardedAgent({
			model: role.model,
			instructions: role.instructions,
			tools: role.tools,
			limits: { ...params.budget, maxTotalTokens: remaining },
			clock: params.clock,
			signal: params.signal,
		});
		let text = "";
		try {
			const result = await guarded.agent.generate({
				prompt: promptFor(role.name, params.task, outputs),
				abortSignal: guarded.abortSignal,
			});
			text = result.text;
		} catch (error) {
			// The guarded agent has already recorded the cause in its summary. A provider outage or a
			// request error is the caller's to answer (503 / 400), not a result to report as 200.
			if (!params.signal.aborted && isEnvironmentError(error)) throw error;
		}
		const run = await guarded.done;
		const entry: RoleOutput = { role: role.name, output: text, run };
		outputs.push(entry);
		await notify(params.onRoleOutput, entry);
		if (FATAL_STOPS.has(run.stopReason)) {
			stopped = run.stopReason;
			break;
		}
		final = text;
		remaining -= tokensUsed(run);
	}
	return { outputs, final, ...(stopped ? { stopped } : {}) };
}
