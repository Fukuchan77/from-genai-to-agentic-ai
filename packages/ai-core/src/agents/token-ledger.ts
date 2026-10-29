import type { AgentRunSummary } from "./guarded-agent";

/** What a provider reported for one call. Any field can be missing (some local models report none). */
export interface UsageInput {
	readonly inputTokens?: number | undefined;
	readonly outputTokens?: number | undefined;
	readonly totalTokens?: number | undefined;
}

export interface UsageTotals {
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly totalTokens: number;
}

export interface RoleUsage extends UsageTotals {
	/** Every call recorded for the role, known or not. */
	readonly calls: number;
	/** Calls whose usage was unavailable; they add nothing to the tokens. */
	readonly unknownCalls: number;
}

export interface TokenBreakdown {
	/** `"unknown"` when no call of the role reported usable usage. */
	readonly byRole: Readonly<Record<string, RoleUsage | "unknown">>;
	/** The sum of the known usage only: unavailable usage is never estimated (Req 4.10). */
	readonly total: UsageTotals;
}

interface RoleState {
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
	calls: number;
	unknownCalls: number;
}

function isCount(value: number | undefined): value is number {
	return value !== undefined && Number.isFinite(value) && value >= 0;
}

/**
 * Totals token usage per role (supervisor, each sub-agent, moderator…) for one run (003 C9). Each
 * role's usage and the overall total come from the same records, so they always add up.
 */
export class TokenLedger {
	readonly #roles = new Map<string, RoleState>();

	record(role: string, usage: UsageInput | undefined): void {
		if (role === "") throw new RangeError("role must not be empty.");
		let state = this.#roles.get(role);
		if (state === undefined) {
			state = { inputTokens: 0, outputTokens: 0, totalTokens: 0, calls: 0, unknownCalls: 0 };
			this.#roles.set(role, state);
		}
		state.calls += 1;
		const input = usage?.inputTokens;
		const output = usage?.outputTokens;
		const total = usage?.totalTokens;
		const known = isCount(total) || (isCount(input) && isCount(output));
		if (!known) {
			state.unknownCalls += 1;
			return;
		}
		state.inputTokens += isCount(input) ? input : 0;
		state.outputTokens += isCount(output) ? output : 0;
		state.totalTokens += isCount(total) ? total : (input ?? 0) + (output ?? 0);
	}

	breakdown(): TokenBreakdown {
		const total = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
		const entries = [...this.#roles].map(([role, state]) => {
			total.inputTokens += state.inputTokens;
			total.outputTokens += state.outputTokens;
			total.totalTokens += state.totalTokens;
			const usage: RoleUsage | "unknown" =
				state.unknownCalls === state.calls ? "unknown" : Object.freeze({ ...state });
			return [role, usage] as const;
		});
		return Object.freeze({
			byRole: Object.freeze(Object.fromEntries(entries)),
			total: Object.freeze(total),
		});
	}
}

/**
 * The ledger's usage for one finished run (003 W1 review F-10). `AgentRunSummary.totalTokens` is
 * input and output (cache reads and reasoning are inside those two). A run that took no step, or
 * whose provider reported nothing, is `undefined`: unavailable, never estimated.
 */
export function usageFromRun(
	summary: Pick<AgentRunSummary, "totalTokens">,
): UsageInput | undefined {
	const { input, output } = summary.totalTokens;
	if (input + output === 0) return undefined;
	return { inputTokens: input, outputTokens: output, totalTokens: input + output };
}
