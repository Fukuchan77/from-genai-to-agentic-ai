import { generateText, type LanguageModel, NoObjectGeneratedError, Output } from "ai";
import type { z } from "zod";
import { PlatformError } from "../errors";
import { StructuredOutputError, type StructuredUsage } from "./errors";

/** Regenerations allowed after the first attempt fails (CL-2: 3 attempts in total). */
export const DEFAULT_MAX_REGENERATIONS = 2;

export interface GenerateValidatedParams<T> {
	readonly model: LanguageModel;
	readonly schema: z.ZodType<T>;
	readonly system?: string;
	readonly prompt: string;
	/** Extra checks the schema cannot express. Returns the problems; an empty list means valid. */
	readonly validate?: (value: T) => readonly string[];
	readonly maxRegenerations?: number;
	readonly abortSignal?: AbortSignal;
	readonly providerOptions?: Parameters<typeof generateText>[0]["providerOptions"];
}

export interface GenerateValidatedResult<T> {
	readonly value: T;
	/** Attempts used, 1 when the first output was valid. */
	readonly attempts: number;
	/** Token usage summed over every attempt. */
	readonly usage: StructuredUsage;
}

interface UsageLike {
	readonly inputTokens?: number | undefined;
	readonly outputTokens?: number | undefined;
	readonly totalTokens?: number | undefined;
	readonly inputTokenDetails?: { readonly cacheReadTokens?: number | undefined } | undefined;
}

function addUsage(total: StructuredUsage, usage: UsageLike | undefined): StructuredUsage {
	if (!usage) return total;
	const inputTokens = usage.inputTokens ?? 0;
	const outputTokens = usage.outputTokens ?? 0;
	return {
		inputTokens: total.inputTokens + inputTokens,
		outputTokens: total.outputTokens + outputTokens,
		totalTokens: total.totalTokens + (usage.totalTokens ?? inputTokens + outputTokens),
		cacheReadTokens: total.cacheReadTokens + (usage.inputTokenDetails?.cacheReadTokens ?? 0),
	};
}

function formatSchemaIssues(error: z.ZodError): string[] {
	return error.issues.map((issue) => {
		const path = issue.path.map(String).join(".");
		// Zod names the unexpected keys in this message, and those keys come from the model.
		const message =
			issue.code === "unrecognized_keys" ? "定義にないキーが含まれています。" : issue.message;
		return `${path || "(root)"}: ${message}`;
	});
}

function issuesFromText<T>(text: string | undefined, schema: z.ZodType<T>): string[] {
	let value: unknown;
	try {
		value = JSON.parse(text ?? "");
	} catch {
		return ["(root): 出力を JSON として解析できませんでした。"];
	}
	const parsed = schema.safeParse(value);
	return parsed.success
		? ["(root): 出力を検証できませんでした。"]
		: formatSchemaIssues(parsed.error);
}

function promptWithFeedback(prompt: string, issues: readonly string[] | undefined): string {
	if (!issues || issues.length === 0) return prompt;
	return [
		prompt,
		"",
		"前回の出力は次の点で条件を満たしていませんでした。これらを直して、指定された形式で出力し直してください。",
		...issues.map((issue) => `- ${issue}`),
	].join("\n");
}

/**
 * Generates an object with `generateText` + `Output.object` and regenerates it when the output
 * breaks the schema or the extra `validate` (plan C3). The retry prompt carries the previous
 * attempt's problems. Provider errors and aborts are not retried; after an abort no further attempt
 * starts. Throws `StructuredOutputError` once every attempt has failed.
 */
export async function generateValidated<T>(
	params: GenerateValidatedParams<T>,
): Promise<GenerateValidatedResult<T>> {
	const maxRegenerations = params.maxRegenerations ?? DEFAULT_MAX_REGENERATIONS;
	if (!Number.isInteger(maxRegenerations) || maxRegenerations < 0) {
		throw new PlatformError(
			"invalid-request",
			"maxRegenerations は 0 以上の整数で指定してください。",
		);
	}

	let usage: StructuredUsage = {
		inputTokens: 0,
		outputTokens: 0,
		totalTokens: 0,
		cacheReadTokens: 0,
	};
	const issuesByAttempt: (readonly string[])[] = [];

	for (let attempt = 1; attempt <= maxRegenerations + 1; attempt += 1) {
		if (params.abortSignal?.aborted) throw params.abortSignal.reason;
		try {
			const result = await generateText({
				model: params.model,
				...(params.system === undefined ? {} : { instructions: params.system }),
				prompt: promptWithFeedback(params.prompt, issuesByAttempt.at(-1)),
				output: Output.object({ schema: params.schema }),
				...(params.abortSignal ? { abortSignal: params.abortSignal } : {}),
				...(params.providerOptions ? { providerOptions: params.providerOptions } : {}),
			});
			usage = addUsage(usage, result.usage);
			const problems = params.validate?.(result.output) ?? [];
			if (problems.length === 0) return { value: result.output, attempts: attempt, usage };
			issuesByAttempt.push([...problems]);
		} catch (error) {
			if (!NoObjectGeneratedError.isInstance(error)) throw error;
			usage = addUsage(usage, error.usage);
			issuesByAttempt.push(issuesFromText(error.text, params.schema));
		}
	}
	throw new StructuredOutputError(issuesByAttempt, usage);
}
