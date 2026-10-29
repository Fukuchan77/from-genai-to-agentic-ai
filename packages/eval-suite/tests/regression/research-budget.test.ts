// Regression: the research Supervisor's call-count cap and the shared token budget, end to end in
// `mock` mode (003 plan C9 / C16, Requirement 4.8, CL-17). The Budget and the sub-agent tools are
// unit-tested inside `@platform/ai-core`; this file pins only what a whole run reports, through the
// public subpaths: the real Supervisor and sub-agents, the m3-4 scenario model and the fixture arXiv.
//
// The m3-4 `default` scenario plans four sub-agent calls (search, search, reading, market) and then
// writes a report. The Supervisor follows that script whatever the limits are, so every call beyond
// a limit is a call the platform itself must refuse.

import type { AgentRunSummary } from "@platform/ai-core/agents";
import {
	createArxivFixtureFetcher,
	createScenarioModel,
	M3_4_SAMPLE_THEMES,
	M3_4_SCENARIOS,
} from "@platform/ai-core/mock";
import {
	createArxivCache,
	createArxivClient,
	type ResearchEvent,
	type ResearchLimits,
	type ResearchResult,
	type ResearchUsage,
	runResearch,
} from "@platform/ai-core/research";
import { createFakeClock } from "@platform/ai-core/testing";
import { describe, expect, it } from "vitest";

const CALL_LIMIT_REASON = "サブエージェントの呼び出し回数の上限に達したため、実行しませんでした。";
const SHARED_TOKENS_GONE_REASON = "共有のトークン予算が残っていないため、実行しませんでした。";
const TOKEN_BUDGET_STOP_REASON = "トークン予算が尽きたため、調査を完了できませんでした。";

interface ResearchRun {
	readonly result: ResearchResult;
	readonly events: readonly ResearchEvent[];
	readonly usageReports: readonly ResearchUsage[];
	/** How the Supervisor's own loop ended. */
	readonly supervisorRun: AgentRunSummary;
}

async function runDefaultTheme(limits: Partial<ResearchLimits>): Promise<ResearchRun> {
	const clock = createFakeClock(Date.UTC(2026, 0, 1));
	const events: ResearchEvent[] = [];
	const usageReports: ResearchUsage[] = [];
	const summaries: AgentRunSummary[] = [];
	const result = await runResearch({
		theme: M3_4_SAMPLE_THEMES.default,
		model: createScenarioModel({ purpose: "chat", scenarios: M3_4_SCENARIOS }),
		arxiv: createArxivClient({
			fetcher: createArxivFixtureFetcher(),
			clock,
			cache: createArxivCache(),
			options: { minIntervalMs: 0 },
		}),
		clock,
		signal: new AbortController().signal,
		limits,
		observer: { onRunEnd: (summary) => summaries.push(summary) },
		onEvent: (event) => events.push(event),
		onUsage: (usage) => usageReports.push(usage),
	});
	const supervisorRun = summaries[0];
	if (summaries.length !== 1 || supervisorRun === undefined) {
		throw new Error(`expected one supervisor run summary, got ${summaries.length}`);
	}
	return { result, events, usageReports, supervisorRun };
}

/** Calls the model-driven Supervisor made to each sub-agent (refused ones included). */
function attemptedCalls(events: readonly ResearchEvent[]): string[] {
	return events
		.filter((event) => event.agent === "supervisor" && event.kind === "call")
		.map((event) => String(event.detail.callee));
}

function tokensOf(result: ResearchResult, role: string): number {
	const usage = result.usage.byRole[role];
	return usage === undefined || usage === "unknown" ? 0 : usage.totalTokens;
}

describe("research Supervisor call cap (regression, Req 4.8)", () => {
	it("stops running sub-agents after the second call when maxSubagentCalls is 2, and still reports", async () => {
		const run = await runDefaultTheme({ maxSubagentCalls: 2 });

		// The Supervisor asked for four calls, but only the first two ran.
		expect(attemptedCalls(run.events)).toEqual(["search", "search", "reading", "market"]);
		expect(run.result.calls).toBe(2);
		expect(Object.keys(run.result.usage.byRole).sort()).toEqual(["search", "supervisor"]);
		expect(run.result.usage.byRole.search).toMatchObject({ calls: 2 });

		// The refusals are named as gaps, with the call-limit reason, in order.
		expect(run.result.missing).toEqual([
			{ agent: "reading", reason: CALL_LIMIT_REASON },
			{ agent: "market", reason: CALL_LIMIT_REASON },
		]);
		expect(run.events.filter((e) => e.kind === "error").map((e) => e.agent)).toEqual([
			"reading",
			"market",
		]);

		// The Supervisor itself finished normally and the report carries what the two searches found.
		expect(run.supervisorRun.stopReason).toBe("completed");
		expect(run.result.report).toContain("# 階層型エージェントの最新動向");
		expect(run.result.report).toContain("## 調査できなかった観点");
		expect(run.result.report).toContain("論文精読");
		expect(run.result.report).toContain("市場影響評価");

		// The live usage readout ends at the cap, never past it.
		expect(run.usageReports.at(-1)).toMatchObject({ calls: 2, maxCalls: 2 });
		expect(Math.max(...run.usageReports.map((usage) => usage.calls))).toBe(2);
	});

	it.each([
		{ cap: 1, ran: ["search"], missing: ["search", "reading", "market"] },
		{ cap: 3, ran: ["search", "search", "reading"], missing: ["market"] },
		{ cap: 4, ran: ["search", "search", "reading", "market"], missing: [] },
	])(
		"runs exactly the first $cap planned calls when the cap is $cap",
		async ({ cap, ran, missing }) => {
			const run = await runDefaultTheme({ maxSubagentCalls: cap });

			expect(run.result.calls).toBe(cap);
			expect(run.result.missing.map(({ agent }) => agent)).toEqual(missing);
			const summarised = run.events
				.filter((event) => event.kind === "summary" && event.agent !== "supervisor")
				.map((event) => event.agent);
			expect(summarised).toEqual(ran);
		},
	);

	it("does not count a refused call against the cap or spend any tokens on it", async () => {
		const capped = await runDefaultTheme({ maxSubagentCalls: 2 });
		const unlimited = await runDefaultTheme({});

		expect(unlimited.result.calls).toBe(4);
		expect(unlimited.result.missing).toEqual([]);
		// Whatever the capped run spent on a sub-agent was spent identically in the full run, and
		// the roles the cap shut out spent nothing.
		expect(tokensOf(capped.result, "search")).toBe(tokensOf(unlimited.result, "search"));
		expect(tokensOf(capped.result, "reading")).toBe(0);
		expect(tokensOf(capped.result, "market")).toBe(0);
		expect(capped.result.usage.total.totalTokens).toBeLessThan(
			unlimited.result.usage.total.totalTokens,
		);
	});
});

describe("research shared token budget (regression, Req 4.8, CL-17)", () => {
	it("refuses a sub-agent that would start with no shared tokens left and says why", async () => {
		// 7,000 tokens: the Supervisor holds 3,500; the two searches use 4,440 of the sub-agents'
		// share, so reading and market have nothing to start with.
		const run = await runDefaultTheme({ maxTotalTokens: 7_000 });

		expect(run.result.calls).toBe(2);
		expect(run.result.missing.filter(({ agent }) => agent !== "supervisor")).toEqual([
			{ agent: "reading", reason: SHARED_TOKENS_GONE_REASON },
			{ agent: "market", reason: SHARED_TOKENS_GONE_REASON },
		]);
		expect(tokensOf(run.result, "reading")).toBe(0);
		expect(tokensOf(run.result, "market")).toBe(0);
		// The Supervisor, too, runs out of what it was held, and the run reports that.
		expect(run.supervisorRun.stopReason).toBe("token-budget");
		expect(run.result.missing.at(-1)).toEqual({
			agent: "supervisor",
			reason: TOKEN_BUDGET_STOP_REASON,
		});
	});

	it("shrinks the last sub-agent that does run to what the others left, and refuses the next", async () => {
		// 10,000 tokens: after the two searches only 560 of the sub-agents' 5,000 remain, so the
		// reading agent is cut short (a full reading costs 2,220) and the market agent is not run.
		const run = await runDefaultTheme({ maxTotalTokens: 10_000 });
		const full = await runDefaultTheme({});

		expect(run.result.calls).toBe(3);
		expect(run.result.missing.map(({ agent }) => agent)).toEqual(["reading", "market"]);
		expect(run.result.missing[0]?.reason).toBe(TOKEN_BUDGET_STOP_REASON);
		expect(run.result.missing[1]?.reason).toBe(SHARED_TOKENS_GONE_REASON);
		expect(tokensOf(run.result, "reading")).toBeGreaterThan(0);
		expect(tokensOf(run.result, "reading")).toBeLessThan(tokensOf(full.result, "reading"));
		expect(tokensOf(run.result, "market")).toBe(0);
		// The two searches ran before any shortage and cost the same as in the full run.
		expect(tokensOf(run.result, "search")).toBe(tokensOf(full.result, "search"));
	});

	it("never runs more sub-agents when it is given fewer tokens", async () => {
		const budgets = [960, 7_000, 10_000, 20_000];
		const calls: number[] = [];
		for (const maxTotalTokens of budgets) {
			calls.push((await runDefaultTheme({ maxTotalTokens })).result.calls);
		}

		expect(calls).toEqual([1, 2, 3, 4]);
	});

	it("keeps the total within the soft cap: the budget plus what the Supervisor itself spent", async () => {
		// The sub-agents' share is enforced when each one starts, but the Supervisor's own loop and
		// the step a sub-agent is in the middle of cannot be cut short, so the total may pass
		// `maxTotalTokens` (plan C9: a soft cap). This pins how far, so a regression that stops
		// recording usage or narrowing the sub-agents' limits cannot hide behind the overshoot.
		for (const maxTotalTokens of [960, 7_000, 10_000]) {
			const run = await runDefaultTheme({ maxTotalTokens });

			expect(run.result.usage.total.totalTokens, `max ${maxTotalTokens}`).toBeLessThanOrEqual(
				maxTotalTokens + tokensOf(run.result, "supervisor"),
			);
		}
	});

	it("runs every planned call and stays inside the budget when it is ample", async () => {
		const run = await runDefaultTheme({ maxTotalTokens: 20_000 });

		expect(run.result.calls).toBe(4);
		expect(run.result.missing).toEqual([]);
		expect(run.supervisorRun.stopReason).toBe("completed");
		expect(run.result.usage.total.totalTokens).toBeLessThanOrEqual(20_000);
	});
});
