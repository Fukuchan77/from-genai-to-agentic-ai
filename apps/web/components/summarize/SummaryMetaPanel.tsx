/**
 * What the Route Handler sends in `data-summary-meta` (`SummaryMeta`, ai-core). Optional rather
 * than `| undefined`: JSON drops the fields a provider did not report.
 */
export interface SummaryMetaView {
	readonly strategy: "whole" | "staged";
	readonly estimatedInputTokens: number;
	readonly actualInputTokens?: number | undefined;
	readonly chunks: number;
	readonly cacheReadTokens?: number | undefined;
	/** Attempts of the call that produced the summary; regenerations are `attempts - 1`. */
	readonly attempts: number;
}

const formatCount = (value: number) => value.toLocaleString("ja-JP");

function Row({ label, value }: { readonly label: string; readonly value: string }) {
	return (
		<div className="flex flex-wrap justify-between gap-x-4">
			<dt className="text-muted-foreground">{label}</dt>
			<dd className="font-medium tabular-nums">{value}</dd>
		</div>
	);
}

/** How the summary was produced: strategy, input tokens, cache reads, regenerations (Req 4.8, 4.12). */
export function SummaryMetaPanel({ meta }: { readonly meta: SummaryMetaView }) {
	return (
		<section
			aria-label="要約の処理情報"
			className="rounded-lg border border-border bg-card p-4 text-sm text-card-foreground"
		>
			<dl className="flex flex-col gap-2">
				<Row
					label="処理方式"
					value={
						meta.strategy === "whole"
							? "全文を一度に入力"
							: `分割して段階的に要約（${meta.chunks} 分割）`
					}
				/>
				<Row label="入力トークン（推定）" value={formatCount(meta.estimatedInputTokens)} />
				<Row
					label="入力トークン（実測）"
					value={
						meta.actualInputTokens === undefined
							? "取得できませんでした"
							: formatCount(meta.actualInputTokens)
					}
				/>
				<Row
					label="キャッシュ読み出し"
					value={
						meta.cacheReadTokens === undefined
							? "記録なし"
							: `${formatCount(meta.cacheReadTokens)} トークン`
					}
				/>
				<Row label="再生成回数" value={`${Math.max(0, meta.attempts - 1)} 回`} />
			</dl>
		</section>
	);
}
