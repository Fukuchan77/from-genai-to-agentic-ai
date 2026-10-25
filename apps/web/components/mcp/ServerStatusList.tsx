import type { McpServerStatus, McpToolStatus } from "@platform/ai-core/mcp";
import { Badge } from "@/components/ui/badge";

export interface ServerStatusListProps {
	/** Each configured server as `GET /api/mcp/servers` reports it (no secret is ever in it). */
	readonly servers: readonly McpServerStatus[];
}

const NO_REASON = "理由は報告されていません。";

function ToolRisk({ risk }: { readonly risk: McpToolStatus["risk"] }) {
	return <Badge variant={risk === "read-only" ? "secondary" : "destructive"}>{risk}</Badge>;
}

function LoadedTools({
	serverId,
	tools,
}: {
	readonly serverId: string;
	readonly tools: readonly McpToolStatus[];
}) {
	if (tools.length === 0) {
		return <p className="text-sm text-muted-foreground">読み込んだツールはありません。</p>;
	}
	return (
		<div className="flex flex-col gap-1">
			<h4 className="text-xs font-semibold text-muted-foreground">読み込んだツール</h4>
			<ul aria-label={`${serverId} の読み込んだツール`} className="flex flex-col gap-1 text-sm">
				{tools.map((tool) => (
					<li key={tool.name} className="flex flex-wrap items-center gap-2">
						<code>{tool.name}</code>
						<ToolRisk risk={tool.risk} />
					</li>
				))}
			</ul>
		</div>
	);
}

function RefusedTools({
	serverId,
	tools,
}: {
	readonly serverId: string;
	readonly tools: readonly McpToolStatus[];
}) {
	if (tools.length === 0) return null;
	return (
		<div className="flex flex-col gap-1">
			<h4 className="text-xs font-semibold text-muted-foreground">拒否したツール</h4>
			<ul aria-label={`${serverId} の拒否したツール`} className="flex flex-col gap-2 text-sm">
				{tools.map((tool) => (
					<li key={tool.name} className="flex flex-col gap-1 rounded-md border border-border p-2">
						<span className="flex flex-wrap items-center gap-2">
							<code>{tool.name}</code>
							<ToolRisk risk={tool.risk} />
						</span>
						<span className="text-muted-foreground">{tool.disabledReason ?? NO_REASON}</span>
					</li>
				))}
			</ul>
		</div>
	);
}

/**
 * The state of each MCP server, the tools it loaded and the ones it refused with the reason (plan
 * C14, Req 1.10, 1.15, 1.17). The server decided all of it; this only shows it. The region is
 * `aria-live="polite"` so a server that drops mid-session is announced.
 */
export function ServerStatusList({ servers }: ServerStatusListProps) {
	return (
		<section aria-label="MCP サーバーの状態" aria-live="polite" className="flex flex-col gap-3">
			{servers.length === 0 ? (
				<p className="text-sm text-muted-foreground">接続先の MCP サーバーはありません。</p>
			) : (
				<ul aria-label="MCP サーバー" className="flex flex-col gap-3">
					{servers.map((server) => {
						const loaded = server.tools.filter((tool) => tool.registered);
						const refused = server.tools.filter((tool) => !tool.registered);
						const connected = server.state === "connected";
						return (
							<li
								key={server.id}
								data-server={server.id}
								className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4"
							>
								<div className="flex flex-wrap items-center gap-2">
									<span className="font-semibold">{server.id}</span>
									<Badge variant={connected ? "default" : "destructive"}>
										{connected ? "接続済み" : "利用不可"}
									</Badge>
									{connected ? (
										<span className="text-xs text-muted-foreground">
											{`読み込み ${loaded.length} 個 / 拒否 ${refused.length} 個`}
										</span>
									) : null}
								</div>
								{connected ? null : (
									<p className="text-sm">
										{`原因: ${server.reason ?? NO_REASON} このサーバーのツールは使えません。`}
									</p>
								)}
								{connected ? <LoadedTools serverId={server.id} tools={loaded} /> : null}
								<RefusedTools serverId={server.id} tools={refused} />
							</li>
						);
					})}
				</ul>
			)}
		</section>
	);
}
