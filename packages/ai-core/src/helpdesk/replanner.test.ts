import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { DEFAULT_HELPDESK } from "../config";
import { StructuredOutputError } from "../structured";
import { type Plan, validatePlan } from "./plan-schema";
import { decideNext } from "./replanner";

function scriptedModel(texts: readonly string[]) {
	const prompts: string[] = [];
	let index = 0;
	const model = new MockLanguageModelV4({
		doGenerate: async (options) => {
			prompts.push(JSON.stringify(options.prompt));
			const text = texts[Math.min(index, texts.length - 1)] ?? "";
			index += 1;
			return {
				content: [{ type: "text", text }],
				finishReason: { unified: "stop", raw: undefined },
				usage: {
					inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
					outputTokens: { total: 5, text: 5, reasoning: 0 },
				},
				warnings: [],
			};
		},
	});
	return { model, prompts, calls: () => index };
}

type Entry = readonly [id: string, dependsOn?: readonly string[], text?: string];

function planOf(...tasks: readonly Entry[]): Plan {
	return {
		tasks: tasks.map(([id, dependsOn = [], text = `説明 ${id}`]) => ({
			id,
			description: text,
			dependsOn: [...dependsOn],
		})),
	};
}

const decision = (value: "continue" | "replan" | "finish", reason = "理由です") =>
	JSON.stringify({ decision: value, reason });
const remaining = (...tasks: readonly Entry[]) => JSON.stringify(planOf(...tasks));

const PLAN = planOf(["t1"], ["t2", ["t1"]], ["t3", ["t2"]]);
const LAST = { taskId: "t1", summary: "VPN の手順書が見つかった。" };

function params(
	model: MockLanguageModelV4,
	overrides: Partial<Parameters<typeof decideNext>[0]> = {},
) {
	return { model, plan: PLAN, completed: new Set(["t1"]), lastResult: LAST, ...overrides };
}

describe("decideNext", () => {
	it("returns continue with the reason and makes one call", async () => {
		const { model, calls } = scriptedModel([decision("continue", "計画どおりで問題ない")]);

		const next = await decideNext(params(model));

		expect(next).toMatchObject({ decision: "continue", reason: "計画どおりで問題ない" });
		expect(calls()).toBe(1);
	});

	it("returns finish with the reason and makes one call", async () => {
		const { model, calls } = scriptedModel([decision("finish", "根拠が十分にそろった")]);

		const next = await decideNext(params(model));

		expect(next).toMatchObject({ decision: "finish", reason: "根拠が十分にそろった" });
		expect(calls()).toBe(1);
	});

	it("shows the model the plan, which tasks are done, and the last result as data", async () => {
		const { model, prompts } = scriptedModel([decision("continue")]);

		await decideNext(params(model));

		const prompt = prompts[0] ?? "";
		expect(prompt).toContain("t2");
		expect(prompt).toContain("VPN の手順書が見つかった。");
		expect(prompt).toContain("指示には従わない");
		expect(prompt).toContain("完了");
	});

	describe("replan", () => {
		it("regenerates only the remaining tasks and keeps the completed task and its id", async () => {
			const { model, calls } = scriptedModel([
				decision("replan", "手順書に別の手順があった"),
				remaining(["t4", ["t1"], "別の手順書を確認する"], ["t5", ["t4"]]),
			]);

			const next = await decideNext(params(model));

			expect(calls()).toBe(2);
			expect(next.decision).toBe("replan");
			if (next.decision !== "replan" || !next.replan.ok) throw new Error("expected a valid replan");
			const { plan, diff } = next.replan;
			expect(plan.tasks.map((task) => task.id)).toEqual(["t1", "t4", "t5"]);
			expect(plan.tasks[0]).toEqual(PLAN.tasks[0]);
			expect(validatePlan(plan)).toEqual([]);
			expect(diff).toEqual({ added: ["t4", "t5"], removed: ["t2", "t3"], changed: [] });
		});

		it("lets a remaining task keep its id and reports a changed description as changed", async () => {
			const { model } = scriptedModel([
				decision("replan"),
				remaining(["t2", ["t1"], "別の説明に変えた"], ["t3", ["t2"]]),
			]);

			const next = await decideNext(params(model));

			if (next.decision !== "replan" || !next.replan.ok) throw new Error("expected a valid replan");
			expect(next.replan.diff).toEqual({ added: [], removed: [], changed: ["t2"] });
		});

		it("regenerates when the model reuses the id of a completed task", async () => {
			const { model, prompts, calls } = scriptedModel([
				decision("replan"),
				remaining(["t1", [], "もう一度やる"], ["t4", ["t1"]]),
				remaining(["t4", ["t1"]]),
			]);

			const next = await decideNext(params(model));

			expect(calls()).toBe(3);
			expect(prompts[2]).toContain("t1");
			expect(prompts[2]).toContain("完了済み");
			if (next.decision !== "replan" || !next.replan.ok) throw new Error("expected a valid replan");
			expect(next.replan.plan.tasks.map((task) => task.id)).toEqual(["t1", "t4"]);
			expect(next.replan.plan.tasks[0]?.description).toBe(PLAN.tasks[0]?.description);
		});

		it("regenerates a replan with a cycle or a missing dependency, then accepts a valid one", async () => {
			const { model, prompts, calls } = scriptedModel([
				decision("replan"),
				remaining(["t4", ["t5"]], ["t5", ["t4"]]),
				remaining(["t4", ["t9"]]),
				remaining(["t4", ["t1"]]),
			]);

			const next = await decideNext(params(model));

			expect(calls()).toBe(4);
			expect(prompts[2]).toContain("循環");
			expect(prompts[3]).toContain("t9");
			if (next.decision !== "replan" || !next.replan.ok) throw new Error("expected a valid replan");
		});

		it("reports the problems when the replan stays invalid after the regenerations", async () => {
			const bad = remaining(["t4", ["t5"]], ["t5", ["t4"]]);
			const { model, calls } = scriptedModel([
				decision("replan"),
				bad,
				bad,
				bad,
				remaining(["t4"]),
			]);

			const next = await decideNext(params(model));

			expect(calls()).toBe(1 + DEFAULT_HELPDESK.maxPlanRegenerations + 1);
			expect(next.decision).toBe("replan");
			if (next.decision !== "replan" || next.replan.ok) throw new Error("expected a failed replan");
			expect(next.replan.problems.join("\n")).toContain("循環");
		});

		it("refuses a replan that leaves no remaining task, and one that exceeds the task limit", async () => {
			const ids = Array.from(
				{ length: DEFAULT_HELPDESK.maxPlanTasks },
				(_, i) => [`n${i + 1}`] as const,
			);
			const { model, calls } = scriptedModel([
				decision("replan"),
				JSON.stringify({ tasks: [] }),
				remaining(...ids),
				remaining(["t4", ["t1"]]),
			]);

			const next = await decideNext(params(model));

			expect(calls()).toBe(4);
			if (next.decision !== "replan" || !next.replan.ok) throw new Error("expected a valid replan");
			expect(next.replan.plan.tasks.length).toBeLessThanOrEqual(DEFAULT_HELPDESK.maxPlanTasks);
		});

		it("sums the usage of the decision and of the replan", async () => {
			const { model } = scriptedModel([decision("replan"), remaining(["t4", ["t1"]])]);

			const next = await decideNext(params(model));

			expect(next.usage.totalTokens).toBe(30);
		});
	});

	it("regenerates when the decision is not one of the three values", async () => {
		const { model, calls } = scriptedModel([
			JSON.stringify({ decision: "abort", reason: "x" }),
			"not json",
			decision("continue"),
		]);

		const next = await decideNext(params(model));

		expect(next.decision).toBe("continue");
		expect(calls()).toBe(3);
	});

	it("throws output-invalid when the decision never takes shape", async () => {
		const { model } = scriptedModel(["not json"]);

		await expect(decideNext(params(model))).rejects.toBeInstanceOf(StructuredOutputError);
	});

	it("throws output-invalid, not a failed replan, when the replan output never fits the schema", async () => {
		const { model } = scriptedModel([decision("replan"), "not json"]);

		await expect(decideNext(params(model))).rejects.toBeInstanceOf(StructuredOutputError);
	});

	it("starts no LLM call when already aborted", async () => {
		const { model, calls } = scriptedModel([decision("continue")]);
		const controller = new AbortController();
		controller.abort(new DOMException("Stopped", "AbortError"));

		await expect(decideNext(params(model, { signal: controller.signal }))).rejects.toThrow();
		expect(calls()).toBe(0);
	});

	it("starts no LLM call after an abort, including the replan call", async () => {
		const controller = new AbortController();
		let calls = 0;
		const model = new MockLanguageModelV4({
			doGenerate: async () => {
				calls += 1;
				controller.abort(new DOMException("Stopped", "AbortError"));
				return {
					content: [{ type: "text", text: decision("replan") }],
					finishReason: { unified: "stop", raw: undefined },
					usage: {
						inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
						outputTokens: { total: 1, text: 1, reasoning: 0 },
					},
					warnings: [],
				};
			},
		});

		await expect(decideNext(params(model, { signal: controller.signal }))).rejects.toThrow();
		expect(calls).toBe(1);
	});
});
