import type {
	CooperationResult,
	GoalSpec,
	MultiPathResult,
	Optimization,
	ReflectionResult,
	SinglePathResult,
} from "@platform/ai-core/patterns";
import type {
	DemoUsage,
	EvaluateAndOptimizeResult,
	OrchestrateResult,
	PromptChainResult,
	RouteByDifficultyResult,
	RouteResult,
	VoteResult,
} from "@platform/ai-core/workflows";
import type { ReactNode } from "react";
import { RunSummaryBadge } from "@/components/agent/RunSummaryBadge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

const numberFormat = new Intl.NumberFormat("ja-JP");

/** The `{ name, result, usage }` body of `POST /api/workflows`, one shape per demo name. */
export type WorkflowRun = {
	readonly usage: DemoUsage;
} & (
	| { readonly name: "prompt-chaining"; readonly result: PromptChainResult }
	| { readonly name: "routing"; readonly result: RouteResult }
	| { readonly name: "model-routing"; readonly result: RouteByDifficultyResult<string> }
	| { readonly name: "parallel-sectioning"; readonly result: SectioningResult }
	| { readonly name: "parallel-voting"; readonly result: VoteResult<string> }
	| { readonly name: "orchestrator-workers"; readonly result: OrchestrateResult<string> }
	| { readonly name: "evaluator-optimizer"; readonly result: EvaluateAndOptimizeResult }
	| { readonly name: "passive-goal-creator"; readonly result: GoalSpec }
	| { readonly name: "prompt-response-optimizer"; readonly result: Optimization }
	| { readonly name: "single-path-plan"; readonly result: SinglePathResult }
	| { readonly name: "multi-path-plan"; readonly result: MultiPathResult }
	| { readonly name: "self-reflection" | "cross-reflection"; readonly result: ReflectionResult }
	| { readonly name: "role-based-cooperation"; readonly result: CooperationResult }
);

interface SectioningResult {
	readonly sections: readonly { readonly aspect: string; readonly output: string }[];
	readonly merged: string;
}

const WORKFLOW_TITLES = {
	"prompt-chaining": "プロンプトチェーン",
	routing: "ルーティング",
	"model-routing": "モデルの使い分け",
	"parallel-sectioning": "並列化（区画分け）",
	"parallel-voting": "並列化（投票）",
	"orchestrator-workers": "オーケストレーター・ワーカー",
	"evaluator-optimizer": "評価・改善ループ",
	"passive-goal-creator": "Passive Goal Creator",
	"prompt-response-optimizer": "プロンプト / 応答の最適化",
	"single-path-plan": "単一経路の計画",
	"multi-path-plan": "複数経路の計画",
	"self-reflection": "自己反省",
	"cross-reflection": "相互反省",
	"role-based-cooperation": "役割ベースの協調",
} as const;

function Text({ children }: { readonly children: ReactNode }) {
	return <p className="whitespace-pre-wrap break-words">{children}</p>;
}

function Output({ label, children }: { readonly label: string; readonly children: ReactNode }) {
	return (
		<section aria-label={label} className="flex flex-col gap-1 rounded-md border border-border p-3">
			<h3 className="text-sm font-semibold">{label}</h3>
			<Text>{children}</Text>
		</section>
	);
}

function formatTokens(usage: { inputTokens: number; outputTokens: number }): string {
	return `入力 ${numberFormat.format(usage.inputTokens)} / 出力 ${numberFormat.format(usage.outputTokens)}`;
}

function PromptChainView({ result }: { readonly result: PromptChainResult }) {
	return (
		<>
			{result.status === "failed" ? (
				<Alert variant="destructive">
					<AlertTitle>{`ステップ「${result.failedStep}」で失敗しました`}</AlertTitle>
					<AlertDescription>
						<ul aria-label="検証エラー" className="list-disc pl-5">
							{result.errors.map((error) => (
								<li key={error}>{error}</li>
							))}
						</ul>
					</AlertDescription>
				</Alert>
			) : null}
			<ol aria-label="ステップ" className="flex flex-col gap-2">
				{result.steps.map((step) => (
					<li key={step.name} className="flex flex-col gap-1 rounded-md border border-border p-3">
						<span className="text-sm font-semibold">{step.name}</span>
						<Text>{String(step.output)}</Text>
					</li>
				))}
			</ol>
			{result.status === "completed" ? (
				<Output label="最終出力">{String(result.output)}</Output>
			) : null}
		</>
	);
}

function RoutingView({ result }: { readonly result: RouteResult }) {
	return (
		<>
			<dl className="flex flex-col gap-1 text-sm">
				<div className="flex flex-wrap gap-x-2">
					<dt className="text-muted-foreground">分類</dt>
					<dd>
						<Badge variant="secondary">{result.category}</Badge>
					</dd>
				</div>
				<div className="flex flex-wrap gap-x-2">
					<dt className="text-muted-foreground">理由</dt>
					<dd>{result.reason}</dd>
				</div>
			</dl>
			{result.matched ? null : (
				<p className="text-sm text-muted-foreground">
					どのカテゴリにも当てはまらなかったため、フォールバックの処理で答えています。
				</p>
			)}
			<Output label="処理結果">{String(result.output)}</Output>
		</>
	);
}

const TIER_LABELS = { light: "軽量", capable: "高性能" } as const;
const DIFFICULTY_LABELS: Readonly<Record<string, string>> = {
	easy: "easy（易）",
	hard: "hard（難）",
};

function ModelRoutingView({ result }: { readonly result: RouteByDifficultyResult<string> }) {
	return (
		<>
			<section
				aria-label="モデルの選択"
				className="flex flex-col gap-1 rounded-md border border-border bg-muted p-3 text-sm"
			>
				<span>{`難易度: ${DIFFICULTY_LABELS[result.difficulty] ?? result.difficulty}`}</span>
				<span>{`理由: ${result.reason}`}</span>
				<span>{`使ったモデル: ${TIER_LABELS[result.tier]}（${result.displayName}・${result.modelId}）`}</span>
				<span>{`トークン: ${formatTokens(result.usage)}`}</span>
			</section>
			{result.distinct ? null : (
				<p className="text-sm text-muted-foreground">
					軽量モデルと高性能モデルが同じモデルのため、使い分けの効果は確かめられません。
				</p>
			)}
			<Output label="回答">{result.output}</Output>
		</>
	);
}

function SectioningView({ result }: { readonly result: SectioningResult }) {
	return (
		<ol aria-label="区画" className="flex flex-col gap-2">
			{result.sections.map((section) => (
				<li
					key={section.aspect}
					className="flex flex-col gap-1 rounded-md border border-border p-3"
				>
					<span className="text-sm font-semibold">{section.aspect}</span>
					<Text>{section.output}</Text>
				</li>
			))}
		</ol>
	);
}

function VotingView({ result }: { readonly result: VoteResult<string> }) {
	return (
		<>
			<ol aria-label="票の内訳" className="flex flex-col gap-1 text-sm">
				{result.ballots.map((ballot) => (
					<li key={ballot.index}>{`${ballot.index} 票目: ${ballot.label}`}</li>
				))}
			</ol>
			<ul aria-label="集計" className="flex flex-wrap gap-3 text-sm">
				{result.tally.map((entry) => (
					<li key={entry.label}>{`${entry.label}: ${entry.count} 票`}</li>
				))}
			</ul>
			{result.outcome === "majority" ? (
				<Output label="結論">{result.conclusion}</Output>
			) : (
				<p className="text-sm font-medium">
					{`同数のため、結論は出ません。同数の選択肢: ${result.tiedLabels.join("、")}。`}
				</p>
			)}
		</>
	);
}

function OrchestratorView({ result }: { readonly result: OrchestrateResult<string> }) {
	const failed = result.results.filter((entry) => entry.status === "failed").length;
	return (
		<>
			{failed > 0 ? (
				<Alert variant="destructive">
					<AlertTitle>{`${failed} 件のワーカーが失敗しました`}</AlertTitle>
					<AlertDescription>失敗したサブタスクを除いた結果から統合しています。</AlertDescription>
				</Alert>
			) : null}
			<ol aria-label="サブタスク" className="flex flex-col gap-2">
				{result.results.map((entry) => (
					<li
						key={entry.subtask.title}
						className="flex flex-col gap-1 rounded-md border border-border p-3"
					>
						<div className="flex flex-wrap items-center gap-2">
							<span className="text-sm font-semibold">{entry.subtask.title}</span>
							<Badge variant={entry.status === "completed" ? "default" : "destructive"}>
								{entry.status === "completed" ? "完了" : "失敗"}
							</Badge>
						</div>
						<p className="text-sm text-muted-foreground">{entry.subtask.instruction}</p>
						{entry.status === "completed" ? <Text>{String(entry.output)}</Text> : null}
					</li>
				))}
			</ol>
			<Output label="統合結果">{result.synthesis}</Output>
		</>
	);
}

function EvaluatorOptimizerView({ result }: { readonly result: EvaluateAndOptimizeResult }) {
	return (
		<>
			<div className="flex flex-wrap items-center gap-2">
				<Badge variant={result.passed ? "default" : "destructive"}>
					{result.passed ? "合格" : "未合格"}
				</Badge>
				<span className="text-sm text-muted-foreground">{`${result.iterations} 回の反復`}</span>
			</div>
			{result.passed ? null : (
				<Alert variant="destructive">
					<AlertTitle>合格基準に達しませんでした</AlertTitle>
					<AlertDescription>
						{`最高スコアの反復 ${result.bestIteration} の出力を返しています。`}
					</AlertDescription>
				</Alert>
			)}
			<ol aria-label="反復の履歴" className="flex flex-col gap-2">
				{result.history.map((record) => (
					<li
						key={record.iteration}
						className="flex flex-col gap-2 rounded-md border border-border p-3"
					>
						<div className="flex flex-wrap items-center gap-2">
							<span className="text-sm font-semibold">{`反復 ${record.iteration}`}</span>
							<span className="text-sm">{`スコア ${record.combinedScore}`}</span>
							{record.iteration === result.bestIteration ? (
								<Badge variant="secondary">採用</Badge>
							) : null}
						</div>
						<ul
							aria-label={`反復 ${record.iteration} の評価`}
							className="flex flex-col gap-1 text-sm"
						>
							{record.scores.map((score) => (
								<li key={score.evaluator}>
									<span className="font-medium">{score.evaluator}</span>
									{`（${score.score} 点）: ${score.feedback}`}
								</li>
							))}
						</ul>
						<Text>{record.output}</Text>
					</li>
				))}
			</ol>
			<Output label="最終出力">{result.final}</Output>
		</>
	);
}

function NamedList({
	label,
	items,
}: {
	readonly label: string;
	readonly items: readonly string[];
}) {
	return (
		<section className="flex flex-col gap-1">
			<h3 className="text-sm font-semibold">{label}</h3>
			<ul aria-label={label} className="list-disc pl-5 text-sm">
				{items.map((item) => (
					<li key={item}>{item}</li>
				))}
			</ul>
		</section>
	);
}

function GoalView({ result }: { readonly result: GoalSpec }) {
	return (
		<>
			<Output label="目標">{result.objective}</Output>
			{result.constraints.length > 0 ? <NamedList label="制約" items={result.constraints} /> : null}
			{result.successCriteria.length > 0 ? (
				<NamedList label="成功基準" items={result.successCriteria} />
			) : null}
			{result.missingInformation.length === 0 ? (
				<p className="text-sm text-muted-foreground">不足している情報はありません。</p>
			) : (
				<>
					<NamedList label="不足している情報" items={result.missingInformation} />
					<NamedList label="確認したいこと" items={result.clarifyingQuestions} />
				</>
			)}
		</>
	);
}

function OptimizerView({ result }: { readonly result: Optimization }) {
	return (
		<>
			<div className="grid gap-3 sm:grid-cols-2">
				<Output label="改善前">{result.original}</Output>
				<Output label="改善後">{result.improved}</Output>
			</div>
			<NamedList label="改善の理由" items={result.reasons} />
		</>
	);
}

function SinglePathView({ result }: { readonly result: SinglePathResult }) {
	return (
		<ol aria-label="計画のステップ" className="flex flex-col gap-2">
			{result.results.map((entry, index) => (
				<li key={entry.step} className="flex flex-col gap-1 rounded-md border border-border p-3">
					<span className="text-sm font-semibold">{`${index + 1}. ${entry.step}`}</span>
					<Text>{entry.output}</Text>
				</li>
			))}
		</ol>
	);
}

function MultiPathView({ result }: { readonly result: MultiPathResult }) {
	return (
		<>
			<ol aria-label="候補の計画" className="flex flex-col gap-2">
				{result.candidates.map((candidate, index) => {
					const evaluation = result.evaluations.find((entry) => entry.index === index);
					const selected = index === result.selectedIndex;
					return (
						// The candidates are positional: the evaluations refer to them by index.
						// biome-ignore lint/suspicious/noArrayIndexKey: see above
						<li key={index} className="flex flex-col gap-1 rounded-md border border-border p-3">
							<div className="flex flex-wrap items-center gap-2">
								<span className="text-sm font-semibold">{`候補 ${index + 1}`}</span>
								{evaluation ? (
									<span className="text-sm">{`スコア ${evaluation.score}`}</span>
								) : null}
								{selected ? <Badge>選択</Badge> : null}
							</div>
							<ol className="list-decimal pl-5 text-sm">
								{candidate.steps.map((step) => (
									<li key={step}>{step}</li>
								))}
							</ol>
							{evaluation ? (
								<p className="text-sm text-muted-foreground">{evaluation.comment}</p>
							) : null}
						</li>
					);
				})}
			</ol>
			<Output label="選んだ理由">{result.reason}</Output>
		</>
	);
}

function ReflectionView({ result }: { readonly result: ReflectionResult }) {
	return (
		<>
			<section aria-label="使ったモデル" className="flex flex-col gap-1 text-sm">
				<span>{`生成: ${result.generatorModelId}`}</span>
				<span>{`批評: ${result.criticModelId}`}</span>
				{result.generatorModelId === result.criticModelId ? (
					<span className="text-muted-foreground">生成と批評に同じモデルを使っています。</span>
				) : null}
			</section>
			<ol aria-label="反省の履歴" className="flex flex-col gap-2">
				{result.history.map((record) => (
					<li
						key={record.iteration}
						className="flex flex-col gap-1 rounded-md border border-border p-3"
					>
						<span className="text-sm font-semibold">{`反復 ${record.iteration}`}</span>
						<Text>{record.output}</Text>
						<p className="text-sm">
							<span className="font-medium">批評: </span>
							{record.critique}
						</p>
						<p className="text-sm">
							<span className="font-medium">修正後: </span>
							{record.revised}
						</p>
					</li>
				))}
			</ol>
			<Output label="最終出力">{result.final}</Output>
		</>
	);
}

const EARLY_STOP_LABELS: Readonly<Record<string, string>> = {
	"step-limit": "ステップ数の上限",
	"token-budget": "トークン予算の上限",
	timeout: "実行時間の上限",
	aborted: "中断",
	error: "エラー",
};

function CooperationView({ result }: { readonly result: CooperationResult }) {
	const { stopped } = result;
	return (
		<>
			{stopped === undefined ? null : (
				<Alert variant="destructive">
					<AlertTitle>役割の受け渡しが最後まで進みませんでした</AlertTitle>
					<AlertDescription>
						{stopped === "budget-exhausted"
							? "共有トークン予算を使い切ったため、以降の役割は実行されませんでした。"
							: `役割の実行が「${EARLY_STOP_LABELS[stopped] ?? stopped}」で途中で終了しました。`}
					</AlertDescription>
				</Alert>
			)}
			<ol aria-label="役割" className="flex flex-col gap-2">
				{result.outputs.map((entry) => (
					<li key={entry.role} className="flex flex-col gap-2 rounded-md border border-border p-3">
						<h3 className="text-sm font-semibold">{entry.role}</h3>
						{entry.output === "" ? (
							<p className="text-sm text-muted-foreground">出力はありません。</p>
						) : (
							<Text>{entry.output}</Text>
						)}
						<RunSummaryBadge run={entry.run} />
					</li>
				))}
			</ol>
			{result.final === "" ? null : <Output label="最終出力">{result.final}</Output>}
		</>
	);
}

function ResultBody({ run }: { readonly run: WorkflowRun }) {
	switch (run.name) {
		case "prompt-chaining":
			return <PromptChainView result={run.result} />;
		case "routing":
			return <RoutingView result={run.result} />;
		case "model-routing":
			return <ModelRoutingView result={run.result} />;
		case "parallel-sectioning":
			return <SectioningView result={run.result} />;
		case "parallel-voting":
			return <VotingView result={run.result} />;
		case "orchestrator-workers":
			return <OrchestratorView result={run.result} />;
		case "evaluator-optimizer":
			return <EvaluatorOptimizerView result={run.result} />;
		case "passive-goal-creator":
			return <GoalView result={run.result} />;
		case "prompt-response-optimizer":
			return <OptimizerView result={run.result} />;
		case "single-path-plan":
			return <SinglePathView result={run.result} />;
		case "multi-path-plan":
			return <MultiPathView result={run.result} />;
		case "self-reflection":
		case "cross-reflection":
			return <ReflectionView result={run.result} />;
		case "role-based-cooperation":
			return <CooperationView result={run.result} />;
		default:
			return (
				<p className="text-sm text-muted-foreground">
					この結果は、画面での表示に対応していない形式です。
				</p>
			);
	}
}

/** The Japanese title of a workflow or pattern name; an unknown name is shown as it is. */
export function workflowTitle(name: string): string {
	return Object.hasOwn(WORKFLOW_TITLES, name)
		? WORKFLOW_TITLES[name as keyof typeof WORKFLOW_TITLES]
		: name;
}

/**
 * The result of one workflow run (plan C14, Req 3.2-3.12): a view per `name`, drawn from the
 * server's JSON. The footer shows the model calls and tokens the run used, which is the cost bound
 * of plan C13 made visible.
 */
export function WorkflowResultView({ run }: { readonly run: WorkflowRun }) {
	const { usage } = run;
	return (
		<article
			aria-label={`実行結果: ${workflowTitle(run.name)}`}
			className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4"
		>
			<ResultBody run={run} />
			<section aria-label="使用量" className="flex flex-wrap gap-x-4 text-xs text-muted-foreground">
				<span>{`モデル呼び出し ${numberFormat.format(usage.llmCalls)} 回`}</span>
				<span>{formatTokens(usage)}</span>
			</section>
		</article>
	);
}
