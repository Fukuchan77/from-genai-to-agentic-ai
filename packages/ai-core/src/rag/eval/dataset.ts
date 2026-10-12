import { readFile } from "node:fs/promises";
import { z } from "zod";
import { PlatformError, type PlatformErrorCode } from "../../errors";

// The labelled question set behind the retrieval and answer-quality evaluations (plan C10,
// Req 2.12): a question, the chunks that answer it, and a reference answer.

/** A set smaller than this cannot separate retrieval methods (Req 2.12). */
export const MIN_EVAL_QUESTIONS = 20;

const nonBlank = z.string().refine((value) => value.trim().length > 0, "must not be blank");

export const evalQuestionSchema = z.strictObject({
	id: nonBlank,
	question: nonBlank,
	/** IDs of the chunks that contain the answer; at least one. */
	goldChunkIds: z.array(nonBlank).min(1),
	referenceAnswer: nonBlank,
});

export type EvalQuestion = z.infer<typeof evalQuestionSchema>;

/** A file is a bare array of questions or `{ "questions": [...] }`. */
const evalSetFileSchema = z.union([
	z.array(z.unknown()),
	z.strictObject({ questions: z.array(z.unknown()) }),
]);

export const EVAL_SET_ERROR_REASONS = [
	"unreadable",
	"invalid-json",
	"invalid-schema",
	"too-few-questions",
	"duplicate-id",
] as const;

export type EvalSetErrorReason = (typeof EVAL_SET_ERROR_REASONS)[number];

const REASON_MESSAGES: Record<EvalSetErrorReason, string> = {
	unreadable: "評価用の質問セットを読み込めませんでした。",
	"invalid-json": "評価用の質問セットが JSON として解析できませんでした。",
	"invalid-schema": "評価用の質問セットの形式が正しくありません。",
	"too-few-questions": `評価用の質問セットは ${MIN_EVAL_QUESTIONS} 問以上必要です。`,
	"duplicate-id": "評価用の質問セットに重複した id があります。",
};

/**
 * The question set cannot be used. `issues` and `details` name schema paths, counts and question
 * IDs only; they never carry the question or answer text.
 */
export class EvalSetError extends PlatformError {
	readonly reason: EvalSetErrorReason;
	readonly issues: readonly string[];

	constructor(
		reason: EvalSetErrorReason,
		details: Readonly<Record<string, unknown>> = {},
		issues: readonly string[] = [],
	) {
		const code: PlatformErrorCode =
			reason === "unreadable" ? "source-unavailable" : "invalid-request";
		super(code, REASON_MESSAGES[reason], {
			reason,
			...details,
			...(issues.length ? { issues } : {}),
		});
		this.reason = reason;
		this.issues = issues;
	}
}

function describeIssues(error: z.ZodError): string[] {
	return error.issues.map((issue) => {
		const path = issue.path.map(String).join(".");
		// Zod names unexpected keys in this message; the fixed text keeps the error value-free.
		const message =
			issue.code === "unrecognized_keys" ? "定義にないキーが含まれています。" : issue.message;
		return `${path || "(root)"}: ${message}`;
	});
}

/**
 * Reads and validates a labelled question set. Fails with `EvalSetError` when the file cannot be
 * read or parsed, a question is malformed (no gold chunk, blank text), `id`s repeat, or there are
 * fewer than `MIN_EVAL_QUESTIONS` questions.
 */
export async function loadEvalSet(path: string): Promise<readonly EvalQuestion[]> {
	let text: string;
	try {
		text = await readFile(path, "utf8");
	} catch {
		throw new EvalSetError("unreadable");
	}

	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch {
		throw new EvalSetError("invalid-json");
	}

	const file = evalSetFileSchema.safeParse(json);
	if (!file.success) {
		throw new EvalSetError("invalid-schema", {}, [
			"(root): 配列、または questions 配列を持つオブジェクトが必要です。",
		]);
	}
	const rawQuestions = Array.isArray(file.data) ? file.data : file.data.questions;

	const parsed = z.array(evalQuestionSchema).safeParse(rawQuestions);
	if (!parsed.success) {
		throw new EvalSetError("invalid-schema", {}, describeIssues(parsed.error));
	}
	const questions = parsed.data;

	if (questions.length < MIN_EVAL_QUESTIONS) {
		throw new EvalSetError("too-few-questions", {
			count: questions.length,
			minimum: MIN_EVAL_QUESTIONS,
		});
	}

	const seen = new Set<string>();
	const duplicates = new Set<string>();
	for (const item of questions) {
		if (seen.has(item.id)) duplicates.add(item.id);
		seen.add(item.id);
	}
	if (duplicates.size > 0) {
		throw new EvalSetError("duplicate-id", { duplicateIds: [...duplicates] });
	}
	return questions;
}
