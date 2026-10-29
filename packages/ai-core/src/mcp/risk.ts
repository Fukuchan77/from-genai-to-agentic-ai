import type { ToolRisk } from "../aci/types";

function hint(annotations: object, name: "readOnlyHint" | "destructiveHint"): unknown {
	// An own property only: an annotations object with a prototype must not lend a hint.
	return Object.hasOwn(annotations, name)
		? (annotations as Record<string, unknown>)[name]
		: undefined;
}

/**
 * Maps MCP tool annotations to a risk class (ADR-7, Req 1.16, 1.17). Annotations are hints a server
 * gives about itself, so only an explicit `readOnlyHint: true` earns `read-only`; everything else,
 * a missing or malformed annotation included, is `destructive`. A tool that also claims
 * `destructiveHint: true` contradicts itself and is not trusted.
 */
export function riskFromAnnotations(annotations: unknown): ToolRisk {
	if (typeof annotations !== "object" || annotations === null || Array.isArray(annotations)) {
		return "destructive";
	}
	if (hint(annotations, "destructiveHint") === true) return "destructive";
	return hint(annotations, "readOnlyHint") === true ? "read-only" : "destructive";
}
