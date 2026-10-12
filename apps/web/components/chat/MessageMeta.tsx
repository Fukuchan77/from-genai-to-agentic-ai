import type { ResponseMetadata } from "@platform/ai-core/chat";

const numberFormat = new Intl.NumberFormat("ja-JP");

/**
 * The model name and token counts under an answer (Req 3.7). The metadata arrives in two chunks:
 * identity with the stream's `start`, `usage` with its `finish`, so usage may be absent while the
 * answer is still streaming.
 */
export function MessageMeta({ metadata }: { readonly metadata: ResponseMetadata | undefined }) {
	if (!metadata) return null;
	const { usage } = metadata;
	return (
		<ul
			aria-label="応答の情報"
			className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"
		>
			<li>{metadata.modelName}</li>
			{usage ? (
				<>
					<li>入力 {numberFormat.format(usage.inputTokens)} トークン</li>
					<li>出力 {numberFormat.format(usage.outputTokens)} トークン</li>
					{usage.cacheReadTokens === undefined ? null : (
						<li>キャッシュ読み出し {numberFormat.format(usage.cacheReadTokens)} トークン</li>
					)}
				</>
			) : null}
		</ul>
	);
}
