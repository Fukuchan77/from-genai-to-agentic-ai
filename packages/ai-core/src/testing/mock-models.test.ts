import { describe, expect, it } from "vitest";
import { createObjectModel, createTextStreamModel, createToolCallingModel } from "./mock-models";

async function readStream(model: ReturnType<typeof createTextStreamModel>) {
	const result = await model.doStream({} as Parameters<typeof model.doStream>[0]);
	const parts: unknown[] = [];
	for await (const part of result.stream) parts.push(part);
	return parts;
}

describe("mock model factories", () => {
	it("returns the configured text for generation and streaming", async () => {
		const model = createTextStreamModel("hello world");

		await expect(
			model.doGenerate({} as Parameters<typeof model.doGenerate>[0]),
		).resolves.toMatchObject({
			content: [{ type: "text", text: "hello world" }],
			finishReason: { unified: "stop" },
		});
		await expect(readStream(model)).resolves.toEqual(
			expect.arrayContaining([
				{ type: "text-delta", id: "text-1", delta: "hello world" },
				{
					type: "finish",
					finishReason: { unified: "stop", raw: undefined },
					usage: expect.any(Object),
				},
			]),
		);
	});

	it("returns the configured tool call for generation and streaming", async () => {
		const toolCall = {
			toolCallId: "call-1",
			toolName: "getWeather",
			input: { city: "Tokyo" },
		};
		const model = createToolCallingModel(toolCall);

		await expect(
			model.doGenerate({} as Parameters<typeof model.doGenerate>[0]),
		).resolves.toMatchObject({
			content: [{ type: "tool-call", ...toolCall, input: JSON.stringify(toolCall.input) }],
			finishReason: { unified: "tool-calls" },
		});
		const result = await model.doStream({} as Parameters<typeof model.doStream>[0]);
		const parts: unknown[] = [];
		for await (const part of result.stream) parts.push(part);
		expect(parts).toEqual(
			expect.arrayContaining([
				{ type: "tool-call", ...toolCall, input: JSON.stringify(toolCall.input) },
				{
					type: "finish",
					finishReason: { unified: "tool-calls", raw: undefined },
					usage: expect.any(Object),
				},
			]),
		);
	});

	it("serializes the configured object for generation and streaming", async () => {
		const value = { title: "Agentic AI", chapters: [1, 2] };
		const model = createObjectModel(value);
		const serialized = JSON.stringify(value);

		await expect(
			model.doGenerate({} as Parameters<typeof model.doGenerate>[0]),
		).resolves.toMatchObject({
			content: [{ type: "text", text: serialized }],
			finishReason: { unified: "stop" },
		});
		await expect(readStream(model)).resolves.toEqual(
			expect.arrayContaining([{ type: "text-delta", id: "text-1", delta: serialized }]),
		);
	});
});
