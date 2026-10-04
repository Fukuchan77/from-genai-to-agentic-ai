import { generateText, streamText } from "ai";
import { describe, expect, it } from "vitest";
import type { LanguageModelV4CallOptions } from "./request-key";
import { defineScenario } from "./scenario";
import { createScenarioModel } from "./scenario-model";

const userPrompt = (text: string): LanguageModelV4CallOptions["prompt"] => [
	{ role: "user", content: [{ type: "text", text }] },
];

describe("createScenarioModel", () => {
	it("binds purpose and deterministically returns text for generate and stream", async () => {
		const model = createScenarioModel({
			purpose: "chat",
			scenarios: [
				defineScenario({
					id: "test/chat",
					turns: [
						{
							match: { purpose: "chat", lastUserTextIncludes: "Tokyo", stepIndex: 0 },
							respond: { text: "Sunny", chunkSize: 2 },
						},
					],
				}),
			],
		});

		await expect(
			generateText({ model, prompt: "Tokyo weather" }).then((result) => result.text),
		).resolves.toBe("Sunny");
		await expect(streamText({ model, prompt: "Tokyo weather" }).text).resolves.toBe("Sunny");
	});

	it("derives stepIndex and the trailing tool result name from the prompt", async () => {
		const model = createScenarioModel({
			purpose: "chat",
			scenarios: [
				defineScenario({
					id: "test/tool-result",
					turns: [
						{
							match: { purpose: "chat", stepIndex: 1, toolResultFor: "weather" },
							respond: { text: "Use an umbrella" },
						},
					],
				}),
			],
		});
		const prompt: LanguageModelV4CallOptions["prompt"] = [
			...userPrompt("Will it rain?"),
			{
				role: "assistant",
				content: [
					{
						type: "tool-call",
						toolCallId: "call-1",
						toolName: "weather",
						input: { city: "Tokyo" },
					},
				],
			},
			{
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: "call-1",
						toolName: "weather",
						output: { type: "json", value: { rain: true } },
					},
				],
			},
		];

		const result = await model.doGenerate({ prompt });
		expect(result.content).toContainEqual({ type: "text", text: "Use an umbrella" });
	});

	it("returns tool calls and structured objects", async () => {
		const toolModel = createScenarioModel({
			purpose: "chat",
			scenarios: [
				defineScenario({
					id: "test/tool-call",
					turns: [
						{
							match: { lastUserTextIncludes: "weather" },
							respond: { toolCalls: [{ toolName: "weather", input: { city: "Tokyo" } }] },
						},
					],
				}),
			],
		});
		const objectModel = createScenarioModel({
			purpose: "structured",
			scenarios: [
				defineScenario({
					id: "test/object",
					turns: [{ match: { purpose: "structured" }, respond: { object: { title: "Done" } } }],
				}),
			],
		});

		const toolResult = await toolModel.doGenerate({ prompt: userPrompt("weather") });
		expect(toolResult.content[0]).toMatchObject({ type: "tool-call", toolName: "weather" });
		const objectResult = await objectModel.doGenerate({ prompt: userPrompt("summarize") });
		expect(objectResult.content).toContainEqual({ type: "text", text: '{"title":"Done"}' });
	});
});
