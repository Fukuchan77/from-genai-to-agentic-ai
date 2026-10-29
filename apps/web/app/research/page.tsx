import { DEFAULT_RESEARCH } from "@platform/ai-core/config";
import { RESEARCH_REQUEST_LIMITS } from "@platform/ai-core/research";
import type { Metadata } from "next";
import { ResearchPanel } from "@/components/research/ResearchPanel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { getPlatform } from "@/lib/server/platform";

export const metadata: Metadata = { title: "リサーチ" };

// The model list depends on the running server (mode and credentials).
export const dynamic = "force-dynamic";

export default async function ResearchPage() {
	const { gateway, config } = await getPlatform();
	// The supervisor and the sub-agents call tools, so a model without them is not offered.
	const models = gateway
		.availableModels()
		.filter((model) => model.capabilities.tools && !model.capabilities.embedding);
	const defaultModel = models.find((model) => model.id === config.models.chat) ?? models[0];

	return (
		<div className="flex flex-col gap-8">
			<h1 className="text-2xl font-bold">階層型リサーチ</h1>
			<p className="text-muted-foreground">
				テーマを入力すると、Supervisor
				が検索・読解・市場の各サブエージェントに調査を任せ、引用を確認したレポートにまとめます。各主体の動きとトークンの内訳も確認できます。
			</p>
			{defaultModel ? (
				<ResearchPanel
					models={models}
					defaultModelId={defaultModel.id}
					themeMaxLength={RESEARCH_REQUEST_LIMITS.themeMaxCharacters}
					calls={{
						min: RESEARCH_REQUEST_LIMITS.maxSubagentCallsMin,
						max: RESEARCH_REQUEST_LIMITS.maxSubagentCallsMax,
						default: DEFAULT_RESEARCH.maxSubagentCalls,
					}}
				/>
			) : (
				<Alert>
					<AlertTitle>利用できるモデルがありません</AlertTitle>
					<AlertDescription>
						ツール呼び出しに対応したモデルの認証情報（API キー）または Ollama
						の設定を確認してください。
					</AlertDescription>
				</Alert>
			)}
		</div>
	);
}
