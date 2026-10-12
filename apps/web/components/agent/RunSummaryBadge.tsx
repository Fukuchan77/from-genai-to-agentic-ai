import type { AgentRunSummary, StopReason } from "@platform/ai-core/agents";
import { Badge } from "@/components/ui/badge";

const numberFormat = new Intl.NumberFormat("ja-JP");

const STOP_REASON_LABELS: Readonly<Record<StopReason, string>> = {
	completed: "完了",
	"step-limit": "ステップ数の上限",
	"token-budget": "トークン予算の上限",
	timeout: "実行時間の上限",
	aborted: "中断",
	error: "エラー",
};

function formatElapsed(elapsedMs: number): string {
	return elapsedMs < 1000
		? `${numberFormat.format(Math.round(elapsedMs))} ミリ秒`
		: `${(elapsedMs / 1000).toFixed(1)} 秒`;
}

export interface RunSummaryBadgeProps {
	/** The `run` of the finish metadata; absent when the stream ended without one. */
	readonly run: AgentRunSummary | undefined;
	/** Which display to use when `run` is absent: the learner stopped the run, or it failed. */
	readonly outcome?: "interrupted" | "error";
}

function Row({ term, children }: { term: string; children: React.ReactNode }) {
	return (
		<div className="flex flex-wrap gap-x-2">
			<dt className="text-muted-foreground">{term}</dt>
			<dd className="font-medium">{children}</dd>
		</div>
	);
}

/**
 * Why and how a run ended (Req 5.6, 6.2): stop reason, steps, tokens, elapsed time and the tools
 * called. Stopping or failing can end the stream before `finish`, so without `run` it shows an
 * interrupted or error display instead (plan C8 / C16).
 */
export function RunSummaryBadge({ run, outcome = "interrupted" }: RunSummaryBadgeProps) {
	if (run === undefined) {
		const interrupted = outcome === "interrupted";
		return (
			<section
				role="status"
				aria-label="実行サマリ"
				className="flex flex-wrap items-center gap-2 text-sm"
			>
				<Badge variant={interrupted ? "secondary" : "destructive"}>
					{interrupted ? "中断" : "エラー"}
				</Badge>
				<span className="text-muted-foreground">
					実行サマリは届いていません。
					{interrupted ? "実行は途中で止められました。" : "実行中にエラーが発生しました。"}
				</span>
			</section>
		);
	}
	const { totalTokens } = run;
	return (
		<section
			role="status"
			aria-label="実行サマリ"
			className="flex flex-col gap-2 rounded-md border border-border bg-muted p-3 text-sm"
		>
			<div className="flex items-center gap-2">
				<span className="text-muted-foreground">停止理由</span>
				<Badge variant={run.stopReason === "completed" ? "default" : "secondary"}>
					{STOP_REASON_LABELS[run.stopReason]}
				</Badge>
			</div>
			{run.error ? <p>{run.error.message}</p> : null}
			<dl className="flex flex-col gap-1">
				<Row term="ステップ数">{numberFormat.format(run.steps)}</Row>
				<Row term="トークン">
					{`入力 ${numberFormat.format(totalTokens.input)} / 出力 ${numberFormat.format(totalTokens.output)}`}
				</Row>
				{totalTokens.cacheRead > 0 ? (
					<Row term="キャッシュ">{`キャッシュ読み出し ${numberFormat.format(totalTokens.cacheRead)}`}</Row>
				) : null}
				{totalTokens.reasoning > 0 ? (
					<Row term="推論">{`推論 ${numberFormat.format(totalTokens.reasoning)}`}</Row>
				) : null}
				<Row term="経過時間">{formatElapsed(run.elapsedMs)}</Row>
				<Row term="呼び出したツール">
					{run.toolsCalled.length === 0 ? (
						"なし"
					) : (
						<ol aria-label="呼び出したツール" className="flex flex-wrap gap-x-2">
							{run.toolsCalled.map((name, index) => (
								// Calls repeat and keep their order, so the index is the identity.
								// biome-ignore lint/suspicious/noArrayIndexKey: see above
								<li key={index}>{name}</li>
							))}
						</ol>
					)}
				</Row>
			</dl>
		</section>
	);
}
