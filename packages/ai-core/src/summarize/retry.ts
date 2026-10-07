import { SummaryValidationError } from "./errors";

/** Regenerations allowed after the first attempt fails schema validation (Req 4.4). */
export const MAX_REGENERATIONS = 2;

export type AttemptOutcome<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly issues: readonly string[] };

export type AttemptNumber = 1 | 2 | 3;

export interface RegenerationResult<T> {
	readonly value: T;
	readonly attempts: AttemptNumber;
}

export interface RestartNotice {
	/** The attempt that is about to start (2 or 3). */
	readonly attempt: number;
	/** Validation issues of the attempt that just failed. */
	readonly issues: readonly string[];
}

/**
 * Runs `attempt` until it returns a valid outcome, regenerating at most twice. Events of every
 * attempt are forwarded; before a regeneration, `onRestart` may supply an event that tells the
 * consumer to discard what the failed attempt streamed. Errors thrown by `attempt` (as opposed to
 * a validation failure it returns) are not retried. After the third invalid attempt it throws
 * `SummaryValidationError` with the issues of every attempt.
 */
export async function* withRegeneration<E, T>(
	attempt: (
		attemptNumber: number,
		previousIssues: readonly string[] | undefined,
	) => AsyncGenerator<E, AttemptOutcome<T>>,
	onRestart: (notice: RestartNotice) => E | undefined,
): AsyncGenerator<E, RegenerationResult<T>> {
	const issuesByAttempt: (readonly string[])[] = [];
	for (let attemptNumber = 1; attemptNumber <= MAX_REGENERATIONS + 1; attemptNumber += 1) {
		const previousIssues = issuesByAttempt.at(-1);
		if (previousIssues) {
			const restart = onRestart({ attempt: attemptNumber, issues: previousIssues });
			if (restart !== undefined) yield restart;
		}
		const outcome = yield* attempt(attemptNumber, previousIssues);
		if (outcome.ok) return { value: outcome.value, attempts: attemptNumber as AttemptNumber };
		issuesByAttempt.push(outcome.issues);
	}
	throw new SummaryValidationError(issuesByAttempt);
}
