import { DEFAULT_INPUT_LIMITS } from "@platform/ai-core/config";
import { PlatformError } from "@platform/ai-core/errors";
import { ModelSelectionError } from "@platform/ai-core/models";
import {
	type IngestRequest,
	ingestDocuments,
	ingestRequestSchema,
	listIngestableFiles,
} from "@platform/ai-core/rag";
import { AISDKError } from "ai";
import { toErrorResponse } from "@/lib/server/errors";
import { type GuardPolicy, guardRequest } from "@/lib/server/guard";
import { getKnowledgeBase, getPlatform } from "@/lib/server/platform";

// POST /api/rag/ingest (plan C13, Req 1.1, 1.3, 1.8, 2.12): guard -> resolve the embedding model ->
// validate the file list -> ingest. The caller names files inside one of two server-side
// directories; nothing else reaches the file system. Unreadable files come back in `skipped`.

export const dynamic = "force-dynamic";

const PROVIDER_FAILURE_MESSAGE =
	"埋め込みの生成に失敗しました。設定とネットワークを確認して、もう一度お試しください。ナレッジベースは変更していません。";

const INGEST_POLICY: GuardPolicy<IngestRequest> = {
	schema: ingestRequestSchema,
	limits: DEFAULT_INPUT_LIMITS,
	// File and tag limits are part of the schema; there is no further content to inspect.
	inspect: () => undefined,
};

/** Names the setting that is missing; the gateway's own message does not mention the API key. */
function embeddingNotConfigured(error: ModelSelectionError): PlatformError {
	return new PlatformError(
		"invalid-request",
		"埋め込みモデルが設定されていません。環境変数 AI_MODEL_EMBEDDING に埋め込みモデルを指定し、対応するプロバイダの API キーも設定してください。",
		{ ...error.details },
	);
}

export async function POST(request: Request): Promise<Response> {
	try {
		const platform = await getPlatform();
		const guarded = await guardRequest(request, INGEST_POLICY, {
			limiter: platform.limiter,
			mode: platform.mode,
		});
		if (!guarded.ok) return guarded.response;
		const { body } = guarded;

		let embedding: Awaited<ReturnType<typeof platform.gateway.resolveEmbedding>>;
		try {
			embedding = await platform.gateway.resolveEmbedding();
		} catch (error) {
			if (error instanceof ModelSelectionError && error.reason === "no-default") {
				throw embeddingNotConfigured(error);
			}
			throw error;
		}

		const root =
			body.source === "knowledge"
				? platform.knowledgeRoots.knowledge
				: platform.knowledgeRoots.evalCorpus;
		const files = body.files ?? (await listIngestableFiles(root));
		const { db } = await getKnowledgeBase();

		try {
			const result = await ingestDocuments({
				db,
				embedding,
				source: body.source,
				root,
				files,
				reset: body.reset,
				clock: platform.clock,
				signal: request.signal,
				...(body.tags ? { tags: body.tags } : {}),
			});
			return Response.json(result);
		} catch (error) {
			// The SDK's errors can carry the provider's response; only a fixed message leaves.
			if (AISDKError.isInstance(error)) {
				throw new PlatformError("provider-unavailable", PROVIDER_FAILURE_MESSAGE);
			}
			throw error;
		}
	} catch (error) {
		return toErrorResponse(error);
	}
}
