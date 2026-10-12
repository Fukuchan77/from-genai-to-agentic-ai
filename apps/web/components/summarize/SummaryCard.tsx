import type { Summary } from "@platform/ai-core/summarize";
import type { DeepPartial } from "ai";
import { useId } from "react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ChapterList } from "./ChapterList";

const KEY_POINT_COUNT = 3;
const PENDING_KEYS = ["pending-1", "pending-2", "pending-3"] as const;

export interface SummaryCardProps {
	/** The newest `data-summary` payload: unvalidated and incomplete until generation ends. */
	readonly summary: DeepPartial<Summary> | undefined;
	readonly generating: boolean;
}

function defined<T>(items: readonly (T | undefined)[] | undefined): T[] {
	return (items ?? []).filter((item): item is T => item !== undefined);
}

function Section({
	heading,
	children,
}: {
	readonly heading: string;
	readonly children: React.ReactNode;
}) {
	return (
		<section className="flex flex-col gap-2">
			<h3 className="text-sm font-semibold text-muted-foreground">{heading}</h3>
			{children}
		</section>
	);
}

/**
 * Renders a partial summary (Req 4.5): confirmed fields as text, every field still to come as a
 * skeleton. Skeletons are decorative; the panel announces progress.
 */
export function SummaryCard({ summary, generating }: SummaryCardProps) {
	const titleId = useId();
	const title = summary?.title;
	const keyPoints = defined(summary?.keyPoints);
	const tags = defined(summary?.tags);
	const actionItems = defined(summary?.actionItems);
	const chapters = summary?.chapters;
	const pendingKeyPoints = generating ? Math.max(0, KEY_POINT_COUNT - keyPoints.length) : 0;

	return (
		<article
			aria-busy={generating}
			{...(title ? { "aria-labelledby": titleId } : { "aria-label": "要約" })}
			className="flex flex-col gap-5 rounded-xl border border-border bg-card p-6 text-card-foreground"
		>
			{title ? (
				<h2 id={titleId} className="text-xl font-bold">
					{title}
				</h2>
			) : generating ? (
				<Skeleton className="h-7 w-2/3" />
			) : null}

			<Section heading="要点">
				<ul aria-label="要点" className="flex list-disc flex-col gap-2 pl-5">
					{keyPoints.map((point, index) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: append-only list without identifiers
						<li key={index}>{point}</li>
					))}
					{PENDING_KEYS.slice(0, pendingKeyPoints).map((key) => (
						<li key={key} className="list-none">
							<Skeleton className="h-4 w-full" />
						</li>
					))}
				</ul>
			</Section>

			<Section heading="タグ">
				{tags.length > 0 ? (
					<ul aria-label="タグ" className="flex flex-wrap gap-2">
						{tags.map((tag, index) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: append-only list without identifiers
							<li key={index}>
								<Badge variant="secondary">{tag}</Badge>
							</li>
						))}
					</ul>
				) : generating ? (
					<Skeleton className="h-6 w-1/3" />
				) : null}
			</Section>

			<Section heading="アクションアイテム">
				{actionItems.length > 0 ? (
					<ul aria-label="アクションアイテム" className="flex list-disc flex-col gap-2 pl-5">
						{actionItems.map((item, index) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: append-only list without identifiers
							<li key={index}>{item}</li>
						))}
					</ul>
				) : generating ? (
					<Skeleton className="h-4 w-1/2" />
				) : summary?.actionItems ? (
					<p className="text-sm text-muted-foreground">アクションアイテムはありません</p>
				) : null}
			</Section>

			{chapters && chapters.length > 0 ? (
				<Section heading="チャプター">
					<ChapterList chapters={defined(chapters)} />
				</Section>
			) : null}
		</article>
	);
}
