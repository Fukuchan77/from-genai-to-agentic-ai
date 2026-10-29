// Capability observation (plan C16, Req 6.2, constitution principle 1): with a real local model, how
// often does the marketing council reach agreement within the round limit, and what does it cost in
// tokens compared with a SINGLE agent improving the same copy in one call chain? The test prints a
// comparison table for research.md and asserts only invariants, never a pass rate: a small local
// model may or may not agree. It runs only under `mise run test:local` with Ollama available;
// everywhere else `describeLocal` reports it as skipped with the reason from the local global setup.
import { buildToolSet } from "@platform/ai-core/aci";
import {
	DEFAULT_AGENT_LIMITS,
	DEFAULT_COUNCIL,
	loadPlatformConfig,
} from "@platform/ai-core/config";
import { loadSamplePersonas, runCouncil } from "@platform/ai-core/marketing";
import { createModelGateway } from "@platform/ai-core/models";
import { cooperateByRole } from "@platform/ai-core/patterns";
import { systemClock } from "@platform/ai-core/ports";
import { describeLocal } from "@platform/ai-core/testing";
import { expect } from "vitest";

/** Several councils and single runs of a local model take minutes; leave a wide margin. */
const LOCAL_MODEL_TIMEOUT_MS = 900_000;
const PERSONA_RUN_LIMIT_MS = 300_000;
const REPETITIONS = 2;
/** Same rule as the council's own `<draft>` extraction (`extractDraft` is not exported). */
const DRAFT_BLOCK = /<draft>([\s\S]*?)<\/draft>/gi;

/** The last non-blank `<draft>` block of a text, if any. */
function extractDraftBlock(text: string): string | undefined {
	let found: string | undefined;
	for (const match of text.matchAll(DRAFT_BLOCK)) {
		const candidate = match[1]?.trim() ?? "";
		if (candidate !== "") found = candidate;
	}
	return found;
}

const DRAFT =
	"新発売の保湿クリームです。うるおいが長く続きます。ぜひ一度お試しください。価格は 3,980 円です。";

interface Observation {
	readonly kind: "council" | "single";
	readonly run: number;
	readonly tokens: number;
	/** Rounds the council used; a single agent has one call chain, counted as one round. */
	readonly rounds: number;
	/** `agreed` for a council that agreed; a single agent has nobody to agree with. */
	readonly agreed: boolean | null;
	readonly endReason: string;
	/** Council: `improvedDraft` differs from the input. Single: the extracted `<draft>` block differs. */
	readonly draftChanged: boolean;
	/** Persona statements that contained a `<draft>` block (council only; null for a single agent). */
	readonly draftBlocks: string | null;
	/** Tokens spent minus the shared token budget; positive means the soft cap was overshot. */
	readonly overshoot: number;
}

/** Share of observations in which the council agreed, as a number in [0, 1]. */
function agreementRate(observations: readonly Observation[]): number {
	const councils = observations.filter((entry) => entry.kind === "council");
	if (councils.length === 0) return 0;
	return councils.filter((entry) => entry.agreed === true).length / councils.length;
}

function mean(values: readonly number[]): number {
	return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatTable(observations: readonly Observation[]): string {
	const header =
		"| kind | run | tokens | rounds | agreed | end reason | draft changed | statements with <draft> | overshoot |";
	const divider = "| :-- | --: | --: | --: | :-- | :-- | :-- | :-- | --: |";
	const rows = observations.map((entry) => {
		const agreed = entry.agreed === null ? "n/a" : entry.agreed ? "yes" : "no";
		return `| ${entry.kind} | ${entry.run} | ${entry.tokens} | ${entry.rounds} | ${agreed} | ${entry.endReason} | ${entry.draftChanged ? "yes" : "no"} | ${entry.draftBlocks ?? "n/a"} | ${entry.overshoot} |`;
	});
	const councils = observations.filter((entry) => entry.kind === "council");
	const singles = observations.filter((entry) => entry.kind === "single");
	const councilMean = mean(councils.map((entry) => entry.tokens));
	const singleMean = mean(singles.map((entry) => entry.tokens));
	const ratio = singleMean > 0 ? (councilMean / singleMean).toFixed(1) : "n/a";
	return [
		header,
		divider,
		...rows,
		"",
		`agreement within ${DEFAULT_COUNCIL.maxRounds} rounds: ${(agreementRate(observations) * 100).toFixed(0)}% (${councils.filter((entry) => entry.agreed === true).length}/${councils.length})`,
		`mean rounds (council): ${mean(councils.map((entry) => entry.rounds)).toFixed(1)}`,
		`mean tokens: council ${councilMean.toFixed(0)}, single ${singleMean.toFixed(0)}, ratio ${ratio}x`,
	].join("\n");
}

describeLocal("council agreement and cost on a local model", (it) => {
	it(
		"observes the agreement rate and the token cost against a single agent",
		async () => {
			const config = loadPlatformConfig();
			expect(config.mode).toBe("local");
			const { model } = await createModelGateway({ config }).resolve({ purpose: "chat" });
			const personas = await loadSamplePersonas();
			const observations: Observation[] = [];
			const failures: string[] = [];

			for (let run = 1; run <= REPETITIONS; run += 1) {
				try {
					const council = await runCouncil({
						draft: DRAFT,
						personas,
						model,
						clock: systemClock,
						signal: AbortSignal.timeout(LOCAL_MODEL_TIMEOUT_MS),
						// Observed with one local model: each persona call hit the default 60 s limit with 0
						// tokens recorded. The cause is not identified (a long or runaway generation of that
						// small model, or other local test files sharing the single Ollama slot; consider
						// `--no-file-parallelism`). The council calls personas one at a time. This test only
						// raises the limit; the app default stays 60 s.
						roleLimits: { maxDurationMs: PERSONA_RUN_LIMIT_MS },
					});
					const statements = council.rounds.flatMap((round) => round.statements);
					const withDraft = statements.filter(
						(statement) => extractDraftBlock(statement.text) !== undefined,
					).length;
					observations.push({
						kind: "council",
						run,
						tokens: council.usage.total.totalTokens,
						rounds: council.rounds.length,
						agreed: council.endReason === "agreed",
						endReason: council.endReason,
						draftChanged: council.improvedDraft !== DRAFT,
						draftBlocks: `${withDraft}/${statements.length}`,
						overshoot: council.usage.total.totalTokens - DEFAULT_COUNCIL.maxTotalTokens,
					});

					// The same copy, improved by one agent that is told every persona's viewpoint.
					const { tools } = buildToolSet(
						[],
						{},
						{ clock: systemClock, toolTimeoutMs: DEFAULT_AGENT_LIMITS.toolTimeoutMs },
					);
					const single = await cooperateByRole({
						roles: [
							{
								name: "single",
								instructions: [
									"あなたはマーケティング文案を改善する担当者です。",
									"次の視点をすべて踏まえて、<draft> の文案を改善してください。",
									...personas.map((persona) => `- ${persona.name}: ${persona.viewpoint}`),
									"最後に、改善後の文案の全文を <draft>…</draft> で囲んで書いてください。",
								].join("\n"),
								model,
								tools,
							},
						],
						task: `<draft>\n${DRAFT}\n</draft>`,
						budget: {
							maxSteps: 2,
							maxTotalTokens: DEFAULT_COUNCIL.maxTotalTokens,
							maxDurationMs: 120_000,
							toolTimeoutMs: DEFAULT_AGENT_LIMITS.toolTimeoutMs,
						},
						clock: systemClock,
						signal: AbortSignal.timeout(LOCAL_MODEL_TIMEOUT_MS),
					});
					const summary = single.outputs[0]?.run;
					const singleTokens = summary ? summary.totalTokens.input + summary.totalTokens.output : 0;
					const singleDraft = extractDraftBlock(single.final);
					observations.push({
						kind: "single",
						run,
						tokens: singleTokens,
						rounds: 1,
						agreed: null,
						endReason: summary?.stopReason ?? "none",
						draftChanged: singleDraft !== undefined && singleDraft !== DRAFT,
						draftBlocks: null,
						overshoot: singleTokens - DEFAULT_COUNCIL.maxTotalTokens,
					});
				} catch (error) {
					// A failed run is an observation too (a 400 from the model server, a timeout, ...).
					const detail = error as { message?: string; responseBody?: string };
					failures.push(
						`run ${run}: ${detail.message ?? String(error)} ${detail.responseBody ?? ""}`.trim(),
					);
					console.info(`run ${run} failed: ${failures.at(-1)}`);
				}
				console.info(
					`progress after run ${run}: ${observations.length} observations, ${failures.length} failures`,
				);
			}

			// For pasting into research.md.
			console.info(`\n${formatTable(observations)}\n`);
			console.info(`failed runs: ${failures.length}${failures.map((f) => `\n- ${f}`).join("")}`);

			// Invariants only: a rate is observed, never required.
			for (const entry of observations) {
				expect(Number.isFinite(entry.tokens)).toBe(true);
				expect(entry.tokens).toBeGreaterThanOrEqual(0);
				expect(entry.rounds).toBeGreaterThanOrEqual(1);
				if (entry.kind === "council") {
					expect(entry.rounds).toBeLessThanOrEqual(DEFAULT_COUNCIL.maxRounds);
				}
				// No upper bound on tokens: the budget is a soft cap, so the overshoot is only printed.
			}
			const rate = agreementRate(observations);
			expect(rate).toBeGreaterThanOrEqual(0);
			expect(rate).toBeLessThanOrEqual(1);
		},
		LOCAL_MODEL_TIMEOUT_MS,
	);
});
