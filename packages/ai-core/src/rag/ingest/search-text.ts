const NON_WORD_CHARACTERS = /[^\p{L}\p{N}]+/u;
const SHORT_HIRAGANA_ONLY = /^\p{Script=Hiragana}{1,2}$/u;

let segmenter: Intl.Segmenter | undefined;

function wordSegmenter(): Intl.Segmenter {
	segmenter ??= new Intl.Segmenter("ja", { granularity: "word" });
	return segmenter;
}

/**
 * Words for the full-text index and query: NFKC-normalised and lowercased, cut by ICU word
 * boundaries and then at every character that is not a letter or digit, without hiragana-only
 * words of two characters or fewer (particles and endings, ADR-3).
 */
function tokenize(text: string): string[] {
	const words: string[] = [];
	for (const part of wordSegmenter().segment(text.normalize("NFKC").toLowerCase())) {
		if (!part.isWordLike) continue;
		for (const word of part.segment.split(NON_WORD_CHARACTERS)) {
			if (word !== "" && !SHORT_HIRAGANA_ONLY.test(word)) words.push(word);
		}
	}
	return words;
}

/** Space-separated words stored in the `search_text` column and indexed with the `simple` config. */
export function toSearchText(text: string): string {
	return tokenize(text).join(" ");
}

/**
 * Builds the OR query passed as a bind variable to `to_tsquery('simple', $1)`. Words hold only
 * letters and digits, so no tsquery operator can reach the database. Returns `undefined` when no
 * word remains; the caller then skips full-text search.
 */
export function buildFullTextQuery(text: string): string | undefined {
	const words = [...new Set(tokenize(text))];
	return words.length === 0 ? undefined : words.join(" | ");
}
