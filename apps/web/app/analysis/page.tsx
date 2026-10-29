import { DEFAULT_ANALYSIS } from "@platform/ai-core/config";
import type { Metadata } from "next";
import { GET as getAnalysisStatus } from "@/app/api/analysis/status/route";
import { AnalysisPanel } from "@/components/analysis/AnalysisPanel";
import type { AnalysisStatusResponse } from "@/components/analysis/SandboxNotice";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { getPlatform } from "@/lib/server/platform";

export const metadata: Metadata = { title: "データ分析" };

// The sandbox selection depends on the running server (Docker, E2B key), so it is read per request.
export const dynamic = "force-dynamic";

const STATUS_UNAVAILABLE_MESSAGE =
	"分析エージェントの状態を取得できませんでした。サーバーの設定を確認してください。";

/**
 * The state `GET /api/analysis/status` reports, read through the handler itself so the page and the
 * API cannot disagree. A failure becomes a message, not a crashed page.
 */
async function loadStatus(): Promise<
	{ readonly status: AnalysisStatusResponse } | { readonly message: string }
> {
	try {
		const response = await getAnalysisStatus();
		if (response.ok) return { status: (await response.json()) as AnalysisStatusResponse };
		const body = (await response.json()) as { error?: { message?: string } };
		return { message: body.error?.message ?? STATUS_UNAVAILABLE_MESSAGE };
	} catch {
		return { message: STATUS_UNAVAILABLE_MESSAGE };
	}
}

export default async function AnalysisPage() {
	const { gateway, config } = await getPlatform();
	const models = gateway
		.availableModels()
		.filter((model) => model.capabilities.tools && !model.capabilities.embedding);
	const defaultModel = models.find((model) => model.id === config.models.chat) ?? models[0];
	const loaded = await loadStatus();

	return (
		<div className="flex flex-col gap-8">
			<h1 className="text-2xl font-bold">データ分析</h1>
			<p className="text-muted-foreground">
				CSV や Excel のファイルと指示を渡すと、エージェントが Python
				のコードを書き、サンドボックスの中で実行して、表と図で答えます。コードがエラーになったときは、自分で直して再実行します。
			</p>
			{"message" in loaded ? (
				<Alert variant="destructive">
					<AlertTitle>分析エージェントの状態を取得できません</AlertTitle>
					<AlertDescription>{loaded.message}</AlertDescription>
				</Alert>
			) : (
				<AnalysisPanel
					status={loaded.status}
					models={models}
					defaultModelId={defaultModel?.id ?? ""}
					limits={{
						maxFigureBytes: DEFAULT_ANALYSIS.maxFigureBytes,
						maxTableRows: DEFAULT_ANALYSIS.maxTableRows,
					}}
				/>
			)}
		</div>
	);
}
