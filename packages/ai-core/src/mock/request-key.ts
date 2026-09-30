import { createHash } from "node:crypto";
import type { MockLanguageModelV4 } from "ai/test";
import type { ModelPurpose } from "../models/types";

export type LanguageModelV4CallOptions = Parameters<MockLanguageModelV4["doGenerate"]>[0];

export type RequestKey = string & { readonly __requestKey: unique symbol };

type CanonicalValue = null | boolean | number | string | CanonicalValue[] | CanonicalObject;
interface CanonicalObject {
	readonly [key: string]: CanonicalValue;
}

const OMITTED_KEYS = new Set(["abortSignal", "headers", "providerOptions"]);

function canonicalize(value: unknown): CanonicalValue | undefined {
	if (value === undefined || typeof value === "function" || typeof value === "symbol") {
		return undefined;
	}
	if (value === null || typeof value === "boolean" || typeof value === "string") return value;
	if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
	if (typeof value === "bigint") return value.toString();
	if (value instanceof Date) return value.toISOString();
	if (value instanceof Uint8Array) return Buffer.from(value).toString("base64");
	if (Array.isArray(value)) {
		return value.map((item) => canonicalize(item) ?? null);
	}
	if (typeof value === "object") {
		const entries = Object.entries(value)
			.filter(([key]) => !OMITTED_KEYS.has(key))
			.sort(([left], [right]) => left.localeCompare(right));
		const result: Record<string, CanonicalValue> = {};
		for (const [key, entryValue] of entries) {
			const normalized = canonicalize(entryValue);
			if (normalized !== undefined) result[key] = normalized;
		}
		return result;
	}
	return String(value);
}

export function normalizeRequest(
	params: LanguageModelV4CallOptions,
	purpose: ModelPurpose,
): CanonicalObject {
	return canonicalize({ params, purpose }) as CanonicalObject;
}

export function requestKey(params: LanguageModelV4CallOptions, purpose: ModelPurpose): RequestKey {
	const normalized = JSON.stringify(normalizeRequest(params, purpose));
	return createHash("sha256").update(normalized).digest("hex") as RequestKey;
}
