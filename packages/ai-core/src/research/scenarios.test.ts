import { describe, expect, it } from "vitest";
import { M3_4_SAMPLE_THEMES, M3_4_SCENARIOS } from "../mock";
import { createArxivFixtureFetcher } from "../mock/arxiv-fixtures";
import { createScenarioModel } from "../mock/scenario-model";
import { createFakeClock } from "../ports/clock";
import { createArxivCache, createArxivClient } from "./arxiv/client";
import type { ResearchEvent } from "./subagents";
import { runResearch } from "./supervisor";

// The m3-4 scenarios, end to end: the real Supervisor and sub-agents, the scenario model, and the
// arXiv client reading `fixtures/arxiv/`. Nothing here is mocked at the research layer.

function run(theme: string, events: ResearchEvent[] = []) {
	const clock = createFakeClock();
	return runResearch({
		theme,
		model: createScenarioModel({ purpose: "chat", scenarios: M3_4_SCENARIOS }),
		arxiv: createArxivClient({
			fetcher: createArxivFixtureFetcher(),
			clock,
			cache: createArxivCache(),
			options: { minIntervalMs: 0 },
		}),
		clock,
		signal: new AbortController().signal,
		onEvent: (event) => events.push(event),
	});
}

describe("m3-4 scenarios", () => {
	describe("default", () => {
		it("completes in four sub-agent calls with a report and no gap", async () => {
			const result = await run(M3_4_SAMPLE_THEMES.default);
			expect(result.calls).toBe(4);
			expect(result.missing).toEqual([]);
			expect(result.report).toContain("# 階層型エージェントの最新動向");
			expect(result.report).toContain("## 今後の課題");
		});

		it("drops the paper that no search returned and warns about it", async () => {
			const result = await run(M3_4_SAMPLE_THEMES.default);
			expect(result.report).not.toContain("未取得の手法 X");
			expect(result.report).toContain("2401.01234");
			expect(result.report).toContain("2403.05678");
			expect(result.warnings).toHaveLength(1);
			expect(result.warnings[0]).toContain("2412.99999");
			expect(result.report).toContain("## 引用の確認");
		});

		it("counts the tokens of the supervisor and of each sub-agent", async () => {
			const result = await run(M3_4_SAMPLE_THEMES.default);
			expect(Object.keys(result.usage.byRole).sort()).toEqual([
				"market",
				"reading",
				"search",
				"supervisor",
			]);
			expect(result.usage.byRole.search).toMatchObject({ calls: 2 });
			expect(result.usage.total.totalTokens).toBeGreaterThan(0);
		});

		it("shows cards for the papers and a summary for every sub-agent that ran", async () => {
			const events: ResearchEvent[] = [];
			await run(M3_4_SAMPLE_THEMES.default, events);
			const cards = events.filter((event) => event.kind === "card");
			// Each search shows its three papers; the reading shows the one it read.
			expect(cards.map((event) => event.agent)).toEqual([...Array(6).fill("search"), "reading"]);
			const summaries = events.filter((event) => event.kind === "summary").map((e) => e.agent);
			expect(summaries).toEqual(["search", "search", "reading", "market", "supervisor"]);
		});
	});

	describe("partial failure", () => {
		it("names the gap that the empty reading left, and still reports", async () => {
			const result = await run(M3_4_SAMPLE_THEMES.partialFailure);
			expect(result.calls).toBe(3);
			expect(result.missing).toHaveLength(1);
			expect(result.missing[0]).toMatchObject({ agent: "reading" });
			expect(result.report).toContain("## 調査できなかった観点");
			expect(result.report).toContain("論文精読");
			expect(result.report).toContain("2403.05678");
		});

		it("has nothing to remove from its report", async () => {
			const result = await run(M3_4_SAMPLE_THEMES.partialFailure);
			expect(result.warnings).toEqual([]);
		});
	});

	it("does not answer a theme it has no scenario for: a mock run never invents a result", async () => {
		await expect(run("このテーマには台本がありません")).rejects.toThrow();
	});
});
