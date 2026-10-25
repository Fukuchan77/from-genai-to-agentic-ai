import type {
	CouncilEndReason,
	CouncilMissing,
	CouncilRound,
	CouncilTurnEvent,
} from "@platform/ai-core/marketing";
import { Badge } from "@/components/ui/badge";

/** One `data-council-turn` part: a statement with the persona's name (Req 6.3). */
export type CouncilTurnView = Pick<
	CouncilTurnEvent,
	"round" | "personaId" | "personaName" | "text" | "failed"
> & {
	/** The part id (`turn-<n>`), unique per statement. */
	readonly id: string;
};

/** One `data-council-verdict` part: a round's verdict with its round number (Req 6.2). */
export type CouncilVerdictView = NonNullable<CouncilRound["verdict"]> & {
	readonly round: number;
};

/** The per-round summary inside `data-council-result`. */
export interface CouncilResultRoundView {
	readonly round: number;
	/** How many statements the round had; the statements themselves came as turns. */
	readonly statements: number;
	readonly missing: readonly CouncilMissing[];
	readonly verdict?: NonNullable<CouncilRound["verdict"]>;
}

/** `data-council-result`: the improved draft and why the council ended (Req 6.2). */
export interface CouncilResultView {
	readonly improvedDraft: string;
	readonly endReason: CouncilEndReason;
	readonly rounds: readonly CouncilResultRoundView[];
}

export interface CouncilTimelineProps {
	readonly turns: readonly CouncilTurnView[];
	readonly verdicts: readonly CouncilVerdictView[];
	/** Present once the council ended. */
	readonly result?: CouncilResultView | undefined;
}

const END_REASON_LABELS: Readonly<Record<CouncilEndReason, string>> = {
	agreed: "合意に達したため終了しました",
	"max-rounds": "ラウンドの上限に達したため終了しました",
	"budget-exhausted": "トークンの予算を使い切ったため終了しました",
};

/**
 * The statements of the rounds that were settled. A round is settled when its verdict arrived or
 * the result lists it (a round the budget cut off before the moderator judged has no verdict).
 * When the stream fails, the
 * panel keeps only these, so a statement of a round that was never confirmed does not stay on the
 * screen as if it had counted (W6 review F-17).
 */
export function confirmedRoundTurns(input: {
	readonly turns: readonly CouncilTurnView[];
	readonly verdicts: readonly CouncilVerdictView[];
	readonly result?: CouncilResultView | undefined;
}): CouncilTurnView[] {
	const { turns, verdicts, result } = input;
	const confirmed = new Set([
		...verdicts.map(({ round }) => round),
		...(result?.rounds.map(({ round }) => round) ?? []),
	]);
	return turns.filter(({ round }) => confirmed.has(round));
}

interface RoundGroup {
	readonly round: number;
	readonly turns: CouncilTurnView[];
}

function groupByRound(
	turns: readonly CouncilTurnView[],
	verdicts: readonly CouncilVerdictView[],
	result: CouncilResultView | undefined,
): RoundGroup[] {
	const groups = new Map<number, CouncilTurnView[]>();
	const rounds = [
		...turns.map(({ round }) => round),
		...verdicts.map(({ round }) => round),
		...(result?.rounds.map(({ round }) => round) ?? []),
	];
	for (const round of rounds) if (!groups.has(round)) groups.set(round, []);
	for (const turn of turns) groups.get(turn.round)?.push(turn);
	return [...groups.entries()]
		.sort(([a], [b]) => a - b)
		.map(([round, roundTurns]) => ({ round, turns: roundTurns }));
}

function VerdictView({
	verdict,
	settled,
}: {
	readonly verdict: CouncilVerdictView | CouncilResultRoundView["verdict"] | undefined;
	readonly settled: boolean;
}) {
	if (verdict === undefined) {
		return (
			<p className="text-sm text-muted-foreground">{settled ? "判定なし" : "判定を待っています"}</p>
		);
	}
	return (
		<div className="flex flex-col gap-1 text-sm">
			<p className="flex flex-wrap items-center gap-2">
				<Badge variant={verdict.agreed ? "default" : "secondary"}>
					{verdict.agreed ? "合意しました" : "合意に至っていません"}
				</Badge>
				<span className="whitespace-pre-wrap">{verdict.reason}</span>
			</p>
			{verdict.remainingObjections.length > 0 ? (
				<ul aria-label="残っている懸念" className="list-disc pl-5 text-muted-foreground">
					{verdict.remainingObjections.map((objection) => (
						<li key={objection}>{objection}</li>
					))}
				</ul>
			) : null}
		</div>
	);
}

/**
 * The council as it unfolds, round by round (plan C14, Req 6.2, 6.3): each statement under the
 * persona's name, then the round's verdict, and at the end the improved draft and why it ended. The
 * whole region is a polite live log so a screen reader hears each addition. Statements and drafts are
 * drawn as plain text (a text node, never HTML).
 */
export function CouncilTimeline({ turns, verdicts, result }: CouncilTimelineProps) {
	const verdictByRound = new Map(verdicts.map((verdict) => [verdict.round, verdict]));
	const summaryByRound = new Map(result?.rounds.map((summary) => [summary.round, summary]));
	return (
		<div role="log" aria-label="合議の経過" aria-live="polite" className="flex flex-col gap-4">
			{groupByRound(turns, verdicts, result).map(({ round, turns: roundTurns }) => {
				const summary = summaryByRound.get(round);
				const missing = summary?.missing ?? [];
				return (
					<section
						key={round}
						aria-label={`ラウンド ${round}`}
						className="flex flex-col gap-2 rounded-md border p-3"
					>
						<h3 className="text-sm font-semibold">ラウンド {round}</h3>
						{roundTurns.map((turn) => (
							<div key={turn.id} className="flex flex-col gap-1">
								<h4 className="text-sm font-medium">{turn.personaName}</h4>
								{turn.failed ? (
									<p className="text-sm text-muted-foreground">発言できませんでした</p>
								) : (
									<p className="whitespace-pre-wrap text-sm">{turn.text}</p>
								)}
							</div>
						))}
						{missing.length > 0 ? (
							<p className="text-xs text-muted-foreground">
								発言なし:{" "}
								{missing.map(({ personaName, reason }) => `${personaName}（${reason}）`).join("、")}
							</p>
						) : null}
						<VerdictView
							verdict={verdictByRound.get(round) ?? summary?.verdict}
							settled={result !== undefined}
						/>
					</section>
				);
			})}
			{result === undefined ? null : (
				<section
					aria-label="合議の結果"
					className="flex flex-col gap-2 rounded-md border bg-muted p-3"
				>
					<p className="text-sm font-medium">{END_REASON_LABELS[result.endReason]}</p>
					<h3 className="text-sm font-semibold">改善後の文案</h3>
					<p className="whitespace-pre-wrap text-sm">{result.improvedDraft}</p>
				</section>
			)}
		</div>
	);
}
