import type { JSONValue } from "ai";
import type { ModelPurpose } from "../models/types";
import type { LanguageModelV4CallOptions } from "./request-key";

export interface ScenarioMatch {
	readonly lastUserTextIncludes?: string;
	readonly stepIndex?: number;
	readonly toolResultFor?: string;
	readonly purpose?: ModelPurpose;
}

export interface ScenarioToolCall {
	readonly toolName: string;
	readonly input: JSONValue;
}

export interface ScenarioUsage {
	readonly inputTokens?: number;
	readonly outputTokens?: number;
	readonly cacheReadTokens?: number;
	readonly reasoningTokens?: number;
}

export interface ScenarioResponse {
	readonly text?: string;
	readonly reasoning?: string;
	readonly toolCalls?: readonly ScenarioToolCall[];
	readonly object?: JSONValue;
	readonly usage?: ScenarioUsage;
	readonly chunkSize?: number;
}

export interface ScenarioTurn {
	readonly match: ScenarioMatch;
	readonly respond: ScenarioResponse;
}

export interface ScenarioDefinition {
	readonly id: string;
	readonly turns: readonly ScenarioTurn[];
}

export interface ScenarioContext {
	readonly lastUserText: string;
	readonly stepIndex: number;
	readonly toolResultFor?: string;
	readonly purpose: ModelPurpose;
}

export function defineScenario(scenario: ScenarioDefinition): ScenarioDefinition {
	return Object.freeze({
		...scenario,
		turns: Object.freeze(scenario.turns.map((turn) => Object.freeze(turn))),
	});
}

export function deriveScenarioContext(
	params: LanguageModelV4CallOptions,
	purpose: ModelPurpose,
): ScenarioContext {
	let lastUserIndex = -1;
	let lastUserText = "";
	for (let index = 0; index < params.prompt.length; index += 1) {
		const message = params.prompt[index];
		if (message?.role !== "user") continue;
		lastUserIndex = index;
		lastUserText = message.content
			.filter((part) => part.type === "text")
			.map((part) => part.text)
			.join("");
	}
	const stepIndex = params.prompt
		.slice(lastUserIndex + 1)
		.filter((message) => message.role === "assistant").length;
	const trailing = params.prompt.at(-1);
	const toolResultFor =
		trailing?.role === "tool"
			? [...trailing.content].reverse().find((part) => part.type === "tool-result")?.toolName
			: undefined;
	return {
		lastUserText,
		stepIndex,
		...(toolResultFor ? { toolResultFor } : {}),
		purpose,
	};
}

export function scenarioMatches(match: ScenarioMatch, context: ScenarioContext): boolean {
	return (
		(match.lastUserTextIncludes === undefined ||
			context.lastUserText.includes(match.lastUserTextIncludes)) &&
		(match.stepIndex === undefined || context.stepIndex === match.stepIndex) &&
		(match.toolResultFor === undefined || context.toolResultFor === match.toolResultFor) &&
		(match.purpose === undefined || context.purpose === match.purpose)
	);
}
