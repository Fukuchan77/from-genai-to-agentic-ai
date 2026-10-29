import type { AnalysisAttempt, AnalysisStatus } from "@platform/ai-core/analysis";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/components/ui/utils";

export interface AttemptListProps {
	/** The runs so far, in order (`data-analysis-attempt` parts). */
	readonly attempts: readonly AnalysisAttempt[];
	/** The result's status once the analysis ended; `attempt-limit` highlights the last run. */
	readonly status?: AnalysisStatus | undefined;
	/** The fix count the server reported; derived from the runs while the analysis is going on. */
	readonly fixes?: number | undefined;
}

const BLOCK_CLASS =
	"max-h-72 overflow-auto rounded-md border border-border bg-muted p-3 font-mono text-xs text-foreground focus-visible:outline-2 focus-visible:outline-offset-2";

/** A run that follows a failed run is a fix; the first run and a run after a success are not. */
function fixNumbers(attempts: readonly AnalysisAttempt[]): readonly (number | undefined)[] {
	let fixes = 0;
	return attempts.map((_attempt, position) => {
		if (attempts[position - 1]?.errorSummary !== undefined) {
			fixes += 1;
			return fixes;
		}
		return undefined;
	});
}

function Stream({ label, text, name }: { label: string; text: string; name: string }) {
	return (
		<div className="flex flex-col gap-1">
			<p className="text-xs font-medium text-muted-foreground">{label}</p>
			{text === "" ? (
				<p className="text-xs text-muted-foreground">（出力なし）</p>
			) : (
				// biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be reachable by keyboard
				<section tabIndex={0} aria-label={name} className={BLOCK_CLASS}>
					<pre className="whitespace-pre-wrap break-words">{text}</pre>
				</section>
			)}
		</div>
	);
}

/**
 * The history of the generated code's runs (plan C14, Req 3.4, 3.6): for each run its code,
 * standard output, error output and whether it was a fix. When the fixes were used up
 * (`attempt-limit`) the analysis stopped and the last code and error are highlighted. All text
 * is rendered as text, never as markup.
 */
export function AttemptList({ attempts, status, fixes }: AttemptListProps) {
	const limitReached = status === "attempt-limit";
	if (attempts.length === 0 && !limitReached) return null;
	const numbers = fixNumbers(attempts);
	const totalFixes = fixes ?? numbers.filter((value) => value !== undefined).length;

	return (
		<section aria-label="試行履歴" aria-live="polite" className="flex flex-col gap-3">
			<p className="text-sm text-muted-foreground">{`修正回数: ${totalFixes} 回`}</p>
			{limitReached ? (
				<Alert variant="destructive">
					<AlertTitle>修正回数の上限に達したため停止しました</AlertTitle>
					<AlertDescription>
						コードが成功しなかったため、実行を止めました。最後のコードとエラーを確認してください。
					</AlertDescription>
				</Alert>
			) : null}
			<ol aria-label="試行の履歴" className="flex flex-col gap-3">
				{attempts.map((attempt, position) => {
					const highlighted = limitReached && position === attempts.length - 1;
					const fix = numbers[position];
					return (
						<li
							key={attempt.index}
							className={cn(
								"flex flex-col gap-2 rounded-md border p-3",
								highlighted ? "border-destructive" : "border-border",
							)}
						>
							<div className="flex flex-wrap items-center gap-2">
								<h3 className="text-sm font-semibold">{`試行 ${attempt.index}`}</h3>
								<Badge variant="outline">
									{fix === undefined ? "通常の実行" : `修正 ${fix} 回目`}
								</Badge>
								<Badge variant={attempt.errorSummary === undefined ? "secondary" : "destructive"}>
									{attempt.errorSummary === undefined ? "成功" : "エラー"}
								</Badge>
								{highlighted ? <Badge variant="destructive">最後のコードとエラー</Badge> : null}
							</div>
							{attempt.errorSummary === undefined ? null : (
								<p className="text-sm font-medium text-destructive">{attempt.errorSummary}</p>
							)}
							<Stream label="コード" text={attempt.code} name={`試行 ${attempt.index} のコード`} />
							<Stream
								label="標準出力"
								text={attempt.stdout}
								name={`試行 ${attempt.index} の標準出力`}
							/>
							<Stream
								label="エラー出力"
								text={attempt.stderr}
								name={`試行 ${attempt.index} のエラー出力`}
							/>
						</li>
					);
				})}
			</ol>
		</section>
	);
}
