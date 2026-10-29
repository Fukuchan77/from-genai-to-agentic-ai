// Regression (plan C16, Req 6.1 to 6.3, CL-12, CL-17): the marketing council run end to end in `mock`
// mode, through the public `@platform/ai-core/marketing` and `@platform/ai-core/mock` subpaths.
// The unit tests inside `@platform/ai-core` pin the loop with a hand-rolled model; this file pins
// two things they only reach indirectly:
//   - the DEFAULT round count, by behaviour (a council that never agrees runs the default number of
//     rounds and ends with `max-rounds`), not by reading the constant back;
//   - the shared token budget when the moderator is larger than a persona (the realistic shape,
//     since it reads every statement), which the ai-core invariant test has to skip.

import { DEFAULT_COUNCIL } from "@platform/ai-core/config";
import { type CatalogPersona, type CouncilResult, runCouncil } from "@platform/ai-core/marketing";
import { createScenarioModel, defineScenario } from "@platform/ai-core/mock";
import { createFakeClock } from "@platform/ai-core/testing";
import { describe, expect, it } from "vitest";

const PERSONAS: readonly CatalogPersona[] = [
	{ id: "p1", name: "厳格なマーケター", viewpoint: "訴求の明確さ", ordinal: 1 },
	{ id: "p2", name: "一般消費者", viewpoint: "分かりやすさ", ordinal: 2 },
	{ id: "p3", name: "SEO 担当", viewpoint: "検索意図", ordinal: 3 },
];

/** The moderator's prompt always opens with this sentence; a persona's prompt never contains it. */
const MODERATOR_PROMPT_MARKER = "の発言を読み、合意に達したかを判定してください";

type ModeratorShape =
	/** A verdict that never agrees. */
	| "disagree"
	/** An answer that is not JSON, so every attempt fails validation. */
	| "unparseable";

interface CouncilScenarioOptions {
	/** Tokens of one persona statement. */
	readonly personaTokens: number;
	/** Tokens of one moderator attempt. */
	readonly moderatorTokens: number;
	readonly moderator: ModeratorShape;
}

/** Splits a token count into input and output so that the sum is exact. */
function usageOf(tokens: number) {
	const inputTokens = Math.ceil(tokens * 0.8);
	return { inputTokens, outputTokens: tokens - inputTokens };
}

/**
 * Every persona says the same thing and proposes the same draft in every round, and the moderator
 * never agrees. Turns match by who is asked, not by round, so the scenario answers any number of
 * rounds.
 */
function neverAgreeing(options: CouncilScenarioOptions) {
	return defineScenario({
		id: `eval/regression/council-never-agrees-${options.moderator}`,
		turns: [
			...PERSONAS.map((persona) => ({
				match: { purpose: "chat" as const, lastUserTextIncludes: `[役割: ${persona.id}]` },
				respond: {
					text: `${persona.id}: まだ直せます。\n<draft>改善案 ${persona.id}</draft>`,
					usage: usageOf(options.personaTokens),
				},
			})),
			{
				match: { purpose: "chat" as const, lastUserTextIncludes: MODERATOR_PROMPT_MARKER },
				respond: {
					usage: usageOf(options.moderatorTokens),
					...(options.moderator === "disagree"
						? {
								object: {
									agreed: false,
									reason: "意見がそろっていません。",
									remainingObjections: ["価格の根拠が示されていない"],
								},
							}
						: { text: "これは JSON ではありません" }),
				},
			},
		],
	});
}

function council(
	options: CouncilScenarioOptions,
	overrides: Partial<Parameters<typeof runCouncil>[0]> = {},
) {
	const model = createScenarioModel({ purpose: "chat", scenarios: [neverAgreeing(options)] });
	const result = runCouncil({
		draft: "ORIGINAL-DRAFT",
		personas: PERSONAS,
		model,
		clock: createFakeClock(),
		signal: new AbortController().signal,
		...overrides,
	});
	return { model, result };
}

const STEADY = { personaTokens: 100, moderatorTokens: 100, moderator: "disagree" } as const;

describe("the council's default round count (Req 6.2)", () => {
	it("runs exactly three rounds when nobody ever agrees, and ends with max-rounds", async () => {
		const { model, result } = council(STEADY);
		const outcome = await result;

		expect(outcome.endReason).toBe("max-rounds");
		expect(outcome.rounds.map((round) => round.round)).toEqual([1, 2, 3]);
		// Every round was judged, and none was an agreement.
		expect(outcome.rounds.map((round) => round.verdict?.agreed)).toEqual([false, false, false]);
		// Three personas and one moderator call per round, and nothing after the third round.
		expect(model.doGenerateCalls).toHaveLength(3 * (PERSONAS.length + 1));
		expect(outcome.usage.byRole.moderator).toMatchObject({ calls: 3 });
		for (const persona of PERSONAS) {
			expect(outcome.usage.byRole[persona.id]).toMatchObject({ calls: 3 });
		}
	});

	it("is a default, not a fixed count: an explicit maxRounds is honoured", async () => {
		const { model, result } = council(STEADY, { maxRounds: 2 });
		const outcome = await result;

		expect(outcome.endReason).toBe("max-rounds");
		expect(outcome.rounds).toHaveLength(2);
		expect(model.doGenerateCalls).toHaveLength(2 * (PERSONAS.length + 1));
	});

	it("keeps the default inside the cost bound the shared budget allows", async () => {
		const outcome = await council(STEADY).result;

		// 12 calls of 100 tokens each stay far below the default budget, so the rounds, not the
		// budget, are what ended this council.
		expect(outcome.usage.total.totalTokens).toBe(1_200);
		expect(outcome.usage.total.totalTokens).toBeLessThan(DEFAULT_COUNCIL.maxTotalTokens);
	});
});

/** Token total the model really handed out, counted from the calls and not from the ledger. */
function spentBy(
	model: ReturnType<typeof createScenarioModel>,
	options: CouncilScenarioOptions,
): number {
	return model.doGenerateCalls.reduce((sum, call) => {
		const prompt = JSON.stringify(call.prompt);
		return (
			sum +
			(prompt.includes(MODERATOR_PROMPT_MARKER) ? options.moderatorTokens : options.personaTokens)
		);
	}, 0);
}

describe("the council's shared token budget with a moderator larger than the personas (CL-17)", () => {
	// [maxTotalTokens, tokens of one persona statement]
	const BUDGETS = [
		[20, 5],
		[40, 5],
		[55, 7],
		[100, 10],
		[100, 30],
		[200, 25],
		[1_000, 10],
		[1_001, 13],
		[7, 1],
	] as const;
	// How many times a persona's size one moderator attempt is: the moderator reads every statement.
	const MODERATOR_FACTORS = [1, 3, 10] as const;
	const SHAPES: readonly ModeratorShape[] = ["disagree", "unparseable"];

	it("never reports more than it spent, and stays within the cap that applies to each shape", async () => {
		let steady = 0;
		let largeModerator = 0;
		for (const [max, per] of BUDGETS) {
			for (const moderator of SHAPES) {
				for (const factor of MODERATOR_FACTORS) {
					const options = {
						personaTokens: per,
						moderatorTokens: per * factor,
						moderator,
					} satisfies CouncilScenarioOptions;
					const label = `${moderator} max=${max} persona=${per} moderator x${factor}`;

					const { model, result } = council(options, { maxTotalTokens: max, maxRounds: 50 });
					const outcome: CouncilResult = await result;
					const spent = spentBy(model, options);

					// The ledger and the model agree on what was spent.
					expect(outcome.usage.total.totalTokens, label).toBe(spent);
					if (Math.floor(max / 4) >= options.moderatorTokens) {
						// The first moderator attempt fits the reserved quarter: the cap holds exactly.
						steady += 1;
						expect(spent, label).toBeLessThanOrEqual(max);
					} else {
						// The first moderator attempt cannot be sized beforehand and may overshoot,
						// by at most that one attempt (plan CL-17, C12).
						largeModerator += 1;
						expect(spent, label).toBeLessThanOrEqual(max + options.moderatorTokens);
					}
					// Whatever the shape, the council stops by itself.
					expect(["agreed", "max-rounds", "budget-exhausted"], label).toContain(outcome.endReason);
				}
			}
		}
		// Both branches ran: nothing was skipped.
		expect(steady).toBeGreaterThan(0);
		expect(largeModerator).toBeGreaterThan(0);
		expect(steady + largeModerator).toBe(BUDGETS.length * SHAPES.length * MODERATOR_FACTORS.length);
	});

	it("holds a quarter back for the moderator, so even a council that talks a lot is still judged", async () => {
		// Three statements of 30 would take 90 of 100 and leave the moderator nothing; the reserve
		// makes the third persona wait instead, and the round gets its verdict.
		const options = { personaTokens: 30, moderatorTokens: 20, moderator: "disagree" } as const;

		const { model, result } = council(options, { maxTotalTokens: 100, maxRounds: 50 });
		const outcome = await result;

		expect(outcome.rounds[0]?.verdict).toMatchObject({ agreed: false });
		expect(outcome.rounds[0]?.statements).toHaveLength(2);
		expect(outcome.usage.byRole.moderator).toMatchObject({ calls: 1 });
		expect(spentBy(model, options)).toBeLessThanOrEqual(100);
	});

	it("overshoots by the first moderator attempt only, and starts nothing after it", async () => {
		// Personas of 5 and a moderator of 30 under a 40-token budget: the three statements cost 15,
		// the first judgement (not sizeable beforehand) takes 30 of the 25 left, and nothing more starts.
		const options = { personaTokens: 5, moderatorTokens: 30, moderator: "disagree" } as const;

		const { model, result } = council(options, { maxTotalTokens: 40, maxRounds: 50 });
		const outcome = await result;

		expect(spentBy(model, options)).toBe(45);
		expect(outcome.usage.total.totalTokens).toBe(45);
		expect(outcome.endReason).toBe("budget-exhausted");
		expect(outcome.rounds).toHaveLength(1);
		expect(outcome.usage.byRole.moderator).toMatchObject({ calls: 1 });
		// 3 statements and 1 judgement: no second round, no regeneration on a spent budget.
		expect(model.doGenerateCalls).toHaveLength(PERSONAS.length + 1);
	});

	it("does not regenerate a broken moderator answer on a budget that cannot hold another attempt", async () => {
		const options = { personaTokens: 5, moderatorTokens: 30, moderator: "unparseable" } as const;

		const { model, result } = council(options, { maxTotalTokens: 40, maxRounds: 50 });
		const outcome = await result;

		// One attempt of 30 against 25 left: a second attempt would need 60 <= 25, so it is not made.
		expect(spentBy(model, options)).toBe(45);
		expect(outcome.endReason).toBe("budget-exhausted");
		expect(outcome.rounds[0]?.verdict).toMatchObject({ agreed: false });
		expect(model.doGenerateCalls).toHaveLength(PERSONAS.length + 1);
	});
});
