import { Badge } from "@/components/ui/badge";

/** One extracted requirement as `data-requirements-preview` carries it (plan C13). */
export interface RequirementsPreviewItem {
	readonly text: string;
	readonly personaId: string;
}

/** The `data-requirements-preview` payload: every category, rewritten as a whole on each answer. */
export interface RequirementsPreviewData {
	readonly functional: readonly RequirementsPreviewItem[];
	readonly nonFunctional: readonly RequirementsPreviewItem[];
	readonly constraints: readonly RequirementsPreviewItem[];
	readonly unconfirmed: readonly RequirementsPreviewItem[];
}

export interface RequirementsPreviewProps {
	/** The latest preview part, or `null` before the first answer has been processed. */
	readonly requirements: RequirementsPreviewData | null;
	/** Persona display names by id; an id without a name is shown as is. */
	readonly personaNames?: Readonly<Record<string, string>>;
	/** The round whose answers the preview reflects; announced when it changes. */
	readonly round?: number;
}

const CATEGORIES = [
	{ key: "functional", label: "機能要件" },
	{ key: "nonFunctional", label: "非機能要件" },
	{ key: "constraints", label: "制約" },
	{ key: "unconfirmed", label: "未確認事項" },
] as const satisfies readonly { key: keyof RequirementsPreviewData; label: string }[];

/**
 * The requirements extracted so far (Req 5.3, plan C14). The server extracts and merges; this only
 * shows the latest state part. The whole region is polite and announces additions, so a screen
 * reader hears each answer's new items without the learner moving focus.
 */
export function RequirementsPreview({
	requirements,
	personaNames = {},
	round,
}: RequirementsPreviewProps) {
	return (
		<section
			aria-label="要件プレビュー"
			aria-live="polite"
			aria-relevant="additions text"
			className="flex flex-col gap-3"
		>
			{round === undefined ? null : (
				<p className="text-sm text-muted-foreground">{`第 ${round} ラウンドの回答を反映しました。`}</p>
			)}
			{requirements === null ? (
				<p className="text-sm text-muted-foreground">
					まだ要件はありません。回答を送信すると、ここに反映されます。
				</p>
			) : (
				CATEGORIES.map(({ key, label }) => {
					const items = requirements[key];
					return (
						<section
							key={key}
							aria-label={label}
							className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3"
						>
							<h3 className="flex items-center gap-2 text-sm font-semibold">
								{label}
								<Badge variant="outline">{`${items.length} 件`}</Badge>
							</h3>
							{items.length === 0 ? (
								<p className="text-sm text-muted-foreground">まだありません</p>
							) : (
								<ul className="flex flex-col gap-1 text-sm">
									{items.map((item, index) => (
										<li
											// biome-ignore lint/suspicious/noArrayIndexKey: the server rewrites the whole list per answer and items may repeat
											key={`${index}-${item.personaId}-${item.text}`}
											className="break-words"
										>
											<span>{item.text}</span>{" "}
											<span className="text-xs text-muted-foreground">
												{`（出所: ${personaNames[item.personaId] ?? item.personaId}）`}
											</span>
										</li>
									))}
								</ul>
							)}
						</section>
					);
				})
			)}
		</section>
	);
}
