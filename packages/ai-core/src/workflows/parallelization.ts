import { toStepError } from "./errors";
import { assertWithinLimit, resolveWorkflowLimits, type WorkflowLimitOverrides } from "./limits";

export interface NamedSection {
	readonly name: string;
}

/**
 * Runs the named tasks at once. The first failure aborts the others through the signal handed to
 * `run` and is thrown once every task has settled; the caller's own abort is thrown as its reason.
 */
async function runAtOnce<S extends NamedSection, R>(
	sections: readonly S[],
	run: (section: S, signal: AbortSignal) => Promise<R>,
	signal: AbortSignal | undefined,
): Promise<R[]> {
	signal?.throwIfAborted();
	const internal = new AbortController();
	const combined = signal ? AbortSignal.any([signal, internal.signal]) : internal.signal;
	let failure: { readonly error: unknown } | undefined;
	const results = await Promise.allSettled(
		sections.map(async (section) => {
			try {
				return await run(section, combined);
			} catch (error) {
				if (failure === undefined) {
					failure = { error: toStepError(section.name, error) };
					internal.abort(failure.error);
				}
				throw error;
			}
		}),
	);
	signal?.throwIfAborted();
	if (failure !== undefined) throw failure.error;
	return results.map((outcome) => (outcome as PromiseFulfilledResult<R>).value);
}

export interface ParallelSectionsParams<S extends NamedSection, R> {
	readonly sections: readonly S[];
	readonly run: (section: S, signal: AbortSignal) => Promise<R>;
	readonly limits?: WorkflowLimitOverrides | undefined;
	readonly signal?: AbortSignal | undefined;
}

/**
 * Sectioning (Req 3.5): runs every section in parallel and returns all results in section order.
 * One failing section aborts the rest and fails with a `WorkflowStepError` naming it. The section
 * count is capped by `maxSections` (CL-3).
 */
export async function parallelSections<S extends NamedSection, R>(
	params: ParallelSectionsParams<S, R>,
): Promise<R[]> {
	const limits = resolveWorkflowLimits(params.limits);
	assertWithinLimit("sections", params.sections.length, limits.maxSections);
	return runAtOnce(params.sections, params.run, params.signal);
}

export interface Ballot<T> {
	/** 1-based vote number. */
	readonly index: number;
	readonly value: T;
	readonly label: string;
}

export interface TallyEntry {
	readonly label: string;
	readonly count: number;
}

export type VoteResult<T> =
	| {
			readonly outcome: "majority";
			readonly conclusion: string;
			readonly tally: readonly TallyEntry[];
			readonly ballots: readonly Ballot<T>[];
	  }
	| {
			readonly outcome: "tie";
			readonly tiedLabels: readonly string[];
			readonly tally: readonly TallyEntry[];
			readonly ballots: readonly Ballot<T>[];
	  };

export interface ParallelVoteParams<T> {
	readonly task: string;
	/** Number of votes; defaults to `defaultVotes` and may not exceed `maxVotes`. */
	readonly votes?: number | undefined;
	readonly run: (task: string, voteIndex: number, signal: AbortSignal) => Promise<T>;
	/** Maps a ballot to the label that is counted, so equivalent answers fall together. */
	readonly normalize: (value: T) => string;
	readonly limits?: WorkflowLimitOverrides | undefined;
	readonly signal?: AbortSignal | undefined;
}

/**
 * Voting (Req 3.6): runs the same task `votes` times in parallel and counts the normalized
 * ballots. The conclusion is the label with strictly the most votes. When the top count is shared
 * the result is a `tie` with no conclusion; no label is picked.
 */
export async function parallelVote<T>(params: ParallelVoteParams<T>): Promise<VoteResult<T>> {
	const limits = resolveWorkflowLimits(params.limits);
	const votes = params.votes ?? limits.defaultVotes;
	assertWithinLimit("votes", votes, limits.maxVotes);
	const voters = Array.from({ length: votes }, (_, offset) => ({
		name: `vote-${offset + 1}`,
		index: offset + 1,
	}));
	const values = await runAtOnce(
		voters,
		(voter, signal) => params.run(params.task, voter.index, signal),
		params.signal,
	);
	const ballots = values.map((value, offset) => ({
		index: offset + 1,
		value,
		label: params.normalize(value),
	}));
	const counts = new Map<string, number>();
	for (const ballot of ballots) counts.set(ballot.label, (counts.get(ballot.label) ?? 0) + 1);
	const tally = [...counts].map(([label, count]) => ({ label, count }));
	const top = Math.max(...tally.map((entry) => entry.count));
	const leaders = tally.filter((entry) => entry.count === top).map((entry) => entry.label);
	const sorted = [...tally].sort((a, b) => b.count - a.count);
	const [conclusion] = leaders;
	if (leaders.length === 1 && conclusion !== undefined) {
		return { outcome: "majority", conclusion, tally: sorted, ballots };
	}
	return { outcome: "tie", tiedLabels: leaders, tally: sorted, ballots };
}
