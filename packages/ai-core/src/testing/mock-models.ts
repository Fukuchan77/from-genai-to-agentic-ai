import type { JSONValue } from "ai";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";

type GenerateResult = Awaited<ReturnType<MockLanguageModelV4["doGenerate"]>>;
type StreamResult = Awaited<ReturnType<MockLanguageModelV4["doStream"]>>;
type StreamPart = StreamResult["stream"] extends ReadableStream<infer Part> ? Part : never;
type FinishReason = GenerateResult["finishReason"];
type Usage = GenerateResult["usage"];

const EMPTY_USAGE: Usage = {
	inputTokens: {
		total: 0,
		noCache: 0,
		cacheRead: 0,
		cacheWrite: 0,
	},
	outputTokens: {
		total: 0,
		text: 0,
		reasoning: 0,
	},
};

function finishReason(unified: FinishReason["unified"]): FinishReason {
	return { unified, raw: undefined };
}

function createStream(parts: StreamPart[]): StreamResult {
	return {
		stream: simulateReadableStream({
			chunks: parts,
			initialDelayInMs: null,
			chunkDelayInMs: null,
		}),
	};
}

/** Creates a deterministic model that returns the same text for generate and stream calls. */
export function createTextStreamModel(text: string): MockLanguageModelV4 {
	return new MockLanguageModelV4({
		doGenerate: {
			content: [{ type: "text", text }],
			finishReason: finishReason("stop"),
			usage: EMPTY_USAGE,
			warnings: [],
		},
		doStream: createStream([
			{ type: "stream-start", warnings: [] },
			{ type: "text-start", id: "text-1" },
			{ type: "text-delta", id: "text-1", delta: text },
			{ type: "text-end", id: "text-1" },
			{ type: "finish", finishReason: finishReason("stop"), usage: EMPTY_USAGE },
		]),
	});
}

export interface MockToolCall {
	toolCallId: string;
	toolName: string;
	input: JSONValue;
}

/** Creates a deterministic model that returns one tool call for generate and stream calls. */
export function createToolCallingModel(toolCall: MockToolCall): MockLanguageModelV4 {
	const content = {
		type: "tool-call" as const,
		toolCallId: toolCall.toolCallId,
		toolName: toolCall.toolName,
		input: JSON.stringify(toolCall.input),
	};
	return new MockLanguageModelV4({
		doGenerate: {
			content: [content],
			finishReason: finishReason("tool-calls"),
			usage: EMPTY_USAGE,
			warnings: [],
		},
		doStream: createStream([
			{ type: "stream-start", warnings: [] },
			content,
			{ type: "finish", finishReason: finishReason("tool-calls"), usage: EMPTY_USAGE },
		]),
	});
}

/** Creates a deterministic structured-output model backed by JSON text. */
export function createObjectModel(value: JSONValue): MockLanguageModelV4 {
	return createTextStreamModel(JSON.stringify(value));
}
