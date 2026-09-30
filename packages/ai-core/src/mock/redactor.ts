import type { EnvSource } from "../config";

const REDACTED = "[REDACTED]";
const SENSITIVE_NAME =
	/(?:^|[-_])(api[-_]?key|authorization|cookie|credential|password|secret|token)(?:$|[-_])/iu;
const SENSITIVE_HEADER = /^(?:authorization|cookie|proxy-authorization|set-cookie|x-api-key)$/iu;
const SENSITIVE_QUERY_PARAMETER =
	/^(?:api[-_]?key|access[-_]?token|auth|authorization|key|password|secret|token)$/iu;
const KNOWN_SECRET_PATTERNS = [
	/\bBearer\s+[A-Za-z0-9._~+/-]+=*/giu,
	/\bsk-(?:ant-)?[A-Za-z0-9_-]{8,}\b/gu,
	/\btvly-[A-Za-z0-9_-]{8,}\b/gu,
	/\bAIza[A-Za-z0-9_-]{20,}\b/gu,
] as const;

export interface Redactor {
	redact<T>(value: T): T;
}

function configuredSecrets(env: EnvSource): readonly string[] {
	return Object.entries(env)
		.filter(([name, value]) => SENSITIVE_NAME.test(name) && value !== undefined && value !== "")
		.map(([, value]) => value as string)
		.sort((left, right) => right.length - left.length);
}

function redactUrl(value: string): string {
	try {
		const url = new URL(value);
		for (const key of url.searchParams.keys()) {
			if (SENSITIVE_QUERY_PARAMETER.test(key)) url.searchParams.set(key, REDACTED);
		}
		return url.toString();
	} catch {
		return value;
	}
}

function redactString(value: string, secrets: readonly string[]): string {
	let redacted = redactUrl(value);
	for (const secret of secrets) redacted = redacted.replaceAll(secret, REDACTED);
	for (const pattern of KNOWN_SECRET_PATTERNS) redacted = redacted.replace(pattern, REDACTED);
	return redacted;
}

function redactHeaders(
	value: Readonly<Record<string, unknown>>,
	secrets: readonly string[],
): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(value).flatMap(([name, headerValue]) =>
			SENSITIVE_HEADER.test(name) ? [] : [[name, redactValue(headerValue, secrets, name)] as const],
		),
	);
}

function redactValue(value: unknown, secrets: readonly string[], parentKey?: string): unknown {
	if (typeof value === "string") return redactString(value, secrets);
	if (Array.isArray(value)) return value.map((item) => redactValue(item, secrets));
	if (value instanceof Date || value instanceof Uint8Array || value === null) return value;
	if (typeof value !== "object") return value;

	const record = value as Readonly<Record<string, unknown>>;
	if (parentKey?.toLowerCase() === "headers") return redactHeaders(record, secrets);

	return Object.fromEntries(
		Object.entries(record).map(([key, nested]) => [
			key,
			SENSITIVE_NAME.test(key) ? REDACTED : redactValue(nested, secrets, key),
		]),
	);
}

export function createRedactor(env: EnvSource): Redactor {
	const secrets = configuredSecrets(env);
	return {
		redact<T>(value: T): T {
			return redactValue(value, secrets) as T;
		},
	};
}
