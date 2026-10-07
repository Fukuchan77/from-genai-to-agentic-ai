import { describe, expect, it } from "vitest";
import { PlatformError } from "../errors";
import { SourceFetchError, SummaryValidationError, TranscriptUnavailableError } from "./errors";
import {
	formatSchemaIssues,
	parseYoutubeVideoId,
	SUMMARY_LIMITS,
	summarizeRequestSchema,
	summarySchema,
	summarySchemaFor,
} from "./schema";

const validSummary = {
	title: "Agentic AI 入門",
	keyPoints: ["目的を明確にする", "ツールを安全に使う", "評価で品質を確認する"],
	tags: ["AI", "agents"],
	actionItems: ["モックでテストする"],
};

function issuePaths(result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) {
	return (result.error?.issues ?? []).map((issue) => issue.path.join("."));
}

describe("summarySchema", () => {
	it("accepts a summary with exactly three key points and optional chapters", () => {
		expect(summarySchema.safeParse(validSummary).success).toBe(true);
		expect(
			summarySchema.safeParse({
				...validSummary,
				chapters: [{ heading: "導入", startSeconds: 0 }],
			}).success,
		).toBe(true);
	});

	it.each([
		["two", validSummary.keyPoints.slice(0, 2)],
		["four", [...validSummary.keyPoints, "余分な要点"]],
	])("rejects %s key points", (_label, keyPoints) => {
		const result = summarySchema.safeParse({ ...validSummary, keyPoints });

		expect(result.success).toBe(false);
		expect(issuePaths(result)).toEqual(["keyPoints"]);
	});

	it.each([
		["title", { title: "x".repeat(SUMMARY_LIMITS.titleMaxLength + 1) }, "title"],
		["empty title", { title: "" }, "title"],
		[
			"tags",
			{ tags: Array.from({ length: SUMMARY_LIMITS.tagsMax + 1 }, (_, i) => `t${i}`) },
			"tags",
		],
		["no tags", { tags: [] }, "tags"],
		[
			"action items",
			{ actionItems: Array.from({ length: SUMMARY_LIMITS.actionItemsMax + 1 }, () => "a") },
			"actionItems",
		],
		["empty key point", { keyPoints: ["", "b", "c"] }, "keyPoints.0"],
		[
			"negative chapter start",
			{ chapters: [{ heading: "h", startSeconds: -1 }] },
			"chapters.0.startSeconds",
		],
	])("rejects a summary over the %s limit", (_label, override, path) => {
		const result = summarySchema.safeParse({ ...validSummary, ...override });

		expect(result.success).toBe(false);
		expect(issuePaths(result)).toEqual([path]);
	});

	it("requires at least one chapter for timestamped sources and omits chapters otherwise", () => {
		const withChapters = summarySchemaFor({ withChapters: true });
		const withoutChapters = summarySchemaFor({ withChapters: false });

		expect(issuePaths(withChapters.safeParse(validSummary))).toEqual(["chapters"]);
		expect(issuePaths(withChapters.safeParse({ ...validSummary, chapters: [] }))).toEqual([
			"chapters",
		]);
		expect(
			withChapters.safeParse({ ...validSummary, chapters: [{ heading: "導入", startSeconds: 0 }] })
				.success,
		).toBe(true);
		expect(withoutChapters.safeParse(validSummary).data).toEqual(validSummary);
		expect(
			withoutChapters.safeParse({ ...validSummary, chapters: [{ heading: "x", startSeconds: 1 }] })
				.data,
		).toEqual(validSummary);
	});

	it("formats issues as path-prefixed messages", () => {
		const result = summarySchema.safeParse({ title: "", keyPoints: [] });
		if (result.success) throw new Error("expected failure");

		const issues = formatSchemaIssues(result.error);

		expect(issues).toHaveLength(result.error.issues.length);
		expect(issues[0]).toMatch(/^title: /u);
		expect(issues.some((issue) => issue.startsWith("keyPoints: "))).toBe(true);
		expect(issues.some((issue) => issue.startsWith("tags: "))).toBe(true);
	});

	it("labels root-level issues", () => {
		const result = summarySchema.safeParse("not an object");
		if (result.success) throw new Error("expected failure");

		expect(formatSchemaIssues(result.error)[0]).toMatch(/^\(root\): /u);
	});
});

describe("summarizeRequestSchema", () => {
	const base = { id: "req-1", modelId: "model-x" };

	it.each([
		{ kind: "article", url: "https://example.test/articles/agentic-ai" },
		{ kind: "youtube", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
		{ kind: "transcript", text: "字幕テキスト" },
	])("accepts a $kind input", (input) => {
		expect(summarizeRequestSchema.safeParse({ ...base, input }).success).toBe(true);
	});

	it("rejects unknown top-level and input fields", () => {
		const extraTop = summarizeRequestSchema.safeParse({
			...base,
			input: { kind: "transcript", text: "t" },
			messages: [],
		});
		const extraInput = summarizeRequestSchema.safeParse({
			...base,
			input: { kind: "transcript", text: "t", url: "https://example.test" },
		});

		expect(extraTop.success).toBe(false);
		expect(extraTop.error?.issues[0]?.code).toBe("unrecognized_keys");
		expect(extraInput.success).toBe(false);
	});

	it.each([
		["non-http article URL", { kind: "article", url: "file:///etc/passwd" }],
		["non-YouTube video URL", { kind: "youtube", url: "https://example.test/watch?v=abc" }],
		["empty transcript", { kind: "transcript", text: "" }],
		[
			"oversized transcript",
			{ kind: "transcript", text: "a".repeat(SUMMARY_LIMITS.transcriptTextMaxLength + 1) },
		],
		["unknown kind", { kind: "podcast", url: "https://example.test" }],
	])("rejects a %s", (_label, input) => {
		expect(summarizeRequestSchema.safeParse({ ...base, input }).success).toBe(false);
	});

	it("rejects missing id and modelId", () => {
		expect(
			summarizeRequestSchema.safeParse({ input: { kind: "transcript", text: "t" } }).success,
		).toBe(false);
	});
});

describe("parseYoutubeVideoId", () => {
	it.each([
		["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
		["https://youtube.com/watch?v=dQw4w9WgXcQ&t=30", "dQw4w9WgXcQ"],
		["https://m.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
		["https://youtu.be/dQw4w9WgXcQ?si=abc", "dQw4w9WgXcQ"],
		["https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
		["https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
		["https://www.youtube.com/live/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
		["http://www.youtube.com/watch?v=m1-agentic-ai", "m1-agentic-ai"],
	])("extracts the video id from %s", (url, id) => {
		expect(parseYoutubeVideoId(url)).toBe(id);
	});

	it.each([
		"not a url",
		"ftp://www.youtube.com/watch?v=dQw4w9WgXcQ",
		"https://www.youtube.com/watch",
		"https://www.youtube.com/watch?v=bad%20id",
		"https://youtu.be/",
		"https://www.youtube.com/channel/UC123",
		"https://evil.example/youtube.com/watch?v=dQw4w9WgXcQ",
		"https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
		`https://youtu.be/${"a".repeat(65)}`,
	])("returns undefined for %s", (url) => {
		expect(parseYoutubeVideoId(url)).toBeUndefined();
	});
});

describe("summarize errors", () => {
	it("SourceFetchError carries the reason and HTTP status", () => {
		const error = new SourceFetchError("http-status", { status: 404 });

		expect(error).toBeInstanceOf(PlatformError);
		expect(error.code).toBe("source-unavailable");
		expect(error.reason).toBe("http-status");
		expect(error.status).toBe(404);
		expect(error.details).toEqual({ reason: "http-status", status: 404 });
		expect(error.message).toContain("404");
	});

	it.each([
		["empty-body", "本文"],
		["network", "取得"],
	] as const)("SourceFetchError(%s) has a Japanese message and no status", (reason, word) => {
		const error = new SourceFetchError(reason);

		expect(error.status).toBeUndefined();
		expect(error.details).toEqual({ reason });
		expect(error.message).toContain(word);
	});

	it.each([
		["no-captions", "字幕"],
		["private", "非公開"],
		["fetch-failed", "取得"],
	] as const)("TranscriptUnavailableError(%s) carries the reason", (reason, word) => {
		const error = new TranscriptUnavailableError(reason);

		expect(error).toBeInstanceOf(PlatformError);
		expect(error.code).toBe("source-unavailable");
		expect(error.reason).toBe(reason);
		expect(error.details).toEqual({ reason });
		expect(error.message).toContain(word);
	});

	it("SummaryValidationError lists the issues of every attempt", () => {
		const error = new SummaryValidationError([["keyPoints: too small"], ["title: too big"]]);

		expect(error).toBeInstanceOf(PlatformError);
		expect(error.code).toBe("output-invalid");
		expect(error.attempts).toBe(2);
		expect(error.issues).toEqual(["title: too big"]);
		expect(error.details).toEqual({
			attempts: 2,
			issues: ["title: too big"],
			issuesByAttempt: [["keyPoints: too small"], ["title: too big"]],
		});
		expect(error.message).toContain("2");
	});
});
