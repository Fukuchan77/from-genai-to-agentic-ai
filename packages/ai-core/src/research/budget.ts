import { type TokenBreakdown, TokenLedger, type UsageInput } from "../agents/token-ledger";

export interface BudgetLimits {
	readonly maxCalls: number;
	readonly maxTotalTokens: number;
	/**
	 * Tokens held back for one role (the supervisor, which spends while the others run and is only
	 * recorded when it ends). The others may spend what is left; the role's own spend, up to its
	 * reserve, does not lower that. Beyond the reserve it does.
	 */
	readonly reserve?: { readonly role: string; readonly tokens: number };
}

export type BudgetExhaustion = "calls" | "tokens";

export interface BudgetStatus {
	readonly calls: number;
	readonly maxCalls: number;
	readonly remainingTokens: number;
	/** Why no further call is funded; `undefined` while one is. The call limit is named first. */
	readonly exhausted: BudgetExhaustion | undefined;
}

export interface Budget {
	/**
	 * Grants one sub-agent call, or refuses (`false`) when the call limit is reached or no tokens
	 * remain (CL-17). A refused call is not counted and must not be run.
	 */
	takeCall(): boolean;
	remainingTokens(): number;
	/** Adds a run's usage under its role; `undefined` records that the usage was unavailable. */
	recordUsage(role: string, usage: UsageInput | undefined): void;
	breakdown(): TokenBreakdown;
	status(): BudgetStatus;
}

function assertPositiveInteger(value: number, name: string): void {
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new RangeError(`${name} must be a positive integer`);
	}
}

/**
 * The call count and the shared token budget of one research run (plan C9, CL-17). The Supervisor
 * and the sub-agents together spend `maxTotalTokens`, and each sub-agent call is given what is left.
 * Usage a provider did not report adds nothing; it is never estimated (Req 4.10).
 */
export function createBudget(limits: BudgetLimits): Budget {
	assertPositiveInteger(limits.maxCalls, "maxCalls");
	assertPositiveInteger(limits.maxTotalTokens, "maxTotalTokens");
	const { reserve } = limits;
	if (reserve !== undefined) {
		if (reserve.role === "") throw new RangeError("reserve.role must not be empty");
		assertPositiveInteger(reserve.tokens, "reserve.tokens");
		if (reserve.tokens >= limits.maxTotalTokens) {
			throw new RangeError("reserve.tokens must be less than maxTotalTokens");
		}
	}
	const ledger = new TokenLedger();
	let calls = 0;

	const remainingTokens = () => {
		const { byRole, total } = ledger.breakdown();
		const own = reserve === undefined ? undefined : byRole[reserve.role];
		const ownSpent = own === undefined || own === "unknown" ? 0 : own.totalTokens;
		// The reserved role counts as spending at least its reserve, so the others cannot use it.
		const held = reserve === undefined ? 0 : Math.max(reserve.tokens, ownSpent);
		return Math.max(0, limits.maxTotalTokens - (total.totalTokens - ownSpent) - held);
	};
	const exhausted = (): BudgetExhaustion | undefined => {
		if (calls >= limits.maxCalls) return "calls";
		return remainingTokens() <= 0 ? "tokens" : undefined;
	};

	return {
		takeCall: () => {
			if (exhausted() !== undefined) return false;
			calls += 1;
			return true;
		},
		remainingTokens,
		recordUsage: (role, usage) => ledger.record(role, usage),
		breakdown: () => ledger.breakdown(),
		status: () => ({
			calls,
			maxCalls: limits.maxCalls,
			remainingTokens: remainingTokens(),
			exhausted: exhausted(),
		}),
	};
}
