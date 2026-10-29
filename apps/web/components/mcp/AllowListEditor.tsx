"use client";

import type { McpAllowList, McpServerStatus } from "@platform/ai-core/mcp";
import { Button } from "@/components/ui/button";

export interface AllowListEditorProps {
	/** The servers as `GET /api/mcp/servers` reports them; only a loaded tool can be selected. */
	readonly servers: readonly McpServerStatus[];
	/** Server ID → the tool names the next chat loads. */
	readonly value: McpAllowList;
	/** Called with the complete allow-list: every connected server, with an empty entry if none. */
	readonly onChange: (next: McpAllowList) => void;
	/** The per-agent tool limit (`limits.maxTools`). The server enforces it; this only shows it. */
	readonly maxTools: number;
	/** Tools the agent has besides the MCP ones (the think tool), which count against the limit. */
	readonly reservedTools?: number;
	readonly disabled?: boolean;
}

const CHECKBOX_CLASS = "size-4 shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2";

function loadable(server: McpServerStatus): readonly string[] {
	return server.tools.filter((tool) => tool.registered).map((tool) => tool.name);
}

function countOf(value: McpAllowList): number {
	return Object.values(value).reduce((total, names) => total + names.length, 0);
}

/**
 * The allow-list editor (plan C14, Req 1.8, 1.15). The learner can only narrow what the server
 * loaded, so the checkboxes cover the loaded tools. The count against the 20-tool limit is shown,
 * and once it is reached the unselected tools are turned off so the request stays one the server
 * accepts. The server still validates every request.
 */
export function AllowListEditor({
	servers,
	value,
	onChange,
	maxTools,
	reservedTools = 0,
	disabled = false,
}: AllowListEditorProps) {
	const connected = servers.filter((server) => server.state === "connected");
	const count = countOf(value) + reservedTools;
	const atLimit = count >= maxTools;

	function toggle(server: McpServerStatus, name: string, checked: boolean) {
		const selected = new Set(value[server.id] ?? []);
		if (checked) selected.add(name);
		else selected.delete(name);
		onChange(buildValue(new Map([[server.id, selected]])));
	}

	// Every connected server gets an entry; `overrides` replaces the selection of the given servers.
	function buildValue(overrides: ReadonlyMap<string, ReadonlySet<string>>): McpAllowList {
		return Object.fromEntries(
			connected.map((server) => {
				const selected = overrides.get(server.id) ?? new Set(value[server.id] ?? []);
				return [server.id, loadable(server).filter((name) => selected.has(name))];
			}),
		);
	}

	function restoreDefault() {
		let room = Math.max(0, maxTools - reservedTools);
		const next: Record<string, string[]> = {};
		for (const server of connected) {
			const names = loadable(server).slice(0, room);
			room -= names.length;
			next[server.id] = names;
		}
		onChange(next);
	}

	return (
		<section aria-label="許可リストの編集" className="flex flex-col gap-3">
			{servers.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					許可リストを編集できるサーバーはありません。
				</p>
			) : (
				<>
					{servers.map((server) => (
						<fieldset
							key={server.id}
							className="flex flex-col gap-2 rounded-lg border border-border p-4"
						>
							<legend className="px-1 text-sm font-semibold">{server.id}</legend>
							{server.state === "connected" ? (
								loadable(server).map((name) => {
									const checked = (value[server.id] ?? []).includes(name);
									return (
										<label key={name} className="flex items-center gap-2 text-sm">
											<input
												type="checkbox"
												className={CHECKBOX_CLASS}
												value={name}
												checked={checked}
												disabled={disabled || (atLimit && !checked)}
												onChange={(event) => toggle(server, name, event.target.checked)}
											/>
											<code>{name}</code>
										</label>
									);
								})
							) : (
								<p className="text-sm text-muted-foreground">
									利用不可のため、ツールを選べません。
								</p>
							)}
						</fieldset>
					))}
					<div className="flex flex-wrap items-center gap-3">
						<p role="status" aria-label="選択中のツール数" aria-live="polite" className="text-sm">
							{`選択中 ${count} / ${maxTools} 個`}
							{reservedTools > 0 ? `（組み込みツール ${reservedTools} 個を含む）` : ""}
							{count === maxTools ? ` 上限の ${maxTools} 個に達しました。` : ""}
						</p>
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={disabled}
							onClick={restoreDefault}
						>
							既定に戻す
						</Button>
					</div>
					{count > maxTools ? (
						<p role="alert" className="text-sm text-destructive">
							{`ツールの数が上限の ${maxTools} 個を超えています。いくつか外してください。`}
						</p>
					) : null}
				</>
			)}
		</section>
	);
}
