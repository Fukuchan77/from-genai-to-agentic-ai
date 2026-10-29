"use client";

import type { StopReason } from "@platform/ai-core/agents";
import { ErrorBanner } from "@/components/chat/ErrorBanner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/** One measured run, as `POST /api/mcp/compare` reports it. */
export interface CompareRun {
	readonly steps: number;
	readonly tokens: number;
	readonly stopReason: StopReason;
	readonly toolsCalled: readonly string[];
	/** Set when the run did not finish. */
	readonly failed?: boolean;
	/** Vetted text from the server, present only when the run ended in `error`. */
	readonly error?: { readonly code: string; readonly message: string };
}

/** The body of a successful `POST /api/mcp/compare`. A missing `ratio` is a ratio not computed. */
export interface CompareResult {
	readonly highLevel: CompareRun;
	readonly lowLevel: CompareRun;
	readonly comparison: {
		/** Low-level steps minus high-level steps: positive means the high-level tool saved some. */
		readonly steps: number;
		readonly tokens: number;
		readonly ratio?: number;
	};
}

export interface CompareViewProps {
	readonly result?: CompareResult | undefined;
	/** A comparison is running; the button is held back and the wait is announced. */
	readonly running?: boolean;
	/** The request failed before a result came back. */
	readonly error?: Error | undefined;
	readonly onRun: () => void;
}

const STOP_REASON_LABELS: Readonly<Record<StopReason, string>> = {
	completed: "完了",
	"step-limit": "ステップ上限",
	"token-budget": "トークン予算",
	timeout: "タイムアウト",
	aborted: "中断",
	error: "エラー",
};

const APPROACHES = [
	{ key: "highLevel", label: "高水準" },
	{ key: "lowLevel", label: "低レベル" },
] as const;

/** "高水準のほうが N <unit>少ない / 多い", or "同じ" when the two cost the same. */
function describeSaving(saved: number, unit: string): string {
	if (saved === 0) return "同じ";
	return `高水準のほうが ${Math.abs(saved)} ${unit}${saved > 0 ? "少ない" : "多い"}`;
}

function Summary({ result }: { readonly result: CompareResult }) {
	const { highLevel, lowLevel, comparison } = result;
	const failed = highLevel.failed === true || lowLevel.failed === true;
	return (
		<fieldset className="flex min-w-0 flex-col gap-1 border-0 p-0 text-sm">
			<legend className="sr-only">比較の要約</legend>
			{failed ? (
				<p>失敗した実行があるため、差と比率は示しません。</p>
			) : (
				<>
					<p>{`ステップ数: ${describeSaving(comparison.steps, "ステップ")}`}</p>
					<p>{`トークン数: ${describeSaving(comparison.tokens, "トークン")}`}</p>
					{comparison.ratio === undefined ? (
						<p>低レベルのトークン数が 0 のため、比率は計算できません。</p>
					) : (
						<p>
							{`比率（高水準 ÷ 低レベル）: ${comparison.ratio.toFixed(2)}（高水準は低レベルの ${Math.round(comparison.ratio * 100)}%）`}
						</p>
					)}
				</>
			)}
		</fieldset>
	);
}

/**
 * The same task done with one high-level tool and with low-level tools in combination (plan C14,
 * Req 1.12). The server measured and compared; this shows the numbers, flags the side that did not
 * finish, and shows no ratio the server did not compute. The region is `aria-live="polite"` so the
 * result is announced when it arrives.
 */
export function CompareView({ result, running = false, error, onRun }: CompareViewProps) {
	const rows = result
		? ([
				["ステップ数", (run: CompareRun) => String(run.steps)],
				["トークン数", (run: CompareRun) => String(run.tokens)],
				["停止理由", (run: CompareRun) => STOP_REASON_LABELS[run.stopReason]],
				[
					"呼んだツール",
					(run: CompareRun) => (run.toolsCalled.length === 0 ? "なし" : run.toolsCalled.join(", ")),
				],
			] as const)
		: [];
	return (
		<section aria-label="高水準と低レベルの比較" aria-live="polite" className="flex flex-col gap-3">
			<p className="text-sm text-muted-foreground">
				同じ作業（ファイルを探して読む）を、高水準ツール <code>findAndReadFiles</code> 1
				つで行う場合と、低レベルツール <code>searchFiles</code> と <code>readFile</code>{" "}
				の組み合わせで行う場合で、ステップ数とトークン数を比べます。
			</p>
			<div>
				<Button type="button" variant="outline" disabled={running} onClick={onRun}>
					比較を実行
				</Button>
			</div>
			{running ? (
				<p role="status">比較を実行しています。2 つの実行を順に行うため、少し時間がかかります。</p>
			) : null}
			{error ? <ErrorBanner error={error} onRetry={onRun} /> : null}
			{result ? (
				<>
					<table className="w-full border-collapse text-sm">
						<caption className="sr-only">高水準と低レベルの比較</caption>
						<thead>
							<tr className="border-b border-border text-left">
								<th scope="col" className="py-1 pr-3 font-medium" />
								{APPROACHES.map(({ key, label }) => (
									<th key={key} scope="col" className="py-1 pr-3 font-medium">
										{label}
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{rows.map(([name, format]) => (
								<tr key={name} className="border-b border-border">
									<th scope="row" className="py-1 pr-3 text-left font-medium">
										{name}
									</th>
									{APPROACHES.map(({ key }) => (
										<td key={key} className="py-1 pr-3">
											{format(result[key])}
										</td>
									))}
								</tr>
							))}
						</tbody>
					</table>
					{APPROACHES.map(({ key, label }) => {
						const run = result[key];
						if (run.failed !== true) return null;
						return (
							<Alert key={key} variant="destructive">
								<AlertTitle>{`${label}の実行は完了しませんでした`}</AlertTitle>
								<AlertDescription>
									<p>{`停止理由: ${STOP_REASON_LABELS[run.stopReason]}`}</p>
									{run.error ? (
										<>
											<p>{run.error.message}</p>
											<p className="text-xs">
												エラーコード: <code>{run.error.code}</code>
											</p>
										</>
									) : null}
								</AlertDescription>
							</Alert>
						);
					})}
					<Summary result={result} />
				</>
			) : null}
		</section>
	);
}
