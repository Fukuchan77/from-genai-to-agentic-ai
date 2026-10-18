import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineAciTool } from "../aci/define-tool";
import { buildToolSet } from "../aci/tool-set";
import { createCalculatorTool } from "../aci/tools/calculator";
import type { GuardedToolSet } from "../aci/types";
import { PlatformError } from "../errors";
import { createFakeClock } from "../ports/clock";
import { describeTool } from "../testing/tool-description";
import { type CooperateByRoleParams, cooperateByRole, type Role } from "./role-based-cooperation";

// The repository rule `workflow-no-agent-loop` allows only role-based-cooperation.ts to import the
// agents area, so this test spies on the factory through the mock registry instead of importing it.
interface AgentFactoryOptions {
	readonly limits: { readonly maxTotalTokens: number };
	readonly tools: object;
}

const createGuardedAgentSpy = vi.hoisted(() => vi.fn());

vi.mock("../agents/guarded-agent", async (importOriginal) => {
	const actual = await importOriginal<{ createGuardedAgent: (options: never) => unknown }>();
	createGuardedAgentSpy.mockImplementation(actual.createGuardedAgent);
	return { ...actual, createGuardedAgent: createGuardedAgentSpy };
});

function agentOptions(): AgentFactoryOptions[] {
	return createGuardedAgentSpy.mock.calls.map(([options]) => options as AgentFactoryOptions);
}

const BUDGET: CooperateByRoleParams["budget"] = {
	maxSteps: 6,
	maxTotalTokens: 1_000,
	maxDurationMs: 60_000,
	toolTimeoutMs: 5_000,
};

type Step =
	| { readonly text: string; readonly tokens?: number }
	| { readonly tool: string; readonly input: Record<string, unknown>; readonly tokens?: number }
	| { readonly fail: Error };

/** A model that plays the scripted steps in order and records every user message it received. */
function scripted(steps: readonly Step[]) {
	const users: string[] = [];
	const systems: string[] = [];
	let call = 0;
	const model = new MockLanguageModelV4({
		doGenerate: async (options) => {
			systems.push(JSON.stringify(options.prompt.filter((message) => message.role === "system")));
			users.push(JSON.stringify(options.prompt.filter((message) => message.role === "user")));
			const step = steps[Math.min(call, steps.length - 1)];
			call += 1;
			if (!step || "fail" in step) throw step?.fail ?? new Error("no step scripted");
			const tokens = step.tokens ?? 10;
			const inputTokens = Math.ceil(tokens * 0.8);
			const usage = {
				inputTokens: { total: inputTokens, noCache: inputTokens, cacheRead: 0, cacheWrite: 0 },
				outputTokens: { total: tokens - inputTokens, text: tokens - inputTokens, reasoning: 0 },
			};
			if ("tool" in step) {
				return {
					content: [
						{
							type: "tool-call" as const,
							toolCallId: `call-${call}`,
							toolName: step.tool,
							input: JSON.stringify(step.input),
						},
					],
					finishReason: { unified: "tool-calls" as const, raw: undefined },
					usage,
					warnings: [],
				};
			}
			return {
				content: [{ type: "text" as const, text: step.text }],
				finishReason: { unified: "stop" as const, raw: undefined },
				usage,
				warnings: [],
			};
		},
	});
	return { model, users, systems, calls: () => call };
}

/** Rejects with the signal's reason, also when it has already aborted. */
function untilAborted(signal: AbortSignal | undefined): Promise<never> {
	return new Promise((_, reject) => {
		if (signal?.aborted) reject(signal.reason);
		signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
	});
}

const clock = createFakeClock();
const NO_TOOLS: GuardedToolSet = buildToolSet([], {}, { clock, toolTimeoutMs: 5_000 }).tools;

function role(name: string, steps: readonly Step[], tools: GuardedToolSet = NO_TOOLS) {
	const model = scripted(steps);
	const definition: Role = {
		name,
		instructions: `You are the ${name}.`,
		model: model.model,
		tools,
	};
	return { definition, ...model };
}

function run(
	roles: readonly Role[],
	overrides: Partial<Parameters<typeof cooperateByRole>[0]> = {},
) {
	return cooperateByRole({
		roles,
		task: "build the feature",
		budget: BUDGET,
		clock,
		signal: new AbortController().signal,
		...overrides,
	});
}

describe("cooperateByRole", () => {
	it("creates one guarded agent per role and hands each role the remaining token budget", async () => {
		createGuardedAgentSpy.mockClear();
		const researcher = role("researcher", [{ text: "findings", tokens: 300 }]);
		const coder = role("coder", [{ text: "code", tokens: 200 }]);
		const reviewer = role("reviewer", [{ text: "approved", tokens: 50 }]);

		await run([researcher.definition, coder.definition, reviewer.definition]);

		expect(createGuardedAgentSpy).toHaveBeenCalledTimes(3);
		expect(agentOptions().map((options) => options.limits.maxTotalTokens)).toEqual([
			1_000, 700, 500,
		]);
		expect(agentOptions()[0]?.limits).toMatchObject({
			maxSteps: BUDGET.maxSteps,
			maxDurationMs: BUDGET.maxDurationMs,
			toolTimeoutMs: BUDGET.toolTimeoutMs,
		});
	});

	it("returns each role's output and run summary and the last role's output as the final result", async () => {
		const researcher = role("researcher", [{ text: "findings" }]);
		const coder = role("coder", [{ text: "code" }]);

		const result = await run([researcher.definition, coder.definition]);

		expect(result.outputs.map((entry) => [entry.role, entry.output])).toEqual([
			["researcher", "findings"],
			["coder", "code"],
		]);
		expect(result.outputs[0]?.run).toMatchObject({ stopReason: "completed", steps: 1 });
		expect(result.final).toBe("code");
		expect(result).not.toHaveProperty("stopped");
	});

	it("passes the task and every earlier role's output to the next role", async () => {
		const researcher = role("researcher", [{ text: "FINDINGS-TEXT" }]);
		const coder = role("coder", [{ text: "CODE-TEXT" }]);
		const reviewer = role("reviewer", [{ text: "ok" }]);

		await run([researcher.definition, coder.definition, reviewer.definition]);

		expect(researcher.systems[0]).toContain("You are the researcher.");
		expect(coder.systems[0]).toContain("You are the coder.");
		expect(researcher.users[0]).toContain("build the feature");
		expect(researcher.users[0]).not.toContain("FINDINGS-TEXT");
		expect(coder.users[0]).toContain("FINDINGS-TEXT");
		expect(reviewer.users[0]).toContain("FINDINGS-TEXT");
		expect(reviewer.users[0]).toContain("CODE-TEXT");
	});

	it("names the role the message is for, as the first line of its prompt", async () => {
		const researcher = role("researcher", [{ text: "findings" }]);
		const coder = role("coder", [{ text: "code" }]);

		await run([researcher.definition, coder.definition]);

		expect(researcher.users[0]).toContain("[役割: researcher]");
		expect(coder.users[0]).toContain("[役割: coder]");
		expect(coder.users[0]).not.toContain("[役割: researcher]");
	});

	it("does not run the next role once the shared budget is spent, and says so", async () => {
		const researcher = role("researcher", [{ text: "findings", tokens: 600 }]);
		const coder = role("coder", [{ text: "code", tokens: 600 }]);
		const reviewer = role("reviewer", [{ text: "approved" }]);

		const result = await run([researcher.definition, coder.definition, reviewer.definition]);

		expect(result.stopped).toBe("budget-exhausted");
		expect(result.outputs.map((entry) => entry.role)).toEqual(["researcher", "coder"]);
		expect(reviewer.calls()).toBe(0);
		expect(result.final).toBe("code");
	});

	it("is not budget-exhausted when the last role is the one that spends the rest", async () => {
		const researcher = role("researcher", [{ text: "findings", tokens: 100 }]);
		const reviewer = role("reviewer", [{ text: "approved", tokens: 900 }]);

		const result = await run([researcher.definition, reviewer.definition]);

		expect(result).not.toHaveProperty("stopped");
		expect(result.final).toBe("approved");
	});

	it("stops with the role's error and runs nothing after it", async () => {
		const researcher = role("researcher", [{ text: "findings" }]);
		const coder = role("coder", [{ fail: new Error("provider exploded") }]);
		const reviewer = role("reviewer", [{ text: "approved" }]);

		const result = await run([researcher.definition, coder.definition, reviewer.definition]);

		expect(result.stopped).toBe("error");
		expect(result.outputs.map((entry) => entry.role)).toEqual(["researcher", "coder"]);
		expect(result.outputs[1]).toMatchObject({ output: "", run: { stopReason: "error" } });
		expect(reviewer.calls()).toBe(0);
		expect(result.final).toBe("findings");
	});

	it("rethrows a provider outage instead of reporting it as a stopped result", async () => {
		const outage = new APICallError({
			message: "down",
			url: "https://example.invalid",
			requestBodyValues: {},
		});
		const failing: Role = {
			name: "researcher",
			instructions: "r",
			model: new MockLanguageModelV4({
				doGenerate: async () => {
					throw outage;
				},
			}),
			tools: NO_TOOLS,
		};
		const reviewer = role("reviewer", [{ text: "ok" }]);

		await expect(run([failing, reviewer.definition])).rejects.toBe(outage);
		expect(reviewer.calls()).toBe(0);
	});

	it("rethrows a PlatformError about the environment", async () => {
		const unavailable = new PlatformError("provider-unavailable", "down");
		const failing: Role = {
			name: "researcher",
			instructions: "r",
			model: new MockLanguageModelV4({
				doGenerate: async () => {
					throw unavailable;
				},
			}),
			tools: NO_TOOLS,
		};

		await expect(run([failing])).rejects.toBe(unavailable);
	});

	it("stops with aborted when the caller aborts during a role, and starts no later role", async () => {
		const controller = new AbortController();
		const researcher = {
			...role("researcher", [{ text: "findings" }]),
		};
		const hanging = new MockLanguageModelV4({
			doGenerate: async (options) => {
				controller.abort(new Error("user stopped"));
				return untilAborted(options.abortSignal);
			},
		});
		const coder: Role = { name: "coder", instructions: "c", model: hanging, tools: NO_TOOLS };
		const reviewer = role("reviewer", [{ text: "approved" }]);

		const result = await run([researcher.definition, coder, reviewer.definition], {
			signal: controller.signal,
		});

		expect(result.stopped).toBe("aborted");
		expect(result.outputs.at(-1)).toMatchObject({ role: "coder", run: { stopReason: "aborted" } });
		expect(reviewer.calls()).toBe(0);
	});

	it("does not start any role when the signal is already aborted", async () => {
		const controller = new AbortController();
		controller.abort(new Error("stop"));
		const researcher = role("researcher", [{ text: "findings" }]);

		const result = await run([researcher.definition], { signal: controller.signal });

		expect(result).toMatchObject({ stopped: "aborted", outputs: [], final: "" });
		expect(researcher.calls()).toBe(0);
	});

	it("stops with timeout when a role runs out of time", async () => {
		const fake = createFakeClock();
		const hanging = new MockLanguageModelV4({
			doGenerate: async (options) => {
				fake.advanceBy(BUDGET.maxDurationMs);
				return untilAborted(options.abortSignal);
			},
		});
		const slow: Role = { name: "slow", instructions: "s", model: hanging, tools: NO_TOOLS };
		const next = role("next", [{ text: "x" }]);

		const result = await run([slow, next.definition], { clock: fake });

		expect(result.stopped).toBe("timeout");
		expect(next.calls()).toBe(0);
	});

	it("continues to the next role when a role only hit its step limit", async () => {
		const loopTool = createCalculatorTool();
		const tools = buildToolSet([loopTool], {}, { clock, toolTimeoutMs: 5_000 }).tools;
		const looping = role("looping", [{ tool: "calculator", input: { expression: "1+1" } }], tools);
		const next = role("next", [{ text: "wrap up" }]);

		const result = await run([looping.definition, next.definition], {
			budget: { ...BUDGET, maxSteps: 2 },
		});

		expect(result.outputs[0]?.run.stopReason).toBe("step-limit");
		expect(result).not.toHaveProperty("stopped");
		expect(result.final).toBe("wrap up");
	});

	it("lets a role use its tools and records them in the run summary", async () => {
		const tools = buildToolSet([createCalculatorTool()], {}, { clock, toolTimeoutMs: 5_000 }).tools;
		const coder = role(
			"coder",
			[{ tool: "calculator", input: { expression: "2 + 3" } }, { text: "the answer is 5" }],
			tools,
		);

		const result = await run([coder.definition]);

		expect(result.outputs[0]?.run.toolsCalled).toEqual(["calculator"]);
		expect(result.final).toBe("the answer is 5");
	});

	it("rejects more roles than the limit without creating an agent", async () => {
		createGuardedAgentSpy.mockClear();
		const six = Array.from(
			{ length: 6 },
			(_, index) => role(`r${index}`, [{ text: "x" }]).definition,
		);

		await expect(run(six)).rejects.toMatchObject({ code: "invalid-request" });
		expect(createGuardedAgentSpy).not.toHaveBeenCalled();
	});

	it("accepts exactly the role limit", async () => {
		const five = Array.from(
			{ length: 5 },
			(_, index) => role(`r${index}`, [{ text: `o${index}` }]).definition,
		);

		const result = await run(five);

		expect(result.outputs).toHaveLength(5);
	});

	it("rejects an empty role list and duplicate role names", async () => {
		const a = role("same", [{ text: "x" }]).definition;

		await expect(run([])).rejects.toMatchObject({ code: "invalid-request" });
		await expect(run([a, a])).rejects.toMatchObject({ code: "invalid-request" });
	});

	it("keeps the role's own tools out of the other roles", async () => {
		const secretTool = defineAciTool({
			name: "secret",
			description: describeTool("only for the coder"),
			inputSchema: z.object({}),
			risk: "read-only",
			execute: () => ({ ok: true }),
		});
		const coderTools = buildToolSet([secretTool], {}, { clock, toolTimeoutMs: 5_000 }).tools;
		const researcher = role("researcher", [{ text: "x" }]);
		const coder = role("coder", [{ text: "y" }], coderTools);
		createGuardedAgentSpy.mockClear();

		await run([researcher.definition, coder.definition]);

		const toolNames = createGuardedAgentSpy.mock.calls.map(([options]) =>
			Object.keys(options.tools),
		);
		expect(toolNames).toEqual([[], ["secret"]]);
	});
});
