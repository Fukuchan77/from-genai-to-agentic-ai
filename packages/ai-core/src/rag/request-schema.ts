import { z } from "zod";
import { DEFAULT_RAG } from "../config/defaults";
import { INGEST_SOURCES } from "./ingest/ingest";
import { isSafeFileName } from "./ingest/loader";

export const INGEST_REQUEST_LIMITS = Object.freeze({
	maxFiles: DEFAULT_RAG.maxIngestFiles,
	fileNameMaxLength: 255,
	maxTags: 10,
	tagMaxLength: 40,
});

const fileNameSchema = z
	.string()
	.min(1)
	.max(INGEST_REQUEST_LIMITS.fileNameMaxLength)
	.refine(isSafeFileName, {
		error:
			"ファイル名には 1 つのパス要素だけを指定してください（先頭の . や区切り文字は使えません）。",
	});

// Tag length counts characters (code points), so an emoji or a kanji is one.
const tagSchema = z
	.string()
	.min(1)
	.refine((tag) => [...tag].length <= INGEST_REQUEST_LIMITS.tagMaxLength, {
		error: `タグは ${INGEST_REQUEST_LIMITS.tagMaxLength} 文字までです。`,
	});

/**
 * The body of `POST /api/rag/ingest` (plan "HTTP API"). The caller names files inside one of two
 * server-side directories; there is no path, upload or root field. `files` omitted means every
 * supported file of the directory.
 */
export const ingestRequestSchema = z.strictObject({
	source: z.enum(INGEST_SOURCES, {
		error: `source は ${INGEST_SOURCES.join(" / ")} のいずれかを指定してください。`,
	}),
	files: z.array(fileNameSchema).min(1).max(INGEST_REQUEST_LIMITS.maxFiles).optional(),
	tags: z.array(tagSchema).max(INGEST_REQUEST_LIMITS.maxTags).optional(),
	reset: z.boolean().default(false),
});

export type IngestRequest = z.infer<typeof ingestRequestSchema>;
