import { MockLanguageModelV4 } from "ai/test";
import { beforeAll, describe, expect, it } from "vitest";
import {
	createFixtureHttpFetcher,
	createFixtureTranscriptSource,
	createScenarioModel,
	defineScenario,
	type FixtureSet,
	loadFixtureSet,
	M1_3_SCENARIOS,
	type ScenarioDefinition,
} from "../mock";
import { defaultModelFor, getModelEntry } from "../models/catalog";
import type { ModelEntry, ProviderId, RunMode } from "../models/types";
// The public surface (`@platform/ai-core/summarize`) is exercised through the index.
import {
	type LoadedSource,
	loadSource,
	OUTPUT_RESERVE_TOKENS,
	planSummary,
	SourceFetchError,
	type Summary,
	type SummaryDeps,
	type SummaryEvent,
	type SummaryInput,
	type SummaryPlan,
	SummaryValidationError,
	streamSummary,
	summarize,
	summarizeSource,
	TranscriptUnavailableError,
} from "./index";

function structuredEntry(mode: RunMode, provider: ProviderId): ModelEntry {
	return getModelEntry(defaultModelFor(mode, provider, "structured"));
}

const mockEntry = structuredEntry("mock", "mock");
const anthropicEntry = structuredEntry("live", "anthropic");
const openaiEntry = structuredEntry("live", "openai");

// The 13.6 m1-3 scenarios answer without a chunkSize (one delta) and statelessly, so the cases that
// need streamed deltas, a later-valid regeneration or an integration step add scenarios here.
const baseSummary = {
	title: "Agentic AI 入門",
	keyPoints: ["目的を明確にする", "ツールを安全に使う", "評価で品質を確認する"],
	tags: ["AI", "agents", "evaluation"],
	actionItems: ["モックでテストする"],
} satisfies Summary;

const INLINE_SCENARIOS: readonly ScenarioDefinition[] = [
	defineScenario({
		id: "m1-3/test/streamed-summary",
		turns: [
			{
				match: { purpose: "structured", lastUserTextIncludes: "fixture:summary-streamed" },
				respond: { object: baseSummary, chunkSize: 8, usage: { inputTokens: 90 } },
			},
		],
	}),
	defineScenario({
		id: "m1-3/test/integrate",
		turns: [
			{
				match: { purpose: "structured", lastUserTextIncludes: "部分要約（JSON）の一覧" },
				respond: {
					object: { ...baseSummary, title: "統合した要約" },
					chunkSize: 10,
					usage: { inputTokens: 300, cacheReadTokens: 50 },
				},
			},
		],
	}),
];

// Stateless matching: the regeneration prompt carries the feedback text, so this scenario is kept
// out of the shared list (it would otherwise also turn m1-3/validation-retry valid).
const VALID_AFTER_FEEDBACK = defineScenario({
	id: "m1-3/test/valid-after-feedback",
	turns: [
		{
			match: {
				purpose: "structured",
				lastUserTextIncludes: "前回の出力はスキーマ検証に失敗しました",
			},
			respond: { object: { ...baseSummary, title: "再生成した要約" }, chunkSize: 16 },
		},
		{
			match: { purpose: "structured", lastUserTextIncludes: "fixture:summary-retry-once" },
			respond: { object: { ...baseSummary, keyPoints: ["1つだけ"] }, chunkSize: 16 },
		},
	],
});

function scenarioModel() {
	return createScenarioModel({
		purpose: "structured",
		scenarios: [...INLINE_SCENARIOS, ...M1_3_SCENARIOS],
	});
}

function transcript(text: string): LoadedSource {
	return { kind: "transcript", text };
}

async function collect(plan: SummaryPlan, deps: SummaryDeps): Promise<SummaryEvent[]> {
	const events: SummaryEvent[] = [];
	for await (const event of streamSummary(plan, deps)) events.push(event);
	return events;
}

async function collectUntilError(plan: SummaryPlan, deps: SummaryDeps) {
	const events: SummaryEvent[] = [];
	try {
		for await (const event of streamSummary(plan, deps)) events.push(event);
	} catch (error) {
		return { events, error };
	}
	return { events, error: undefined };
}

function promptText(call: MockLanguageModelV4["doStreamCalls"][number]): string {
	return call.prompt
		.flatMap((message) =>
			message.role === "system"
				? [message.content]
				: message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])),
		)
		.join("\n");
}

function sourcePartOptions(call: MockLanguageModelV4["doStreamCalls"][number]) {
	const user = call.prompt.find((message) => message.role === "user");
	const [source] = user?.role === "user" ? user.content : [];
	return source?.providerOptions;
}

describe("streamSummary: whole", () => {
	it("streams partials, then the validated final summary, then the meta (m1-3/full-summary)", async () => {
		const model = scenarioModel();
		const plan = planSummary(transcript("fixture:summary-full 本文です。"), mockEntry);

		const events = await collect(plan, { model, entry: mockEntry });
		const types = events.map((event) => event.type);

		expect(types.at(-2)).toBe("final");
		expect(types.at(-1)).toBe("meta");
		expect(types.slice(0, -2).every((type) => type === "partial")).toBe(true);
		expect(events.at(-2)).toEqual({ type: "final", summary: baseSummary });
		expect(events.at(-1)).toEqual({
			type: "meta",
			meta: {
				strategy: "whole",
				estimatedInputTokens: plan.estimatedInputTokens,
				actualInputTokens: 120,
				chunks: 1,
				cacheReadTokens: undefined,
				attempts: 1,
			},
		});
		expect(model.doStreamCalls).toHaveLength(1);
		expect(model.doStreamCalls[0]?.maxOutputTokens).toBe(OUTPUT_RESERVE_TOKENS);
		expect(model.doStreamCalls[0]?.responseFormat).toMatchObject({ type: "json" });
	});

	it("emits partial objects field by field in schema order, ending at the final value", async () => {
		const plan = planSummary(transcript("fixture:summary-streamed"), mockEntry);

		const events = await collect(plan, { model: scenarioModel(), entry: mockEntry });
		const partials = events.flatMap((event) => (event.type === "partial" ? [event.summary] : []));
		const firstSeen: string[] = [];
		for (const partial of partials) {
			for (const key of Object.keys(partial)) if (!firstSeen.includes(key)) firstSeen.push(key);
		}

		expect(partials.length).toBeGreaterThan(5);
		expect(firstSeen).toEqual(["title", "keyPoints", "tags", "actionItems"]);
		for (const [index, partial] of partials.entries()) {
			const previous = partials[index - 1];
			if (previous) {
				expect(Object.keys(partial).length).toBeGreaterThanOrEqual(Object.keys(previous).length);
			}
		}
		expect(partials.at(-1)).toEqual(baseSummary);
		expect(events.at(-2)).toEqual({ type: "final", summary: baseSummary });
	});

	it("generates chapters with start times for a timestamped source (m1-3/chapter-summary)", async () => {
		const model = scenarioModel();
		const source: LoadedSource = {
			kind: "youtube",
			title: "Agentic AI 入門",
			text: "fixture:summary-chapters 導入\n実装",
			segments: [
				{ text: "fixture:summary-chapters 導入", startSeconds: 0 },
				{ text: "実装", startSeconds: 90 },
			],
		};

		const events = await collect(planSummary(source, mockEntry), { model, entry: mockEntry });
		const final = events.find((event) => event.type === "final");
		const call = model.doStreamCalls[0];

		expect(final?.type === "final" && final.summary.chapters).toEqual([
			{ heading: "導入", startSeconds: 0 },
			{ heading: "実装", startSeconds: 90 },
		]);
		expect(call && promptText(call)).toContain("[90s] 実装");
		expect(call?.responseFormat).toMatchObject({
			type: "json",
			schema: { required: expect.arrayContaining(["chapters"]) },
		});
	});

	it("regenerates a timestamped summary that omits chapters and finally fails", async () => {
		const model = scenarioModel();
		const source: LoadedSource = {
			kind: "youtube",
			text: "fixture:summary-full",
			segments: [{ text: "fixture:summary-full", startSeconds: 0 }],
		};

		const { events, error } = await collectUntilError(planSummary(source, mockEntry), {
			model,
			entry: mockEntry,
		});

		expect(error).toBeInstanceOf(SummaryValidationError);
		expect((error as SummaryValidationError).issues).toEqual([
			expect.stringMatching(/^chapters: /u),
		]);
		expect(events.some((event) => event.type === "final")).toBe(false);
	});
});

describe("streamSummary: validation and regeneration", () => {
	it("restarts once and then streams the regenerated summary", async () => {
		const model = createScenarioModel({ purpose: "structured", scenarios: [VALID_AFTER_FEEDBACK] });
		const plan = planSummary(transcript("fixture:summary-retry-once"), mockEntry);

		const events = await collect(plan, { model, entry: mockEntry });
		const restartIndex = events.findIndex((event) => event.type === "restart");
		const final = { ...baseSummary, title: "再生成した要約" };

		expect(events.filter((event) => event.type === "restart")).toEqual([
			{ type: "restart", attempt: 2, issues: [expect.stringMatching(/^keyPoints: /u)] },
		]);
		expect(events.slice(0, restartIndex).every((event) => event.type === "partial")).toBe(true);
		expect(events.slice(restartIndex + 1, -2).every((event) => event.type === "partial")).toBe(
			true,
		);
		expect(events.slice(restartIndex + 1).some((event) => event.type === "partial")).toBe(true);
		expect(events.at(-2)).toEqual({ type: "final", summary: final });
		expect(events.at(-1)).toMatchObject({ type: "meta", meta: { attempts: 2 } });
		expect(model.doStreamCalls).toHaveLength(2);
		const [first, second] = model.doStreamCalls.map(promptText);
		expect(first).not.toContain("前回の出力");
		expect(second).toContain("- keyPoints: ");
	});

	it("fails with SummaryValidationError after three invalid attempts (m1-3/validation-retry)", async () => {
		const model = scenarioModel();
		const plan = planSummary(transcript("fixture:summary-invalid"), mockEntry);

		const { events, error } = await collectUntilError(plan, { model, entry: mockEntry });

		expect(error).toBeInstanceOf(SummaryValidationError);
		expect(error).toMatchObject({ attempts: 3 });
		const { issuesByAttempt } = error as SummaryValidationError;
		expect(issuesByAttempt).toHaveLength(3);
		for (const issues of issuesByAttempt) {
			expect(issues).toEqual(
				expect.arrayContaining([
					expect.stringMatching(/^keyPoints: /u),
					expect.stringMatching(/^tags: /u),
					expect.stringMatching(/^actionItems: /u),
				]),
			);
		}
		expect(events.filter((event) => event.type === "restart").map((event) => event.type)).toEqual([
			"restart",
			"restart",
		]);
		expect(events.some((event) => event.type === "final" || event.type === "meta")).toBe(false);
		expect(model.doStreamCalls).toHaveLength(3);
	});

	it("reports output that is not JSON as a validation issue", async () => {
		const model = new MockLanguageModelV4({
			doStream: async () => ({
				stream: new ReadableStream({
					start(controller) {
						controller.enqueue({ type: "stream-start", warnings: [] });
						controller.enqueue({ type: "text-start", id: "t" });
						controller.enqueue({ type: "text-delta", id: "t", delta: "not json" });
						controller.enqueue({ type: "text-end", id: "t" });
						controller.enqueue({
							type: "finish",
							finishReason: { unified: "stop", raw: undefined },
							usage: {
								inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
								outputTokens: { total: 1, text: 1, reasoning: 0 },
							},
						});
						controller.close();
					},
				}),
			}),
		});

		const { error } = await collectUntilError(planSummary(transcript("x"), mockEntry), {
			model,
			entry: mockEntry,
		});

		expect(error).toBeInstanceOf(SummaryValidationError);
		expect((error as SummaryValidationError).issues).toEqual([
			"(root): 出力を JSON として解析できませんでした。",
		]);
	});

	it("propagates a provider failure without regenerating", async () => {
		const failure = new Error("provider down");
		const model = new MockLanguageModelV4({
			doStream: async () => {
				throw failure;
			},
		});

		const { error } = await collectUntilError(planSummary(transcript("x"), mockEntry), {
			model,
			entry: mockEntry,
		});

		expect(error).toBe(failure);
		expect(model.doStreamCalls).toHaveLength(1);
	});
});

describe("streamSummary: prompt cache", () => {
	it("marks the source for Anthropic and records the cache reads (m1-3/split-summary)", async () => {
		const model = scenarioModel();
		const plan = planSummary(transcript("fixture:summary-split"), anthropicEntry);

		const events = await collect(plan, { model, entry: anthropicEntry });
		const call = model.doStreamCalls[0];

		expect(call && sourcePartOptions(call)).toEqual({
			anthropic: { cacheControl: { type: "ephemeral" } },
		});
		expect(events.at(-1)).toMatchObject({
			type: "meta",
			meta: { cacheReadTokens: 200, actualInputTokens: 400 },
		});
	});

	it("only records the cache reads for an automatically caching provider", async () => {
		const model = scenarioModel();

		const events = await collect(planSummary(transcript("fixture:summary-split"), openaiEntry), {
			model,
			entry: openaiEntry,
		});

		expect(model.doStreamCalls[0] && sourcePartOptions(model.doStreamCalls[0])).toBeUndefined();
		expect(events.at(-1)).toMatchObject({ type: "meta", meta: { cacheReadTokens: 200 } });
	});

	it("does not report cache reads for a provider without prompt caching", async () => {
		const events = await collect(planSummary(transcript("fixture:summary-split"), mockEntry), {
			model: scenarioModel(),
			entry: mockEntry,
		});

		expect(events.at(-1)).toMatchObject({ type: "meta", meta: { cacheReadTokens: undefined } });
	});
});

describe("streamSummary: staged", () => {
	const line = "fixture:summary-split エージェントの評価と安全なツール利用について説明します。";
	const longText = Array.from({ length: 300 }, (_, index) => `${index} ${line}`).join("\n");
	const smallAnthropic: ModelEntry = { ...anthropicEntry, contextWindow: 8_000 };

	it("summarizes each chunk, then streams only the integrated summary", async () => {
		const model = scenarioModel();
		const plan = planSummary(transcript(longText), smallAnthropic);

		const events = await collect(plan, { model, entry: smallAnthropic });
		const partialTitles = events.flatMap((event) =>
			event.type === "partial" && event.summary.title ? [event.summary.title] : [],
		);
		const chunkCalls = model.doStreamCalls.slice(0, -1).map(promptText);
		const integrationCall = model.doStreamCalls.at(-1);

		expect(plan.strategy).toBe("staged");
		expect(plan.chunks.length).toBeGreaterThan(1);
		expect(model.doStreamCalls).toHaveLength(plan.chunks.length + 1);
		for (const [index, text] of chunkCalls.entries()) {
			expect(text).toContain(`${index + 1}/${plan.chunks.length}`);
		}
		expect(integrationCall && promptText(integrationCall)).toContain('"title":"分割要約"');
		expect(integrationCall && sourcePartOptions(integrationCall)).toEqual({
			anthropic: { cacheControl: { type: "ephemeral" } },
		});
		expect(partialTitles.length).toBeGreaterThan(0);
		expect(partialTitles.every((title) => "統合した要約".startsWith(title))).toBe(true);
		expect(events.at(-2)).toEqual({
			type: "final",
			summary: { ...baseSummary, title: "統合した要約" },
		});
		expect(events.at(-1)).toEqual({
			type: "meta",
			meta: {
				strategy: "staged",
				estimatedInputTokens: plan.estimatedInputTokens,
				actualInputTokens: 400 * plan.chunks.length + 300,
				chunks: plan.chunks.length,
				cacheReadTokens: 200 * plan.chunks.length + 50,
				attempts: 1,
			},
		});
	});

	it("applies the same regeneration rule to a chunk summary", async () => {
		const model = scenarioModel();
		const invalidText = Array.from(
			{ length: 300 },
			(_, index) =>
				`${index} fixture:summary-invalid ${line.replace("fixture:summary-split ", "")}`,
		).join("\n");
		const plan = planSummary(transcript(invalidText), smallAnthropic);

		const { events, error } = await collectUntilError(plan, { model, entry: smallAnthropic });

		expect(error).toBeInstanceOf(SummaryValidationError);
		expect(model.doStreamCalls).toHaveLength(3);
		expect(events).toEqual([]);
	});
});

describe("summarize and summarizeSource", () => {
	let fixtures: FixtureSet;

	beforeAll(async () => {
		fixtures = await loadFixtureSet();
	});

	it("summarize returns only the final summary and its meta", async () => {
		const plan = planSummary(transcript("fixture:summary-full"), mockEntry);

		const result = await summarize(plan, { model: scenarioModel(), entry: mockEntry });

		expect(result.summary).toEqual(baseSummary);
		expect(result.meta).toMatchObject({ strategy: "whole", attempts: 1 });
	});

	it("summarize rejects when no valid summary is produced", async () => {
		const plan = planSummary(transcript("fixture:summary-invalid"), mockEntry);

		await expect(
			summarize(plan, { model: scenarioModel(), entry: mockEntry }),
		).rejects.toBeInstanceOf(SummaryValidationError);
	});

	it.each([
		[{ kind: "article", url: "https://example.test/missing" }, SourceFetchError],
		[{ kind: "article", url: "https://example.test/blank" }, SourceFetchError],
		[{ kind: "youtube", url: "https://youtu.be/m1-no-captions" }, TranscriptUnavailableError],
		[{ kind: "youtube", url: "https://youtu.be/m1-private" }, TranscriptUnavailableError],
	] as const)(
		"never calls the model when the source fails: %o",
		async (input: SummaryInput, type) => {
			const model = scenarioModel();
			const http = createFixtureHttpFetcher([
				...fixtures.http,
				{ url: "https://example.test/missing", status: 404, headers: {}, body: "" },
				{
					url: "https://example.test/blank",
					status: 200,
					headers: { "content-type": "text/html" },
					body: "<html><body></body></html>",
				},
			]);
			const transcripts = createFixtureTranscriptSource(fixtures.transcripts);

			const events: SummaryEvent[] = [];
			const error = await (async () => {
				for await (const event of summarizeSource(input, {
					model,
					entry: mockEntry,
					http,
					transcripts,
				})) {
					events.push(event);
				}
			})().catch((caught: unknown) => caught);

			expect(error).toBeInstanceOf(type);
			expect(events).toEqual([]);
			expect(model.doStreamCalls).toHaveLength(0);
		},
	);

	it("summarizeSource loads the 13.6 article fixture and streams its summary", async () => {
		const model = createScenarioModel({
			purpose: "structured",
			scenarios: [
				defineScenario({
					id: "m1-3/test/article",
					turns: [
						{
							match: { purpose: "structured", lastUserTextIncludes: "結果を評価しながら" },
							respond: { object: baseSummary },
						},
					],
				}),
			],
		});

		const events: SummaryEvent[] = [];
		for await (const event of summarizeSource(
			{ kind: "article", url: "https://example.test/articles/agentic-ai" },
			{
				model,
				entry: mockEntry,
				http: createFixtureHttpFetcher(fixtures.http),
				transcripts: createFixtureTranscriptSource(fixtures.transcripts),
			},
		)) {
			events.push(event);
		}

		expect(events.at(-2)).toEqual({ type: "final", summary: baseSummary });
		expect(model.doStreamCalls[0] && promptText(model.doStreamCalls[0])).toContain(
			"タイトル: Agentic AI 入門",
		);
	});

	it("loadSource composes with the 13.6 YouTube fixture into a chaptered plan", async () => {
		const source = await loadSource(
			{ kind: "youtube", url: "https://youtu.be/m1-agentic-ai" },
			{
				http: createFixtureHttpFetcher(fixtures.http),
				transcripts: createFixtureTranscriptSource(fixtures.transcripts),
			},
		);

		expect(planSummary(source, mockEntry)).toMatchObject({
			strategy: "whole",
			withChapters: true,
			chunks: ["[0s] Agentic AI の基本を説明します。\n[90s] 次に安全なツール利用を実装します。"],
		});
	});
});
