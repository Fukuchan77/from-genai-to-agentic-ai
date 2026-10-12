import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PlatformError } from "../../errors";
import {
	EVAL_SET_ERROR_REASONS,
	type EvalQuestion,
	EvalSetError,
	loadEvalSet,
	MIN_EVAL_QUESTIONS,
} from "./dataset";

let directory: string;

beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), "eval-set-"));
});

afterEach(async () => {
	await rm(directory, { recursive: true, force: true });
});

function questions(count: number): EvalQuestion[] {
	return Array.from({ length: count }, (_, index) => ({
		id: `q${index + 1}`,
		question: `質問 ${index + 1}`,
		goldChunkIds: [`chunk-${index + 1}`],
		referenceAnswer: `参照回答 ${index + 1}`,
	}));
}

/** A copy of `set[index]` with some fields replaced (or removed with `undefined`). */
function patched(set: readonly EvalQuestion[], index: number, patch: Record<string, unknown>) {
	const item = set[index];
	if (!item) throw new Error(`no question at ${index}`);
	return { ...item, ...patch } as EvalQuestion;
}

async function write(content: unknown): Promise<string> {
	const path = join(directory, "eval-set.json");
	await writeFile(path, typeof content === "string" ? content : JSON.stringify(content));
	return path;
}

async function failureOf(path: string): Promise<EvalSetError> {
	const error = await loadEvalSet(path).then(
		() => undefined,
		(thrown: unknown) => thrown,
	);
	expect(error).toBeInstanceOf(EvalSetError);
	return error as EvalSetError;
}

describe("loadEvalSet: valid sets", () => {
	it("loads a set of exactly the minimum size and keeps the order and fields", async () => {
		const set = questions(MIN_EVAL_QUESTIONS);

		const loaded = await loadEvalSet(await write(set));

		expect(MIN_EVAL_QUESTIONS).toBe(20);
		expect(loaded).toEqual(set);
	});

	it("loads a set wrapped in a `questions` property", async () => {
		const set = questions(25);

		expect(await loadEvalSet(await write({ questions: set }))).toEqual(set);
	});

	it("keeps several gold chunk IDs for one question", async () => {
		const set = questions(20);
		set[0] = patched(set, 0, { goldChunkIds: ["a", "b"] });

		const loaded = await loadEvalSet(await write(set));

		expect(loaded[0]?.goldChunkIds).toEqual(["a", "b"]);
	});
});

describe("loadEvalSet: rejections", () => {
	it("rejects a set with fewer than 20 questions", async () => {
		const error = await failureOf(await write(questions(MIN_EVAL_QUESTIONS - 1)));

		expect(error.reason).toBe("too-few-questions");
		expect(error.code).toBe("invalid-request");
		expect(error).toBeInstanceOf(PlatformError);
		expect(error.details).toMatchObject({ count: 19, minimum: 20 });
	});

	it("rejects an empty set", async () => {
		expect((await failureOf(await write([]))).reason).toBe("too-few-questions");
	});

	it("rejects a question whose gold chunk IDs are empty", async () => {
		const set = questions(20);
		set[3] = patched(set, 3, { goldChunkIds: [] });

		const error = await failureOf(await write(set));

		expect(error.reason).toBe("invalid-schema");
		expect(error.issues.join("\n")).toContain("goldChunkIds");
	});

	it("rejects a question that has no gold chunk IDs property", async () => {
		const set = questions(20).map(({ goldChunkIds: _gold, ...rest }) => rest);

		expect((await failureOf(await write(set))).reason).toBe("invalid-schema");
	});

	it("rejects a blank gold chunk ID", async () => {
		const set = questions(20);
		set[0] = patched(set, 0, { goldChunkIds: ["a", ""] });

		expect((await failureOf(await write(set))).reason).toBe("invalid-schema");
	});

	it.each(["question", "referenceAnswer", "id"] as const)("rejects an empty %s", async (field) => {
		const set = questions(20);
		set[5] = patched(set, 5, { [field]: "" });

		const error = await failureOf(await write(set));

		expect(error.reason).toBe("invalid-schema");
		expect(error.issues.join("\n")).toContain(field);
	});

	it.each(["question", "referenceAnswer"] as const)(
		"rejects a whitespace-only %s",
		async (field) => {
			const set = questions(20);
			set[5] = patched(set, 5, { [field]: " \n\t " });

			expect((await failureOf(await write(set))).reason).toBe("invalid-schema");
		},
	);

	it("rejects duplicate question ids and names them", async () => {
		const set = questions(21);
		set[10] = patched(set, 10, { id: "q2" });

		const error = await failureOf(await write(set));

		expect(error.reason).toBe("duplicate-id");
		expect(error.code).toBe("invalid-request");
		expect(error.details).toMatchObject({ duplicateIds: ["q2"] });
	});

	it("rejects an unknown property so a typo does not silently drop a field", async () => {
		const set = questions(20).map((item) => ({ ...item, goldChunkId: ["typo"] }));

		expect((await failureOf(await write(set))).reason).toBe("invalid-schema");
	});

	it("rejects JSON that is neither an array nor a `questions` object", async () => {
		expect((await failureOf(await write({ items: [] }))).reason).toBe("invalid-schema");
		expect((await failureOf(await write("42"))).reason).toBe("invalid-schema");
	});

	it("rejects invalid JSON", async () => {
		const error = await failureOf(await write("[{ not json"));

		expect(error.reason).toBe("invalid-json");
		expect(error.code).toBe("invalid-request");
	});

	it("reports a missing file as an unavailable source", async () => {
		const error = await failureOf(join(directory, "missing.json"));

		expect(error.reason).toBe("unreadable");
		expect(error.code).toBe("source-unavailable");
	});

	it("reports a directory path as an unavailable source", async () => {
		const path = join(directory, "folder");
		await mkdir(path);

		const error = await failureOf(path);

		expect(error.reason).toBe("unreadable");
	});

	it("keeps the question text out of the error", async () => {
		const set = questions(20);
		set[0] = patched(set, 0, { goldChunkIds: [], question: "PRIVATE-QUESTION-TEXT" });

		const error = await failureOf(await write(set));

		expect(JSON.stringify([error.message, error.details, error.issues])).not.toContain(
			"PRIVATE-QUESTION-TEXT",
		);
	});
});

describe("EvalSetError", () => {
	it("uses a closed vocabulary of reasons", () => {
		expect([...EVAL_SET_ERROR_REASONS].sort()).toEqual(
			["duplicate-id", "invalid-json", "invalid-schema", "too-few-questions", "unreadable"].sort(),
		);
	});
});

describe("the committed eval set (fixtures/rag/eval-set.json)", () => {
	const path = fileURLToPath(new URL("../../../fixtures/rag/eval-set.json", import.meta.url));

	it("passes loadEvalSet with at least 20 questions", async () => {
		const set = await loadEvalSet(path);
		expect(set.length).toBeGreaterThanOrEqual(20);
	});

	it("has unique ids and unique questions", async () => {
		const set = await loadEvalSet(path);
		expect(new Set(set.map((entry) => entry.id)).size).toBe(set.length);
		expect(new Set(set.map((entry) => entry.question)).size).toBe(set.length);
	});

	it("has a non-empty reference answer and at least one gold chunk for every question", async () => {
		for (const entry of await loadEvalSet(path)) {
			expect(entry.referenceAnswer.trim(), entry.id).not.toBe("");
			expect(entry.goldChunkIds.length, entry.id).toBeGreaterThan(0);
		}
	});

	it("includes questions with more than one gold chunk (multi-aspect questions)", async () => {
		const set = await loadEvalSet(path);
		expect(set.filter((entry) => entry.goldChunkIds.length > 1).length).toBeGreaterThanOrEqual(3);
	});
});
