import type { Table } from "@platform/ai-core/analysis";

export interface TableViewProps {
	/** One `data-analysis-table` part of the stream (the server already limited the rows). */
	readonly table: Table;
	/**
	 * The most rows drawn (`DEFAULT_ANALYSIS.maxTableRows`), passed by the page for the reason given
	 * on `FigureViewProps.maxBytes`.
	 */
	readonly maxRows: number;
}

const HEADER_CLASS = "border-b border-border px-3 py-2 font-semibold";

/**
 * A table the sandbox code produced (Req 3.5): a plain `<table>` with a caption, at most
 * `maxTableRows` rows, and how many rows the code had. Every value is a React text node, so
 * markup in a cell is shown as text.
 */
export function TableView({ table, maxRows }: TableViewProps) {
	const shown = table.rows.slice(0, maxRows);
	const total = Math.max(table.totalRows, table.rows.length);
	const caption = table.caption.trim();
	return (
		<div className="flex flex-col gap-2">
			{/* A table wider than the screen scrolls; the region is a tab stop so a keyboard can scroll it. */}
			<section
				aria-label={caption.length > 0 ? caption : "表"}
				// biome-ignore lint/a11y/noNoninteractiveTabindex: a scroll container must be focusable for keyboard users
				tabIndex={0}
				className="overflow-x-auto rounded-md border border-border focus-visible:outline-2 focus-visible:outline-offset-2"
			>
				<table className="w-full border-collapse text-left text-sm">
					{caption.length > 0 ? (
						<caption className="p-2 text-left text-sm font-medium">{caption}</caption>
					) : null}
					<thead className="bg-muted">
						<tr>
							{table.columns.map((column, index) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: columns have no id and never reorder
								<th key={index} scope="col" className={HEADER_CLASS}>
									{column}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{shown.map((row, rowIndex) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: rows have no id and never reorder
							<tr key={rowIndex} className="border-b border-border last:border-b-0">
								{row.map((cell, cellIndex) => (
									// biome-ignore lint/suspicious/noArrayIndexKey: cells have no id and never reorder
									<td key={cellIndex} className="px-3 py-2 align-top">
										{cell === null ? "—" : String(cell)}
									</td>
								))}
							</tr>
						))}
					</tbody>
				</table>
			</section>
			<p className="text-xs text-muted-foreground">{`${total} 件中 ${shown.length} 件を表示`}</p>
		</div>
	);
}
