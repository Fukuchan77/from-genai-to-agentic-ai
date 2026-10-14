import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { StructuredOutputError } from "../structured";
import { createObjectModel } from "../testing/mock-models";
import { classifyWithModel, route } from "./routing";

const CATEGORIES = ["billing", "technical", "general"] as const;

function handlers() {
	return {
		billing: vi.fn(async (input: unknown) => `billing:${String(input)}`),
		technical: vi.fn(async (input: unknown) => `technical:${String(input)}`),
		general: vi.fn(async (input: unknown) => `general:${String(input)}`),
	};
}

describe("route", () => {
	it("runs only the handler of the classified category and returns the category and reason", async () => {
		const h = handlers();
		const fallback = vi.fn(async () => "fallback");

		const result = await route({
			input: "invoice is wrong",
			categories: CATEGORIES,
			classify: async () => ({ category: "billing", reason: "請求に関する問い合わせ" }),
			handlers: h,
			fallback,
		});

		expect(result).toEqual({
			category: "billing",
			reason: "請求に関する問い合わせ",
			matched: true,
			output: "billing:invoice is wrong",
		});
		expect(h.technical).not.toHaveBeenCalled();
		expect(h.general).not.toHaveBeenCalled();
		expect(fallback).not.toHaveBeenCalled();
	});

	it("passes the input and the signal to classify and to the handler", async () => {
		const controller = new AbortController();
		const classify = vi.fn(async () => ({ category: "technical", reason: "r" }));
		const h = handlers();

		await route({
			input: "x",
			categories: CATEGORIES,
			classify,
			handlers: h,
			fallback: async () => "f",
			signal: controller.signal,
		});

		expect(classify).toHaveBeenCalledWith("x", controller.signal);
		expect(h.technical).toHaveBeenCalledWith("x", controller.signal);
	});

	it("runs the fallback with matched=false when the category is not predefined, and no handler", async () => {
		const h = handlers();
		const fallback = vi.fn(async (input: unknown) => `fallback:${String(input)}`);

		const result = await route({
			input: "weather?",
			categories: CATEGORIES,
			classify: async () => ({ category: "weather", reason: "どの分類にも当たらない" }),
			handlers: h,
			fallback,
		});

		expect(result).toEqual({
			category: "weather",
			reason: "どの分類にも当たらない",
			matched: false,
			output: "fallback:weather?",
		});
		expect(fallback).toHaveBeenCalledTimes(1);
		for (const handler of Object.values(h)) expect(handler).not.toHaveBeenCalled();
	});

	it("does not treat an inherited object key as a category", async () => {
		const h = handlers();
		const fallback = vi.fn(async () => "fallback");

		const result = await route({
			input: "x",
			categories: CATEGORIES,
			classify: async () => ({ category: "constructor", reason: "r" }),
			handlers: h,
			fallback,
		});

		expect(result.matched).toBe(false);
		expect(fallback).toHaveBeenCalledTimes(1);
	});

	it("falls back when the category is predefined but has no handler", async () => {
		const fallback = vi.fn(async () => "fallback");

		const result = await route({
			input: "x",
			categories: ["a", "b"],
			classify: async () => ({ category: "b", reason: "r" }),
			handlers: { a: async () => "a" } as unknown as Record<"a" | "b", () => Promise<unknown>>,
			fallback,
		});

		expect(result.matched).toBe(false);
		expect(fallback).toHaveBeenCalledTimes(1);
	});

	it("ignores a handler whose key is not a predefined category", async () => {
		const extra = vi.fn(async () => "extra");
		const fallback = vi.fn(async () => "fallback");

		const result = await route({
			input: "x",
			categories: ["a"],
			classify: async () => ({ category: "extra", reason: "r" }),
			handlers: { a: async () => "a", extra } as unknown as Record<"a", () => Promise<unknown>>,
			fallback,
		});

		expect(result.matched).toBe(false);
		expect(extra).not.toHaveBeenCalled();
	});

	it("does not call an inherited property when a predefined category has no own handler", async () => {
		const fallback = vi.fn(async () => "fallback");

		const result = await route({
			input: "x",
			categories: ["toString"],
			classify: async () => ({ category: "toString", reason: "r" }),
			handlers: {} as unknown as Record<"toString", () => Promise<unknown>>,
			fallback,
		});

		expect(result.matched).toBe(false);
		expect(fallback).toHaveBeenCalledTimes(1);
	});

	it("does not run a handler after an abort", async () => {
		const controller = new AbortController();
		const h = handlers();
		const reason = new Error("stopped");

		const run = route({
			input: "x",
			categories: CATEGORIES,
			classify: async () => {
				controller.abort(reason);
				return { category: "billing", reason: "r" };
			},
			handlers: h,
			fallback: async () => "f",
			signal: controller.signal,
		});

		await expect(run).rejects.toBe(reason);
		expect(h.billing).not.toHaveBeenCalled();
	});
});

describe("classifyWithModel", () => {
	it("returns the category and reason the model produced", async () => {
		const result = await classifyWithModel({
			model: createObjectModel({ category: "technical", reason: "エラーの相談" }),
			categories: CATEGORIES,
			input: "app crashes",
		});

		expect(result).toMatchObject({ category: "technical", reason: "エラーの相談" });
	});

	it("offers the categories in the prompt and wraps the input as data", async () => {
		const prompts: string[] = [];
		const userTexts: string[] = [];
		const model = new MockLanguageModelV4({
			doGenerate: async (options) => {
				prompts.push(JSON.stringify(options.prompt));
				userTexts.push(JSON.stringify(options.prompt.filter((message) => message.role === "user")));
				return {
					content: [{ type: "text", text: JSON.stringify({ category: "general", reason: "r" }) }],
					finishReason: { unified: "stop", raw: undefined },
					usage: {
						inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
						outputTokens: { total: 1, text: 1, reasoning: 0 },
					},
					warnings: [],
				};
			},
		});

		const result = await classifyWithModel({
			model,
			categories: CATEGORIES,
			input: "hello there",
		});

		expect(prompts[0]).toContain("billing");
		expect(prompts[0]).toContain("technical");
		expect(userTexts[0]).toContain("<input>");
		expect(userTexts[0]).toContain("hello there");
		expect(result.usage.totalTokens).toBe(2);
	});

	it("regenerates when the model answers with a category outside the list", async () => {
		const texts = [
			JSON.stringify({ category: "weather", reason: "r" }),
			JSON.stringify({ category: "billing", reason: "請求" }),
		];
		let call = 0;
		const model = new MockLanguageModelV4({
			doGenerate: async () => {
				const text = texts[Math.min(call, texts.length - 1)] ?? "";
				call += 1;
				return {
					content: [{ type: "text", text }],
					finishReason: { unified: "stop", raw: undefined },
					usage: {
						inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
						outputTokens: { total: 0, text: 0, reasoning: 0 },
					},
					warnings: [],
				};
			},
		});

		const result = await classifyWithModel({ model, categories: CATEGORIES, input: "x" });

		expect(result.category).toBe("billing");
		expect(call).toBe(2);
	});

	it("fails with output-invalid when the model never answers within the list", async () => {
		const error = await classifyWithModel({
			model: createObjectModel({ category: "weather", reason: "r" }),
			categories: CATEGORIES,
			input: "x",
		}).catch((thrown: unknown) => thrown);

		expect(error).toBeInstanceOf(StructuredOutputError);
	});

	it("requires a non-empty reason", async () => {
		const error = await classifyWithModel({
			model: createObjectModel({ category: "billing", reason: "" }),
			categories: CATEGORIES,
			input: "x",
		}).catch((thrown: unknown) => thrown);

		expect(error).toBeInstanceOf(StructuredOutputError);
	});
});
