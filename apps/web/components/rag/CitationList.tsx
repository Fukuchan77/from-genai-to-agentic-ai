import type { Citation, CitationLocator } from "@platform/ai-core/rag";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/components/ui/utils";

export interface CitationListProps {
	/** Every retrieved chunk in retrieval order, as the server settled it (`data-rag-result`). */
	readonly citations: readonly Citation[];
	/** Out-of-range footnote numbers the server removed from the answer. */
	readonly removedCitations?: readonly number[];
	/** Prefix of the card ids; the answer's footnote links point at `#<prefix>-<label>`. */
	readonly idPrefix?: string;
}

/** The id of the card for `label`; `AnswerView` builds its link targets with the same function. */
export function citationCardId(idPrefix: string, label: number): string {
	return `${idPrefix}-${label}`;
}

function describeLocator(locator: CitationLocator): string {
	return locator.kind === "page" ? `ページ ${locator.page}` : locator.path.join(" › ");
}

/**
 * The citation cards (plan C14). The server decided which chunks were cited and which footnotes
 * had to go; this only shows that outcome. Each card is a focus target (`tabindex="-1"`) so a
 * footnote link can move the keyboard focus onto it.
 */
export function CitationList({
	citations,
	removedCitations = [],
	idPrefix = "citation",
}: CitationListProps) {
	return (
		<section aria-label="引用元" className="flex flex-col gap-3">
			{removedCitations.length > 0 ? (
				<p
					role="status"
					aria-label="除去された脚注"
					className="rounded-md border border-border bg-muted p-3 text-sm"
				>
					{`取得した資料の範囲外の脚注 ${removedCitations.map((n) => `[${n}]`).join(" ")} は、根拠がないためサーバーが回答から除去しました。`}
				</p>
			) : null}
			{citations.length === 0 ? (
				<p className="text-sm text-muted-foreground">引用できる文書はありません。</p>
			) : (
				<ol aria-label="引用" className="flex flex-col gap-3">
					{citations.map((citation) => (
						<li
							key={citation.chunkId}
							id={citationCardId(idPrefix, citation.label)}
							tabIndex={-1}
							className={cn(
								"flex flex-col gap-2 rounded-lg border border-border bg-card p-3 text-sm",
								"focus-visible:outline-2 focus-visible:outline-offset-2",
							)}
						>
							<div className="flex flex-wrap items-center gap-2">
								<span className="font-semibold">{`[${citation.label}]`}</span>
								<span className="font-medium">{citation.documentTitle}</span>
								<Badge variant={citation.cited ? "default" : "outline"}>
									{citation.cited ? "引用あり" : "取得のみ"}
								</Badge>
							</div>
							<p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
								<span>{describeLocator(citation.locator)}</span>
								{citation.similarity === undefined ? null : (
									<span>{`類似度 ${citation.similarity.toFixed(2)}`}</span>
								)}
							</p>
							<p className="whitespace-pre-wrap break-words">{citation.excerpt}</p>
						</li>
					))}
				</ol>
			)}
		</section>
	);
}
