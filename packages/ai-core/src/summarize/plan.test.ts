import { countTokens } from "gpt-tokenizer";
import { describe, expect, it, vi } from "vitest";
import { PlatformError } from "../errors";
import { defaultModelFor, getModelEntry } from "../models/catalog";
import type { ModelEntry } from "../models/types";
import {
	CONTEXT_USAGE_RATIO,
	chunkBudgetTokens,
	contextBudgetTokens,
	fittingEnd,
	formatSourceText,
	integrationGroups,
	integrationTokens,
	MIN_CHUNK_TOKENS,
	OUTPUT_RESERVE_TOKENS,
	planSummary,
	wholeOverheadTokens,
} from "./plan";
import { buildIntegrationPrompt } from "./prompts";
import type { Summary } from "./schema";
import type { LoadedSource } from "./source";
import { estimateTokens, TOKEN_SAFETY_FACTOR } from "./tokens";

// Counts the text the planner tokenizes, to pin the cost of splitting (W3 review M6).
const tokenized = vi.hoisted(() => ({ characters: 0 }));
vi.mock("./tokens", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./tokens")>();
	return {
		...actual,
		estimateTokens: (text: string) => {
			tokenized.characters += text.length;
			return actual.estimateTokens(text);
		},
	};
});

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

	it("stages at exactly MIN_CHUNK_TOKENS per chunk and refuses one token below", () => {
		const source: LoadedSource = { kind: "transcript", text: longText };
		const entryWithChunkBudget = (tokens: number) => {
			let contextWindow = 1;
			while (chunkBudgetTokens(source, entryWithContext(contextWindow)) < tokens)
				contextWindow += 1;
			const entry = entryWithContext(contextWindow);
			expect(chunkBudgetTokens(source, entry)).toBe(tokens);
			return entry;
		};

		const atMinimum = planSummary(source, entryWithChunkBudget(MIN_CHUNK_TOKENS));

		expect(atMinimum.strategy).toBe("staged");
		expect(atMinimum.chunks.every((chunk) => estimateTokens(chunk) <= MIN_CHUNK_TOKENS)).toBe(true);
		expect(() => planSummary(source, entryWithChunkBudget(MIN_CHUNK_TOKENS - 1))).toThrow(
			expect.objectContaining({ code: "capability-unsupported" }),
		);
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

describe("fittingEnd", () => {
	function estimateOf(characters: readonly string[], start: number, end: number): number {
		return estimateTokens(characters.slice(start, end).join(""));
	}

	const samples = {
		japanese: paragraph.repeat(12),
		english: "Agents use tools, evaluate the results and continue. ".repeat(12),
		spaces: `${"a".repeat(7)}${" ".repeat(40)}`.repeat(12),
		mixed: `${paragraph}x${"0123456789".repeat(5)} tail ${"あ".repeat(30)}`.repeat(4),
		emoji: "🙂👍🏽 絵文字 ".repeat(40),
	};

	// Token counts are not monotonic in length ("Age" can cost more than "Agents"), so the contract
	// is a prefix that fits and cannot be extended by one character, as with the former bisection.
	it.each(Object.entries(samples))(
		"returns a fitting prefix that one more character would overflow for %s text",
		(_name, text) => {
			const characters = Array.from(text);
			for (const budget of [1, 2, 3, 7, 20, 55, 130]) {
				for (const start of [0, 1, 17]) {
					const end = fittingEnd(characters, start, budget);
					const label = `budget ${budget}, start ${start}, end ${end}`;
					expect(end, label).toBeGreaterThan(start);
					if (end > start + 1) {
						expect(estimateOf(characters, start, end), label).toBeLessThanOrEqual(budget);
					}
					if (end < characters.length) {
						expect(estimateOf(characters, start, end + 1), label).toBeGreaterThan(budget);
					}
				}
			}
		},
	);

	it("returns the end of the line when the rest fits", () => {
		const characters = Array.from("短い");
		expect(fittingEnd(characters, 0, 1_000)).toBe(2);
		expect(fittingEnd(characters, 1, 1_000)).toBe(2);
	});

	it("takes at least one character even when it alone exceeds the budget", () => {
		expect(fittingEnd(Array.from("🙂🙂"), 0, 1)).toBe(1);
	});

	it("tokenizes text in proportion to the line, not quadratically", () => {
		const line = "word ".repeat(40_000);
		const source: LoadedSource = { kind: "transcript", text: line };
		const entry = entryWithContext(8_000);
		tokenized.characters = 0;

		const plan = planSummary(source, entry);

		expect(plan.chunks.length).toBeGreaterThan(10);
		expect(plan.chunks.join("")).toBe(line);
		// Bisection over the rest of the line tokenized about 30 times the line here.
		expect(tokenized.characters).toBeLessThan(line.length * 8);
	});
});

describe("integrationGroups", () => {
	const partial: Summary = {
		title: "部分要約",
		keyPoints: ["要点その一です。", "要点その二です。", "要点その三です。"],
		tags: ["AI", "評価"],
		actionItems: ["試してみる"],
	};
	const options = { withChapters: false, title: "長い記事" };
	const partials = Array.from({ length: 5 }, (_, index) => ({ ...partial, title: `部分${index}` }));

	// The smallest context window whose budget holds `tokens`; asserts the budget is exactly that.
	function entryWithBudget(tokens: number): ModelEntry {
		let contextWindow = 1;
		while (contextBudgetTokens(entryWithContext(contextWindow)) < tokens) contextWindow += 1;
		const entry = entryWithContext(contextWindow);
		expect(contextBudgetTokens(entry)).toBe(tokens);
		return entry;
	}

	it("estimates the integration prompt at or slightly above its real size", () => {
		const prompt = buildIntegrationPrompt(
			{ partials, ...options },
			{
				cachePolicy: { mode: "none", recordsCacheReads: false },
			},
		);
		const text = [
			prompt.instructions,
			...prompt.messages.flatMap((message) =>
				typeof message.content === "string"
					? [message.content]
					: message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])),
			),
		].join("\n");
		const actual = estimateTokens(text);

		const estimate = integrationTokens(partials, options);

		// Summing per-line counts errs on the safe side: never below the real prompt, within 5%.
		expect(estimate).toBeGreaterThanOrEqual(actual);
		expect(estimate).toBeLessThanOrEqual(Math.ceil(actual * 1.05));
		expect(integrationTokens(partials.slice(0, 2), options)).toBeGreaterThan(
			integrationTokens(partials.slice(0, 1), options),
		);
	});

	it("keeps every partial in one group when they all fit", () => {
		const entry = entryWithBudget(integrationTokens(partials, options));

		expect(integrationGroups(partials, options, entry)).toEqual([partials]);
	});

	it("groups the partials so each group's integration prompt fits the budget", () => {
		const entry = entryWithBudget(integrationTokens(partials.slice(0, 2), options));

		const groups = integrationGroups(partials, options, entry);

		expect(groups).toEqual([partials.slice(0, 2), partials.slice(2, 4), partials.slice(4)]);
		for (const group of groups) {
			expect(integrationTokens(group, options)).toBeLessThanOrEqual(contextBudgetTokens(entry));
		}
	});

	it("refuses with capability-unsupported when no group can hold two partials", () => {
		const entry = entryWithBudget(integrationTokens(partials.slice(0, 2), options) - 1);

		expect(() => integrationGroups(partials, options, entry)).toThrow(
			expect.objectContaining({ code: "capability-unsupported" }),
		);
	});

	it("refuses with capability-unsupported when a single partial does not fit", () => {
		const entry = entryWithBudget(integrationTokens(partials.slice(0, 1), options) - 1);

		expect(() => integrationGroups(partials.slice(0, 1), options, entry)).toThrow(
			expect.objectContaining({ code: "capability-unsupported" }),
		);
	});

	it("accepts a single partial that fits exactly", () => {
		const entry = entryWithBudget(integrationTokens(partials.slice(0, 1), options));

		expect(integrationGroups(partials.slice(0, 1), options, entry)).toEqual([partials.slice(0, 1)]);
	});
});
