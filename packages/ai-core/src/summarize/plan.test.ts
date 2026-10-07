import { countTokens } from "gpt-tokenizer";
import { describe, expect, it } from "vitest";
import { PlatformError } from "../errors";
import { defaultModelFor, getModelEntry } from "../models/catalog";
import type { ModelEntry } from "../models/types";
import {
	CONTEXT_USAGE_RATIO,
	chunkBudgetTokens,
	contextBudgetTokens,
	formatSourceText,
	OUTPUT_RESERVE_TOKENS,
	planSummary,
	wholeOverheadTokens,
} from "./plan";
import type { LoadedSource } from "./source";
import { estimateTokens, TOKEN_SAFETY_FACTOR } from "./tokens";

const mockEntry = getModelEntry(defaultModelFor("mock", "mock", "structured"));

function entryWithContext(contextWindow: number): ModelEntry {
	return { ...mockEntry, contextWindow };
}

const paragraph = "エージェントは目標に向けてツールを使い、結果を評価しながら処理を進めます。";
const longText = Array.from({ length: 400 }, (_, index) => `${index}: ${paragraph}`).join("\n");

describe("estimateTokens", () => {
	it("applies the 1.2 safety factor to the gpt-tokenizer count and rounds up", () => {
		expect(TOKEN_SAFETY_FACTOR).toBe(1.2);
		expect(countTokens("hello world")).toBe(2);
		expect(estimateTokens("hello world")).toBe(3);
		expect(estimateTokens(paragraph)).toBe(Math.ceil(countTokens(paragraph) * 1.2));
		expect(estimateTokens("")).toBe(0);
	});
});

describe("contextBudgetTokens", () => {
	it("is 80% of the context window minus the 4,096-token output reserve", () => {
		expect(CONTEXT_USAGE_RATIO).toBe(0.8);
		expect(OUTPUT_RESERVE_TOKENS).toBe(4_096);
		expect(contextBudgetTokens(entryWithContext(10_000))).toBe(8_000 - 4_096);
		expect(contextBudgetTokens(entryWithContext(10_001))).toBe(8_000 - 4_096);
		expect(contextBudgetTokens(entryWithContext(10_002))).toBe(8_001 - 4_096);
	});
});

describe("planSummary", () => {
	it("summarizes a short transcript whole, recording the estimate it decided on", () => {
		const source: LoadedSource = { kind: "transcript", text: paragraph };

		expect(planSummary(source, mockEntry)).toEqual({
			strategy: "whole",
			estimatedInputTokens: estimateTokens(paragraph),
			chunks: [paragraph],
			withChapters: false,
		});
	});

	it("switches from whole to staged exactly at the 80% boundary", () => {
		const source: LoadedSource = { kind: "article", text: longText, title: "長い記事" };
		const needed = estimateTokens(longText) + wholeOverheadTokens(source);
		let contextWindow = 1;
		while (contextBudgetTokens(entryWithContext(contextWindow)) < needed) contextWindow += 1;

		const atBoundary = planSummary(source, entryWithContext(contextWindow));
		const overBoundary = planSummary(source, entryWithContext(contextWindow - 1));

		expect(contextBudgetTokens(entryWithContext(contextWindow))).toBe(needed);
		expect(atBoundary.strategy).toBe("whole");
		expect(atBoundary.chunks).toEqual([longText]);
		expect(overBoundary.strategy).toBe("staged");
		expect(overBoundary.estimatedInputTokens).toBe(estimateTokens(longText));
		expect(overBoundary.title).toBe("長い記事");
	});

	it("splits on line boundaries into chunks that each fit the chunk budget", () => {
		const source: LoadedSource = { kind: "transcript", text: longText };
		const entry = entryWithContext(8_000);

		const plan = planSummary(source, entry);
		const budget = chunkBudgetTokens(source, entry);

		expect(plan.strategy).toBe("staged");
		expect(plan.chunks.length).toBeGreaterThan(1);
		expect(plan.chunks.join("\n")).toBe(longText);
		for (const chunk of plan.chunks) {
			expect(estimateTokens(chunk)).toBeLessThanOrEqual(budget);
			expect(chunk).toMatch(/^\d+: /u);
		}
		// Greedy packing: no more chunks than the estimate needs, plus one for line granularity.
		expect(plan.chunks.length).toBeLessThanOrEqual(
			Math.ceil(estimateTokens(longText) / budget) + 1,
		);
	});

	it("hard-splits a single line that is longer than the chunk budget", () => {
		const line = paragraph.repeat(300);
		const source: LoadedSource = { kind: "transcript", text: `前\n${line}\n後` };
		const entry = entryWithContext(8_000);

		const plan = planSummary(source, entry);
		const budget = chunkBudgetTokens(source, entry);

		expect(plan.strategy).toBe("staged");
		expect(plan.chunks.length).toBeGreaterThan(2);
		expect(plan.chunks.every((chunk) => estimateTokens(chunk) <= budget)).toBe(true);
		expect(plan.chunks[0]).toBe("前");
		expect(plan.chunks.at(-1)).toBe("後");
		expect(plan.chunks.slice(1, -1).join("")).toBe(line);
	});

	it("prefixes YouTube segments with their start seconds and asks for chapters", () => {
		const source: LoadedSource = {
			kind: "youtube",
			title: "動画",
			text: "導入です。\n実装です。",
			segments: [
				{ text: "導入です。", startSeconds: 0 },
				{ text: "実装です。", startSeconds: 90.7 },
			],
		};

		const plan = planSummary(source, mockEntry);

		expect(formatSourceText(source)).toBe("[0s] 導入です。\n[90s] 実装です。");
		expect(plan).toEqual({
			strategy: "whole",
			estimatedInputTokens: estimateTokens("[0s] 導入です。\n[90s] 実装です。"),
			chunks: ["[0s] 導入です。\n[90s] 実装です。"],
			withChapters: true,
			title: "動画",
		});
	});

	it("counts the chapter instruction and title in the prompt overhead", () => {
		const plain: LoadedSource = { kind: "transcript", text: "x" };
		const titled: LoadedSource = { ...plain, title: "タイトル" };
		const timestamped: LoadedSource = {
			kind: "youtube",
			text: "x",
			segments: [{ text: "x", startSeconds: 0 }],
		};

		expect(wholeOverheadTokens(titled)).toBeGreaterThan(wholeOverheadTokens(plain));
		expect(wholeOverheadTokens(timestamped)).toBeGreaterThan(wholeOverheadTokens(plain));
	});

	it("refuses a model whose context window leaves no room for a chunk", () => {
		const source: LoadedSource = { kind: "transcript", text: longText };
		const entry = entryWithContext(5_000);

		const error = (() => {
			try {
				planSummary(source, entry);
			} catch (caught) {
				return caught;
			}
			return undefined;
		})();

		expect(error).toBeInstanceOf(PlatformError);
		expect(error).toMatchObject({
			code: "capability-unsupported",
			details: { modelId: mockEntry.id, contextWindow: 5_000 },
		});
	});
});
