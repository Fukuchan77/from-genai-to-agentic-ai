import { Skeleton } from "@/components/ui/skeleton";

/** A chapter as it streams in: either field may still be missing. */
export interface PartialChapter {
	readonly heading?: string | undefined;
	readonly startSeconds?: number | undefined;
}

/**
 * `MM:SS` for a start time; once the video passes an hour, `H:MM:SS` (the YouTube convention).
 * Negative and non-finite values show as `00:00`.
 */
export function formatTimestamp(seconds: number): string {
	const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const rest = total % 60;
	const pair = (value: number) => String(value).padStart(2, "0");
	return hours > 0 ? `${hours}:${pair(minutes)}:${pair(rest)}` : `${pair(minutes)}:${pair(rest)}`;
}

export interface ChapterListProps {
	readonly chapters: readonly PartialChapter[];
}

/** Timestamped table of contents of a video summary (Req 4.10). */
export function ChapterList({ chapters }: ChapterListProps) {
	if (chapters.length === 0) return null;
	return (
		<ol aria-label="チャプター" className="flex flex-col gap-2">
			{chapters.map((chapter, index) => (
				// Chapters have no id and are only ever appended while streaming, so the index is stable.
				// biome-ignore lint/suspicious/noArrayIndexKey: append-only list without identifiers
				<li key={index} className="flex items-baseline gap-3 text-sm">
					{chapter.startSeconds === undefined ? (
						<Skeleton className="h-4 w-12" />
					) : (
						<time
							dateTime={`PT${Math.max(0, Math.floor(chapter.startSeconds))}S`}
							className="font-mono tabular-nums text-muted-foreground"
						>
							{formatTimestamp(chapter.startSeconds)}
						</time>
					)}
					{chapter.heading === undefined ? <Skeleton className="h-4 w-48" /> : chapter.heading}
				</li>
			))}
		</ol>
	);
}
