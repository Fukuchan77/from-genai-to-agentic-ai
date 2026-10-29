import { DEFAULT_INTERVIEW } from "../config/defaults";
import { PlatformError } from "../errors";

/**
 * Interview state and its transitions (Req 5.3, 5.5, CL-11). Every function here is pure: it
 * returns a new state and never mutates its input. The state is persona-independent, so the
 * interview, document and registry code can all depend on it.
 */

/** One extracted requirement, tagged with the persona whose answer it came from. */
export interface RequirementItem {
	readonly text: string;
	readonly personaId: string;
}

export interface Requirements {
	readonly functional: readonly RequirementItem[];
	readonly nonFunctional: readonly RequirementItem[];
	readonly constraints: readonly RequirementItem[];
	readonly unconfirmed: readonly RequirementItem[];
}

export type RequirementCategory = keyof Requirements;

export const REQUIREMENT_CATEGORIES = [
	"functional",
	"nonFunctional",
	"constraints",
	"unconfirmed",
] as const satisfies readonly RequirementCategory[];

export const EMPTY_REQUIREMENTS: Requirements = Object.freeze({
	functional: Object.freeze([]),
	nonFunctional: Object.freeze([]),
	constraints: Object.freeze([]),
	unconfirmed: Object.freeze([]),
});

/** What the learner submitted for one question. */
export interface InterviewAnswer {
	readonly questionId: string;
	readonly personaId: string;
	readonly text: string;
}

/** An answer as stored: `round` is the number of rounds already closed when it was recorded. */
export interface RecordedAnswer extends InterviewAnswer {
	readonly round: number;
}

export interface InterviewState {
	readonly answers: readonly RecordedAnswer[];
	readonly requirements: Requirements;
	/** Rounds closed so far (0 before the first verdict). */
	readonly round: number;
	readonly maxRounds: number;
	readonly completed: boolean;
	/** True when the interview ended at the round limit instead of on a sufficient verdict. */
	readonly forcedEnd: boolean;
	/** Items the latest verdict reported as missing. */
	readonly missing: readonly string[];
}

/** The effective sufficiency verdict (the caller has already applied the `missing` check). */
export interface RoundVerdict {
	readonly sufficient: boolean;
	readonly missing: readonly string[];
}

export function createInterviewState(
	options: { readonly maxRounds?: number } = {},
): InterviewState {
	const maxRounds = options.maxRounds ?? DEFAULT_INTERVIEW.maxRounds;
	if (!Number.isInteger(maxRounds) || maxRounds < 1) {
		throw new PlatformError("invalid-request", "maxRounds must be a positive integer.", {
			maxRounds,
		});
	}
	return {
		answers: [],
		requirements: EMPTY_REQUIREMENTS,
		round: 0,
		maxRounds,
		completed: false,
		forcedEnd: false,
		missing: [],
	};
}

/**
 * Adds the extracted items to `current`, never removing one. Blank items and items already
 * present in the same category (compared after trimming) are skipped, so the first source persona
 * wins. Returns `current` itself when nothing was added.
 */
export function mergeRequirements(current: Requirements, extracted: Requirements): Requirements {
	let changed = false;
	const merged = { ...current };
	for (const category of REQUIREMENT_CATEGORIES) {
		const items = [...current[category]];
		const seen = new Set(items.map((item) => item.text.trim()));
		for (const item of extracted[category]) {
			const text = item.text.trim();
			if (text === "" || seen.has(text)) continue;
			seen.add(text);
			items.push({ text, personaId: item.personaId });
		}
		if (items.length !== current[category].length) {
			changed = true;
			merged[category] = items;
		}
	}
	return changed ? merged : current;
}

/**
 * Records one answer. `extracted` is what the extraction found in it; `undefined` or an empty
 * result means the answer links to no requirement (small talk), and the requirements stay the
 * same object. Rejected after completion (Req 5.3, the route maps this to 409).
 */
export function recordAnswer(
	state: InterviewState,
	answer: InterviewAnswer,
	extracted: Requirements | undefined,
): InterviewState {
	assertOpen(state);
	return {
		...state,
		answers: [...state.answers, { ...answer, round: state.round }],
		requirements: extracted ? mergeRequirements(state.requirements, extracted) : state.requirements,
	};
}

export function isRoundLimitReached(state: InterviewState): boolean {
	return state.round >= state.maxRounds;
}

/**
 * Closes the current round with the sufficiency verdict (Req 5.5). A sufficient verdict completes
 * the interview; otherwise it stays open until the round limit, where it completes with
 * `forcedEnd` and the latest `missing` list for the document's unconfirmed chapter (Req 5.6).
 */
export function closeRound(state: InterviewState, verdict: RoundVerdict): InterviewState {
	assertOpen(state);
	const closed = { ...state, round: state.round + 1, missing: [...verdict.missing] };
	if (verdict.sufficient) return { ...closed, completed: true };
	if (isRoundLimitReached(closed)) return { ...closed, completed: true, forcedEnd: true };
	return closed;
}

function assertOpen(state: InterviewState): void {
	if (state.completed) {
		throw new PlatformError("invalid-request", "The interview is already completed.", {
			reason: "interview-completed",
		});
	}
}
