import type { Metadata } from "next";
import { SummaryPanel } from "@/components/summarize/SummaryPanel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { getPlatform } from "@/lib/server/platform";

export const metadata: Metadata = { title: "要約" };

// The model list depends on the run mode and credentials of the running server.
export const dynamic = "force-dynamic";

export default async function SummarizePage() {
	const { gateway, config } = await getPlatform();
	const models = gateway
		.availableModels()
		.filter((model) => model.capabilities.structuredOutput && !model.capabilities.embedding);
	const defaultModel = models.find((model) => model.id === config.models.structured) ?? models[0];

	return (
		<div className="flex flex-col gap-6">
			<h1 className="text-2xl font-bold">要約</h1>
			<p className="text-sm text-muted-foreground">
				記事の URL、YouTube の
				URL、または字幕テキストを要約します。確定した項目から順に表示されます。
			</p>
			{defaultModel ? (
				<SummaryPanel models={models} defaultModelId={defaultModel.id} />
			) : (
				<Alert>
					<AlertTitle>構造化出力に対応したモデルがありません</AlertTitle>
					<AlertDescription>
						実行モードに合うモデルの認証情報（API キー）または Ollama の設定を確認してください。
					</AlertDescription>
				</Alert>
			)}
		</div>
	);
}
