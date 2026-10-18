/** The kinds of credential shapes the final answer is checked for (Req 2.8). */
export const CREDENTIAL_KINDS = [
	"plaintext-password",
	"temporary-password",
	"api-key",
	"access-token",
] as const;

export type CredentialKind = (typeof CREDENTIAL_KINDS)[number];

// A value is a run of printable ASCII without quotes, brackets or separators, so a Japanese
// sentence after the value ends it. Runs are bounded so that no pattern can backtrack heavily.
const VALUE = "[A-Za-z0-9!#$%&*+\\-./:;<=>?@^_~]";
const OPEN = "[「『\"'“‘`]?";
const SEPARATOR = "\\s{0,3}(?:は|が|を|:|：|=|＝|is)\\s{0,3}";

const TEMPORARY_LABEL =
	"(?:(?:仮|一時|初期|臨時)(?:の)?パスワード|(?:temp(?:orary)?|initial)[ _-]?(?:password|passwd|pwd)|one[- ]time[ _-]?password)";
const PASSWORD_LABEL = "(?:パスワード|password|passwd|pwd)";
const KEY_LABEL = "(?:API[ _-]?キー|API[ _-]?key|apikey|secret[ _-]?key|シークレットキー)";
const TOKEN_LABEL =
	"(?:アクセストークン|access[ _-]?token|auth[ _-]?token|bearer[ _-]?token|token)";

function labelled(label: string, min: number, max: number): RegExp {
	return new RegExp(`${label}${SEPARATOR}${OPEN}(${VALUE}{${min},${max}})`, "gi");
}

const TEMPORARY = labelled(TEMPORARY_LABEL, 6, 128);
const PASSWORD = labelled(PASSWORD_LABEL, 6, 128);
const LABELLED_KEY = labelled(KEY_LABEL, 12, 256);
const LABELLED_TOKEN = labelled(TOKEN_LABEL, 12, 512);

// Shapes that are credentials on their own, whatever the surrounding words are.
const KEY_SHAPES: readonly RegExp[] = [
	/\bsk-[A-Za-z0-9_-]{12,200}/g,
	/\btvly-[A-Za-z0-9_-]{12,200}/g,
	/\bAKIA[0-9A-Z]{16}\b/g,
	/\bAIza[0-9A-Za-z_-]{30,60}/g,
];
const TOKEN_SHAPES: readonly RegExp[] = [
	/\bgh[pousr]_[A-Za-z0-9]{20,255}/g,
	/\bgithub_pat_[A-Za-z0-9_]{20,255}/g,
	/\bxox[abprs]-[A-Za-z0-9-]{10,200}/g,
	/\bBearer\s{1,3}[A-Za-z0-9._~+/=-]{12,512}/gi,
	/\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
];

/** A bracketed or starred value is a placeholder, not a secret. */
function isPlaceholder(value: string): boolean {
	return /^[<[{(*xX._-]/.test(value) && (/^[<[{(]/.test(value) || /^([*xX._-])\1+$/.test(value));
}

/** A link or a hyphenated word is guidance, not a secret ("パスワードは https://…/reset から"). */
function looksLikeProse(value: string): boolean {
	return /:\/\/|^www\./i.test(value) || /^[A-Za-z]+(?:[-_.][A-Za-z]+)+$/.test(value);
}

/** A password needs a digit, a symbol, or mixed case; a plain lower-case word ("required") is not one. */
function looksLikePassword(value: string): boolean {
	if (isPlaceholder(value) || looksLikeProse(value)) return false;
	return /[0-9!#$%&*+\-./:;<=>?@^_~]/.test(value) || (/[a-z]/.test(value) && /[A-Z]/.test(value));
}

/** A labelled key or token needs a digit or mixed case: "is automatically-refreshed" is a sentence. */
function looksLikeSecret(value: string): boolean {
	if (isPlaceholder(value) || looksLikeProse(value)) return false;
	return /[0-9]/.test(value) || (/[a-z]/.test(value) && /[A-Z]/.test(value));
}

function hasMatch(text: string, pattern: RegExp, accept: (value: string) => boolean): boolean {
	for (const match of text.matchAll(pattern)) {
		if (accept(match[1] ?? match[0])) return true;
	}
	return false;
}

/**
 * Looks for credential shapes in text and returns the kinds found, never the values (Req 2.8). A
 * pure, bounded pattern check: a temporary password is not also reported as a plain password, and
 * ordinary advice such as "パスワードは設定画面から変更できます" is not a finding.
 */
export function detectCredentialShapes(text: string): readonly CredentialKind[] {
	const found = new Set<CredentialKind>();

	let rest = text;
	if (hasMatch(text, TEMPORARY, looksLikePassword)) {
		found.add("temporary-password");
		rest = text.replace(TEMPORARY, " ");
	}
	if (hasMatch(rest, PASSWORD, looksLikePassword)) found.add("plaintext-password");

	if (
		hasMatch(text, LABELLED_KEY, looksLikeSecret) ||
		KEY_SHAPES.some((shape) => hasMatch(text, shape, () => true))
	) {
		found.add("api-key");
	}
	if (
		hasMatch(text, LABELLED_TOKEN, looksLikeSecret) ||
		TOKEN_SHAPES.some((shape) => hasMatch(text, shape, () => true))
	) {
		found.add("access-token");
	}

	return CREDENTIAL_KINDS.filter((kind) => found.has(kind));
}
