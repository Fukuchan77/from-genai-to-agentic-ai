import type { RerankSkipReason, RetrievalTrace, ScoredChunk } from "@platform/ai-core/rag";

/** The `data-rag-trace` payload: everything the retrieval recorded so far. */
export type TraceViewData = RetrievalTrace;

export interface TraceViewProps {
	readonly trace: TraceViewData | undefined;
}

const RERANK_SKIP_MESSAGES: Readonly<Record<RerankSkipReason, string>> = {
	"api-key-missing": "Rerank の API キーが未設定のため、スキップしました。",
	"provider-error": "Rerank の呼び出しに失敗したため、統合後の順位を使います。",
};

const BODY_EXCERPT_CHARACTERS = 80;

function locate(chunk: ScoredChunk["chunk"]): string {
	return chunk.page === null ? chunk.headingPath.join(" › ") : `ページ ${chunk.page}`;
}

function excerpt(body: string): string {
	const characters = [...body];
	return characters.length > BODY_EXCERPT_CHARACTERS
		? `${characters.slice(0, BODY_EXCERPT_CHARACTERS).join("")}…`
		: body;
}

function Candidates({ rows }: { readonly rows: readonly ScoredChunk[] }) {
	if (rows.length === 0) return <p className="text-muted-foreground">候補はありません。</p>;
	return (
		<ol className="flex flex-col gap-2">
			{rows.map(({ chunk, score, similarity }, index) => (
				<li key={chunk.id} className="flex flex-col gap-1 rounded-md border border-border p-2">
					<div className="flex flex-wrap items-baseline gap-x-3">
						<span className="font-semibold">{index + 1}</span>
						<span className="font-medium">{chunk.documentTitle}</span>
						<span className="text-xs text-muted-foreground">{locate(chunk)}</span>
						<span className="text-xs text-muted-foreground">{`スコア ${score.toFixed(3)}`}</span>
						{similarity === undefined ? null : (
							<span className="text-xs text-muted-foreground">{`類似度 ${similarity.toFixed(3)}`}</span>
						)}
					</div>
					<p className="break-words text-muted-foreground">{excerpt(chunk.body)}</p>
				</li>
			))}
		</ol>
	);
}

function Section({
	title,
	children,
}: {
	readonly title: string;
	readonly children: React.ReactNode;
}) {
	return (
		<details className="rounded-md border border-border bg-card px-3 py-2 text-sm">
			<summary className="cursor-pointer rounded-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2">
				{title}
			</summary>
			<div className="mt-2 flex flex-col gap-2">{children}</div>
		</details>
	);
}

function SearchResults({ searches }: { readonly searches: RetrievalTrace["vector"] }) {
	return (
		<>
			{searches.map((search) => (
				<div key={search.query} className="flex flex-col gap-2">
					{searches.length > 1 ? <p className="font-medium">{search.query}</p> : null}
					<Candidates rows={search.candidates} />
				</div>
			))}
		</>
	);
}

/**
 * The intermediate results of a query, one collapsible section per stage (plan C14, Req 2.8). A
 * section exists only when its method is on; the trace shows what the retrieval recorded and is
 * never recomputed here. Native `<details>` keeps the keyboard operation (Enter / Space) script-free.
 */
export function TraceView({ trace }: TraceViewProps) {
	if (trace === undefined) return null;
	const { methods } = trace.settings;
	return (
		<section aria-label="中間結果" className="flex flex-col gap-2">
			{methods.hyde && trace.hypotheticalAnswer !== undefined ? (
				<Section title="仮想回答">
					<p className="whitespace-pre-wrap break-words">{trace.hypotheticalAnswer}</p>
				</Section>
			) : null}
			{methods.multiQuery && trace.subQueries !== undefined ? (
				<Section title="サブクエリ">
					<ol className="list-decimal pl-5">
						{trace.subQueries.map((query) => (
							<li key={query}>{query}</li>
						))}
					</ol>
				</Section>
			) : null}
			<Section title="ベクトル検索の候補">
				<SearchResults searches={trace.vector} />
			</Section>
			{methods.hybrid ? (
				<Section title="全文検索の候補">
					<SearchResults searches={trace.fullText} />
				</Section>
			) : null}
			{methods.hybrid || methods.multiQuery ? (
				<Section title="統合後">
					<Candidates rows={trace.fused} />
				</Section>
			) : null}
			{methods.rerank ? (
				<Section title="Rerank 後">
					{trace.rerank.status === "skipped" ? (
						<p>
							{trace.rerank.reason
								? RERANK_SKIP_MESSAGES[trace.rerank.reason]
								: "スキップしました。"}
						</p>
					) : (
						<Candidates rows={trace.reranked ?? []} />
					)}
				</Section>
			) : null}
			<Section title="回答に使うチャンク">
				<Candidates rows={trace.final} />
			</Section>
		</section>
	);
}
