import { describe, expect, it } from "vitest";
import { DEFAULT_INTERVIEW } from "../config/defaults";
import { M3_5_SAMPLE_ANSWERS, M3_5_SAMPLE_OVERVIEWS, M3_SCENARIOS } from "../mock";
import { createScenarioModel } from "../mock/scenario-model";
import { askRound, extractRequirements, judgeSufficiency, type Question } from "./interview";
import { generatePersonas } from "./personas";
import { closeRound, createInterviewState, type InterviewState, recordAnswer } from "./session";

// The m3-5 scenarios, end to end: the real persona, interview and session code against the
// scenario model. Nothing here is mocked at the requirements layer.

const model = () => createScenarioModel({ purpose: "chat", scenarios: M3_SCENARIOS });

interface Trace {
	readonly state: InterviewState;
	readonly questions: readonly (readonly Question[])[];
	readonly missingByRound: readonly (readonly string[])[];
}

async function interview(overview: string, answers: readonly (readonly string[])[]) {
	const llm = model();
	const personas = await generatePersonas({ model: llm, overview });
	let state = createInterviewState();
	const questions: Question[][] = [];
	const missingByRound: (readonly string[])[] = [];
	for (const round of answers) {
		if (state.completed) break;
		const asked = [...(await askRound({ model: llm, personas, state }))];
		questions.push(asked);
		for (const [index, question] of asked.entries()) {
			const answer = {
				questionId: question.id,
				personaId: question.personaId,
				text: round[index] ?? "",
			};
			const extracted = await extractRequirements({
				model: llm,
				answer,
				current: state.requirements,
			});
			state = recordAnswer(state, answer, extracted);
		}
		const verdict = await judgeSufficiency({
			model: llm,
			requirements: state.requirements,
			round: state.round + 1,
			maxRounds: state.maxRounds,
		});
		missingByRound.push(verdict.missing);
		state = closeRound(state, verdict);
	}
	return { personas, trace: { state, questions, missingByRound } satisfies Trace };
}

describe("m3-5 scenarios", () => {
	it("are written for the default round limit", () => {
		expect(DEFAULT_INTERVIEW.maxRounds).toBe(M3_5_SAMPLE_ANSWERS.limit.length);
		expect(DEFAULT_INTERVIEW.personaCount).toBe(3);
	});

	describe("default", () => {
		it("makes three personas with ids assigned in order", async () => {
			const personas = await generatePersonas({
				model: model(),
				overview: M3_5_SAMPLE_OVERVIEWS.default,
			});
			expect(personas.map((persona) => persona.id)).toEqual([
				"persona-1",
				"persona-2",
				"persona-3",
			]);
			expect(new Set(personas.map((persona) => persona.name)).size).toBe(3);
		});

		it("is insufficient after round 1, then sufficient after round 2 without a forced end", async () => {
			const { trace } = await interview(M3_5_SAMPLE_OVERVIEWS.default, M3_5_SAMPLE_ANSWERS.default);
			expect(trace.state).toMatchObject({ round: 2, completed: true, forcedEnd: false });
			expect(trace.state.missing).toEqual([]);
			expect(trace.missingByRound[0]?.length).toBeGreaterThan(0);
			expect(trace.missingByRound[1]).toEqual([]);
		});

		it("asks three questions per round and focuses round 2 on what was missing", async () => {
			const { trace } = await interview(M3_5_SAMPLE_OVERVIEWS.default, M3_5_SAMPLE_ANSWERS.default);
			expect(trace.questions.map((round) => round.length)).toEqual([3, 3]);
			expect(trace.questions[1]?.map((question) => question.id)).toEqual([
				"q-2-1",
				"q-2-2",
				"q-2-3",
			]);
			expect(trace.missingByRound[0]).toEqual(["応答時間の目標値", "運用にかけられる予算の上限"]);
			const asked = trace.questions[1]?.map((question) => question.text).join("\n") ?? "";
			expect(asked).toContain("応答");
			expect(asked).toContain("予算");
			expect(trace.questions[0]?.map((question) => question.text).join("\n")).not.toContain("予算");
		});

		it("extracts every category and tags each item with the answering persona", async () => {
			const { trace } = await interview(M3_5_SAMPLE_OVERVIEWS.default, M3_5_SAMPLE_ANSWERS.default);
			const { requirements } = trace.state;
			expect(requirements.functional.length).toBeGreaterThan(0);
			expect(requirements.nonFunctional.length).toBeGreaterThan(0);
			expect(requirements.constraints.length).toBeGreaterThan(0);
			const owners = new Set(requirements.functional.map((item) => item.personaId));
			expect(owners.has("persona-1")).toBe(true);
		});
	});

	describe("limit", () => {
		it("stays insufficient until the round limit and ends forced with the latest missing list", async () => {
			const { trace } = await interview(M3_5_SAMPLE_OVERVIEWS.limit, M3_5_SAMPLE_ANSWERS.limit);
			expect(trace.state).toMatchObject({
				round: DEFAULT_INTERVIEW.maxRounds,
				completed: true,
				forcedEnd: true,
			});
			expect(trace.state.missing.length).toBeGreaterThan(0);
			expect(trace.missingByRound.every((missing) => missing.length > 0)).toBe(true);
		});
	});

	it("does not answer an overview it has no scenario for: a mock run never invents a result", async () => {
		await expect(
			generatePersonas({ model: model(), overview: "このプロダクトには台本がありません" }),
		).rejects.toThrow();
	});
});
