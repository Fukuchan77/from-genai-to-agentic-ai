import { z } from "zod";
import { buildToolSet, createCalculatorTool, createCurrentTimeTool } from "../aci";
import { DEFAULT_AGENT_LIMITS } from "../config";
import { PlatformError } from "../errors";
import type { ModelGateway, ResolvedModel } from "../models";
import type { Clock } from "../ports/clock";
import { DEFAULT_MAX_REGENERATIONS } from "../structured";
import { createUsageLedger, type DemoUsage, stageText } from "../workflows/demos";
import { assertWithinLimit, resolveWorkflowLimits } from "../workflows/limits";
import { planMultiPath } from "./multi-path-plan";
import { createPassiveGoal } from "./passive-goal-creator";
import { optimizePromptOrResponse } from "./prompt-optimizer";
import { reflect } from "./reflection";
import { type CooperateByRoleParams, cooperateByRole, type Role } from "./role-based-cooperation";
import { planSinglePath } from "./single-path-plan";

// Fixed compositions of the six agent design patterns, one per name, for the HTTP API and the
// screen (plan C12, C13). The role-based demo calls `cooperateByRole`, the one pattern that builds
// agent loops; this file imports nothing from the agents area. Prompts carry `[段: <stage>]`
// labels that the `mock` scenarios in `fixtures/scenarios/m2-4.ts` match on.

export const PATTERN_DEMO_NAMES = [
	"passive-goal-creator",
	"prompt-response-optimizer",
	"single-path-plan",
	"multi-path-plan",
	"self-reflection",
	"cross-reflection",
	"role-based-cooperation",
] as const;

export type PatternDemoName = (typeof PATTERN_DEMO_NAMES)[number];

export interface PatternDemoDeps {
	readonly gateway: ModelGateway;
	readonly clock: Clock;
	/** Limits of each role's agent; `maxTotalTokens` is shared by all roles (CL-8). */
	readonly agentLimits: CooperateByRoleParams["budget"];
	readonly signal?: AbortSignal | undefined;
}

export interface PatternDemoInput {
	readonly task: string;
	readonly options?: unknown;
}

export interface PatternDemoRun {
	readonly name: PatternDemoName;
	readonly result: unknown;
	readonly usage: DemoUsage;
}

const DEFAULT_OPTIMIZER_GOAL = "意図を保ったまま、より具体的で誤解の少ない形にする。";
const ROLE_COUNT = 3;
const STRUCTURED_ATTEMPTS = DEFAULT_MAX_REGENERATIONS + 1;

const OPTION_SCHEMAS = {
	"passive-goal-creator": z.strictObject({}),
	"prompt-response-optimizer": z.strictObject({
		target: z.enum(["prompt", "response"]).optional(),
		goal: z.string().min(1).max(200).optional(),
	}),
	"single-path-plan": z.strictObject({}),
	"multi-path-plan": z.strictObject({ candidates: z.number().int().optional() }),
	"self-reflection": z.strictObject({ maxIterations: z.number().int().optional() }),
	"cross-reflection": z.strictObject({ maxIterations: z.number().int().optional() }),
	"role-based-cooperation": z.strictObject({}),
} as const satisfies Record<PatternDemoName, z.ZodType>;

type OptionsOf<N extends PatternDemoName> = z.infer<(typeof OPTION_SCHEMAS)[N]>;

function parseName(name: string): PatternDemoName {
	if ((PATTERN_DEMO_NAMES as readonly string[]).includes(name)) return name as PatternDemoName;
	throw new PlatformError("invalid-request", "パターンの名前が正しくありません。", {
		allowed: PATTERN_DEMO_NAMES,
	});
}

function parseOptions<N extends PatternDemoName>(name: N, options: unknown): OptionsOf<N> {
	const parsed = OPTION_SCHEMAS[name].safeParse(options ?? {});
	if (!parsed.success) {
		// Only the paths: zod's messages can echo the rejected value or key.
		throw new PlatformError("invalid-request", "options の形式が正しくありません。", {
			paths: parsed.error.issues.map((issue) => issue.path.map(String).join(".") || "(root)"),
		});
	}
	return parsed.data as OptionsOf<N>;
}

/**
 * The most model calls one run of the demo can make with these options (plan C13). It also checks
 * the options against the limits, so an over-limit request is refused before any model is called.
 * Structured-output calls count every allowed regeneration; each step of a role's agent is a call.
 */
export function patternDemoMaxCalls(
	name: string,
	options?: unknown,
	agentLimits: Pick<CooperateByRoleParams["budget"], "maxSteps"> = DEFAULT_AGENT_LIMITS,
): number {
	const demo = parseName(name);
	const parsed = parseOptions(demo, options) as Record<string, number | undefined>;
	const limits = resolveWorkflowLimits();
	switch (demo) {
		case "passive-goal-creator":
		case "prompt-response-optimizer":
			return STRUCTURED_ATTEMPTS;
		case "single-path-plan":
			return STRUCTURED_ATTEMPTS + limits.maxPlanSteps;
		case "multi-path-plan": {
			const candidates = parsed.candidates ?? limits.defaultCandidates;
			assertWithinLimit("candidates", candidates, limits.maxCandidates);
			return candidates * STRUCTURED_ATTEMPTS + STRUCTURED_ATTEMPTS;
		}
		case "self-reflection":
		case "cross-reflection": {
			const iterations = parsed.maxIterations ?? limits.defaultMaxIterations;
			assertWithinLimit("maxIterations", iterations, limits.maxIterationsCap);
			// the first draft, then per iteration a critique (structured) and a revision
			return 1 + iterations * (STRUCTURED_ATTEMPTS + 1);
		}
		case "role-based-cooperation":
			return ROLE_COUNT * agentLimits.maxSteps;
	}
}

interface Context {
	readonly deps: PatternDemoDeps;
	readonly ledger: ReturnType<typeof createUsageLedger>;
	readonly task: string;
	readonly signal: AbortSignal | undefined;
}

async function resolveWrapped(
	context: Context,
	purpose: "chat" | "structured" | "judge",
	require: readonly ("tools" | "structuredOutput")[] = [],
): Promise<ResolvedModel> {
	const resolved = await context.deps.gateway.resolve({
		purpose,
		...(require.length > 0 ? { require } : {}),
	});
	return { ...resolved, model: context.ledger.wrap(resolved.model) };
}

async function passiveGoalCreator(context: Context) {
	const structured = await resolveWrapped(context, "structured", ["structuredOutput"]);
	return createPassiveGoal({
		model: structured.model,
		instruction: context.task,
		signal: context.signal,
	});
}

async function promptResponseOptimizer(
	context: Context,
	options: OptionsOf<"prompt-response-optimizer">,
) {
	const structured = await resolveWrapped(context, "structured", ["structuredOutput"]);
	return optimizePromptOrResponse({
		model: structured.model,
		target: options.target ?? "prompt",
		original: context.task,
		goal: options.goal ?? DEFAULT_OPTIMIZER_GOAL,
		signal: context.signal,
	});
}

async function singlePathPlan(context: Context) {
	const structured = await resolveWrapped(context, "structured", ["structuredOutput"]);
	const chat = await resolveWrapped(context, "chat");
	return planSinglePath({
		planner: { model: structured.model },
		goal: context.task,
		signal: context.signal,
		executor: (step, { goal, previousResults, signal }) =>
			stageText({
				model: chat.model,
				stage: `ステップ ${previousResults.length + 1}`,
				task: goal,
				extra: [
					`<step>\n${step}\n</step>`,
					...previousResults.map(
						(entry) => `<previous step="${entry.step}">\n${entry.output}\n</previous>`,
					),
				].join("\n\n"),
				signal,
			}),
	});
}

async function multiPathPlan(context: Context, options: OptionsOf<"multi-path-plan">) {
	const structured = await resolveWrapped(context, "structured", ["structuredOutput"]);
	const judge = await resolveWrapped(context, "judge", ["structuredOutput"]);
	return planMultiPath({
		planner: { model: structured.model },
		evaluator: { model: judge.model },
		goal: context.task,
		candidates: options.candidates,
		signal: context.signal,
	});
}

async function reflection(
	context: Context,
	mode: "self" | "cross",
	options: OptionsOf<"self-reflection">,
) {
	const generator = await resolveWrapped(context, "chat");
	// A self critique is a structured call on the generator itself; a cross critique uses the judge.
	const critic =
		mode === "cross" ? await resolveWrapped(context, "judge", ["structuredOutput"]) : undefined;
	return reflect({
		mode,
		generator,
		critic,
		task: context.task,
		maxIterations: options.maxIterations,
		signal: context.signal,
	});
}

async function roleBasedCooperation(context: Context) {
	const { clock, agentLimits } = context.deps;
	const model = (await resolveWrapped(context, "chat", ["tools"])).model;
	const toolsFor = (...tools: Parameters<typeof buildToolSet>[0]) =>
		buildToolSet(tools, {}, { clock, toolTimeoutMs: agentLimits.toolTimeoutMs }).tools;
	const roles: Role[] = [
		{
			name: "researcher",
			instructions:
				"あなたはリサーチャーです。currentTime ツールで調査時点を確かめ、タスクに必要な事実を短くまとめてください。",
			model,
			tools: toolsFor(createCurrentTimeTool(clock)),
		},
		{
			name: "coder",
			instructions:
				"あなたはコーダーです。前の役割の調査結果をもとに、calculator ツールで必要な数値を集計し、結果を短くまとめてください。",
			model,
			tools: toolsFor(createCalculatorTool()),
		},
		{
			name: "reviewer",
			instructions:
				"あなたはレビュアーです。前の役割の出力が整合しているかを確かめ、承認するか、直す点を短く述べてください。",
			model,
			tools: toolsFor(),
		},
	];
	return cooperateByRole({
		roles,
		task: context.task,
		budget: agentLimits,
		clock,
		signal: context.signal ?? new AbortController().signal,
	});
}

/**
 * Runs one agent design pattern demo by name (Req 4.1). The options are checked against the limits
 * before any model is resolved, and the result reports the model calls and tokens the run used.
 */
export async function runPatternDemo(
	name: string,
	deps: PatternDemoDeps,
	input: PatternDemoInput,
): Promise<PatternDemoRun> {
	const demo = parseName(name);
	if (typeof input.task !== "string" || input.task.trim() === "") {
		throw new PlatformError("invalid-request", "task を指定してください。");
	}
	const options = parseOptions(demo, input.options);
	const maxCalls = patternDemoMaxCalls(demo, input.options, deps.agentLimits);
	deps.signal?.throwIfAborted();

	const ledger = createUsageLedger({ maxCalls });
	const context: Context = { deps, ledger, task: input.task, signal: deps.signal };
	const result = await (async (): Promise<unknown> => {
		switch (demo) {
			case "passive-goal-creator":
				return passiveGoalCreator(context);
			case "prompt-response-optimizer":
				return promptResponseOptimizer(context, options as OptionsOf<"prompt-response-optimizer">);
			case "single-path-plan":
				return singlePathPlan(context);
			case "multi-path-plan":
				return multiPathPlan(context, options as OptionsOf<"multi-path-plan">);
			case "self-reflection":
				return reflection(context, "self", options as OptionsOf<"self-reflection">);
			case "cross-reflection":
				return reflection(context, "cross", options as OptionsOf<"cross-reflection">);
			case "role-based-cooperation":
				return roleBasedCooperation(context);
		}
	})();
	return { name: demo, result, usage: ledger.total() };
}
