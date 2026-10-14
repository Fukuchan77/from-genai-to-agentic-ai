import { readFileSync } from "node:fs";
import { wrapLanguageModel } from "ai";
import { describe, expect, it, vi } from "vitest";
import { M2_4_SAMPLE_TASKS } from "../../fixtures/scenarios/m2-4";
import { DEFAULT_AGENT_LIMITS, loadPlatformConfig } from "../config";
import { PlatformError } from "../errors";
import { createModelGateway, type ModelGateway, type ResolveRequest } from "../models";
import { createFakeClock } from "../ports/clock";
import { PATTERN_DEMO_NAMES, patternDemoMaxCalls, runPatternDemo } from "./demos";

// The repository rule `workflow-no-agent-loop` keeps the agents area out of this directory except in
// role-based-cooperation.ts, so the agent factory is observed through the mock registry.
interface AgentFactoryOptions {
	readonly tools: object;
	readonly signal: AbortSignal;
	readonly limits: { readonly maxTotalTokens: number };
}

const createGuardedAgentSpy = vi.hoisted(() => vi.fn());

vi.mock("../agents/guarded-agent", async (importOriginal) => {
	const actual = await importOriginal<{ createGuardedAgent: (options: never) => unknown }>();
	createGuardedAgentSpy.mockImplementation(actual.createGuardedAgent);
	return { ...actual, createGuardedAgent: createGuardedAgentSpy };
});

const gateway = createModelGateway({ config: loadPlatformConfig({ VITEST: "true" }) });

interface CapturedCall {
	readonly system: string;
	readonly user: string;
	readonly signal: AbortSignal | undefined;
}

/** A gateway that records the resolve requests and every model call (system, user text, signal). */
function capturingGateway(base: ModelGateway = gateway) {
	const requests: ResolveRequest[] = [];
	const calls: CapturedCall[] = [];
	const wrapped: ModelGateway = {
		async resolve(request) {
			requests.push(request);
			const resolved = await base.resolve(request);
			return {
				...resolved,
				model: wrapLanguageModel({
					model: resolved.model,
					middleware: {
						specificationVersion: "v4",
						async wrapGenerate({ doGenerate, params }) {
							const text = (role: string) =>
								JSON.stringify(params.prompt.filter((message) => message.role === role));
							calls.push({
								system: text("system"),
								user: text("user"),
								signal: params.abortSignal,
							});
							return doGenerate();
						},
					},
				}),
			};
		},
		resolveEmbedding: base.resolveEmbedding.bind(base),
		availableModels: base.availableModels.bind(base),
	};
	return { gateway: wrapped, requests, calls };
}
const deps = { gateway, clock: createFakeClock(), agentLimits: DEFAULT_AGENT_LIMITS };

function spyOnGateway(base: ModelGateway = gateway) {
	const resolve = vi.fn(base.resolve.bind(base));
	const wrapped: ModelGateway = {
		resolve,
		resolveEmbedding: base.resolveEmbedding.bind(base),
		availableModels: base.availableModels.bind(base),
	};
	return { gateway: wrapped, resolve };
}

describe("runPatternDemo: passive-goal-creator", () => {
	it("returns the goal specification for a sufficient instruction", async () => {
		const run = await runPatternDemo("passive-goal-creator", deps, {
			task: M2_4_SAMPLE_TASKS.passiveGoal.sufficient,
		});

		expect(run.name).toBe("passive-goal-creator");
		expect(run.result).toMatchObject({
			objective: expect.any(String),
			missingInformation: [],
			clarifyingQuestions: [],
		});
		expect(run.usage.llmCalls).toBe(1);
	});

	it("returns the missing items and the questions for an ambiguous instruction", async () => {
		const run = await runPatternDemo("passive-goal-creator", deps, {
			task: M2_4_SAMPLE_TASKS.passiveGoal.ambiguous,
		});

		const goal = run.result as { missingInformation: string[]; clarifyingQuestions: string[] };
		expect(goal.missingInformation.length).toBeGreaterThan(0);
		expect(goal.clarifyingQuestions.length).toBeGreaterThan(0);
	});
});

describe("runPatternDemo: prompt-response-optimizer", () => {
	it("improves a prompt and gives the reasons", async () => {
		const run = await runPatternDemo("prompt-response-optimizer", deps, {
			task: M2_4_SAMPLE_TASKS.optimizer.prompt,
		});

		expect(run.result).toMatchObject({ original: M2_4_SAMPLE_TASKS.optimizer.prompt });
		expect((run.result as { reasons: string[] }).reasons.length).toBeGreaterThan(0);
	});

	it("improves a response when the target option says so", async () => {
		const run = await runPatternDemo("prompt-response-optimizer", deps, {
			task: M2_4_SAMPLE_TASKS.optimizer.response,
			options: { target: "response" },
		});

		expect((run.result as { improved: string }).improved).toContain("情報システム部");
	});

	it("rejects a target outside the vocabulary", async () => {
		await expect(
			runPatternDemo("prompt-response-optimizer", deps, {
				task: "x",
				options: { target: "essay" },
			}),
		).rejects.toMatchObject({ code: "invalid-request" });
	});
});

describe("runPatternDemo: options reach the patterns", () => {
	it("instructs the optimizer for the chosen target and hands it the goal", async () => {
		const prompt = capturingGateway();
		const response = capturingGateway();

		await runPatternDemo(
			"prompt-response-optimizer",
			{ ...deps, gateway: prompt.gateway },
			{ task: M2_4_SAMPLE_TASKS.optimizer.prompt, options: { goal: "GOAL-FOR-PROMPT" } },
		);
		await runPatternDemo(
			"prompt-response-optimizer",
			{ ...deps, gateway: response.gateway },
			{ task: M2_4_SAMPLE_TASKS.optimizer.response, options: { target: "response" } },
		);

		expect(prompt.calls[0]?.system).toContain("プロンプトの最適化");
		expect(prompt.calls[0]?.user).toContain("GOAL-FOR-PROMPT");
		expect(response.calls[0]?.system).toContain("回答の最適化");
	});

	it("asks for the requested number of candidates", async () => {
		const scenarios = [
			{
				id: "test/two-candidates",
				turns: [
					{
						match: { purpose: "structured" as const, lastUserTextIncludes: "候補 1/2 として" },
						respond: { object: { steps: ["a"] } },
					},
					{
						match: { purpose: "structured" as const, lastUserTextIncludes: "候補 2/2 として" },
						respond: { object: { steps: ["b"] } },
					},
					{
						match: { purpose: "judge" as const, lastUserTextIncludes: '<candidate number="2">' },
						respond: {
							object: {
								evaluations: [
									{ candidate: 1, score: 50, comment: "x" },
									{ candidate: 2, score: 60, comment: "y" },
								],
								selectedCandidate: 2,
								reason: "r",
							},
						},
					},
				],
			},
		];
		const two = capturingGateway(
			createModelGateway({
				config: loadPlatformConfig({ VITEST: "true" }),
				mock: { scenarios },
			}),
		);

		const run = await runPatternDemo(
			"multi-path-plan",
			{ ...deps, gateway: two.gateway },
			{ task: "TWO-CANDIDATE-TASK", options: { candidates: 2 } },
		);

		expect((run.result as { candidates: unknown[] }).candidates).toHaveLength(2);
		expect(run.usage.llmCalls).toBe(3);
	});

	it("hands the caller's signal to the model calls", async () => {
		const controller = new AbortController();
		const captured = capturingGateway();

		await runPatternDemo(
			"passive-goal-creator",
			{ ...deps, gateway: captured.gateway, signal: controller.signal },
			{ task: M2_4_SAMPLE_TASKS.passiveGoal.sufficient },
		);
		controller.abort();

		expect(captured.calls[0]?.signal?.aborted).toBe(true);
	});

	it("asks the gateway for a tool-capable model for the roles and a structured one for the plans", async () => {
		const captured = capturingGateway();

		await runPatternDemo(
			"role-based-cooperation",
			{ ...deps, gateway: captured.gateway },
			{ task: M2_4_SAMPLE_TASKS.roleBased },
		);
		await runPatternDemo(
			"single-path-plan",
			{ ...deps, gateway: captured.gateway },
			{ task: M2_4_SAMPLE_TASKS.singlePath },
		);

		expect(captured.requests[0]).toMatchObject({ purpose: "chat", require: ["tools"] });
		expect(captured.requests).toContainEqual({
			purpose: "structured",
			require: ["structuredOutput"],
		});
	});
});

describe("runPatternDemo: single-path-plan", () => {
	it("plans the steps and runs them in order, each with its result", async () => {
		const run = await runPatternDemo("single-path-plan", deps, {
			task: M2_4_SAMPLE_TASKS.singlePath,
		});

		const result = run.result as { steps: string[]; results: { step: string; output: string }[] };
		expect(result.steps).toHaveLength(3);
		expect(result.results.map((entry) => entry.step)).toEqual(result.steps);
		expect(result.results.every((entry) => entry.output.length > 0)).toBe(true);
		expect(run.usage.llmCalls).toBe(4);
	});
});

describe("runPatternDemo: multi-path-plan", () => {
	it("generates three candidates, evaluates them all and reports the chosen one", async () => {
		const run = await runPatternDemo("multi-path-plan", deps, {
			task: M2_4_SAMPLE_TASKS.multiPath,
		});

		const result = run.result as {
			candidates: unknown[];
			evaluations: unknown[];
			selectedIndex: number;
			reason: string;
		};
		expect(result.candidates).toHaveLength(3);
		expect(result.evaluations).toHaveLength(3);
		expect(result.selectedIndex).toBe(1);
		expect(result.reason.length).toBeGreaterThan(0);
		expect(run.usage.llmCalls).toBe(4);
	});

	it("rejects more candidates than the limit before any model is resolved", async () => {
		const spy = spyOnGateway();

		await expect(
			runPatternDemo(
				"multi-path-plan",
				{ ...deps, gateway: spy.gateway },
				{ task: M2_4_SAMPLE_TASKS.multiPath, options: { candidates: 6 } },
			),
		).rejects.toMatchObject({ code: "invalid-request" });
		expect(spy.resolve).not.toHaveBeenCalled();
	});
});

describe("runPatternDemo: self-reflection", () => {
	it("critiques and revises, ending early when the critic asks for no change", async () => {
		const run = await runPatternDemo("self-reflection", deps, {
			task: M2_4_SAMPLE_TASKS.selfReflection,
		});

		const result = run.result as {
			final: string;
			history: { iteration: number; output: string; revised: string }[];
			generatorModelId: string;
			criticModelId: string;
		};
		expect(result.history).toHaveLength(3);
		expect(result.history[2]?.revised).toBe(result.history[2]?.output);
		expect(result.final).toBe(result.history[1]?.revised);
		expect(result.criticModelId).toBe(result.generatorModelId);
		// first draft + 3 critiques + 2 revisions
		expect(run.usage.llmCalls).toBe(6);
	});

	it("honours a lower iteration limit", async () => {
		const run = await runPatternDemo("self-reflection", deps, {
			task: M2_4_SAMPLE_TASKS.selfReflection,
			options: { maxIterations: 1 },
		});

		expect((run.result as { history: unknown[] }).history).toHaveLength(1);
		expect(run.usage.llmCalls).toBe(3);
	});

	it("rejects more iterations than the cap", async () => {
		await expect(
			runPatternDemo("self-reflection", deps, {
				task: M2_4_SAMPLE_TASKS.selfReflection,
				options: { maxIterations: 9 },
			}),
		).rejects.toMatchObject({ code: "invalid-request" });
	});
});

describe("runPatternDemo: cross-reflection", () => {
	it("critiques with the judge model, which has a different catalog ID", async () => {
		const run = await runPatternDemo("cross-reflection", deps, {
			task: M2_4_SAMPLE_TASKS.crossReflection,
		});

		const result = run.result as {
			final: string;
			history: unknown[];
			generatorModelId: string;
			criticModelId: string;
		};
		expect(result.criticModelId).toBe("mock:judge-v1");
		expect(result.criticModelId).not.toBe(result.generatorModelId);
		expect(result.history).toHaveLength(2);
		expect(result.final).toContain("検索機能");
		// first draft + 2 critiques + 1 revision
		expect(run.usage.llmCalls).toBe(4);
	});

	it("refuses with invalid-request, before any call, when the judge is the same model as the chat model", async () => {
		const chat = await gateway.resolve({ purpose: "chat" });
		const sameModel: ModelGateway = {
			resolve: async () => chat,
			resolveEmbedding: gateway.resolveEmbedding.bind(gateway),
			availableModels: gateway.availableModels.bind(gateway),
		};

		const error = await runPatternDemo(
			"cross-reflection",
			{ ...deps, gateway: sameModel },
			{ task: M2_4_SAMPLE_TASKS.crossReflection },
		).catch((thrown: unknown) => thrown);

		expect(error).toBeInstanceOf(PlatformError);
		expect(error).toMatchObject({ code: "invalid-request" });
		expect((error as Error).message).toContain("AI_MODEL_JUDGE");
	});
});

describe("runPatternDemo: role-based-cooperation", () => {
	it("passes the work from the researcher to the coder to the reviewer, each with its tools", async () => {
		const run = await runPatternDemo("role-based-cooperation", deps, {
			task: M2_4_SAMPLE_TASKS.roleBased,
		});

		const result = run.result as {
			outputs: {
				role: string;
				output: string;
				run: { toolsCalled: string[]; stopReason: string };
			}[];
			final: string;
		};
		expect(result.outputs.map((entry) => entry.role)).toEqual(["researcher", "coder", "reviewer"]);
		expect(result.outputs.map((entry) => entry.run.toolsCalled)).toEqual([
			["currentTime"],
			["calculator"],
			[],
		]);
		expect(result.outputs.every((entry) => entry.run.stopReason === "completed")).toBe(true);
		expect(result.final).toBe(result.outputs[2]?.output);
		expect(result).not.toHaveProperty("stopped");
		// researcher 2 + coder 2 + reviewer 1 model calls
		expect(run.usage.llmCalls).toBe(5);
	});

	it("builds one agent per role, with only that role's tools, the caller's signal and the shared budget", async () => {
		const controller = new AbortController();
		createGuardedAgentSpy.mockClear();

		await runPatternDemo(
			"role-based-cooperation",
			{ ...deps, signal: controller.signal },
			{ task: M2_4_SAMPLE_TASKS.roleBased },
		);

		const created = createGuardedAgentSpy.mock.calls.map(
			([options]) => options as AgentFactoryOptions,
		);
		expect(created.map((options) => Object.keys(options.tools))).toEqual([
			["currentTime"],
			["calculator"],
			[],
		]);
		controller.abort();
		expect(created.every((options) => options.signal === controller.signal)).toBe(true);
		expect(created[0]?.limits.maxTotalTokens).toBe(DEFAULT_AGENT_LIMITS.maxTotalTokens);
		expect(created[1]?.limits.maxTotalTokens).toBeLessThan(DEFAULT_AGENT_LIMITS.maxTotalTokens);
	});

	it("stops with the budget when the shared token budget is too small for every role", async () => {
		const run = await runPatternDemo(
			"role-based-cooperation",
			{ ...deps, agentLimits: { ...DEFAULT_AGENT_LIMITS, maxTotalTokens: 400 } },
			{ task: M2_4_SAMPLE_TASKS.roleBased },
		);

		expect(run.result).toMatchObject({ stopped: "budget-exhausted" });
		expect((run.result as { outputs: unknown[] }).outputs.length).toBeLessThan(3);
	});
});

describe("runPatternDemo: input checks", () => {
	it("rejects a name outside the closed vocabulary", async () => {
		await expect(runPatternDemo("tree-of-thoughts", deps, { task: "x" })).rejects.toMatchObject({
			code: "invalid-request",
		});
	});

	it("rejects an empty task and an undefined option without echoing it", async () => {
		await expect(runPatternDemo("single-path-plan", deps, { task: " " })).rejects.toMatchObject({
			code: "invalid-request",
		});
		const error = await runPatternDemo("single-path-plan", deps, {
			task: "x",
			options: { "SECRET-KEY": 1 },
		}).catch((thrown: unknown) => thrown);
		expect(error).toMatchObject({ code: "invalid-request" });
		expect(
			JSON.stringify([(error as Error).message, (error as PlatformError).details]),
		).not.toContain("SECRET-KEY");
	});

	it("does not resolve a model when the signal is already aborted", async () => {
		const controller = new AbortController();
		controller.abort(new Error("stop"));
		const spy = spyOnGateway();

		await expect(
			runPatternDemo(
				"passive-goal-creator",
				{ ...deps, gateway: spy.gateway, signal: controller.signal },
				{ task: M2_4_SAMPLE_TASKS.passiveGoal.sufficient },
			),
		).rejects.toThrow("stop");
		expect(spy.resolve).not.toHaveBeenCalled();
	});
});

describe("patternDemoMaxCalls", () => {
	it("is the product of the limits for every demo (a structured call may take 3 attempts)", () => {
		expect(patternDemoMaxCalls("passive-goal-creator")).toBe(3);
		expect(patternDemoMaxCalls("prompt-response-optimizer")).toBe(3);
		expect(patternDemoMaxCalls("single-path-plan")).toBe(3 + 8);
		expect(patternDemoMaxCalls("multi-path-plan")).toBe(3 * 3 + 3);
		expect(patternDemoMaxCalls("multi-path-plan", { candidates: 5 })).toBe(5 * 3 + 3);
		expect(patternDemoMaxCalls("self-reflection")).toBe(1 + 3 * (3 + 1));
		expect(patternDemoMaxCalls("cross-reflection", { maxIterations: 8 })).toBe(1 + 8 * (3 + 1));
		expect(patternDemoMaxCalls("role-based-cooperation")).toBe(3 * DEFAULT_AGENT_LIMITS.maxSteps);
		expect(
			patternDemoMaxCalls("role-based-cooperation", {}, { ...DEFAULT_AGENT_LIMITS, maxSteps: 4 }),
		).toBe(12);
	});

	it("bounds the calls of every demo run in mock mode", async () => {
		const tasks: Record<(typeof PATTERN_DEMO_NAMES)[number], string> = {
			"passive-goal-creator": M2_4_SAMPLE_TASKS.passiveGoal.sufficient,
			"prompt-response-optimizer": M2_4_SAMPLE_TASKS.optimizer.prompt,
			"single-path-plan": M2_4_SAMPLE_TASKS.singlePath,
			"multi-path-plan": M2_4_SAMPLE_TASKS.multiPath,
			"self-reflection": M2_4_SAMPLE_TASKS.selfReflection,
			"cross-reflection": M2_4_SAMPLE_TASKS.crossReflection,
			"role-based-cooperation": M2_4_SAMPLE_TASKS.roleBased,
		};
		for (const name of PATTERN_DEMO_NAMES) {
			const run = await runPatternDemo(name, deps, { task: tasks[name] });
			expect(run.usage.llmCalls, name).toBeLessThanOrEqual(patternDemoMaxCalls(name));
		}
	});

	it("rejects options over a limit and unknown names", () => {
		expect(() => patternDemoMaxCalls("multi-path-plan", { candidates: 6 })).toThrow(PlatformError);
		expect(() => patternDemoMaxCalls("nope")).toThrow(PlatformError);
	});
});

describe("demos.ts and the agents area", () => {
	it("does not import the agents area; only role-based-cooperation.ts builds agent loops", () => {
		const source = readFileSync(new URL("./demos.ts", import.meta.url), "utf8");

		expect(source).not.toMatch(/from\s+["'][^"']*agents[^"']*["']/u);
		expect(source).not.toContain("ToolLoopAgent");
		expect(source).toContain('from "./role-based-cooperation"');
	});
});
