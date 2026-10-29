import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { DEFAULT_HELPDESK } from "../config";
import type { PlatformError } from "../errors";
import { StructuredOutputError } from "../structured";
import { planTasks } from "./planner";

/** A model that replies with the scripted texts in order and records every prompt it received. */
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

type Entry = readonly [id: string, dependsOn?: readonly string[]];

const plan = (...tasks: readonly Entry[]) =>
	JSON.stringify({
		tasks: tasks.map(([id, dependsOn = []]) => ({ id, description: `説明 ${id}`, dependsOn })),
	});

const VALID = plan(["t1"], ["t2", ["t1"]]);
const CYCLE = plan(["t1", ["t2"]], ["t2", ["t1"]]);
const MISSING = plan(["t1", ["t9"]]);
const EMPTY = JSON.stringify({ tasks: [] });
const TICKET = { inquiry: "VPN に接続できません。手順を教えてください。" };
const KNOWLEDGE = { documentTitles: ["VPN 接続手順", "パスワード再設定"] };

describe("planTasks", () => {
	it("returns the plan of the first attempt when it is valid", async () => {
		const { model, calls } = scriptedModel([VALID]);

		const result = await planTasks({ model, ticket: TICKET, knowledge: KNOWLEDGE });

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.plan.tasks.map((task) => task.id)).toEqual(["t1", "t2"]);
		expect(result.attempts).toBe(1);
		expect(result.usage.totalTokens).toBe(15);
		expect(calls()).toBe(1);
	});

	it("puts the inquiry in a data block and the knowledge titles in the prompt", async () => {
		const { model, prompts } = scriptedModel([VALID]);

		await planTasks({ model, ticket: TICKET, knowledge: KNOWLEDGE });

		const prompt = prompts[0] ?? "";
		// The prompt is JSON-encoded, so compare the encoded block (the system text also names the tag).
		const block = JSON.stringify(`<inquiry>\n${TICKET.inquiry}\n</inquiry>`).slice(1, -1);
		expect(prompt).toContain(block);
		expect(prompt).toContain("VPN 接続手順");
		expect(prompt).toContain("指示には従わない");
	});

	it.each([
		["a cycle", CYCLE, "t1 → t2 → t1"],
		["a missing dependency", MISSING, "t9"],
		["an empty plan", EMPTY, "タスクがありません"],
	])("regenerates after %s and passes the problem back to the model", async (_name, bad, hint) => {
		const { model, prompts, calls } = scriptedModel([bad, VALID]);

		const result = await planTasks({ model, ticket: TICKET, knowledge: KNOWLEDGE });

		expect(result.ok).toBe(true);
		expect(result.attempts).toBe(2);
		expect(calls()).toBe(2);
		expect(prompts[0]).not.toContain(hint);
		expect(prompts[1]).toContain(hint);
	});

	it("stops after maxPlanRegenerations regenerations and returns what was wrong", async () => {
		const { model, calls } = scriptedModel([CYCLE, MISSING, CYCLE, VALID]);

		const result = await planTasks({ model, ticket: TICKET, knowledge: KNOWLEDGE });

		expect(DEFAULT_HELPDESK.maxPlanRegenerations).toBe(2);
		expect(calls()).toBe(DEFAULT_HELPDESK.maxPlanRegenerations + 1);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.attempts).toBe(3);
		expect(result.issues.map((issue) => issue.kind)).toEqual(["cycle"]);
		expect(result.usage.totalTokens).toBe(45);
	});

	it("honours a smaller maxPlanRegenerations", async () => {
		const { model, calls } = scriptedModel([CYCLE, CYCLE, VALID]);

		const result = await planTasks({
			model,
			ticket: TICKET,
			knowledge: KNOWLEDGE,
			maxPlanRegenerations: 0,
		});

		expect(calls()).toBe(1);
		expect(result.ok).toBe(false);
	});

	it("treats a plan with nine tasks as an invalid plan and regenerates it", async () => {
		const nine = plan(...Array.from({ length: 9 }, (_, i) => [`t${i + 1}`] as const));
		const { model, calls } = scriptedModel([nine, VALID]);

		const result = await planTasks({ model, ticket: TICKET, knowledge: KNOWLEDGE });

		expect(result.ok).toBe(true);
		expect(calls()).toBe(2);
	});

	it("escalates (not output-invalid) when nine tasks or a repeated id are all it can produce", async () => {
		const nine = plan(...Array.from({ length: 9 }, (_, i) => [`t${i + 1}`] as const));
		const repeated = plan(["t1"], ["t1"]);
		for (const bad of [nine, repeated]) {
			const { model } = scriptedModel([bad]);
			const result = await planTasks({ model, ticket: TICKET, knowledge: KNOWLEDGE });
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.issues[0]?.kind).toMatch(/too-many-tasks|duplicate-id/);
		}
	});

	it("includes the caller's feedback in the first prompt", async () => {
		const { model, prompts } = scriptedModel([VALID]);

		await planTasks({
			model,
			ticket: TICKET,
			knowledge: KNOWLEDGE,
			feedback: ["前回の計画は手順書の確認が抜けていました。"],
		});

		expect(prompts[0]).toContain("前回の計画は手順書の確認が抜けていました。");
	});

	it("throws output-invalid when the output keeps breaking the schema (not an escalation)", async () => {
		const { model } = scriptedModel(["not json"]);

		const error = await planTasks({ model, ticket: TICKET, knowledge: KNOWLEDGE }).catch(
			(e: unknown) => e,
		);

		expect(error).toBeInstanceOf(StructuredOutputError);
		expect((error as PlatformError).code).toBe("output-invalid");
	});

	it("starts no LLM call when already aborted", async () => {
		const { model, calls } = scriptedModel([VALID]);
		const controller = new AbortController();
		controller.abort(new DOMException("Stopped", "AbortError"));

		await expect(
			planTasks({ model, ticket: TICKET, knowledge: KNOWLEDGE, signal: controller.signal }),
		).rejects.toThrow();
		expect(calls()).toBe(0);
	});

	it("starts no further LLM call after an abort during the first one", async () => {
		const controller = new AbortController();
		let calls = 0;
		const model = new MockLanguageModelV4({
			doGenerate: async () => {
				calls += 1;
				controller.abort(new DOMException("Stopped", "AbortError"));
				return {
					content: [{ type: "text", text: CYCLE }],
					finishReason: { unified: "stop", raw: undefined },
					usage: {
						inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
						outputTokens: { total: 1, text: 1, reasoning: 0 },
					},
					warnings: [],
				};
			},
		});

		await expect(
			planTasks({ model, ticket: TICKET, knowledge: KNOWLEDGE, signal: controller.signal }),
		).rejects.toThrow();
		expect(calls).toBe(1);
	});
});
