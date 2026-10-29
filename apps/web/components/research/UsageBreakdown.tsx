import type { TokenBreakdown } from "@platform/ai-core/agents";
import { agentLabel } from "./AgentInspector";

/** The `data-research-usage` payload: the token breakdown plus the sub-agent calls against their limit. */
export interface ResearchUsageData extends TokenBreakdown {
	readonly calls: number;
	readonly maxCalls: number;
}

export interface UsageBreakdownProps {
	/** The newest `data-research-usage` (a state part: each write replaces the one before). */
	readonly usage: ResearchUsageData | undefined;
}

const ROLE_ORDER = ["supervisor", "search", "reading", "market"];

function orderedRoles(byRole: TokenBreakdown["byRole"]): string[] {
	const roles = Object.keys(byRole);
	const known = ROLE_ORDER.filter((role) => roles.includes(role));
	return [...known, ...roles.filter((role) => !ROLE_ORDER.includes(role))];
}

const CELL = "px-2 py-1 text-right tabular-nums";
const HEAD = "px-2 py-1 text-right font-medium";

/**
 * The tokens by role and in total, and the sub-agent calls against their limit (plan C14, Req 4.8,
 * 4.10). A role whose usage could not be read says `unknown` instead of showing a zero, and the
 * total is the server's figure for the known usage only: nothing is estimated or summed here.
 */
export function UsageBreakdown({ usage }: UsageBreakdownProps) {
	if (usage === undefined) {
		return <p className="text-sm text-muted-foreground">使用量はまだありません。</p>;
	}
	return (
		<div className="flex flex-col gap-2 text-sm">
			<p role="status">{`サブエージェント呼び出し: ${usage.calls} / ${usage.maxCalls}`}</p>
			<table className="w-full border-collapse">
				<caption className="sr-only">役割別のトークン内訳</caption>
				<thead>
					<tr className="border-b border-border">
						<th scope="col" className="px-2 py-1 text-left font-medium">
							主体
						</th>
						<th scope="col" className={HEAD}>
							入力
						</th>
						<th scope="col" className={HEAD}>
							出力
						</th>
						<th scope="col" className={HEAD}>
							合計
						</th>
						<th scope="col" className={HEAD}>
							実行回数
						</th>
					</tr>
				</thead>
				<tbody>
					{orderedRoles(usage.byRole).map((role) => {
						const value = usage.byRole[role];
						return (
							<tr key={role} className="border-b border-border">
								<th scope="row" className="px-2 py-1 text-left font-medium">
									{agentLabel(role)}
								</th>
								{value === undefined || value === "unknown" ? (
									<>
										<td colSpan={3} className="px-2 py-1 text-right text-muted-foreground">
											unknown
										</td>
										<td className={CELL}>不明</td>
									</>
								) : (
									<>
										<td className={CELL}>{value.inputTokens}</td>
										<td className={CELL}>{value.outputTokens}</td>
										<td className={CELL}>{value.totalTokens}</td>
										<td className={CELL}>
											{value.unknownCalls > 0
												? `${value.calls}（うち使用量不明 ${value.unknownCalls}）`
												: value.calls}
										</td>
									</>
								)}
							</tr>
						);
					})}
				</tbody>
				<tfoot>
					<tr className="font-semibold">
						<th scope="row" className="px-2 py-1 text-left">
							合計
						</th>
						<td className={CELL}>{usage.total.inputTokens}</td>
						<td className={CELL}>{usage.total.outputTokens}</td>
						<td className={CELL}>{usage.total.totalTokens}</td>
						<td className={CELL} />
					</tr>
				</tfoot>
			</table>
			<p className="text-xs text-muted-foreground">
				合計は取得できた使用量のみの和です。取得できなかった分は推定していません。
			</p>
		</div>
	);
}
