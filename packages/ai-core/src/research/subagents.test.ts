import type { LanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { checkDescription } from "../aci/description-check";
import type { ToolOutcome, ToolRuntime } from "../aci/types";
import type { LoopLimits } from "../agents";
import { AGENT_RUN_ERROR_MESSAGE } from "../agents";
import { createExternalContentLog } from "../agents/observer";
import { PlatformError } from "../errors";
import { defineScenario, type ScenarioTurn } from "../mock/scenario";
import { createScenarioModel } from "../mock/scenario-model";
import { createFakeClock } from "../ports/clock";
import type { ArxivClient } from "./arxiv/client";
import type { ArxivPaper } from "./arxiv/types";
import { type Budget, createBudget } from "./budget";
import {
	createPaperCollector,
	createSubagent,
	DEFAULT_SUBAGENT_LIMITS,
	type ResearchEvent,
	SUBAGENT_TOOL_NAMES,
	type SubagentDependencies,
	type SubagentKind,
	type SubagentResult,
} from "./subagents";

const ABSTRACT = "ABSTRACT-BODY-THAT-MUST-STAY-INSIDE-THE-CHILD";

function paper(arxivId: string, overrides: Partial<ArxivPaper> = {}): ArxivPaper {
	return {
		arxivId,
		title: `Paper ${arxivId}`,
		authors: ["A. Author"],
		publishedAt: "2024-01-02T00:00:00.000Z",
		summary: `${ABSTRACT} ${arxivId}`,
		links: [],
		...overrides,
	};
}

const PAPERS = [paper("2401.01234"), paper("2403.05678")];

function fakeClient(papers: readonly ArxivPaper[] = PAPERS): ArxivClient {
	return {
		search: async () => papers,
		getAbstract: async (id) =>
			papers.find((candidate) => candidate.arxivId === id.replace(/v\d+$/u, "")),
	};
}

const SEARCH_TASK = "階層型エージェントの論文を探す";
const SUMMARY = "階層型エージェントに関する論文を 2 件見つけた。";

/** One scripted run of a child: its tool calls, then its answer. */
function scenarioOf(...turns: ScenarioTurn[]): LanguageModel {
	return createScenarioModel({
		purpose: "chat",
		scenarios: [defineScenario({ id: "subagents/test", turns })],
	});
}

const searchThenAnswer = (answer = SUMMARY, usage = { inputTokens: 100, outputTokens: 20 }) =>
	scenarioOf(
		{
			match: { stepIndex: 0 },
			respond: {
				toolCalls: [{ toolName: "searchArxiv", input: { query: "hierarchical agents" } }],
				usage,
			},
		},
		{ match: { stepIndex: 1 }, respond: { text: answer, usage } },
	);

/** A model that answers with `text` at once and keeps what it was asked. */
function recordingModel(text = SUMMARY) {
	const calls: Parameters<MockLanguageModelV4["doGenerate"] & ((o: never) => unknown)>[0][] = [];
	const model = new MockLanguageModelV4({
		doGenerate: async (params) => {
			calls.push(params as never);
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
	return { model, calls: calls as unknown as { tools?: { name: string }[]; prompt: unknown[] }[] };
}

const LIMITS: LoopLimits = {
	maxSteps: 6,
	maxTotalTokens: 30_000,
	maxDurationMs: 60_000,
	toolTimeoutMs: 10_000,
};

interface Context {
	readonly deps: SubagentDependencies;
	readonly budget: Budget;
	readonly events: ResearchEvent[];
	readonly outcomes: SubagentResult[];
	readonly externalContent: ReturnType<typeof createExternalContentLog>;
	readonly collected: ReturnType<typeof createPaperCollector>;
}

function setup(
	model: LanguageModel,
	overrides: Partial<SubagentDependencies> = {},
	budget: Budget = createBudget({ maxCalls: 8, maxTotalTokens: 80_000 }),
): Context {
	const events: ResearchEvent[] = [];
	const outcomes: SubagentResult[] = [];
	const externalContent = createExternalContentLog();
	const collected = createPaperCollector();
	const deps: SubagentDependencies = {
		model,
		client: fakeClient(),
		budget,
		clock: createFakeClock(),
		papers: collected,
		limits: LIMITS,
		externalContent,
		onEvent: (event) => events.push(event),
		onOutcome: (outcome) => outcomes.push(outcome),
		...overrides,
	};
	return { deps, budget, events, outcomes, externalContent, collected };
}

const RUNTIME: ToolRuntime = { clock: createFakeClock(), toolTimeoutMs: 60_000 };

async function call(
	kind: SubagentKind,
	deps: SubagentDependencies,
	input: unknown,
	signal?: AbortSignal,
): Promise<ToolOutcome<SubagentResult>> {
	const execute = createSubagent(kind, deps).toTool(RUNTIME).execute as (
		input: unknown,
		options: unknown,
	) => Promise<ToolOutcome<SubagentResult>>;
	return await execute(input, {
		toolCallId: "call-1",
		messages: [],
		context: undefined,
		...(signal ? { abortSignal: signal } : {}),
	});
}

async function result(
	kind: SubagentKind,
	deps: SubagentDependencies,
	input: unknown,
	signal?: AbortSignal,
): Promise<SubagentResult> {
	const outcome = await call(kind, deps, input, signal);
	if (!outcome.ok) throw new Error(`tool failed: ${outcome.failure.summary}`);
	return outcome.data;
}

const SEARCH_INPUT = { topic: SEARCH_TASK };
const READING_INPUT = { paperIds: ["2401.01234"], focus: "手法の違いを読む" };
const MARKET_INPUT = { theme: "階層型エージェント", findings: "手法 A は計画を分割する。" };

describe("createSubagent", () => {
	describe("definitions", () => {
		it("names the three tools for the supervisor", () => {
			const { deps } = setup(recordingModel().model);
			expect(SUBAGENT_TOOL_NAMES).toEqual({
				search: "searchPapers",
				reading: "readPapers",
				market: "assessMarketImpact",
			});
			for (const kind of ["search", "reading", "market"] as const) {
				expect(createSubagent(kind, deps).name).toBe(SUBAGENT_TOOL_NAMES[kind]);
			}
		});

		it.each(["search", "reading", "market"] as const)(
			"declares %s read-only with a description in the CL-18 format and every input described",
			(kind) => {
				const { deps } = setup(recordingModel().model);
				const definition = createSubagent(kind, deps);
				expect(definition.risk).toBe("read-only");
				expect(checkDescription(definition.description, definition.inputSchema)).toEqual([]);
			},
		);

		it.each([
			["search: an empty topic", "search", { topic: "" }],
			["search: a topic over 300 characters", "search", { topic: "x".repeat(301) }],
			["search: an unknown field", "search", { topic: "x", extra: 1 }],
			["reading: no paper", "reading", { paperIds: [], focus: "x" }],
			["reading: six papers", "reading", { paperIds: Array(6).fill("2401.01234"), focus: "x" }],
			["reading: a word instead of an ID", "reading", { paperIds: ["agents"], focus: "x" }],
			["reading: an empty focus", "reading", { paperIds: ["2401.01234"], focus: "" }],
			["market: an empty theme", "market", { theme: "", findings: "x" }],
			["market: empty findings", "market", { theme: "x", findings: "" }],
			[
				"market: findings over 3000 characters",
				"market",
				{ theme: "x", findings: "y".repeat(3_001) },
			],
		] as const)("rejects %s", (_name, kind, input) => {
			const { deps } = setup(recordingModel().model);
			expect(createSubagent(kind, deps).inputSchema.safeParse(input).success).toBe(false);
		});

		it.each([
			["search: a topic of 300 characters", "search", { topic: "x".repeat(300) }],
			["reading: five papers", "reading", { paperIds: Array(5).fill("2401.01234"), focus: "x" }],
			["reading: an ID with a version", "reading", { paperIds: ["2401.01234v2"], focus: "x" }],
			[
				"market: findings of 3000 characters",
				"market",
				{ theme: "x", findings: "y".repeat(3_000) },
			],
		] as const)("accepts %s", (_name, kind, input) => {
			const { deps } = setup(recordingModel().model);
			expect(createSubagent(kind, deps).inputSchema.safeParse(input).success).toBe(true);
		});
	});

	describe("a search that works", () => {
		it("returns the model's final answer as the summary, with the IDs of the papers it found", async () => {
			const { deps } = setup(searchThenAnswer());
			expect(await result("search", deps, SEARCH_INPUT)).toEqual({
				status: "ok",
				agent: "search",
				summary: SUMMARY,
				paperIds: ["2401.01234", "2403.05678"],
			});
		});

		it("reports a result that worked to the run, too", async () => {
			const context = setup(searchThenAnswer());
			const data = await result("search", context.deps, SEARCH_INPUT);
			expect(context.outcomes).toEqual([data]);
		});

		it("returns nothing of the child's inside: no abstract, no tool call, no earlier text", async () => {
			const { deps } = setup(searchThenAnswer());
			const outcome = await call("search", deps, SEARCH_INPUT);
			const text = JSON.stringify(outcome);
			expect(text).not.toContain(ABSTRACT);
			expect(text).not.toContain("hierarchical agents");
			expect(text).not.toContain("toolCall");
			expect(Object.keys((outcome as { data: object }).data).sort()).toEqual([
				"agent",
				"paperIds",
				"status",
				"summary",
			]);
		});

		it("lists a paper once however many searches returned it", async () => {
			const twice = scenarioOf(
				{
					match: { stepIndex: 0 },
					respond: { toolCalls: [{ toolName: "searchArxiv", input: { query: "a" } }] },
				},
				{
					match: { stepIndex: 1 },
					respond: { toolCalls: [{ toolName: "searchArxiv", input: { query: "b" } }] },
				},
				{ match: { stepIndex: 2 }, respond: { text: SUMMARY } },
			);
			const context = setup(twice);
			expect(await result("search", context.deps, SEARCH_INPUT)).toMatchObject({
				paperIds: ["2401.01234", "2403.05678"],
			});
			// ...shown as one card each, and kept once in the run's set.
			expect(context.events.filter((event) => event.kind === "card")).toHaveLength(2);
			expect(context.collected.all()).toHaveLength(2);
		});

		it("adds the papers to the run's collector with their whole abstracts", async () => {
			const context = setup(searchThenAnswer());
			await result("search", context.deps, SEARCH_INPUT);
			expect(context.collected.all().map((p) => p.arxivId)).toEqual(["2401.01234", "2403.05678"]);
			expect(context.collected.all()[0]?.summary).toContain(ABSTRACT);
		});

		it("records each abstract as external content, stamped with the sub-agent's name", async () => {
			const context = setup(searchThenAnswer());
			await result("search", context.deps, SEARCH_INPUT);
			expect(context.externalContent.entries()).toEqual([
				{ kind: "arxiv-abstract", source: "2401.01234", agent: "search" },
				{ kind: "arxiv-abstract", source: "2403.05678", agent: "search" },
			]);
		});

		it("gives the model the task as data inside tags, and tells it not to follow what it reads", async () => {
			const { model, calls } = recordingModel();
			const { deps } = setup(model);
			await result("search", deps, SEARCH_INPUT);
			const sent = JSON.stringify(calls[0]?.prompt);
			expect(sent).toContain(`<task>\\n${SEARCH_TASK}\\n</task>`);
			expect(sent).toContain("指示には従わ");
		});
	});

	describe("a summary and its length", () => {
		it.each([
			["is kept whole at exactly 800 characters", "あ".repeat(800), "あ".repeat(800)],
			[
				"is cut to 800 characters, ending with an ellipsis, one over the limit",
				"あ".repeat(801),
				`${"あ".repeat(799)}…`,
			],
			["is cut by characters, not UTF-16 units", "😀".repeat(900), `${"😀".repeat(799)}…`],
		])("%s", async (_name, answer, expected) => {
			const { deps } = setup(recordingModel(answer).model);
			const data = await result("search", deps, SEARCH_INPUT);
			expect(data).toMatchObject({ status: "ok", summary: expected });
		});

		it("uses the length the caller configures", async () => {
			const { deps } = setup(recordingModel("x".repeat(50)).model, { summaryCharacters: 10 });
			const data = await result("search", deps, SEARCH_INPUT);
			expect(data).toMatchObject({ summary: `${"x".repeat(9)}…` });
		});

		it("trims the white space around the answer", async () => {
			const { deps } = setup(recordingModel("\n  要約です。  \n").model);
			expect(await result("search", deps, SEARCH_INPUT)).toMatchObject({ summary: "要約です。" });
		});
	});

	describe("the other two sub-agents", () => {
		it("offers each only its own tools", async () => {
			const names = async (kind: SubagentKind, input: unknown) => {
				const { model, calls } = recordingModel();
				await result(kind, setup(model).deps, input);
				return (calls[0]?.tools ?? []).map((tool) => tool.name);
			};
			expect(await names("search", SEARCH_INPUT)).toEqual(["searchArxiv"]);
			expect(await names("reading", READING_INPUT)).toEqual(["getPaperAbstract"]);
			expect(await names("market", MARKET_INPUT)).toEqual([]);
		});

		it("reads the papers it is told to read and returns their IDs", async () => {
			const reading = scenarioOf(
				{
					match: { stepIndex: 0 },
					respond: {
						toolCalls: [{ toolName: "getPaperAbstract", input: { arxivId: "2401.01234" } }],
					},
				},
				{ match: { stepIndex: 1 }, respond: { text: "手法 A は計画を分割する。" } },
			);
			const { deps, collected } = setup(reading);
			// The search sub-agent fetched it earlier in this run.
			collected.add([PAPERS[0] as ArxivPaper]);
			expect(await result("reading", deps, READING_INPUT)).toEqual({
				status: "ok",
				agent: "reading",
				summary: "手法 A は計画を分割する。",
				paperIds: ["2401.01234"],
			});
		});

		it("hands the paper IDs and the focus to the reading model", async () => {
			const { model, calls } = recordingModel();
			await result("reading", setup(model).deps, {
				paperIds: ["2401.01234", "2403.05678v2"],
				focus: "FOCUS-TEXT",
			});
			const sent = JSON.stringify(calls[0]?.prompt);
			expect(sent).toContain("<papers>\\n2401.01234\\n2403.05678v2\\n</papers>");
			expect(sent).toContain("FOCUS-TEXT");
		});

		it("assesses the market from the findings it is given, with no tools and no paper IDs", async () => {
			const { model, calls } = recordingModel("市場への影響は限定的。");
			const data = await result("market", setup(model).deps, MARKET_INPUT);
			expect(data).toEqual({
				status: "ok",
				agent: "market",
				summary: "市場への影響は限定的。",
				paperIds: [],
			});
			const sent = JSON.stringify(calls[0]?.prompt);
			expect(sent).toContain("<theme>\\n階層型エージェント\\n</theme>");
			expect(sent).toContain("<findings>\\n手法 A は計画を分割する。\\n</findings>");
		});
	});

	describe("the budget", () => {
		it("takes one call from the budget for each run", async () => {
			const { deps, budget } = setup(recordingModel().model);
			await result("market", deps, MARKET_INPUT);
			await result("market", deps, MARKET_INPUT);
			expect(budget.status().calls).toBe(2);
		});

		it("does not run when the call limit is reached, and says so without an exception", async () => {
			const { model, calls } = recordingModel();
			const budget = createBudget({ maxCalls: 1, maxTotalTokens: 80_000 });
			const context = setup(model, {}, budget);
			await result("market", context.deps, MARKET_INPUT);
			const second = await result("market", context.deps, MARKET_INPUT);
			expect(second).toMatchObject({ status: "budget-exhausted", agent: "market" });
			expect((second as { reason: string }).reason).toContain("回数");
			expect(calls).toHaveLength(1);
		});

		it("does not run a child when no tokens remain (CL-17), and names the tokens", async () => {
			const { model, calls } = recordingModel();
			const budget = createBudget({ maxCalls: 8, maxTotalTokens: 100 });
			budget.recordUsage("supervisor", { totalTokens: 100 });
			const context = setup(model, {}, budget);
			const data = await result("search", context.deps, SEARCH_INPUT);
			expect(data).toMatchObject({ status: "budget-exhausted", agent: "search" });
			expect((data as { reason: string }).reason).toContain("トークン");
			expect(calls).toHaveLength(0);
			expect(budget.status().calls).toBe(0);
		});

		it("reports a refusal to the run and to the inspector", async () => {
			const budget = createBudget({ maxCalls: 1, maxTotalTokens: 80_000 });
			budget.takeCall();
			const context = setup(recordingModel().model, {}, budget);
			await result("search", context.deps, SEARCH_INPUT);
			expect(context.outcomes).toEqual([
				expect.objectContaining({ status: "budget-exhausted", agent: "search" }),
			]);
			expect(context.events.at(-1)).toMatchObject({ agent: "search", kind: "error" });
		});

		it("gives the child what is left of the shared tokens as its own limit", async () => {
			// 100 tokens are left; the first step of the child spends 150, so the child must stop.
			const budget = createBudget({ maxCalls: 8, maxTotalTokens: 1_000 });
			budget.recordUsage("supervisor", { totalTokens: 900 });
			const spendy = searchThenAnswer(SUMMARY, { inputTokens: 100, outputTokens: 50 });
			const context = setup(spendy, {}, budget);
			const data = await result("search", context.deps, SEARCH_INPUT);
			expect(data).toMatchObject({ status: "failed", agent: "search" });
			expect((data as { reason: string }).reason).toContain("トークン");
		});

		it("lets the child spend its own limit when more than that is left", async () => {
			const budget = createBudget({ maxCalls: 8, maxTotalTokens: 1_000_000 });
			const spendy = searchThenAnswer(SUMMARY, { inputTokens: 100, outputTokens: 50 });
			const tight = setup(spendy, { limits: { ...LIMITS, maxTotalTokens: 100 } }, budget);
			const data = await result("search", tight.deps, SEARCH_INPUT);
			expect(data).toMatchObject({ status: "failed" });
			expect((data as { reason: string }).reason).toContain("トークン");
			const roomy = setup(spendy, { limits: { ...LIMITS, maxTotalTokens: 10_000 } });
			expect(await result("search", roomy.deps, SEARCH_INPUT)).toMatchObject({ status: "ok" });
		});

		it("records the child's usage under its own name", async () => {
			const context = setup(searchThenAnswer(SUMMARY, { inputTokens: 100, outputTokens: 20 }));
			await result("search", context.deps, SEARCH_INPUT);
			// Two model calls of 120 tokens each.
			expect(context.budget.breakdown().byRole.search).toMatchObject({
				inputTokens: 200,
				outputTokens: 40,
				totalTokens: 240,
			});
			expect(context.budget.remainingTokens()).toBe(80_000 - 240);
		});

		it("records usage that the model did not report as unknown", async () => {
			const silent = scenarioOf({ match: { stepIndex: 0 }, respond: { text: SUMMARY } });
			const context = setup(silent);
			await result("market", context.deps, MARKET_INPUT);
			expect(context.budget.breakdown().byRole.market).toBe("unknown");
			expect(context.budget.remainingTokens()).toBe(80_000);
		});

		it("uses the default limits when none are given", () => {
			expect(DEFAULT_SUBAGENT_LIMITS).toEqual({
				maxSteps: 8,
				maxTotalTokens: 30_000,
				maxDurationMs: 180_000,
				toolTimeoutMs: 90_000,
			});
		});
	});

	describe("a child that fails", () => {
		it("returns its name and a fixed reason instead of throwing, and keeps the raw error out", async () => {
			const broken = new MockLanguageModelV4({
				doGenerate: async () => {
					throw new Error("provider said: key sk-secret-123 is invalid");
				},
			});
			const context = setup(broken);
			const data = await result("search", context.deps, SEARCH_INPUT);
			expect(data).toMatchObject({ status: "failed", agent: "search" });
			expect(JSON.stringify(data)).not.toContain("sk-secret-123");
			expect((data as { reason: string }).reason).toBe(AGENT_RUN_ERROR_MESSAGE);
			expect(context.outcomes).toEqual([data]);
		});

		it("still takes the tokens a failed run used off the budget", async () => {
			const stepsForever = scenarioOf({
				match: {},
				respond: {
					toolCalls: [{ toolName: "searchArxiv", input: { query: "q" } }],
					usage: { inputTokens: 100, outputTokens: 10 },
				},
			});
			const context = setup(stepsForever, { limits: { ...LIMITS, maxSteps: 2 } });
			const data = await result("search", context.deps, SEARCH_INPUT);
			expect(data).toMatchObject({ status: "failed" });
			expect((data as { reason: string }).reason).toContain("ステップ");
			expect(context.budget.breakdown().byRole.search).toMatchObject({ totalTokens: 220 });
		});

		it("fails when the model answers with nothing", async () => {
			const context = setup(recordingModel("   ").model);
			const data = await result("search", context.deps, SEARCH_INPUT);
			expect(data).toMatchObject({ status: "failed", agent: "search" });
			expect((data as { reason: string }).reason).toContain("空");
		});

		it("reports the failure to the run and to the inspector", async () => {
			const broken = new MockLanguageModelV4({
				doGenerate: async () => {
					throw new Error("boom");
				},
			});
			const context = setup(broken);
			await result("reading", context.deps, READING_INPUT);
			expect(context.outcomes).toHaveLength(1);
			expect(context.events.at(-1)).toMatchObject({ agent: "reading", kind: "error" });
		});

		it("takes the call from the budget even though it failed", async () => {
			const broken = new MockLanguageModelV4({
				doGenerate: async () => {
					throw new Error("boom");
				},
			});
			const context = setup(broken);
			await result("search", context.deps, SEARCH_INPUT);
			expect(context.budget.status().calls).toBe(1);
		});
	});

	describe("the set a report is checked against (W5 review F-5)", () => {
		it("does not let a reading sub-agent bring in a paper that only the shared cache holds", async () => {
			const reading = scenarioOf(
				{
					match: { stepIndex: 0 },
					respond: {
						toolCalls: [{ toolName: "getPaperAbstract", input: { arxivId: "2401.01234" } }],
					},
				},
				{ match: { stepIndex: 1 }, respond: { text: "読めなかった。" } },
			);
			// The client could answer for 2401.01234; this run's search never fetched it.
			const context = setup(reading);
			const data = await result("reading", context.deps, READING_INPUT);
			expect(data).toMatchObject({ status: "ok", paperIds: [] });
			expect(context.collected.all()).toEqual([]);
			expect(context.externalContent.entries()).toEqual([]);
		});

		it("lets it read a paper that this run's search fetched", async () => {
			const context = setup(
				scenarioOf(
					{
						match: { stepIndex: 0 },
						respond: {
							toolCalls: [{ toolName: "getPaperAbstract", input: { arxivId: "2401.01234" } }],
						},
					},
					{ match: { stepIndex: 1 }, respond: { text: "読んだ。" } },
				),
			);
			context.collected.add([PAPERS[0] as ArxivPaper]);
			const data = await result("reading", context.deps, READING_INPUT);
			expect(data).toMatchObject({ status: "ok", paperIds: ["2401.01234"] });
		});
	});

	describe("arXiv that cannot be reached (Req 4.7, 4.6)", () => {
		const unreachable = () =>
			new PlatformError("source-unavailable", "arXiv から論文を取得できませんでした。");
		const clientFailing = (error: Error, after = 0): ArxivClient => {
			let calls = 0;
			return {
				search: async () => {
					calls += 1;
					if (calls > after) throw error;
					return PAPERS;
				},
				getAbstract: async () => undefined,
			};
		};

		it("counts a search that found nothing because arXiv was down as a failure of the search", async () => {
			const context = setup(searchThenAnswer("検索できませんでした。"), {
				client: clientFailing(unreachable()),
			});
			const data = await result("search", context.deps, SEARCH_INPUT);
			expect(data).toMatchObject({ status: "failed", agent: "search" });
			expect((data as { reason: string }).reason).toContain("arXiv");
			expect(context.outcomes).toEqual([data]);
			expect(context.events.at(-1)).toMatchObject({ agent: "search", kind: "error" });
		});

		it("keeps the search when another query found papers after the first failed", async () => {
			const twice = scenarioOf(
				{
					match: { stepIndex: 0 },
					respond: { toolCalls: [{ toolName: "searchArxiv", input: { query: "a" } }] },
				},
				{
					match: { stepIndex: 1 },
					respond: { toolCalls: [{ toolName: "searchArxiv", input: { query: "b" } }] },
				},
				{ match: { stepIndex: 2 }, respond: { text: SUMMARY } },
			);
			const context = setup(twice, {
				client: {
					search: (() => {
						let calls = 0;
						return async () => {
							calls += 1;
							if (calls === 1) throw unreachable();
							return PAPERS;
						};
					})(),
					getAbstract: async () => undefined,
				},
			});
			expect(await result("search", context.deps, SEARCH_INPUT)).toMatchObject({ status: "ok" });
		});

		it("does not count a search that failed for another reason", async () => {
			const context = setup(searchThenAnswer(), {
				client: clientFailing(new PlatformError("invalid-request", "検索語が不正です。")),
			});
			expect(await result("search", context.deps, SEARCH_INPUT)).toMatchObject({ status: "ok" });
		});

		it("does not count a failure of the reading sub-agent's own tool", async () => {
			const reading = scenarioOf(
				{
					match: { stepIndex: 0 },
					respond: {
						toolCalls: [{ toolName: "getPaperAbstract", input: { arxivId: "2401.01234" } }],
					},
				},
				{ match: { stepIndex: 1 }, respond: { text: "読めなかった。" } },
			);
			const context = setup(reading, { client: clientFailing(unreachable()) });
			expect(await result("reading", context.deps, READING_INPUT)).toMatchObject({ status: "ok" });
		});
	});

	describe("abort", () => {
		it("does not start the model when the caller has already stopped", async () => {
			const { model, calls } = recordingModel();
			const { deps } = setup(model);
			const reason = new Error("learner stopped");
			await expect(call("search", deps, SEARCH_INPUT, AbortSignal.abort(reason))).rejects.toBe(
				reason,
			);
			expect(calls).toHaveLength(0);
		});

		it("records a child that the tool's time limit cut off as a failure of that child (W5 review F-6)", async () => {
			const controller = new AbortController();
			let started!: () => void;
			const modelStarted = new Promise<void>((resolve) => {
				started = resolve;
			});
			const hanging = new MockLanguageModelV4({
				doGenerate: async (params) => {
					started();
					await new Promise((_resolve, reject) => {
						params.abortSignal?.addEventListener(
							"abort",
							() => reject(params.abortSignal?.reason),
							{
								once: true,
							},
						);
					});
					throw new Error("unreachable");
				},
			});
			const context = setup(hanging);
			const running = call("search", context.deps, SEARCH_INPUT, controller.signal);
			await modelStarted;
			// The clock's timeout signal aborts with a TimeoutError; a learner's stop does not.
			controller.abort(new DOMException("The operation timed out", "TimeoutError"));
			await running.catch(() => undefined);
			for (let turn = 0; turn < 10; turn += 1) await new Promise<void>((r) => setImmediate(r));
			expect(context.outcomes).toEqual([
				expect.objectContaining({ status: "failed", agent: "search" }),
			]);
			expect((context.outcomes[0] as { reason: string }).reason).toContain("時間");
		});

		it("does not record a browser's own abort (an AbortError) as a failure of the child", async () => {
			const controller = new AbortController();
			let started!: () => void;
			const modelStarted = new Promise<void>((resolve) => {
				started = resolve;
			});
			const hanging = new MockLanguageModelV4({
				doGenerate: async (params) => {
					started();
					await new Promise((_resolve, reject) => {
						params.abortSignal?.addEventListener(
							"abort",
							() => reject(params.abortSignal?.reason),
							{
								once: true,
							},
						);
					});
					throw new Error("unreachable");
				},
			});
			const context = setup(hanging);
			const running = call("search", context.deps, SEARCH_INPUT, controller.signal);
			await modelStarted;
			controller.abort(new DOMException("Stopped", "AbortError"));
			await running.catch(() => undefined);
			for (let turn = 0; turn < 10; turn += 1) await new Promise<void>((r) => setImmediate(r));
			expect(context.outcomes).toEqual([]);
		});

		it("stops a child mid-run and lets the caller's abort through as an abort, not a failure", async () => {
			const controller = new AbortController();
			let started!: () => void;
			const modelStarted = new Promise<void>((resolve) => {
				started = resolve;
			});
			let modelSawAbort = false;
			const hanging = new MockLanguageModelV4({
				doGenerate: async (params) => {
					started();
					params.abortSignal?.addEventListener("abort", () => {
						modelSawAbort = true;
					});
					await new Promise((_resolve, reject) => {
						params.abortSignal?.addEventListener(
							"abort",
							() => reject(params.abortSignal?.reason),
							{
								once: true,
							},
						);
					});
					throw new Error("unreachable");
				},
			});
			const context = setup(hanging);
			const running = call("search", context.deps, SEARCH_INPUT, controller.signal);
			await modelStarted;
			const reason = new Error("learner stopped");
			controller.abort(reason);
			await expect(running).rejects.toBe(reason);
			for (let turn = 0; turn < 10; turn += 1) await new Promise<void>((r) => setImmediate(r));
			// The model call itself was stopped, and nothing was reported as a failure of the child.
			expect(modelSawAbort).toBe(true);
			expect(context.outcomes).toEqual([]);
		});
	});

	describe("events for the Agent Inspector (Req 4.9)", () => {
		it("tells who did what, in order: the call, the tool, a card for each paper, the summary", async () => {
			const context = setup(searchThenAnswer());
			await result("search", context.deps, SEARCH_INPUT);
			expect(context.events.map((e) => [e.agent, e.kind])).toEqual([
				["supervisor", "call"],
				["search", "tool"],
				["search", "card"],
				["search", "card"],
				["search", "summary"],
			]);
			expect(context.events[0]?.detail).toEqual({ callee: "search", task: SEARCH_TASK });
			expect(context.events[1]?.detail).toEqual({
				name: "searchArxiv",
				input: "hierarchical agents",
			});
			expect(context.events[2]?.detail).toEqual({
				arxivId: "2401.01234",
				title: "Paper 2401.01234",
				authors: ["A. Author"],
				publishedAt: "2024-01-02",
				url: "https://arxiv.org/abs/2401.01234",
			});
			expect(context.events.at(-1)?.detail).toEqual({ text: SUMMARY });
		});

		it("keeps the abstract out of a card", async () => {
			const context = setup(searchThenAnswer());
			await result("search", context.deps, SEARCH_INPUT);
			expect(JSON.stringify(context.events)).not.toContain(ABSTRACT);
		});

		it("shortens a long task in the call event", async () => {
			const context = setup(recordingModel().model);
			await result("market", context.deps, { theme: "t".repeat(250), findings: "f" });
			const detail = context.events[0]?.detail as { task: string } | undefined;
			expect(detail?.task).toHaveLength(200);
		});

		it("is not broken by a listener that throws", async () => {
			const explode = () => {
				throw new Error("listener failed");
			};
			const { deps } = setup(searchThenAnswer(), { onEvent: explode, onOutcome: explode });
			expect(await result("search", deps, SEARCH_INPUT)).toMatchObject({ status: "ok" });
		});

		it("works without a listener", async () => {
			const { deps } = setup(searchThenAnswer(), {
				onEvent: undefined,
				onOutcome: undefined,
				externalContent: undefined,
			});
			expect(await result("search", deps, SEARCH_INPUT)).toMatchObject({ status: "ok" });
		});
	});
});
