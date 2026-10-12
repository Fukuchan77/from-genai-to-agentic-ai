import { RawJsonView } from "../RawJsonView";
import type { ToolRendererProps } from "../renderers";
import { CardFrame, isRecord } from "./shared";

interface Hit {
	readonly title: string;
	readonly url: string;
	readonly snippet: string;
}

function isHit(value: unknown): value is Hit {
	return (
		isRecord(value) &&
		typeof value.title === "string" &&
		typeof value.url === "string" &&
		typeof value.snippet === "string"
	);
}

/** Only http(s) URLs become links; anything else (e.g. `javascript:`) is shown as plain text. */
function isWebUrl(url: string): boolean {
	try {
		const { protocol } = new URL(url);
		return protocol === "https:" || protocol === "http:";
	} catch {
		return false;
	}
}

export function SearchResultsList({ data }: ToolRendererProps) {
	if (!isRecord(data) || !Array.isArray(data.results) || !data.results.every(isHit)) {
		return <RawJsonView value={data} label="出力" />;
	}
	const hits = data.results as readonly Hit[];
	return (
		<CardFrame title="検索結果">
			{hits.length === 0 ? (
				<p className="text-sm text-muted-foreground">該当する結果はありませんでした。</p>
			) : (
				<ol className="flex flex-col gap-3">
					{hits.map((hit, index) => (
						// Hits have no id and never reorder.
						// biome-ignore lint/suspicious/noArrayIndexKey: see above
						<li key={index} className="flex flex-col gap-1">
							{isWebUrl(hit.url) ? (
								<a
									href={hit.url}
									target="_blank"
									rel="noopener noreferrer"
									className="text-sm font-medium underline underline-offset-2"
								>
									{hit.title}
									<span className="sr-only">（新しいタブで開く）</span>
								</a>
							) : (
								<span className="text-sm font-medium">{hit.title}</span>
							)}
							<p className="text-sm text-muted-foreground">{hit.snippet}</p>
						</li>
					))}
				</ol>
			)}
		</CardFrame>
	);
}
