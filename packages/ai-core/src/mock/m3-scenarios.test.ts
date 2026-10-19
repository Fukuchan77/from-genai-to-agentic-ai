import { describe, expect, it } from "vitest";
import { M1_2_SCENARIOS } from "../../fixtures/scenarios/m1-2";
import { M1_3_SCENARIOS } from "../../fixtures/scenarios/m1-3";
import { M2_1_SCENARIOS } from "../../fixtures/scenarios/m2-1";
import { M2_2_SCENARIOS } from "../../fixtures/scenarios/m2-2";
import { M2_3_SCENARIOS } from "../../fixtures/scenarios/m2-3";
import { M2_4_SCENARIOS } from "../../fixtures/scenarios/m2-4";
import { M3_SCENARIOS } from "./index";
import type { LanguageModelV4CallOptions } from "./request-key";
import { findAmbiguousScenarioMatches } from "./resolve";
import { defineScenario, type ScenarioDefinition, type ScenarioMatch } from "./scenario";

/** Builds the smallest request whose derived context satisfies `match`. */
function minimalWitness(match: ScenarioMatch): LanguageModelV4CallOptions {
	const steps = match.stepIndex ?? 0;
	const prompt: LanguageModelV4CallOptions["prompt"] = [
		{ role: "user", content: [{ type: "text", text: match.lastUserTextIncludes ?? "" }] },
	];
	for (let step = 0; step < steps; step += 1) {
		const toolCallId = `witness-${step}`;
		const toolName = match.toolResultFor ?? "witness";
		prompt.push(
			{ role: "assistant", content: [{ type: "tool-call", toolCallId, toolName, input: {} }] },
			{
				role: "tool",
				content: [
					{ type: "tool-result", toolCallId, toolName, output: { type: "json", value: null } },
				],
			},
		);
	}
	return { prompt };
}

interface TurnRef {
	readonly scenarioId: string;
	readonly turnIndex: number;
	readonly match: ScenarioMatch;
}

function turnsOf(scenarios: readonly ScenarioDefinition[]): TurnRef[] {
	return scenarios.flatMap((scenario) =>
		scenario.turns.map((turn, turnIndex) => ({
			scenarioId: scenario.id,
			turnIndex,
			match: turn.match,
		})),
	);
}

/**
 * Turns whose minimal request also matches another turn: the same input (purpose, user text,
 * step) must never be answered by two scenarios, or the first one in the list silently wins.
 */
function findAmbiguousTurns(
	subject: readonly ScenarioDefinition[],
	all: readonly ScenarioDefinition[] = subject,
): string[] {
	return turnsOf(subject).flatMap(({ scenarioId, turnIndex, match }) => {
		const hits = findAmbiguousScenarioMatches(minimalWitness(match), match.purpose ?? "chat", all);
		const own = hits.filter((hit) => hit.scenarioId === scenarioId && hit.turnIndex === turnIndex);
		return hits.length === 1 && own.length === 1 ? [] : [`${scenarioId}#${turnIndex}`];
	});
}

const MARKER_PREFIX = "fixture:";
const MARKER_FORMAT = /^fixture:[a-z0-9][a-z0-9/-]*$/u;

/**
 * `fixture:` markers that do not resolve: a malformed one, or one whose request does not reach
 * exactly its own turn (for example because another marker contains it as a prefix).
 */
function findUnresolvedFixtureMarkers(
	subject: readonly ScenarioDefinition[],
	all: readonly ScenarioDefinition[] = subject,
): string[] {
	const problems: string[] = [];
	for (const { scenarioId, turnIndex, match } of turnsOf(subject)) {
		const marker = match.lastUserTextIncludes;
		if (marker === undefined || !marker.includes(MARKER_PREFIX)) continue;
		if (!MARKER_FORMAT.test(marker)) {
			problems.push(`${scenarioId}#${turnIndex}: malformed marker`);
			continue;
		}
		const hits = findAmbiguousScenarioMatches(minimalWitness(match), match.purpose ?? "chat", all);
		const only = hits.length === 1 && hits[0]?.scenarioId === scenarioId;
		if (!only) problems.push(`${scenarioId}#${turnIndex}: ${marker} does not resolve to one turn`);
	}
	return problems;
}

function scenario(id: string, ...matches: ScenarioMatch[]): ScenarioDefinition {
	return defineScenario({
		id,
		turns: matches.map((match) => ({ match, respond: { text: "ok" } })),
	});
}

describe("findAmbiguousTurns (detector)", () => {
	it("reports two scenarios that answer the same purpose and text", () => {
		const scenarios = [
			scenario("t/a", { purpose: "chat", lastUserTextIncludes: "ヘルプ" }),
			scenario("t/b", { purpose: "chat", lastUserTextIncludes: "ヘルプ" }),
		];

		expect(findAmbiguousTurns(scenarios)).toEqual(["t/a#0", "t/b#0"]);
	});

	it("reports a text that is contained in another scenario's text", () => {
		const scenarios = [
			scenario("t/short", { purpose: "chat", lastUserTextIncludes: "分析" }),
			scenario("t/long", { purpose: "chat", lastUserTextIncludes: "データ分析" }),
		];

		// The long text also satisfies the short match, so the long turn is ambiguous.
		expect(findAmbiguousTurns(scenarios)).toEqual(["t/long#0"]);
	});

	it("accepts the same text for different purposes or steps", () => {
		const scenarios = [
			scenario("t/a", { purpose: "chat", lastUserTextIncludes: "x" }),
			scenario("t/b", { purpose: "structured", lastUserTextIncludes: "x" }),
			scenario(
				"t/c",
				{ purpose: "chat", lastUserTextIncludes: "y", stepIndex: 0 },
				{ purpose: "chat", lastUserTextIncludes: "y", stepIndex: 1, toolResultFor: "tool" },
			),
		];

		expect(findAmbiguousTurns(scenarios)).toEqual([]);
	});

	it("checks the subject against a larger set", () => {
		const existing = [scenario("m1/a", { purpose: "chat", lastUserTextIncludes: "天気" })];
		const added = [scenario("m3/a", { purpose: "chat", lastUserTextIncludes: "天気" })];

		expect(findAmbiguousTurns(added, [...existing, ...added])).toEqual(["m3/a#0"]);
		expect(findAmbiguousTurns(added)).toEqual([]);
	});

	it("reports nothing for an empty set (the real-set test below guards against that vacuity)", () => {
		expect(findAmbiguousTurns([])).toEqual([]);
	});
});

describe("findUnresolvedFixtureMarkers (detector)", () => {
	it("accepts distinct, well-formed markers", () => {
		const scenarios = [
			scenario("t/a", { purpose: "structured", lastUserTextIncludes: "fixture:plan-ok" }),
			scenario("t/b", { purpose: "structured", lastUserTextIncludes: "fixture:plan-fail" }),
		];

		expect(findUnresolvedFixtureMarkers(scenarios)).toEqual([]);
	});

	it("reports a marker that another marker contains as a prefix", () => {
		const scenarios = [
			scenario("t/a", { purpose: "structured", lastUserTextIncludes: "fixture:plan" }),
			scenario("t/b", { purpose: "structured", lastUserTextIncludes: "fixture:plan-fail" }),
		];

		expect(findUnresolvedFixtureMarkers(scenarios)).toEqual([
			"t/b#0: fixture:plan-fail does not resolve to one turn",
		]);
	});

	it("reports a malformed marker", () => {
		const scenarios = [
			scenario("t/a", { purpose: "chat", lastUserTextIncludes: "fixture:Bad Name" }),
			scenario("t/b", { purpose: "chat", lastUserTextIncludes: "fixture:" }),
		];

		expect(findUnresolvedFixtureMarkers(scenarios)).toEqual([
			"t/a#0: malformed marker",
			"t/b#0: malformed marker",
		]);
	});

	it("ignores turns that do not use a fixture marker", () => {
		const scenarios = [scenario("t/a", { purpose: "chat", lastUserTextIncludes: "ふつうの文" })];

		expect(findUnresolvedFixtureMarkers(scenarios)).toEqual([]);
	});
});

/**
 * Each wave that adds M3 scenarios (10.1, 15.1, 18.5, 22.5, 27.1) updates these two numbers, so a
 * scenario added or dropped without a matching update fails here instead of passing unnoticed.
 */
const EXPECTED_M3_SCENARIOS = 13;
const EXPECTED_M3_TURNS = 63;

const PRIOR_SCENARIOS: readonly ScenarioDefinition[] = [
	...M1_2_SCENARIOS,
	...M1_3_SCENARIOS,
	...M2_1_SCENARIOS,
	...M2_2_SCENARIOS,
	...M2_3_SCENARIOS,
	...M2_4_SCENARIOS,
];
const ALL_SCENARIOS: readonly ScenarioDefinition[] = [...PRIOR_SCENARIOS, ...M3_SCENARIOS];

describe("M3 scenarios: the real set", () => {
	it("holds the expected number of scenarios and turns", () => {
		expect(M3_SCENARIOS).toHaveLength(EXPECTED_M3_SCENARIOS);
		expect(turnsOf(M3_SCENARIOS)).toHaveLength(EXPECTED_M3_TURNS);
	});

	it("gives every scenario an id of the form m3-<module>/... and keeps ids unique", () => {
		for (const { id } of M3_SCENARIOS) expect(id).toMatch(/^m3-[1-6]\//u);
		const ids = ALL_SCENARIOS.map(({ id }) => id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("answers each M3 turn alone, also next to the M1 and M2 scenarios", () => {
		expect(findAmbiguousTurns(M3_SCENARIOS, ALL_SCENARIOS)).toEqual([]);
	});

	it("keeps every M1 and M2 turn unambiguous after the M3 scenarios are added", () => {
		// Non-vacuous: the prior set has many turns, so this check exercises the detector even
		// while M3_SCENARIOS is empty.
		expect(turnsOf(PRIOR_SCENARIOS).length).toBeGreaterThan(30);
		expect(findAmbiguousTurns(PRIOR_SCENARIOS, ALL_SCENARIOS)).toEqual([]);
	});

	it("resolves every fixture: marker of the M3 scenarios to exactly one turn", () => {
		expect(findUnresolvedFixtureMarkers(M3_SCENARIOS, ALL_SCENARIOS)).toEqual([]);
	});
});
