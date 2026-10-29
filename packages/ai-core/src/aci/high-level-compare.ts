/** What one run of a task cost. `failed` marks a run that did not finish the task. */
export interface RunMetrics {
	readonly steps: number;
	readonly tokens: number;
	readonly failed?: boolean | undefined;
}

export interface ApproachComparison {
	/** Steps the high-level tool saved (low-level minus high-level; negative if it cost more). */
	readonly steps: number;
	/** Tokens the high-level tool saved (low-level minus high-level). */
	readonly tokens: number;
	/** `highLevel.tokens / lowLevel.tokens`; below 1 means the high-level tool is cheaper. */
	readonly ratio: number | undefined;
}

function assertMetrics(label: string, metrics: RunMetrics): void {
	for (const field of ["steps", "tokens"] as const) {
		const value = metrics[field];
		if (!Number.isFinite(value) || value < 0) {
			throw new RangeError(
				`${label}.${field} must be a finite number of at least 0 (received ${value}).`,
			);
		}
	}
}

/**
 * Compares measured runs of the same task done with one high-level tool and with a combination of
 * low-level tools (Req 1.12). It only calculates: running the task is the caller's job. A ratio
 * is computed only when both runs finished and the low-level run used tokens.
 */
export function compareApproaches(runs: {
	readonly highLevel: RunMetrics;
	readonly lowLevel: RunMetrics;
}): ApproachComparison {
	const { highLevel, lowLevel } = runs;
	assertMetrics("highLevel", highLevel);
	assertMetrics("lowLevel", lowLevel);
	const bothFinished = highLevel.failed !== true && lowLevel.failed !== true;
	return {
		steps: lowLevel.steps - highLevel.steps,
		tokens: lowLevel.tokens - highLevel.tokens,
		ratio: bothFinished && lowLevel.tokens > 0 ? highLevel.tokens / lowLevel.tokens : undefined,
	};
}
