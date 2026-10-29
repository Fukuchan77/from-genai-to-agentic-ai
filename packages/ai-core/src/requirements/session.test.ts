import { describe, expect, it } from "vitest";
import { DEFAULT_INTERVIEW } from "../config/defaults";
import { PlatformError } from "../errors";
import {
	closeRound,
	createInterviewState,
	EMPTY_REQUIREMENTS,
	type InterviewAnswer,
	type InterviewState,
	isRoundLimitReached,
	mergeRequirements,
	type Requirements,
	recordAnswer,
} from "./session";

const answer = (questionId: string, text = "回答"): InterviewAnswer => ({
	questionId,
	personaId: "p1",
	text,
});

const found = (overrides: Partial<Requirements>): Requirements => ({
	...EMPTY_REQUIREMENTS,
	...overrides,
});

function rejection(run: () => unknown): PlatformError {
	try {
		run();
	} catch (error) {
		expect(error).toBeInstanceOf(PlatformError);
		return error as PlatformError;
	}
	throw new Error("expected the transition to be rejected");
}

describe("createInterviewState", () => {
	it("starts at round 0 with nothing collected and the default round limit", () => {
		expect(createInterviewState()).toEqual({
			answers: [],
			requirements: EMPTY_REQUIREMENTS,
			round: 0,
			maxRounds: DEFAULT_INTERVIEW.maxRounds,
			completed: false,
			forcedEnd: false,
			missing: [],
		});
	});

	it("accepts a custom round limit", () => {
		expect(createInterviewState({ maxRounds: 2 }).maxRounds).toBe(2);
	});

	it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
		"rejects maxRounds %s as invalid-request",
		(maxRounds) => {
			expect(rejection(() => createInterviewState({ maxRounds })).code).toBe("invalid-request");
		},
	);
});

describe("mergeRequirements", () => {
	it("appends new items per category and keeps the source persona of each item", () => {
		const current = found({ functional: [{ text: "ログイン", personaId: "p1" }] });
		const merged = mergeRequirements(
			current,
			found({
				functional: [{ text: "検索", personaId: "p2" }],
				nonFunctional: [{ text: "応答 1 秒", personaId: "p2" }],
				constraints: [{ text: "予算 100 万円", personaId: "p3" }],
				unconfirmed: [{ text: "運用体制", personaId: "p3" }],
			}),
		);
		expect(merged).toEqual({
			functional: [
				{ text: "ログイン", personaId: "p1" },
				{ text: "検索", personaId: "p2" },
			],
			nonFunctional: [{ text: "応答 1 秒", personaId: "p2" }],
			constraints: [{ text: "予算 100 万円", personaId: "p3" }],
			unconfirmed: [{ text: "運用体制", personaId: "p3" }],
		});
	});

	it("never drops an existing item when the extraction omits it", () => {
		const current = found({ constraints: [{ text: "予算", personaId: "p1" }] });
		expect(mergeRequirements(current, EMPTY_REQUIREMENTS).constraints).toEqual(current.constraints);
	});

	it("skips an item that is already present in the same category, keeping the first source", () => {
		const current = found({ functional: [{ text: "ログイン", personaId: "p1" }] });
		const merged = mergeRequirements(
			current,
			found({ functional: [{ text: " ログイン ", personaId: "p2" }] }),
		);
		expect(merged.functional).toEqual([{ text: "ログイン", personaId: "p1" }]);
	});

	it("compares against existing items after trimming, even if they were stored untrimmed", () => {
		const current = found({ functional: [{ text: " ログイン ", personaId: "p1" }] });
		expect(
			mergeRequirements(current, found({ functional: [{ text: "ログイン", personaId: "p2" }] })),
		).toBe(current);
	});

	it("stores new items trimmed and with only text and personaId", () => {
		const incoming = { text: " 検索 ", personaId: "p2", extra: "noise" };
		const merged = mergeRequirements(EMPTY_REQUIREMENTS, found({ functional: [incoming] }));
		expect(merged.functional).toStrictEqual([{ text: "検索", personaId: "p2" }]);
	});

	it("keeps the same text in two different categories", () => {
		const merged = mergeRequirements(
			found({ functional: [{ text: "監査ログ", personaId: "p1" }] }),
			found({ nonFunctional: [{ text: "監査ログ", personaId: "p1" }] }),
		);
		expect(merged.functional).toHaveLength(1);
		expect(merged.nonFunctional).toHaveLength(1);
	});

	it("ignores blank items", () => {
		const current = found({ functional: [{ text: "ログイン", personaId: "p1" }] });
		const merged = mergeRequirements(
			current,
			found({ functional: [{ text: "  ", personaId: "p1" }] }),
		);
		expect(merged).toBe(current);
	});

	it("deduplicates repeats inside one extraction", () => {
		const merged = mergeRequirements(
			EMPTY_REQUIREMENTS,
			found({
				functional: [
					{ text: "検索", personaId: "p1" },
					{ text: "検索", personaId: "p2" },
				],
			}),
		);
		expect(merged.functional).toEqual([{ text: "検索", personaId: "p1" }]);
	});

	it("returns the current object itself when nothing is added", () => {
		const current = found({ functional: [{ text: "ログイン", personaId: "p1" }] });
		expect(mergeRequirements(current, EMPTY_REQUIREMENTS)).toBe(current);
	});

	it("does not mutate its inputs", () => {
		const current = found({ functional: [{ text: "ログイン", personaId: "p1" }] });
		const snapshot = structuredClone(current);
		mergeRequirements(current, found({ functional: [{ text: "検索", personaId: "p2" }] }));
		expect(current).toEqual(snapshot);
	});
});

describe("recordAnswer", () => {
	it("stores the answer with the current round and merges the extracted requirements", () => {
		const state = createInterviewState();
		const next = recordAnswer(
			state,
			answer("q1", "ログインしたい"),
			found({ functional: [{ text: "ログイン", personaId: "p1" }] }),
		);
		expect(next.answers).toEqual([
			{ questionId: "q1", personaId: "p1", text: "ログインしたい", round: 0 },
		]);
		expect(next.requirements.functional).toEqual([{ text: "ログイン", personaId: "p1" }]);
	});

	it("tags answers recorded after a round closed with the new round number", () => {
		const closed = closeRound(createInterviewState(), { sufficient: false, missing: ["予算"] });
		expect(recordAnswer(closed, answer("q2"), undefined).answers[0]?.round).toBe(1);
	});

	it("appends answers in order", () => {
		let state = createInterviewState();
		state = recordAnswer(state, answer("q1"), undefined);
		state = recordAnswer(state, answer("q2"), undefined);
		expect(state.answers.map((a) => a.questionId)).toEqual(["q1", "q2"]);
	});

	it("keeps the requirements untouched when the answer links to nothing (undefined)", () => {
		const seeded = recordAnswer(
			createInterviewState(),
			answer("q1"),
			found({ functional: [{ text: "ログイン", personaId: "p1" }] }),
		);
		const next = recordAnswer(seeded, answer("q2", "今日はいい天気ですね"), undefined);
		expect(next.requirements).toBe(seeded.requirements);
		expect(next.answers).toHaveLength(2);
	});

	it("keeps the requirements untouched when the extraction is empty", () => {
		const seeded = recordAnswer(
			createInterviewState(),
			answer("q1"),
			found({ functional: [{ text: "ログイン", personaId: "p1" }] }),
		);
		const next = recordAnswer(seeded, answer("q2", "雑談"), EMPTY_REQUIREMENTS);
		expect(next.requirements).toBe(seeded.requirements);
	});

	it("does not mutate the previous state", () => {
		const state = createInterviewState();
		const snapshot = structuredClone(state);
		recordAnswer(state, answer("q1"), found({ functional: [{ text: "x", personaId: "p1" }] }));
		expect(state).toEqual(snapshot);
	});

	it("rejects an answer once the interview is completed, without changing the state", () => {
		const done = closeRound(createInterviewState(), { sufficient: true, missing: [] });
		const error = rejection(() => recordAnswer(done, answer("q9"), undefined));
		expect(error.code).toBe("invalid-request");
		expect(error.details).toEqual({ reason: "interview-completed" });
		expect(done.answers).toEqual([]);
	});
});

describe("closeRound", () => {
	it("advances the round and keeps the interview open while information is missing", () => {
		const next = closeRound(createInterviewState({ maxRounds: 3 }), {
			sufficient: false,
			missing: ["予算", "納期"],
		});
		expect(next).toMatchObject({
			round: 1,
			completed: false,
			forcedEnd: false,
			missing: ["予算", "納期"],
		});
	});

	it("completes normally when the verdict is sufficient", () => {
		const next = closeRound(createInterviewState(), { sufficient: true, missing: [] });
		expect(next).toMatchObject({ round: 1, completed: true, forcedEnd: false, missing: [] });
	});

	it("does not force an end on the last round when the verdict is sufficient", () => {
		let state = createInterviewState({ maxRounds: 1 });
		state = closeRound(state, { sufficient: true, missing: [] });
		expect(state).toMatchObject({ completed: true, forcedEnd: false });
	});

	it("progresses one round at a time until the limit is reached", () => {
		let state = createInterviewState({ maxRounds: 3 });
		const rounds: number[] = [];
		const open: boolean[] = [];
		for (let i = 0; i < 3; i++) {
			state = closeRound(state, { sufficient: false, missing: ["予算"] });
			rounds.push(state.round);
			open.push(!state.completed);
		}
		expect(rounds).toEqual([1, 2, 3]);
		expect(open).toEqual([true, true, false]);
	});

	it("force-ends at the limit and keeps the missing items for the document", () => {
		let state = createInterviewState({ maxRounds: 2 });
		state = closeRound(state, { sufficient: false, missing: ["予算"] });
		state = closeRound(state, { sufficient: false, missing: ["納期"] });
		expect(state).toMatchObject({
			round: 2,
			completed: true,
			forcedEnd: true,
			missing: ["納期"],
		});
	});

	it("replaces the previous missing list with the latest verdict", () => {
		let state = createInterviewState({ maxRounds: 3 });
		state = closeRound(state, { sufficient: false, missing: ["予算"] });
		state = closeRound(state, { sufficient: false, missing: [] });
		expect(state.missing).toEqual([]);
	});

	it("keeps answers and requirements when closing", () => {
		const withAnswer = recordAnswer(
			createInterviewState(),
			answer("q1"),
			found({ functional: [{ text: "ログイン", personaId: "p1" }] }),
		);
		const next = closeRound(withAnswer, { sufficient: false, missing: ["予算"] });
		expect(next.answers).toBe(withAnswer.answers);
		expect(next.requirements).toBe(withAnswer.requirements);
		expect(next.maxRounds).toBe(withAnswer.maxRounds);
	});

	it("does not mutate the previous state or the verdict", () => {
		const state = createInterviewState();
		const snapshot = structuredClone(state);
		const missing = ["予算"];
		const next = closeRound(state, { sufficient: false, missing });
		missing.push("後から追加");
		expect(state).toEqual(snapshot);
		expect(next.missing).toEqual(["予算"]);
	});

	it("rejects closing a round after completion", () => {
		const done = closeRound(createInterviewState(), { sufficient: true, missing: [] });
		const error = rejection(() => closeRound(done, { sufficient: false, missing: ["x"] }));
		expect(error.code).toBe("invalid-request");
		expect(error.details).toEqual({ reason: "interview-completed" });
	});

	it("rejects closing a round after a forced end", () => {
		const forced = closeRound(createInterviewState({ maxRounds: 1 }), {
			sufficient: false,
			missing: ["x"],
		});
		expect(forced.completed).toBe(true);
		expect(rejection(() => closeRound(forced, { sufficient: true, missing: [] })).code).toBe(
			"invalid-request",
		);
	});
});

describe("isRoundLimitReached", () => {
	const at = (round: number, maxRounds: number): InterviewState => ({
		...createInterviewState({ maxRounds }),
		round,
	});

	it("is false below the limit", () => {
		expect(isRoundLimitReached(at(1, 2))).toBe(false);
	});

	it("is true exactly at the limit", () => {
		expect(isRoundLimitReached(at(2, 2))).toBe(true);
	});

	it("is true above the limit", () => {
		expect(isRoundLimitReached(at(3, 2))).toBe(true);
	});
});
