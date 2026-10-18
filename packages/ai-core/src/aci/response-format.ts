export type ResponseFormat = "concise" | "detailed";

export interface ResponseFormatOptions {
	readonly format: ResponseFormat;
	/** The most characters (code points) a `concise` response keeps. */
	readonly maxCharacters: number;
	/** How to get the whole text (for example "call again with format: detailed"). */
	readonly fullTextHint: string;
}

/**
 * Applies the `response_format` the model asked for (Req 1.6). `detailed` returns the text as it
 * is; `concise` cuts it at `maxCharacters` code points (never inside a surrogate pair), says how
 * much was left out and appends the hint for getting the whole text.
 */
export function applyResponseFormat(text: string, options: ResponseFormatOptions): string {
	const { format, maxCharacters, fullTextHint } = options;
	if (!Number.isSafeInteger(maxCharacters) || maxCharacters <= 0) {
		throw new RangeError(`maxCharacters must be a positive integer (received ${maxCharacters}).`);
	}
	if (format === "detailed") return text;
	const characters = Array.from(text);
	if (characters.length <= maxCharacters) return text;
	const omitted = characters.length - maxCharacters;
	return `${characters.slice(0, maxCharacters).join("")}\n（残り ${omitted} 文字を省略しました。）\n${fullTextHint}`;
}
