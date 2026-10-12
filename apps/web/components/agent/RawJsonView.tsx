export interface RawJsonViewProps {
	readonly value: unknown;
	/** A short heading such as 入力 / 出力. */
	readonly label?: string;
}

function stringify(value: unknown): string {
	try {
		return JSON.stringify(value, null, 2) ?? "";
	} catch {
		return "";
	}
}

/**
 * Pretty-printed JSON for a tool without a dedicated card, and for data a card cannot read. The
 * text is rendered as a text node, so tool output can never inject markup.
 */
export function RawJsonView({ value, label }: RawJsonViewProps) {
	const text = stringify(value);
	return (
		<div className="flex flex-col gap-1">
			{label ? <span className="text-xs font-semibold text-muted-foreground">{label}</span> : null}
			{text === "" ? (
				<p className="text-sm text-muted-foreground">（値なし）</p>
			) : (
				// tabIndex makes the scrollable region reachable by keyboard (WCAG 2.1.1 / 2.4.3).
				<pre
					// biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be focusable
					tabIndex={0}
					className="max-h-64 overflow-auto rounded-md border border-border bg-muted p-3 text-xs"
				>
					{text}
				</pre>
			)}
		</div>
	);
}
