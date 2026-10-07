import type { AgentRunSummary } from "@platform/ai-core/agents";
import type { LanguageModelUsage } from "ai";
import { describe, expect, it } from "vitest";
import type { DisabledTool } from "../aci/types";
import { listModels } from "../models/catalog";
import type { ModelEntry } from "../models/types";
import { buildResponseMetadata } from "./metadata";
import { getPersona, PERSONA_IDS } from "./personas";

function usage(overrides: {
	input?: number | undefined;
	output?: number | undefined;
	cacheRead?: number | undefined;
	reasoning?: number | undefined;
}): LanguageModelUsage {
	const input = overrides.input;
	const output = overrides.output;
	return {
		inputTokens: input,
		inputTokenDetails: {
			noCacheTokens: undefined,
			cacheReadTokens: overrides.cacheRead,
			cacheWriteTokens: undefined,
		},
		outputTokens: output,
		outputTokenDetails: { textTokens: undefined, reasoningTokens: overrides.reasoning },
		totalTokens: input === undefined || output === undefined ? undefined : input + output,
	};
}

const run: AgentRunSummary = Object.freeze({
	stopReason: "completed",
	steps: 2,
	totalTokens: { input: 30, output: 12, cacheRead: 0, reasoning: 0 },
	elapsedMs: 1_500,
	toolsCalled: Object.freeze(["calculator", "calculator"]),
	error: undefined,
});

// Read every value from the catalog and the personas: no model ID literal outside catalog.ts.
const mockEntry: ModelEntry = listModels({ mode: "mock", capability: "tools" })[0] as ModelEntry;
const liveEntry: ModelEntry = listModels({
	mode: "live",
	capability: "reasoning",
})[0] as ModelEntry;
const persona = getPersona(PERSONA_IDS[0] as string);

describe("buildResponseMetadata", () => {
	it("copies the model identity and the persona version from trusted sources", () => {
		const metadata = buildResponseMetadata({
			entry: liveEntry,
			persona,
			usage: usage({ input: 10, output: 5 }),
		});

		expect(metadata).toMatchObject({
			modelId: liveEntry.id,
			modelName: liveEntry.displayName,
			provider: liveEntry.provider,
			personaId: persona.id,
			personaVersion: persona.version,
		});
	});

	it("maps the AI SDK usage, including cache reads and reasoning tokens", () => {
		const metadata = buildResponseMetadata({
			entry: liveEntry,
			persona,
			usage: usage({ input: 1_200, output: 340, cacheRead: 1_000, reasoning: 120 }),
		});

		expect(metadata.usage).toEqual({
			inputTokens: 1_200,
			outputTokens: 340,
			cacheReadTokens: 1_000,
			reasoningTokens: 120,
		});
	});

	it("omits the optional token details the provider did not report", () => {
		const metadata = buildResponseMetadata({
			entry: mockEntry,
			persona,
			usage: usage({ input: 7, output: 3 }),
		});

		expect(metadata.usage).toEqual({ inputTokens: 7, outputTokens: 3 });
		expect(metadata.usage).not.toHaveProperty("cacheReadTokens");
		expect(metadata.usage).not.toHaveProperty("reasoningTokens");
	});

	it("keeps a reported zero instead of dropping it", () => {
		const metadata = buildResponseMetadata({
			entry: mockEntry,
			persona,
			usage: usage({ input: 7, output: 3, cacheRead: 0, reasoning: 0 }),
		});

		expect(metadata.usage).toEqual({
			inputTokens: 7,
			outputTokens: 3,
			cacheReadTokens: 0,
			reasoningTokens: 0,
		});
	});

	it("counts unreported input and output totals as zero", () => {
		const metadata = buildResponseMetadata({ entry: mockEntry, persona, usage: usage({}) });

		expect(metadata.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
	});

	it("leaves usage out for the stream's start chunk, before any usage exists", () => {
		const metadata = buildResponseMetadata({ entry: mockEntry, persona });

		expect(metadata).not.toHaveProperty("usage");
		expect(metadata.modelName).toBe(mockEntry.displayName);
	});

	describe("without a run (POST /api/chat)", () => {
		it("has no run and no toolsCalled", () => {
			const metadata = buildResponseMetadata({
				entry: mockEntry,
				persona,
				usage: usage({ input: 1, output: 1 }),
			});

			expect(metadata).not.toHaveProperty("run");
			expect(metadata).not.toHaveProperty("toolsCalled");
			expect(metadata.disabledTools).toEqual([]);
		});

		it("reports explicit toolsCalled as given", () => {
			const metadata = buildResponseMetadata({
				entry: mockEntry,
				persona,
				usage: usage({ input: 1, output: 1 }),
				toolsCalled: ["currentTime"],
			});

			expect(metadata.toolsCalled).toEqual(["currentTime"]);
			expect(metadata).not.toHaveProperty("run");
		});
	});

	describe("with a run (POST /api/agent/tools)", () => {
		it("carries the run and reports its tools in call order, duplicates included", () => {
			const metadata = buildResponseMetadata({
				entry: mockEntry,
				persona,
				usage: usage({ input: 30, output: 12 }),
				run,
			});

			expect(metadata.run).toBe(run);
			expect(metadata.toolsCalled).toEqual(["calculator", "calculator"]);
		});

		it("reports an empty tool list when the agent answered from its own knowledge (Req 5.6)", () => {
			const noTools: AgentRunSummary = { ...run, steps: 1, toolsCalled: [] };

			const metadata = buildResponseMetadata({ entry: mockEntry, persona, run: noTools });

			expect(metadata.toolsCalled).toEqual([]);
		});

		it("prefers explicit toolsCalled over the run's list", () => {
			const metadata = buildResponseMetadata({
				entry: mockEntry,
				persona,
				run,
				toolsCalled: ["weather"],
			});

			expect(metadata.toolsCalled).toEqual(["weather"]);
		});

		it("lists the tools that were not registered (Req 5.4)", () => {
			const disabled: readonly DisabledTool[] = [
				{
					name: "webSearch",
					reason: "Web 検索の API キーが未設定です。",
					requiredEnv: ["TAVILY_API_KEY"],
				},
			];

			const metadata = buildResponseMetadata({
				entry: mockEntry,
				persona,
				run,
				disabledTools: disabled,
			});

			expect(metadata.disabledTools).toEqual(disabled);
		});
	});

	it("returns a JSON-serialisable value that survives the UI stream round trip", () => {
		const metadata = buildResponseMetadata({
			entry: liveEntry,
			persona,
			usage: usage({ input: 4, output: 2, cacheRead: 1 }),
			run,
		});

		// toEqual ignores `run.error: undefined`, which JSON drops.
		expect(JSON.parse(JSON.stringify(metadata))).toEqual(metadata);
		expect(Object.isFrozen(metadata)).toBe(true);
	});
});
