import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { createObjectModel } from "../testing/mock-models";
import { WorkflowStepError } from "../workflows";
import { planMultiPath } from "./multi-path-plan";

const USAGE = {
	inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
	outputTokens: { total: 0, text: 0, reasoning: 0 },
};

/** A model whose reply is chosen from the user message, so each candidate can differ. */
function byPrompt(pick: (user: string, call: number) => unknown) {
	let call = 0;
	const users: string[] = [];
	const model = new MockLanguageModelV4({
		doGenerate: async (options) => {
			const user = JSON.stringify(options.prompt.filter((message) => message.role === "user"));
			users.push(user);
			const reply = pick(user, call);
			call += 1;
			return {
				content: [{ type: "text", text: JSON.stringify(reply) }],
				finishReason: { unified: "stop", raw: undefined },
				usage: USAGE,
				warnings: [],
			};
		},
	});
	return { model, users, calls: () => call };
}

function plansByCandidate(user: string): { steps: string[] } {
	const number = /候補 (\d+)\//.exec(user)?.[1] ?? "0";
	return { steps: [`plan ${number}: a`, `plan ${number}: b`] };
}

function evaluation(count: number, selected: number) {
	return {
		evaluations: Array.from({ length: count }, (_, index) => ({
			candidate: index + 1,
			score: 60 + index * 10,
			comment: `comment ${index + 1}`,
		})),
		selectedCandidate: selected,
		reason: "最も現実的だから",
	};
}

describe("planMultiPath", () => {
	it("generates three candidates by default and returns the one the evaluator chose, its reason and every evaluation", async () => {
		const planner = byPrompt(plansByCandidate);
		const evaluator = byPrompt(() => evaluation(3, 2));

		const result = await planMultiPath({
			planner: { model: planner.model },
			evaluator: { model: evaluator.model },
			goal: "launch",
		});

		expect(planner.calls()).toBe(3);
		expect(result.candidates).toEqual([
			{ steps: ["plan 1: a", "plan 1: b"] },
			{ steps: ["plan 2: a", "plan 2: b"] },
			{ steps: ["plan 3: a", "plan 3: b"] },
		]);
		expect(result.selectedIndex).toBe(1);
		expect(result.reason).toBe("最も現実的だから");
		expect(result.evaluations).toEqual([
			{ index: 0, score: 60, comment: "comment 1" },
			{ index: 1, score: 70, comment: "comment 2" },
			{ index: 2, score: 80, comment: "comment 3" },
		]);
	});

	it("generates the candidates in parallel, each asked for its own number", {
		timeout: 1_000,
	}, async () => {
		let arrived = 0;
		let release: () => void = () => {};
		const open = new Promise<void>((resolve) => {
			release = resolve;
		});
		const users: string[] = [];
		const model = new MockLanguageModelV4({
			doGenerate: async (options) => {
				users.push(JSON.stringify(options.prompt.filter((message) => message.role === "user")));
				arrived += 1;
				if (arrived === 4) release();
				await open;
				return {
					content: [{ type: "text", text: JSON.stringify({ steps: ["s"] }) }],
					finishReason: { unified: "stop", raw: undefined },
					usage: USAGE,
					warnings: [],
				};
			},
		});

		await planMultiPath({
			planner: { model },
			evaluator: { model: createObjectModel(evaluation(4, 1)) },
			goal: "g",
			candidates: 4,
		});

		expect(arrived).toBe(4);
		expect(new Set(users).size).toBe(4);
		expect(users.some((user) => user.includes("候補 3/4"))).toBe(true);
	});

	it("honours the requested candidate count up to the limit", async () => {
		const planner = byPrompt(plansByCandidate);

		const result = await planMultiPath({
			planner: { model: planner.model },
			evaluator: { model: createObjectModel(evaluation(5, 5)) },
			goal: "g",
			candidates: 5,
		});

		expect(result.candidates).toHaveLength(5);
		expect(result.selectedIndex).toBe(4);
	});

	it("rejects more candidates than the limit before calling any model", async () => {
		const planner = byPrompt(plansByCandidate);

		await expect(
			planMultiPath({
				planner: { model: planner.model },
				evaluator: { model: createObjectModel(evaluation(6, 1)) },
				goal: "g",
				candidates: 6,
			}),
		).rejects.toMatchObject({ code: "invalid-request" });
		expect(planner.calls()).toBe(0);
	});

	it.each([0, 1.5])("rejects candidates=%s", async (candidates) => {
		await expect(
			planMultiPath({
				planner: { model: createObjectModel({ steps: ["s"] }) },
				evaluator: { model: createObjectModel(evaluation(1, 1)) },
				goal: "g",
				candidates,
			}),
		).rejects.toMatchObject({ code: "invalid-request" });
	});

	it("regenerates the evaluation when the selected candidate is out of range", async () => {
		const evaluator = byPrompt((_user, call) => evaluation(3, call === 0 ? 4 : 3));

		const result = await planMultiPath({
			planner: { model: byPrompt(plansByCandidate).model },
			evaluator: { model: evaluator.model },
			goal: "g",
		});

		expect(evaluator.calls()).toBe(2);
		expect(result.selectedIndex).toBe(2);
	});

	it("regenerates the evaluation when it does not cover every candidate exactly once", async () => {
		const missing = { ...evaluation(3, 1), evaluations: evaluation(3, 1).evaluations.slice(0, 2) };
		const duplicate = {
			...evaluation(3, 1),
			evaluations: [
				{ candidate: 1, score: 50, comment: "a" },
				{ candidate: 1, score: 50, comment: "b" },
				{ candidate: 3, score: 50, comment: "c" },
			],
		};
		const evaluator = byPrompt((_user, call) =>
			call === 0 ? missing : call === 1 ? duplicate : evaluation(3, 1),
		);

		const result = await planMultiPath({
			planner: { model: byPrompt(plansByCandidate).model },
			evaluator: { model: evaluator.model },
			goal: "g",
		});

		expect(evaluator.calls()).toBe(3);
		expect(result.evaluations).toHaveLength(3);
	});

	it("regenerates the evaluation when it has more entries than candidates", async () => {
		const extra = {
			...evaluation(3, 1),
			evaluations: [...evaluation(3, 1).evaluations, { candidate: 1, score: 1, comment: "again" }],
		};
		const evaluator = byPrompt((_user, call) => (call === 0 ? extra : evaluation(3, 1)));

		const result = await planMultiPath({
			planner: { model: byPrompt(plansByCandidate).model },
			evaluator: { model: evaluator.model },
			goal: "g",
		});

		expect(evaluator.calls()).toBe(2);
		expect(result.evaluations).toHaveLength(3);
	});

	it("hands the caller's signal to the planner and the evaluator calls", async () => {
		const controller = new AbortController();
		const seen: { planner: (AbortSignal | undefined)[]; evaluator: (AbortSignal | undefined)[] } = {
			planner: [],
			evaluator: [],
		};
		const spy = (into: (AbortSignal | undefined)[], reply: () => unknown) =>
			new MockLanguageModelV4({
				doGenerate: async (options) => {
					into.push(options.abortSignal);
					return {
						content: [{ type: "text", text: JSON.stringify(reply()) }],
						finishReason: { unified: "stop", raw: undefined },
						usage: USAGE,
						warnings: [],
					};
				},
			});

		await planMultiPath({
			planner: { model: spy(seen.planner, () => ({ steps: ["s"] })) },
			evaluator: { model: spy(seen.evaluator, () => evaluation(3, 1)) },
			goal: "g",
			signal: controller.signal,
		});
		controller.abort();

		expect(seen.planner).toHaveLength(3);
		expect(seen.planner.every((signal) => signal?.aborted)).toBe(true);
		expect(seen.evaluator[0]?.aborted).toBe(true);
	});

	it("shows the evaluator every candidate's steps", async () => {
		const evaluator = byPrompt(() => evaluation(3, 1));

		await planMultiPath({
			planner: { model: byPrompt(plansByCandidate).model },
			evaluator: { model: evaluator.model },
			goal: "THE-GOAL",
		});

		expect(evaluator.users[0]).toContain("plan 1: a");
		expect(evaluator.users[0]).toContain("plan 3: b");
		expect(evaluator.users[0]).toContain("THE-GOAL");
	});

	it("fails with the failed candidate's name and does not evaluate when one generation fails", async () => {
		const evaluator = byPrompt(() => evaluation(3, 1));
		const planner = byPrompt((user) => {
			if (user.includes("候補 2/")) throw new Error("planner crashed");
			return { steps: ["s"] };
		});

		const error = await planMultiPath({
			planner: { model: planner.model },
			evaluator: { model: evaluator.model },
			goal: "g",
		}).catch((thrown: unknown) => thrown);

		expect(error).toBeInstanceOf(WorkflowStepError);
		expect(error).toMatchObject({ step: "candidate-2" });
		expect(evaluator.calls()).toBe(0);
	});

	it("regenerates a candidate that has more steps than the limit", async () => {
		const planner = byPrompt((user, call) =>
			call === 0 && user.includes("候補 1/")
				? { steps: Array.from({ length: 9 }, (_, i) => `s${i}`) }
				: { steps: ["ok"] },
		);

		const result = await planMultiPath({
			planner: { model: planner.model },
			evaluator: { model: createObjectModel(evaluation(3, 1)) },
			goal: "g",
		});

		expect(result.candidates.every((candidate) => candidate.steps.length <= 8)).toBe(true);
	});

	it("does not call the evaluator after an abort", async () => {
		const controller = new AbortController();
		const reason = new Error("user stopped");
		const evaluate = vi.fn();
		const planner = byPrompt(() => {
			controller.abort(reason);
			return { steps: ["s"] };
		});
		const evaluator = new MockLanguageModelV4({
			doGenerate: async () => {
				evaluate();
				throw new Error("must not run");
			},
		});

		await expect(
			planMultiPath({
				planner: { model: planner.model },
				evaluator: { model: evaluator },
				goal: "g",
				signal: controller.signal,
			}),
		).rejects.toBe(reason);
		expect(evaluate).not.toHaveBeenCalled();
	});
});
