import { DEFAULT_PERSONA_ID, PERSONAS } from "@platform/ai-core/chat";
import type { Metadata } from "next";
import { ToolAgentPanel } from "@/components/agent/ToolAgentPanel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { getPlatform } from "@/lib/server/platform";

export const metadata: Metadata = { title: "ツールエージェント" };

// The model list depends on the run mode and credentials of the running server.
export const dynamic = "force-dynamic";

export default async function AgentPage() {
	const { gateway, config } = await getPlatform();
	const models = gateway
		.availableModels()
		.filter((model) => model.capabilities.tools && !model.capabilities.embedding);
	const defaultModel = models.find((model) => model.id === config.models.chat) ?? models[0];

	return (
		<div className="flex flex-col gap-6">
			<h1 className="text-2xl font-bold">ツールエージェント</h1>
			{defaultModel ? (
				<ToolAgentPanel
					models={models}
					defaultModelId={defaultModel.id}
					personas={PERSONAS.map(({ id, title }) => ({ id, title }))}
					defaultPersonaId={DEFAULT_PERSONA_ID}
				/>
			) : (
				<Alert>
					<AlertTitle>ツール呼び出しに対応したモデルがありません</AlertTitle>
					<AlertDescription>
						実行モードに合うモデルの認証情報（API キー）または Ollama の設定を確認してください。
					</AlertDescription>
				</Alert>
			)}
		</div>
	);
}
