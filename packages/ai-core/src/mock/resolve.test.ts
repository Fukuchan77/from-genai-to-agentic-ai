import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { M1_2_SCENARIOS } from "../../fixtures/scenarios/m1-2";
import { M1_3_SCENARIOS } from "../../fixtures/scenarios/m1-3";
import { createCassetteStore } from "./cassette-store";
import type { LanguageModelV4CallOptions } from "./request-key";
import { requestKey } from "./request-key";
import {
	findAmbiguousScenarioMatches,
	MockFixtureMissingError,
	resolveMockResponse,
} from "./resolve";
import { defineScenario, type ScenarioDefinition, type ScenarioMatch } from "./scenario";

const directories: string[] = [];
afterEach(async () =>
	Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true }))),
);

function params(text = "hello"): LanguageModelV4CallOptions {
	return { prompt: [{ role: "user", content: [{ type: "text", text }] }] };
}

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
			{
				role: "assistant",
				content: [{ type: "tool-call", toolCallId, toolName, input: {} }],
			},
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

const BUNDLED_SCENARIO_SETS = [
	["M1_2_SCENARIOS", M1_2_SCENARIOS],
	["M1_3_SCENARIOS", M1_3_SCENARIOS],
] as const satisfies readonly (readonly [string, readonly ScenarioDefinition[]])[];

describe("resolveMockResponse", () => {
	it("prefers the first matching scenario over a cassette", async () => {
		const directory = await mkdtemp(path.join(tmpdir(), "cassette-"));
		directories.push(directory);
		const store = createCassetteStore(directory);
		const key = requestKey(params(), "chat");
		await store.put(key, {
			version: 1,
			key,
			request: { purpose: "chat", modelId: "mock", promptDigest: key, toolNames: [] },
			parts: [
				{ type: "text-start", id: "cassette" },
				{ type: "text-delta", id: "cassette", delta: "cassette" },
				{ type: "text-end", id: "cassette" },
			],
			recordedAt: "2026-09-30T00:00:00.000Z",
			recordedWith: "local",
		});
		const scenarios = [
			defineScenario({ id: "first", turns: [{ match: {}, respond: { text: "scenario" } }] }),
			defineScenario({ id: "second", turns: [{ match: {}, respond: { text: "later" } }] }),
		];

		const resolved = await resolveMockResponse({
			params: params(),
			purpose: "chat",
			scenarios,
			cassettes: store,
		});
		expect(resolved).toMatchObject({
			source: "scenario",
			scenarioId: "first",
			response: { text: "scenario" },
		});
	});

	it("falls back to cassette by request key and never to a network", async () => {
		const directory = await mkdtemp(path.join(tmpdir(), "cassette-"));
		directories.push(directory);
		const store = createCassetteStore(directory);
		const key = requestKey(params(), "chat");
		await store.put(key, {
			version: 1,
			key,
			request: { purpose: "chat", modelId: "mock", promptDigest: key, toolNames: [] },
			parts: [
				{ type: "text-start", id: "t" },
				{ type: "text-delta", id: "t", delta: "saved" },
				{ type: "text-end", id: "t" },
			],
			recordedAt: "2026-09-30T00:00:00.000Z",
			recordedWith: "live",
		});

		await expect(
			resolveMockResponse({ params: params(), purpose: "chat", scenarios: [], cassettes: store }),
		).resolves.toMatchObject({ source: "cassette", cassette: { key } });
		await expect(
			resolveMockResponse({
				params: params("missing"),
				purpose: "chat",
				scenarios: [],
				cassettes: store,
			}),
		).rejects.toMatchObject({
			name: "MockFixtureMissingError",
			key: requestKey(params("missing"), "chat"),
		});
	});

	it("detects ambiguous scenario predicates without changing first-match runtime behavior", () => {
		const scenarios = [
			defineScenario({ id: "broad", turns: [{ match: {}, respond: { text: "a" } }] }),
			defineScenario({
				id: "also-broad",
				turns: [{ match: { purpose: "chat" }, respond: { text: "b" } }],
			}),
		];
		expect(findAmbiguousScenarioMatches(params(), "chat", scenarios)).toEqual([
			{ scenarioId: "broad", turnIndex: 0 },
			{ scenarioId: "also-broad", turnIndex: 0 },
		]);
	});

	it.each(BUNDLED_SCENARIO_SETS)(
		"keeps each %s turn's minimal request unambiguous",
		(_name, scenarios) => {
			const turns = scenarios.flatMap((scenario) =>
				scenario.turns.map((turn, turnIndex) => ({ scenarioId: scenario.id, turnIndex, turn })),
			);
			expect(turns.length).toBeGreaterThan(0);
			for (const { scenarioId, turnIndex, turn } of turns) {
				const purpose = turn.match.purpose ?? "chat";
				expect(
					findAmbiguousScenarioMatches(minimalWitness(turn.match), purpose, scenarios),
				).toEqual([{ scenarioId, turnIndex }]);
			}
		},
	);

	it("exposes only keys and scenario ids in missing-fixture diagnostics", () => {
		const error = new MockFixtureMissingError("abc" as ReturnType<typeof requestKey>, [
			"scenario/a",
		]);
		expect(error.message).toBe("モック応答が見つかりませんでした。");
		expect(error.details).toEqual({ key: "abc", nearest: ["scenario/a"] });
	});

	it("rejects unsafe storage keys and supports concurrent writes to one cassette", async () => {
		const directory = await mkdtemp(path.join(tmpdir(), "cassette-"));
		directories.push(directory);
		const store = createCassetteStore(directory);
		await expect(store.put("../escaped", {})).rejects.toThrow("Invalid cassette storage key");
		const key = requestKey(params(), "chat");
		const cassette = {
			version: 1 as const,
			key,
			request: { purpose: "chat" as const, modelId: "mock", promptDigest: key, toolNames: [] },
			parts: [
				{ type: "text-start" as const, id: "text" },
				{ type: "text-end" as const, id: "text" },
			],
			recordedAt: "2026-09-30T00:00:00.000Z",
			recordedWith: "local" as const,
		};
		const writes = await Promise.allSettled([
			store.put(`llm/${key}`, cassette),
			store.put(`llm/${key}`, cassette),
		]);
		expect(writes.every((write) => write.status === "fulfilled")).toBe(true);
	});

	it("validates cassette JSON at the filesystem boundary", async () => {
		const directory = await mkdtemp(path.join(tmpdir(), "cassette-"));
		directories.push(directory);
		const key = requestKey(params(), "chat");
		await mkdir(path.join(directory, "llm"), { recursive: true });
		await writeFile(
			path.join(directory, "llm", `${key}.json`),
			JSON.stringify({ version: 2, key }),
		);
		await expect(createCassetteStore(directory).get(key)).rejects.toThrow();
		await writeFile(
			path.join(directory, "llm", `${key}.json`),
			JSON.stringify({
				version: 1,
				key,
				request: { purpose: "chat", modelId: "mock", promptDigest: key, toolNames: [] },
				parts: [{ type: "text-delta" }],
				recordedAt: "2026-09-30T00:00:00.000Z",
				recordedWith: "local",
			}),
		);
		await expect(createCassetteStore(directory).get(key)).rejects.toThrow();
	});
});
