import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import type { ModelPurpose } from "../models/types";
import type { CassetteStore } from "./cassette-store";
import { type ResolvedMockResponse, resolveMockResponse } from "./resolve";
import type { ScenarioDefinition, ScenarioResponse } from "./scenario";

type GenerateResult = Awaited<ReturnType<MockLanguageModelV4["doGenerate"]>>;
type LanguageModelStreamPart =
	Awaited<ReturnType<MockLanguageModelV4["doStream"]>>["stream"] extends ReadableStream<infer Part>
		? Part
		: never;
type Usage = GenerateResult["usage"];
type FinishReason = GenerateResult["finishReason"];

const ZERO_USAGE: Usage = {
	inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
	outputTokens: { total: 0, text: 0, reasoning: 0 },
};

function usageFor(response: ScenarioResponse): Usage {
	return {
		inputTokens: {
			total: response.usage?.inputTokens ?? 0,
			noCache: response.usage?.inputTokens ?? 0,
			cacheRead: response.usage?.cacheReadTokens ?? 0,
			cacheWrite: 0,
		},
		outputTokens: {
			total: response.usage?.outputTokens ?? 0,
			text: response.usage?.outputTokens ?? 0,
			reasoning: response.usage?.reasoningTokens ?? 0,
		},
	};
}

function finishReason(unified: FinishReason["unified"]): FinishReason {
	return { unified, raw: undefined };
}

function responseText(response: ScenarioResponse): string | undefined {
	if (response.text !== undefined) return response.text;
	if (response.object !== undefined) return JSON.stringify(response.object);
	return undefined;
}

function responseParts(response: ScenarioResponse, idPrefix: string): LanguageModelStreamPart[] {
	const parts: LanguageModelStreamPart[] = [{ type: "stream-start", warnings: [] }];
	if (response.reasoning !== undefined) {
		parts.push(
			{ type: "reasoning-start", id: `${idPrefix}-reasoning` },
			{ type: "reasoning-delta", id: `${idPrefix}-reasoning`, delta: response.reasoning },
			{ type: "reasoning-end", id: `${idPrefix}-reasoning` },
		);
	}
	const text = responseText(response);
	if (text !== undefined) {
		const id = `${idPrefix}-text`;
		const size = Math.max(1, response.chunkSize ?? (text.length || 1));
		parts.push({ type: "text-start", id });
		for (let offset = 0; offset < text.length; offset += size) {
			parts.push({ type: "text-delta", id, delta: text.slice(offset, offset + size) });
		}
		parts.push({ type: "text-end", id });
	}
	for (const [index, toolCall] of (response.toolCalls ?? []).entries()) {
		parts.push({
			type: "tool-call",
			toolCallId: `${idPrefix}-tool-${index}`,
			toolName: toolCall.toolName,
			input: JSON.stringify(toolCall.input),
		});
	}
	parts.push({
		type: "finish",
		finishReason: finishReason(response.toolCalls?.length ? "tool-calls" : "stop"),
		usage: usageFor(response),
	});
	return parts;
}

function generateFromParts(parts: readonly LanguageModelStreamPart[]): GenerateResult {
	const content: GenerateResult["content"] = [];
	const texts = new Map<string, string>();
	const reasoning = new Map<string, string>();
	let usage = ZERO_USAGE;
	let reason = finishReason("stop");
	for (const part of parts) {
		if (part.type === "text-delta") texts.set(part.id, `${texts.get(part.id) ?? ""}${part.delta}`);
		if (part.type === "reasoning-delta") {
			reasoning.set(part.id, `${reasoning.get(part.id) ?? ""}${part.delta}`);
		}
		if (part.type === "tool-call") content.push(part);
		if (part.type === "finish") {
			usage = part.usage;
			reason = part.finishReason;
		}
	}
	for (const text of texts.values()) content.unshift({ type: "text", text });
	for (const text of reasoning.values()) content.unshift({ type: "reasoning", text });
	return { content, finishReason: reason, usage, warnings: [] };
}

async function partsFor(
	resolved: ResolvedMockResponse,
): Promise<readonly LanguageModelStreamPart[]> {
	if (resolved.source === "cassette") return resolved.cassette.parts;
	return responseParts(resolved.response, `${resolved.scenarioId}-${resolved.turnIndex}`);
}

export function createScenarioModel(options: {
	readonly purpose: ModelPurpose;
	readonly scenarios: readonly ScenarioDefinition[];
	readonly cassettes?: CassetteStore;
}): MockLanguageModelV4 {
	const resolve = (params: Parameters<MockLanguageModelV4["doGenerate"]>[0]) =>
		resolveMockResponse({
			params,
			purpose: options.purpose,
			scenarios: options.scenarios,
			...(options.cassettes ? { cassettes: options.cassettes } : {}),
		});
	return new MockLanguageModelV4({
		provider: "mock",
		modelId: `mock:${options.purpose}`,
		doGenerate: async (params) => generateFromParts(await partsFor(await resolve(params))),
		doStream: async (params) => ({
			stream: simulateReadableStream({
				chunks: [...(await partsFor(await resolve(params)))],
				initialDelayInMs: null,
				chunkDelayInMs: null,
			}),
		}),
	});
}
