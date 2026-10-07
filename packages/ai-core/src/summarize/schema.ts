import { z } from "zod";

export const SUMMARY_LIMITS = Object.freeze({
	titleMaxLength: 120,
	keyPointCount: 3,
	keyPointMaxLength: 200,
	tagsMin: 1,
	tagsMax: 8,
	tagMaxLength: 40,
	actionItemsMax: 10,
	actionItemMaxLength: 200,
	chaptersMax: 50,
	chapterHeadingMaxLength: 120,
	// The HTTP body limit (512 KiB, C14) is the binding cap in the web app; this bounds library use.
	transcriptTextMaxLength: 200_000,
	requestIdMaxLength: 200,
	modelIdMaxLength: 200,
});

const nonEmptyText = (max: number) => z.string().trim().min(1).max(max);

export const chapterSchema = z.object({
	heading: nonEmptyText(SUMMARY_LIMITS.chapterHeadingMaxLength).describe("章の見出し"),
	startSeconds: z.number().finite().nonnegative().describe("章の開始時刻（動画の先頭からの秒数）"),
});

const summaryBaseSchema = z.object({
	title: nonEmptyText(SUMMARY_LIMITS.titleMaxLength).describe("要約のタイトル"),
	keyPoints: z
		.array(nonEmptyText(SUMMARY_LIMITS.keyPointMaxLength))
		.length(SUMMARY_LIMITS.keyPointCount)
		.describe("ちょうど3件の要点（1件1文）"),
	tags: z
		.array(nonEmptyText(SUMMARY_LIMITS.tagMaxLength))
		.min(SUMMARY_LIMITS.tagsMin)
		.max(SUMMARY_LIMITS.tagsMax)
		.describe("重要なタグ"),
	actionItems: z
		.array(nonEmptyText(SUMMARY_LIMITS.actionItemMaxLength))
		.max(SUMMARY_LIMITS.actionItemsMax)
		.describe("読者が取るべき行動（なければ空配列）"),
});

const chaptersSchema = z.array(chapterSchema).max(SUMMARY_LIMITS.chaptersMax);

/** The summary object returned to the UI and library users (Req 4.1, 4.3). */
export const summarySchema = summaryBaseSchema.extend({ chapters: chaptersSchema.optional() });

const summaryWithChaptersSchema = summaryBaseSchema.extend({
	chapters: chaptersSchema.min(1).describe("目次（タイムスタンプ付きの入力のときは必須）"),
});

export type Summary = z.infer<typeof summarySchema>;
export type Chapter = z.infer<typeof chapterSchema>;

/**
 * The schema the model must satisfy. Timestamped sources require chapters (Req 4.10); other
 * sources use the schema without chapters, so the model is never asked for an optional field.
 */
export function summarySchemaFor(options: { readonly withChapters: boolean }): z.ZodType<Summary> {
	return options.withChapters ? summaryWithChaptersSchema : summaryBaseSchema;
}

/** Turns Zod issues into `path: message` strings (no input values are included). */
export function formatSchemaIssues(error: z.ZodError): string[] {
	return error.issues.map((issue) => {
		const path = issue.path.map(String).join(".");
		return `${path || "(root)"}: ${issue.message}`;
	});
}

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);
const YOUTUBE_PATH_PREFIXES = ["shorts", "embed", "live"];
// Real IDs are 11 characters; the wider pattern also admits the readable IDs of mock fixtures.
const VIDEO_ID = /^[A-Za-z0-9_-]{1,64}$/u;

function validVideoId(candidate: string | null | undefined): string | undefined {
	return candidate && VIDEO_ID.test(candidate) ? candidate : undefined;
}

/** Extracts the video ID from youtube.com (`watch`, `shorts`, `embed`, `live`) and youtu.be URLs. */
export function parseYoutubeVideoId(url: string): string | undefined {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return undefined;
	}
	if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return undefined;
	const segments = parsed.pathname.split("/").filter(Boolean);
	if (parsed.hostname === "youtu.be") return validVideoId(segments[0]);
	if (!YOUTUBE_HOSTS.has(parsed.hostname)) return undefined;
	if (segments[0] === "watch") return validVideoId(parsed.searchParams.get("v"));
	if (segments[0] && YOUTUBE_PATH_PREFIXES.includes(segments[0])) return validVideoId(segments[1]);
	return undefined;
}

const httpUrl = z.url({ protocol: /^https?$/u });

export const summaryInputSchema = z.discriminatedUnion("kind", [
	z.strictObject({ kind: z.literal("article"), url: httpUrl }),
	z.strictObject({
		kind: z.literal("youtube"),
		url: httpUrl.refine((url) => parseYoutubeVideoId(url) !== undefined, {
			message: "YouTube の動画 URL ではありません。",
		}),
	}),
	z.strictObject({
		kind: z.literal("transcript"),
		text: z.string().min(1).max(SUMMARY_LIMITS.transcriptTextMaxLength),
	}),
]);

export type SummaryInput = z.infer<typeof summaryInputSchema>;

/** The body of `POST /api/summarize`; unknown fields are rejected. */
export const summarizeRequestSchema = z.strictObject({
	id: z.string().min(1).max(SUMMARY_LIMITS.requestIdMaxLength),
	input: summaryInputSchema,
	modelId: z.string().min(1).max(SUMMARY_LIMITS.modelIdMaxLength),
});

export type SummarizeRequest = z.infer<typeof summarizeRequestSchema>;
