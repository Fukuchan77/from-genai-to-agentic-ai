import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { StructuredOutputError } from "../structured";
import { createObjectModel } from "../testing/mock-models";
import { createPassiveGoal } from "./passive-goal-creator";

/** Replies with the scripted texts in order (the last one repeats) and records each prompt. */
function scripted(texts: readonly string[]) {
	const prompts: string[] = [];
	let call = 0;
	const model = new MockLanguageModelV4({
		doGenerate: async (options) => {
			prompts.push(JSON.stringify(options.prompt));
			const text = texts[Math.min(call, texts.length - 1)] ?? "";
			call += 1;
			return {
				content: [{ type: "text", text }],
				finishReason: { unified: "stop", raw: undefined },
				usage: {
					inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
					outputTokens: { total: 0, text: 0, reasoning: 0 },
				},
				warnings: [],
			};
		},
	});
	return { model, prompts, calls: () => call };
}

const COMPLETE = {
	objective: "社内向けの週報テンプレートを作る",
	constraints: ["A4 1 枚に収める"],
	successCriteria: ["5 分で書き終えられる"],
	missingInformation: [],
	clarifyingQuestions: [],
};

const AMBIGUOUS = {
	objective: "何かを良くする",
	constraints: [],
	successCriteria: ["利用者が満足する"],
	missingInformation: ["対象のシステム", "期限"],
	clarifyingQuestions: ["どのシステムを対象にしますか？", "いつまでに必要ですか？"],
};

describe("createPassiveGoal", () => {
	it("returns the objective, constraints and success criteria for a sufficient instruction", async () => {
		const goal = await createPassiveGoal({
			model: createObjectModel(COMPLETE),
			instruction: "週報のテンプレートを A4 1 枚で作って",
		});

		expect(goal).toEqual(COMPLETE);
	});

	it("returns the missing items together with clarifying questions for an ambiguous instruction", async () => {
		const goal = await createPassiveGoal({
			model: createObjectModel(AMBIGUOUS),
			instruction: "いい感じにして",
		});

		expect(goal.missingInformation).toEqual(["対象のシステム", "期限"]);
		expect(goal.clarifyingQuestions).toHaveLength(2);
	});

	it("regenerates when information is missing but no question is asked", async () => {
		const { model, calls } = scripted([
			JSON.stringify({ ...AMBIGUOUS, clarifyingQuestions: [] }),
			JSON.stringify(AMBIGUOUS),
		]);

		const goal = await createPassiveGoal({ model, instruction: "いい感じにして" });

		expect(calls()).toBe(2);
		expect(goal.clarifyingQuestions).toHaveLength(2);
	});

	it("regenerates when a question is asked but nothing is listed as missing", async () => {
		const { model, calls } = scripted([
			JSON.stringify({ ...COMPLETE, clarifyingQuestions: ["本当によいですか？"] }),
			JSON.stringify(COMPLETE),
		]);

		const goal = await createPassiveGoal({ model, instruction: "x" });

		expect(calls()).toBe(2);
		expect(goal.clarifyingQuestions).toEqual([]);
	});

	it("tells the model what was wrong when it regenerates", async () => {
		const { model, prompts } = scripted([
			JSON.stringify({ ...AMBIGUOUS, clarifyingQuestions: [] }),
			JSON.stringify(AMBIGUOUS),
		]);

		await createPassiveGoal({ model, instruction: "いい感じにして" });

		expect(prompts[1]).toContain("clarifyingQuestions");
	});

	it("fails with output-invalid after three invalid outputs", async () => {
		const { model, calls } = scripted([JSON.stringify({ ...AMBIGUOUS, clarifyingQuestions: [] })]);

		const error = await createPassiveGoal({ model, instruction: "x" }).catch(
			(thrown: unknown) => thrown,
		);

		expect(error).toBeInstanceOf(StructuredOutputError);
		expect(error).toMatchObject({ code: "output-invalid", attempts: 3 });
		expect(calls()).toBe(3);
	});

	it("requires an objective and at least one success criterion", async () => {
		const noCriteria = await createPassiveGoal({
			model: createObjectModel({ ...COMPLETE, successCriteria: [] }),
			instruction: "x",
		}).catch((thrown: unknown) => thrown);
		const noObjective = await createPassiveGoal({
			model: createObjectModel({ ...COMPLETE, objective: "" }),
			instruction: "x",
		}).catch((thrown: unknown) => thrown);

		expect(noCriteria).toBeInstanceOf(StructuredOutputError);
		expect(noObjective).toBeInstanceOf(StructuredOutputError);
	});

	it("wraps the instruction as data and hands the signal to the model call", async () => {
		const controller = new AbortController();
		const seen: (AbortSignal | undefined)[] = [];
		const prompts: string[] = [];
		const model = new MockLanguageModelV4({
			doGenerate: async (options) => {
				seen.push(options.abortSignal);
				prompts.push(JSON.stringify(options.prompt.filter((message) => message.role === "user")));
				return {
					content: [{ type: "text", text: JSON.stringify(COMPLETE) }],
					finishReason: { unified: "stop", raw: undefined },
					usage: {
						inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
						outputTokens: { total: 0, text: 0, reasoning: 0 },
					},
					warnings: [],
				};
			},
		});

		await createPassiveGoal({ model, instruction: "INSTRUCTION-TEXT", signal: controller.signal });
		controller.abort();

		expect(prompts[0]).toContain("<instruction>");
		expect(prompts[0]).toContain("INSTRUCTION-TEXT");
		expect(seen[0]?.aborted).toBe(true);
	});
});
