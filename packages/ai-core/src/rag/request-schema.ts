import { z } from "zod";
import { DEFAULT_RAG } from "../config/defaults";
import { type CatalogModelId, MODEL_CATALOG } from "../models/catalog";
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

export const QUERY_REQUEST_LIMITS = Object.freeze({
	idMaxLength: 200,
	questionMaxLength: DEFAULT_RAG.maxQuestionCharacters,
	topKMin: 1,
	topKMax: 20,
	minSimilarityMin: -1,
	minSimilarityMax: 1,
	maxDocumentIds: 20,
	documentIdMaxLength: 200,
	maxTags: INGEST_REQUEST_LIMITS.maxTags,
});

const CATALOG_MODEL_IDS = Object.freeze(Object.keys(MODEL_CATALOG)) as readonly CatalogModelId[];

// The question length counts characters (code points) like a tag, and a blank question is no query.
const questionSchema = z
	.string()
	.min(1)
	.refine((question) => [...question].length <= QUERY_REQUEST_LIMITS.questionMaxLength, {
		error: `質問は ${QUERY_REQUEST_LIMITS.questionMaxLength} 文字までです。`,
	})
	.refine((question) => question.trim() !== "", { error: "質問を入力してください。" });

const filterSchema = z.strictObject({
	documentIds: z
		.array(z.string().min(1).max(QUERY_REQUEST_LIMITS.documentIdMaxLength))
		.max(QUERY_REQUEST_LIMITS.maxDocumentIds)
		.optional(),
	tags: z.array(tagSchema).max(QUERY_REQUEST_LIMITS.maxTags).optional(),
});

// Every retrieval method is off unless asked for: the default pipeline is the naive one (Req 2.7).
const methodsSchema = z.strictObject({
	hyde: z.boolean().default(false),
	multiQuery: z.boolean().default(false),
	hybrid: z.boolean().default(false),
	rerank: z.boolean().default(false),
});

// `prefault` runs the empty object through the schema, so each default is applied in one place.
const settingsSchema = z.strictObject({
	topK: z
		.number()
		.int()
		.min(QUERY_REQUEST_LIMITS.topKMin)
		.max(QUERY_REQUEST_LIMITS.topKMax)
		.default(DEFAULT_RAG.topK),
	minSimilarity: z
		.number()
		.min(QUERY_REQUEST_LIMITS.minSimilarityMin)
		.max(QUERY_REQUEST_LIMITS.minSimilarityMax)
		.default(DEFAULT_RAG.minSimilarity),
	filter: filterSchema.prefault({}),
	methods: methodsSchema.prefault({}),
});

/**
 * The body of `POST /api/rag/query` (plan "HTTP API"). `settings` is always present after parsing,
 * with `DEFAULT_RAG` values and every method off.
 */
export const queryRequestSchema = z.strictObject({
	id: z.string().min(1).max(QUERY_REQUEST_LIMITS.idMaxLength),
	question: questionSchema,
	modelId: z
		.enum(CATALOG_MODEL_IDS, {
			error: "モデル ID がモデルカタログにありません。選択肢の中からモデルを選んでください。",
		})
		.optional(),
	settings: settingsSchema.prefault({}),
});

export type QueryRequest = z.infer<typeof queryRequestSchema>;
export type QuerySettings = QueryRequest["settings"];
export type QueryMethods = QuerySettings["methods"];
