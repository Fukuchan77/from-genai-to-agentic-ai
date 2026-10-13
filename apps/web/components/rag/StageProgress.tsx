import type { QueryMethods, RagStage } from "@platform/ai-core/rag";
import { Badge } from "@/components/ui/badge";

/** The newest state of one stage, as folded from the `data-rag-stage` parts (id `stage-<stage>`). */
export interface StageState {
	readonly stage: RagStage;
	readonly status: "running" | "done" | "skipped";
	readonly detail?: string;
}

export interface StageProgressProps {
	readonly stages: readonly StageState[];
	/** The switches of this run; the stages of a method that is off are not shown. */
	readonly methods: QueryMethods;
}

// Pipeline order. The events arrive interleaved (vector and full-text search run together), so the
// list is ordered by this table, not by arrival.
const STAGE_ORDER: readonly RagStage[] = [
	"hyde",
	"multi-query",
	"vector-search",
	"full-text-search",
	"fusion",
	"rerank",
	"generate",
];

const STAGE_LABELS: Readonly<Record<RagStage, string>> = {
	hyde: "仮想回答の生成",
	"multi-query": "サブクエリの生成",
	"vector-search": "ベクトル検索",
	"full-text-search": "全文検索",
	fusion: "結果の統合",
	rerank: "Rerank",
	generate: "回答の生成",
};

const STATUS_LABELS = { running: "実行中", done: "完了", skipped: "スキップ" } as const;

/** The switch that turns a stage on; stages without one always run. */
const STAGE_SWITCH: Readonly<Partial<Record<RagStage, keyof QueryMethods>>> = {
	hyde: "hyde",
	"multi-query": "multiQuery",
	"full-text-search": "hybrid",
	rerank: "rerank",
};

/**
 * The progress of a query, stage by stage (plan C14, Req 2.8). The region is `aria-live="polite"`
 * so a screen reader hears each stage start and finish; a skipped stage keeps its reason.
 */
export function StageProgress({ stages, methods }: StageProgressProps) {
	const byStage = new Map(stages.map((state) => [state.stage, state]));
	const shown = STAGE_ORDER.flatMap((stage) => {
		const state = byStage.get(stage);
		const switchName = STAGE_SWITCH[stage];
		if (state === undefined || (switchName !== undefined && !methods[switchName])) return [];
		return [state];
	});
	return (
		<section aria-label="段階の進行" aria-live="polite" className="flex flex-col gap-2">
			{shown.length > 0 ? (
				<ol aria-label="段階" className="flex flex-col gap-1 text-sm">
					{shown.map((state) => (
						<li
							key={state.stage}
							data-stage={state.stage}
							className="flex flex-wrap items-center gap-2"
						>
							<span className="font-medium">{STAGE_LABELS[state.stage]}</span>
							<Badge variant={state.status === "done" ? "default" : "secondary"}>
								{STATUS_LABELS[state.status]}
							</Badge>
							{state.detail === undefined ? null : (
								<span className="text-muted-foreground">{state.detail}</span>
							)}
						</li>
					))}
				</ol>
			) : null}
		</section>
	);
}
