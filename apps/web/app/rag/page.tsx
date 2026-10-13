import { DEFAULT_PERSONA_ID } from "@platform/ai-core/chat";
import { DEFAULT_RAG } from "@platform/ai-core/config";
import { QUERY_REQUEST_LIMITS } from "@platform/ai-core/rag";
import type { Metadata } from "next";
import { GET as getKnowledgeInfo } from "@/app/api/rag/knowledge/route";
import { IngestPanel, type KnowledgeInfo } from "@/components/rag/IngestPanel";
import { RagPanel } from "@/components/rag/RagPanel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { getPlatform } from "@/lib/server/platform";

export const metadata: Metadata = { title: "RAG" };

// The model list, the knowledge base and the Rerank availability depend on the running server.
export const dynamic = "force-dynamic";

const KNOWLEDGE_UNAVAILABLE_MESSAGE =
	"ナレッジベースの状態を取得できませんでした。データベース（Postgres）と埋め込みモデルの設定を確認してください。";

/**
 * The state `GET /api/rag/knowledge` reports, read through the handler itself so the page and the
 * API cannot disagree. A failure (an unreachable database) becomes a message, not a crashed page.
 */
async function loadKnowledge(): Promise<
	{ readonly info: KnowledgeInfo } | { readonly message: string }
> {
	try {
		const response = await getKnowledgeInfo();
		if (response.ok) return { info: (await response.json()) as KnowledgeInfo };
		const body = (await response.json()) as { error?: { message?: string } };
		return { message: body.error?.message ?? KNOWLEDGE_UNAVAILABLE_MESSAGE };
	} catch {
		return { message: KNOWLEDGE_UNAVAILABLE_MESSAGE };
	}
}

export default async function RagPage() {
	const { gateway, config } = await getPlatform();
	const models = gateway.availableModels().filter((model) => !model.capabilities.embedding);
	const defaultModel = models.find((model) => model.id === config.models.chat) ?? models[0];
	const knowledge = await loadKnowledge();

	return (
		<div className="flex flex-col gap-8">
			<h1 className="text-2xl font-bold">RAG（検索拡張生成）</h1>
			<p className="text-muted-foreground">
				文書を取り込み、質問すると、取得した資料を根拠に引用付きで答えます。検索の手法を切り替えて、段階ごとの中間結果を比べられます。
			</p>
			{"message" in knowledge ? (
				<Alert variant="destructive">
					<AlertTitle>ナレッジベースに接続できません</AlertTitle>
					<AlertDescription>{knowledge.message}</AlertDescription>
				</Alert>
			) : (
				<>
					<section aria-labelledby="knowledge-title" className="flex flex-col gap-3">
						<h2 id="knowledge-title" className="text-lg font-semibold">
							ナレッジベース
						</h2>
						<IngestPanel initial={knowledge.info} />
					</section>
					<section aria-labelledby="question-title" className="flex flex-col gap-3">
						<h2 id="question-title" className="text-lg font-semibold">
							質問する
						</h2>
						{defaultModel ? (
							<RagPanel
								models={models}
								defaultModelId={defaultModel.id}
								rerank={knowledge.info.rerank}
								limits={{
									topK: { min: QUERY_REQUEST_LIMITS.topKMin, max: QUERY_REQUEST_LIMITS.topKMax },
									minSimilarity: {
										min: QUERY_REQUEST_LIMITS.minSimilarityMin,
										max: QUERY_REQUEST_LIMITS.minSimilarityMax,
									},
								}}
								defaults={{ topK: DEFAULT_RAG.topK, minSimilarity: DEFAULT_RAG.minSimilarity }}
								questionMaxLength={QUERY_REQUEST_LIMITS.questionMaxLength}
								agentPersonaId={DEFAULT_PERSONA_ID}
							/>
						) : (
							<Alert>
								<AlertTitle>利用できるモデルがありません</AlertTitle>
								<AlertDescription>
									実行モードに合うモデルの認証情報（API キー）または Ollama
									の設定を確認してください。
								</AlertDescription>
							</Alert>
						)}
					</section>
				</>
			)}
		</div>
	);
}
