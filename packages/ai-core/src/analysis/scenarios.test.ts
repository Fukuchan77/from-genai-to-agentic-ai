import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { M3_3_SAMPLE_INSTRUCTIONS, M3_3_SCENARIOS } from "../../fixtures/scenarios/m3-3";
import { createScenarioModel } from "../mock/scenario-model";
import { createFakeClock } from "../ports/clock";
import { createMockSandboxProvider } from "../sandbox/mock";
import { runAnalysis } from "./agent";

// The m3-3 scenarios are what `mock` mode (the Web app, E2E) runs: check that each one, with the
// mock sandbox, ends the way the UI examples promise.

const CSV = new TextEncoder().encode(
	"date,region,product,units,sales\n2026-01-08,東京,ノート,100,40000\n",
);

async function analyse(instruction: string) {
	const provider = createMockSandboxProvider();
	const model = createScenarioModel({ purpose: "chat", scenarios: M3_3_SCENARIOS });
	const result = await runAnalysis({
		sandbox: await provider.create({ timeoutMs: 600_000 }),
		file: { name: "sales.csv", bytes: CSV },
		instruction,
		model,
		options: { maxFixAttempts: 3, executionTimeoutMs: 10_000 },
		clock: createFakeClock(),
		signal: new AbortController().signal,
	});
	return { result, runs: provider.sessions[0]?.runs ?? [], model };
}

describe("the m3-3 scenarios, end to end with the mock sandbox", () => {
	it("success: one run, a figure and a table, and an explanation", async () => {
		const { result, runs } = await analyse(M3_3_SAMPLE_INSTRUCTIONS.success);

		expect(result.status).toBe("succeeded");
		expect(result.attempts).toHaveLength(1);
		expect(result.fixes).toBe(0);
		expect(result.figures).toHaveLength(1);
		expect(result.tables).toHaveLength(1);
		expect(result.text).toContain("月ごと");
		expect(runs).toHaveLength(1);
	});

	it("fixed: the first run fails, the fix succeeds, and the learner sees both", async () => {
		const { result } = await analyse(M3_3_SAMPLE_INSTRUCTIONS.fixed);

		expect(result.status).toBe("succeeded");
		expect(result.attempts).toHaveLength(2);
		expect(result.fixes).toBe(1);
		expect(result.attempts[0]?.errorSummary).toBe("KeyError: 'revenue'");
		expect(result.attempts[1]?.errorSummary).toBeUndefined();
		expect(result.text).toContain("地域");
	});

	it("attempt-limit: four failed runs (the first and three fixes), then the run is stopped", async () => {
		const { result, runs, model } = await analyse(M3_3_SAMPLE_INSTRUCTIONS.attemptLimit);

		expect(result.status).toBe("attempt-limit");
		expect(result.attempts).toHaveLength(4);
		expect(result.fixes).toBe(3);
		expect(result.attempts.at(-1)?.code).toContain("attempt 4");
		expect(runs).toHaveLength(4);
		// The scenario's fifth turn (a plain answer) is never asked for.
		expect(model.doGenerateCalls).toHaveLength(4);
		expect(result.text).toContain("3 回");
	});
});

describe("the m3-3 scenario module", () => {
	it("does not import the mock sandbox itself, whose JSON fixtures Node's native loader rejects", () => {
		// The E2E specs load the scenarios with Node's own ESM loader, where a JSON import needs an
		// import attribute; the marker module is JSON-free and is all the scenarios need.
		const source = readFileSync(
			path.resolve(import.meta.dirname, "../../fixtures/scenarios/m3-3.ts"),
			"utf8",
		);
		const specifiers = [...source.matchAll(/from\s+"([^"]+)"/gu)].map((match) => match[1] ?? "");

		expect(specifiers).toContain("../../src/sandbox/mock-marker");
		expect(specifiers).not.toContain("../../src/sandbox/mock");
		expect(specifiers.some((specifier) => specifier.endsWith(".json"))).toBe(false);
	});
});
