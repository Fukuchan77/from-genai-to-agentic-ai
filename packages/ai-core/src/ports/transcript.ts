import { Innertube } from "youtubei.js";
import { z } from "zod";
import { PlatformError } from "../errors";
import { raceWithAbort } from "./abort";

export type TranscriptFailureReason = "no-captions" | "private" | "fetch-failed";

export interface TranscriptSegment {
	readonly text: string;
	readonly startSeconds: number;
	readonly durationSeconds: number;
}

export interface TranscriptResult {
	readonly videoId: string;
	readonly title?: string;
	readonly language?: string;
	readonly segments: readonly TranscriptSegment[];
}

export interface TranscriptSource {
	fetchTranscript(videoId: string, signal?: AbortSignal): Promise<TranscriptResult>;
}

// youtubei.js returns parser class instances; only the fields below are read, and each is
// validated at runtime because the library's upstream response shape can change without notice.
const basicInfoSchema = z.object({
	title: z.string().optional(),
	is_private: z.boolean().optional(),
});

const playabilityStatusSchema = z
	.object({ status: z.string(), reason: z.string().optional() })
	.optional();

const transcriptItemSchema = z
	.object({
		target_id: z.string().optional(),
		start_ms: z.string().regex(/^\d+$/),
		end_ms: z.string().regex(/^\d+$/),
		snippet: z.object({ text: z.string().optional() }),
	})
	.refine((item) => Number(item.end_ms) >= Number(item.start_ms), {
		message: "end_ms must not precede start_ms",
	});

const transcriptInfoSchema = z.object({
	selectedLanguage: z.string().optional(),
	transcript: z.object({
		content: z
			.object({
				body: z.object({ initial_segments: z.array(transcriptItemSchema) }).nullish(),
			})
			.nullish(),
	}),
});

type TranscriptItem = z.infer<typeof transcriptItemSchema>;

interface YoutubeVideoInfo {
	readonly basic_info: unknown;
	readonly playability_status?: unknown;
	getTranscript(): Promise<unknown>;
}

interface YoutubeClient {
	getInfo(videoId: string): Promise<YoutubeVideoInfo>;
}

export interface YoutubeiTranscriptSourceOptions {
	readonly createClient?: () => Promise<YoutubeClient>;
}

export class TranscriptSourceError extends PlatformError {
	readonly reason: TranscriptFailureReason;

	constructor(reason: TranscriptFailureReason, videoId: string, cause?: unknown) {
		super("source-unavailable", transcriptFailureMessage(reason), {
			videoId,
			reason,
			...(cause instanceof Error ? { cause: cause.message } : {}),
		});
		this.reason = reason;
	}
}

function transcriptFailureMessage(reason: TranscriptFailureReason): string {
	switch (reason) {
		case "no-captions":
			return "動画に利用可能な字幕がありません。";
		case "private":
			return "非公開動画の字幕は取得できません。";
		case "fetch-failed":
			return "動画の字幕を取得できませんでした。";
	}
}

const errorInfoSchema = z.object({ status: z.string().optional(), reason: z.string().optional() });

// Reads only the documented InnertubeError info fields, so a circular or exotic `info`
// cannot throw while a failure is being classified.
function failureText(cause: unknown): string {
	if (!(cause instanceof Error)) return String(cause).toLowerCase();
	const info = "info" in cause ? errorInfoSchema.safeParse(cause.info) : undefined;
	const details = info?.success ? `${info.data.status ?? ""} ${info.data.reason ?? ""}` : "";
	return `${cause.name} ${cause.message} ${details}`.toLowerCase();
}

// YouTube reports private videos as "This video is private"; a bare LOGIN_REQUIRED status also
// covers age-restricted videos, so it is not treated as private on its own.
function isPrivateText(text: string): boolean {
	return /\b(video is private|private video)\b/.test(text);
}

function classifyFailure(cause: unknown): TranscriptFailureReason {
	const text = failureText(cause);
	if (isPrivateText(text)) return "private";
	// youtubei.js reports a missing transcript panel with "... Video likely has no transcript."
	if (text.includes("no transcript")) return "no-captions";
	return "fetch-failed";
}

function mapSegments(items: readonly TranscriptItem[]): TranscriptSegment[] {
	return items.flatMap((item) => {
		// Section headers carry no target_id and are not spoken text.
		if (!item.target_id || !item.snippet.text) return [];
		const startMs = Number(item.start_ms);
		const endMs = Number(item.end_ms);

		return [
			{
				text: item.snippet.text,
				startSeconds: startMs / 1_000,
				durationSeconds: (endMs - startMs) / 1_000,
			},
		];
	});
}

function parseOrFail<T>(schema: z.ZodType<T>, value: unknown, videoId: string): T {
	const parsed = schema.safeParse(value);
	if (!parsed.success) throw new TranscriptSourceError("fetch-failed", videoId, parsed.error);
	return parsed.data;
}

async function createInnertubeClient(): Promise<YoutubeClient> {
	const innertube = await Innertube.create();
	return { getInfo: (videoId) => innertube.getInfo(videoId) };
}

export function createYoutubeiTranscriptSource(
	options: YoutubeiTranscriptSourceOptions = {},
): TranscriptSource {
	const createClient = options.createClient ?? createInnertubeClient;
	let clientPromise: Promise<YoutubeClient> | undefined;

	return {
		async fetchTranscript(videoId, signal) {
			try {
				// Drop a failed creation so a transient bootstrap error does not stick for the process.
				clientPromise ??= createClient().catch((error: unknown) => {
					clientPromise = undefined;
					throw error;
				});
				const client = await raceWithAbort(clientPromise, signal);
				const info = await raceWithAbort(client.getInfo(videoId), signal);
				const basicInfo = parseOrFail(basicInfoSchema, info.basic_info, videoId);
				const playability = parseOrFail(playabilityStatusSchema, info.playability_status, videoId);
				if (basicInfo.is_private || isPrivateText(playability?.reason?.toLowerCase() ?? "")) {
					throw new TranscriptSourceError("private", videoId);
				}
				const transcript = parseOrFail(
					transcriptInfoSchema,
					await raceWithAbort(info.getTranscript(), signal),
					videoId,
				);
				const segments = mapSegments(transcript.transcript.content?.body?.initial_segments ?? []);
				if (segments.length === 0) throw new TranscriptSourceError("no-captions", videoId);

				return {
					videoId,
					...(basicInfo.title ? { title: basicInfo.title } : {}),
					...(transcript.selectedLanguage ? { language: transcript.selectedLanguage } : {}),
					segments,
				};
			} catch (cause) {
				if (cause instanceof TranscriptSourceError) throw cause;
				if (signal?.aborted) throw signal.reason;
				throw new TranscriptSourceError(classifyFailure(cause), videoId, cause);
			}
		},
	};
}
