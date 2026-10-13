import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { StructuredOutputError } from "../structured";
import { createObjectModel } from "../testing/mock-models";
import { optimizePromptOrResponse } from "./prompt-optimizer";

function recording(texts: readonly string[]) {
	const systems: string[] = [];
	const prompts: string[] = [];
	let call = 0;
	const model = new MockLanguageModelV4({
		doGenerate: async (options) => {
			const system = options.prompt.find((message) => message.role === "system");
			systems.push(typeof system?.content === "string" ? system.content : "");
			prompts.push(JSON.stringify(options.prompt));
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
	return { model, systems, prompts, calls: () => call };
}

const REPLY = JSON.stringify({
	improved: "改善後の文章",
	reasons: ["具体的にした", "出力形式を指定した"],
});

describe("optimizePromptOrResponse", () => {
	it("returns the original, the improved text and the reasons", async () => {
		const result = await optimizePromptOrResponse({
			model: createObjectModel({ improved: "改善後", reasons: ["理由 1"] }),
			target: "prompt",
			original: "要約して",
			goal: "社内報告向け",
		});

		expect(result).toEqual({ original: "要約して", improved: "改善後", reasons: ["理由 1"] });
	});

	it("returns the original as given, not as the model repeats it", async () => {
		const result = await optimizePromptOrResponse({
			model: createObjectModel({ improved: "x", reasons: ["r"], original: "tampered" }),
			target: "response",
			original: "ORIGINAL",
			goal: "g",
		});

		expect(result.original).toBe("ORIGINAL");
	});

	it("instructs differently for a prompt and for a response", async () => {
		const forPrompt = recording([REPLY]);
		const forResponse = recording([REPLY]);

		await optimizePromptOrResponse({
			model: forPrompt.model,
			target: "prompt",
			original: "o",
			goal: "g",
		});
		await optimizePromptOrResponse({
			model: forResponse.model,
			target: "response",
			original: "o",
			goal: "g",
		});

		expect(forPrompt.systems[0]).toContain("プロンプト");
		expect(forResponse.systems[0]).toContain("回答");
		expect(forPrompt.systems[0]).not.toBe(forResponse.systems[0]);
	});

	it("puts the original and the goal into the prompt", async () => {
		const { model, prompts } = recording([REPLY]);

		await optimizePromptOrResponse({
			model,
			target: "prompt",
			original: "ORIG-TEXT",
			goal: "GOAL-TEXT",
		});

		expect(prompts[0]).toContain("ORIG-TEXT");
		expect(prompts[0]).toContain("GOAL-TEXT");
	});

	it("regenerates when no reason is given", async () => {
		const { model, calls } = recording([JSON.stringify({ improved: "x", reasons: [] }), REPLY]);

		const result = await optimizePromptOrResponse({
			model,
			target: "prompt",
			original: "o",
			goal: "g",
		});

		expect(calls()).toBe(2);
		expect(result.reasons).toHaveLength(2);
	});

	it("fails with output-invalid when the improved text stays empty", async () => {
		const error = await optimizePromptOrResponse({
			model: createObjectModel({ improved: "", reasons: ["r"] }),
			target: "prompt",
			original: "o",
			goal: "g",
		}).catch((thrown: unknown) => thrown);

		expect(error).toBeInstanceOf(StructuredOutputError);
	});

	it("hands the signal to the model call", async () => {
		const controller = new AbortController();
		const seen: (AbortSignal | undefined)[] = [];
		const model = new MockLanguageModelV4({
			doGenerate: async (options) => {
				seen.push(options.abortSignal);
				return {
					content: [{ type: "text", text: REPLY }],
					finishReason: { unified: "stop", raw: undefined },
					usage: {
						inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
						outputTokens: { total: 0, text: 0, reasoning: 0 },
					},
					warnings: [],
				};
			},
		});

		await optimizePromptOrResponse({
			model,
			target: "prompt",
			original: "o",
			goal: "g",
			signal: controller.signal,
		});
		controller.abort();

		expect(seen[0]?.aborted).toBe(true);
	});
});
