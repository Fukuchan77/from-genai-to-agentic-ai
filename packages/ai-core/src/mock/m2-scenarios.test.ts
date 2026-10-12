import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { M1_2_SCENARIOS } from "../../fixtures/scenarios/m1-2";
import { M1_3_SCENARIOS } from "../../fixtures/scenarios/m1-3";
import {
	M2_1_SAMPLE_QUESTIONS,
	M2_1_SCENARIOS,
	M2_CORPUS_TEXT,
} from "../../fixtures/scenarios/m2-1";
import { M2_2_SCENARIOS } from "../../fixtures/scenarios/m2-2";
import { loadPlatformConfig } from "../config";
import { createModelGateway } from "../models/gateway";
import { buildAnswerPrompt } from "../rag/answer";
import { judgeAxisMarker, judgeRagAnswer } from "../rag/eval/judge";
import { chunkDocument } from "../rag/ingest/chunk";
import { isSkippedFile, loadKnowledgeFile } from "../rag/ingest/loader";
import { expandQuery, generateHypotheticalAnswer } from "../rag/retrieve";
import type { LanguageModelV4CallOptions } from "./request-key";
import { findAmbiguousScenarioMatches } from "./resolve";
import type { ScenarioDefinition, ScenarioMatch } from "./scenario";

const ALL_SCENARIOS: readonly ScenarioDefinition[] = [
	...M1_2_SCENARIOS,
	...M1_3_SCENARIOS,
	...M2_1_SCENARIOS,
	...M2_2_SCENARIOS,
];
const M2_SCENARIOS: readonly ScenarioDefinition[] = [...M2_1_SCENARIOS, ...M2_2_SCENARIOS];

const CORPUS_DIRECTORY = fileURLToPath(new URL("../../fixtures/rag/corpus", import.meta.url));

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

function userPrompt(text: string): LanguageModelV4CallOptions {
	return { prompt: [{ role: "user", content: [{ type: "text", text }] }] };
}

describe("M2 scenarios: matching rules", () => {
	it("gives every scenario an id of the form m2-<module>/... and keeps ids unique", () => {
		for (const scenario of M2_1_SCENARIOS) expect(scenario.id).toMatch(/^m2-1\//u);
		for (const scenario of M2_2_SCENARIOS) expect(scenario.id).toMatch(/^m2-2\//u);
		const ids = ALL_SCENARIOS.map((scenario) => scenario.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("matches exactly one turn for each turn's minimal request, across M1 and M2", () => {
		const turns = M2_SCENARIOS.flatMap((scenario) =>
			scenario.turns.map((turn, turnIndex) => ({ scenarioId: scenario.id, turnIndex, turn })),
		);
		expect(turns.length).toBeGreaterThanOrEqual(10);
		for (const { scenarioId, turnIndex, turn } of turns) {
			const purpose = turn.match.purpose ?? "chat";
			expect(
				findAmbiguousScenarioMatches(minimalWitness(turn.match), purpose, ALL_SCENARIOS),
				`${scenarioId}#${turnIndex}`,
			).toEqual([{ scenarioId, turnIndex }]);
		}
	});

	it("keeps every M1 turn unambiguous after the M2 scenarios are added", () => {
		const turns = [...M1_2_SCENARIOS, ...M1_3_SCENARIOS].flatMap((scenario) =>
			scenario.turns.map((turn, turnIndex) => ({ scenarioId: scenario.id, turnIndex, turn })),
		);
		for (const { scenarioId, turnIndex, turn } of turns) {
			const purpose = turn.match.purpose ?? "chat";
			expect(
				findAmbiguousScenarioMatches(minimalWitness(turn.match), purpose, ALL_SCENARIOS),
				`${scenarioId}#${turnIndex}`,
			).toEqual([{ scenarioId, turnIndex }]);
		}
	});

	it("matches the real prompts the pipeline sends for each sample question", () => {
		const chunk = (body: string) => ({
			chunk: {
				id: "c",
				documentId: "eval:x.md",
				documentTitle: "x.md",
				ordinal: 0,
				headingPath: [],
				page: null,
				body,
			},
			score: 1,
		});
		const answerPrompt = (question: string) => {
			const prompt = buildAnswerPrompt(question, [chunk("資料")]);
			const text = prompt.messages
				.map((message) => (typeof message.content === "string" ? message.content : ""))
				.join("");
			return userPrompt(text);
		};
		const expectations: [string, LanguageModelV4CallOptions, "chat" | "structured", string][] = [
			["answer", answerPrompt(M2_1_SAMPLE_QUESTIONS.answer), "chat", "m2-1/rag/answer"],
			[
				"out of range",
				answerPrompt(M2_1_SAMPLE_QUESTIONS.outOfRange),
				"chat",
				"m2-1/rag/answer-out-of-range",
			],
			["hyde", userPrompt(M2_1_SAMPLE_QUESTIONS.hyde), "structured", "m2-1/hyde"],
			["hyde answer", answerPrompt(M2_1_SAMPLE_QUESTIONS.hyde), "chat", "m2-1/hyde"],
			[
				"multi-query",
				userPrompt(M2_1_SAMPLE_QUESTIONS.multiQuery),
				"structured",
				"m2-1/multi-query",
			],
			[
				"multi-query answer",
				answerPrompt(M2_1_SAMPLE_QUESTIONS.multiQuery),
				"chat",
				"m2-1/multi-query",
			],
			[
				"agentic search",
				userPrompt(M2_1_SAMPLE_QUESTIONS.agenticSearch),
				"chat",
				"m2-1/agentic/search-then-answer",
			],
			[
				"agentic no search",
				userPrompt(M2_1_SAMPLE_QUESTIONS.agenticNoSearch),
				"chat",
				"m2-1/agentic/no-search",
			],
		];
		for (const [label, params, purpose, scenarioId] of expectations) {
			const matches = findAmbiguousScenarioMatches(params, purpose, ALL_SCENARIOS);
			expect(
				matches.map((match) => match.scenarioId),
				label,
			).toEqual([scenarioId]);
		}
	});
});

describe("M2 scenarios: pinned to the evaluation corpus", () => {
	it("uses chunk texts that exist verbatim in fixtures/rag/corpus", async () => {
		const bodies = new Set<string>();
		for (const file of [
			"01-rag-overview.md",
			"02-chunking.md",
			"03-embeddings-and-search.md",
			"04-hybrid-and-rrf.md",
			"05-rerank-and-evaluation.md",
			"06-agentic-rag.md",
		]) {
			const loaded = await loadKnowledgeFile(CORPUS_DIRECTORY, file);
			if (isSkippedFile(loaded)) throw new Error(`corpus file skipped: ${file}`);
			for (const chunk of chunkDocument(loaded, { documentId: `eval:${file}` })) {
				bodies.add(chunk.body);
			}
		}
		for (const [name, text] of Object.entries(M2_CORPUS_TEXT)) {
			expect(bodies.has(text), name).toBe(true);
		}
	});

	it("uses the Judge's axis markers", () => {
		const markers = M2_2_SCENARIOS.flatMap((scenario) =>
			scenario.turns.map((turn) => turn.match.lastUserTextIncludes),
		);
		expect(markers.sort()).toEqual(
			[judgeAxisMarker("faithfulness"), judgeAxisMarker("answer-relevance")].sort(),
		);
	});
});

describe("M2 scenarios: through the mock gateway", () => {
	const gateway = createModelGateway({ config: loadPlatformConfig({ VITEST: "true" }) });

	it("returns the pinned hypothetical answer for the HyDE sample question", async () => {
		const { model } = await gateway.resolve({ purpose: "structured" });
		const result = await generateHypotheticalAnswer({
			model,
			question: M2_1_SAMPLE_QUESTIONS.hyde,
		});
		expect(result.text).toBe(M2_CORPUS_TEXT.whyRag);
	});

	it("returns three different sub-queries for the Multi-Query sample question", async () => {
		const { model } = await gateway.resolve({ purpose: "structured" });
		const result = await expandQuery({ model, question: M2_1_SAMPLE_QUESTIONS.multiQuery });
		expect(result.subQueries).toEqual([
			M2_CORPUS_TEXT.hybridOverview,
			M2_CORPUS_TEXT.scoreScales,
			M2_CORPUS_TEXT.rrf,
		]);
		expect(result.attempts).toBe(1);
	});

	it("scores both Judge axes", async () => {
		const { model } = await gateway.resolve({ purpose: "judge" });
		const judgements = await judgeRagAnswer({
			judgeModel: model,
			question: "質問",
			answer: "回答 [1]",
			chunks: [{ id: "c", documentTitle: "t", body: "資料" }],
		});
		expect(judgements.map((entry) => [entry.axis, entry.verdict])).toEqual([
			["faithfulness", "pass"],
			["answer-relevance", "pass"],
		]);
	});
});
