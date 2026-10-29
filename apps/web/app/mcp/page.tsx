import { DEFAULT_TOOLS } from "@platform/ai-core/config";
import type { McpServerStatus } from "@platform/ai-core/mcp";
import { M3_1_SAMPLE_TASKS } from "@platform/ai-core/mock";
import type { Metadata } from "next";
import { GET as getServers } from "@/app/api/mcp/servers/route";
import { McpPanel } from "@/components/mcp/McpPanel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { getPlatform } from "@/lib/server/platform";

export const metadata: Metadata = { title: "MCP" };

// The servers' state and the model list depend on the running server.
export const dynamic = "force-dynamic";

const SERVERS_UNAVAILABLE_MESSAGE =
	"MCP サーバーの状態を取得できませんでした。MCP の設定（許可ルートなど）を確認してください。";

interface ServersInfo {
	readonly servers: readonly McpServerStatus[];
	readonly limits: { readonly maxTools: number };
	readonly think: { readonly enabled: boolean };
}

/**
 * The state `GET /api/mcp/servers` reports, read through the handler itself so the page and the
 * API cannot disagree. A failure becomes a message, not a crashed page.
 */
async function loadServers(): Promise<
	{ readonly info: ServersInfo } | { readonly message: string }
> {
	try {
		const response = await getServers();
		if (response.ok) return { info: (await response.json()) as ServersInfo };
		const body = (await response.json()) as { error?: { message?: string } };
		return { message: body.error?.message ?? SERVERS_UNAVAILABLE_MESSAGE };
	} catch {
		return { message: SERVERS_UNAVAILABLE_MESSAGE };
	}
}

export default async function McpPage() {
	const { gateway, config } = await getPlatform();
	const models = gateway
		.availableModels()
		.filter((model) => model.capabilities.tools && !model.capabilities.embedding);
	const defaultModel = models.find((model) => model.id === config.models.chat) ?? models[0];
	const loaded = await loadServers();

	return (
		<div className="flex flex-col gap-6">
			<h1 className="text-2xl font-bold">MCP（Model Context Protocol）</h1>
			<p className="text-muted-foreground">
				MCP
				サーバーのツールをエージェントに使わせます。読み込んだツールと拒否したツール、許可リスト、高水準ツールと低レベルツールの比較を確かめられます。
			</p>
			{"message" in loaded ? (
				<Alert variant="destructive">
					<AlertTitle>MCP サーバーの状態を取得できません</AlertTitle>
					<AlertDescription>{loaded.message}</AlertDescription>
				</Alert>
			) : defaultModel ? (
				<McpPanel
					models={models}
					defaultModelId={defaultModel.id}
					initialServers={loaded.info.servers}
					maxTools={loaded.info.limits.maxTools ?? DEFAULT_TOOLS.maxToolsPerAgent}
					thinkEnabled={loaded.info.think.enabled}
					examples={[
						{ label: "一覧して先頭を読む", text: M3_1_SAMPLE_TASKS.listAndRead },
						{ label: "許可ルートの外を読む（エラーになる）", text: M3_1_SAMPLE_TASKS.outsideRoot },
					]}
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
