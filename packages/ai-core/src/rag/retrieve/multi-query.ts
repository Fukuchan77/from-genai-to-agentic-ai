import type { LanguageModel } from "ai";
import { z } from "zod";
import { DEFAULT_RAG } from "../../config/defaults";
import { PlatformError } from "../../errors";
import { generateValidated, type StructuredUsage } from "../../structured";

const subQueriesSchema = z.object({ queries: z.array(z.string()) });

export interface ExpandQueryParams {
	readonly model: LanguageModel;
	readonly question: string;
	/** Defaults to `DEFAULT_RAG.subQueryCount`. */
	readonly count?: number;
	readonly abortSignal?: AbortSignal;
}

export interface ExpandQueryResult {
	readonly subQueries: string[];
	/** Attempts used, 1 when the first output was valid. */
	readonly attempts: number;
	/** Token usage summed over every attempt. */
	readonly usage: StructuredUsage;
}

/** Sub-queries are the same when they differ only in width, case, or spacing. */
function comparisonKey(query: string): string {
	return query.normalize("NFKC").toLowerCase().split(/\s+/u).filter(Boolean).join(" ");
}

function instructionsFor(count: number): string {
	return [
		`Rewrite the user's question as ${count} different search queries for a knowledge base.`,
		"Each query should look at the question from another angle (a different aspect, term, or level of detail), so that together they find documents a single query would miss.",
		"Write the queries in the same language as the question.",
		`Return exactly ${count} queries.`,
	].join("\n");
}

/** Problems in the sub-queries; the messages never repeat the generated text. */
function validateSubQueries(queries: readonly string[], count: number): string[] {
	const problems: string[] = [];
	if (queries.length !== count) {
		problems.push(`queries: サブクエリは ${count} 件必要ですが、${queries.length} 件でした。`);
	}
	if (queries.some((query) => query.trim() === "")) {
		problems.push("queries: 空のサブクエリが含まれています。");
	}
	const keys = queries.map(comparisonKey).filter((key) => key !== "");
	if (new Set(keys).size !== keys.length) {
		problems.push("queries: 重複しているサブクエリがあります。すべて異なる内容にしてください。");
	}
	return problems;
}

/**
 * Multi-Query (plan C7): has the model write `count` different sub-queries for the question.
 * Wrong counts, blanks, and duplicates count as invalid output and are regenerated through
 * `generateValidated` (CL-2); after the last attempt it throws `StructuredOutputError`.
 */
export async function expandQuery(params: ExpandQueryParams): Promise<ExpandQueryResult> {
	const { model, question, abortSignal } = params;
	const count = params.count ?? DEFAULT_RAG.subQueryCount;
	if (!Number.isInteger(count) || count < 1) {
		throw new PlatformError(
			"invalid-request",
			"サブクエリの件数は 1 以上の整数で指定してください。",
		);
	}
	if (question.trim() === "") {
		throw new PlatformError("invalid-request", "質問が空です。");
	}

	const result = await generateValidated({
		model,
		schema: subQueriesSchema,
		system: instructionsFor(count),
		prompt: question,
		validate: (value) => validateSubQueries(value.queries, count),
		...(abortSignal ? { abortSignal } : {}),
	});
	return {
		subQueries: result.value.queries.map((query) => query.trim()),
		attempts: result.attempts,
		usage: result.usage,
	};
}
