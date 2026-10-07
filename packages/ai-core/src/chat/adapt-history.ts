import { isToolUIPart, type UIMessage } from "ai";
import { MODEL_CATALOG } from "../models/catalog";
import type { ModelEntry, ProviderId } from "../models/types";

type Part = UIMessage["parts"][number];

/** Text that replaces an image part when the target model cannot take image input (ADR-7). */
export const IMAGE_OMITTED_TEXT = "[画像は省略されました]";

const PROVIDER_FIELDS = [
	"providerMetadata",
	"providerReference",
	"callProviderMetadata",
	"resultProviderMetadata",
] as const;

/** Tool states that never reached a result; providers reject a call without its result. */
const INCOMPLETE_TOOL_STATES: ReadonlySet<string> = new Set(["input-streaming", "input-available"]);

/**
 * The provider that generated an assistant message, derived from its `ResponseMetadata.modelId`
 * through the server's own catalog. The whole history comes from the client, so the claim is
 * trusted only as far as the catalog backs it: a model ID outside the catalog, or a `provider`
 * that contradicts the catalog entry, means "unknown". User and system messages have no
 * generating provider.
 */
function originProvider(message: UIMessage): ProviderId | undefined {
	if (message.role !== "assistant") return undefined;
	const { metadata } = message;
	if (typeof metadata !== "object" || metadata === null) return undefined;
	const { modelId, provider } = metadata as {
		readonly modelId?: unknown;
		readonly provider?: unknown;
	};
	if (typeof modelId !== "string" || !Object.hasOwn(MODEL_CATALOG, modelId)) return undefined;
	const catalogProvider = MODEL_CATALOG[modelId as keyof typeof MODEL_CATALOG].provider;
	if (provider !== undefined && provider !== catalogProvider) return undefined;
	return catalogProvider;
}

function isImage(mediaType: string): boolean {
	return mediaType === "image" || mediaType.startsWith("image/");
}

function withoutProviderFields(part: Part): Part {
	const copy: Record<string, unknown> = { ...part };
	for (const field of PROVIDER_FIELDS) delete copy[field];
	return copy as Part;
}

interface PartContext {
	readonly target: ModelEntry;
	readonly sameProvider: boolean;
}

/** Returns the adapted copy of `part`, or `undefined` when the part must not be sent. */
function adaptPart(part: Part, { target, sameProvider }: PartContext): Part | undefined {
	// Provider fields become provider options in `convertToModelMessages`. Nothing proves the
	// server issued them (no signature yet), so they are never replayed, whatever the claim.
	const copy = withoutProviderFields(part);

	switch (part.type) {
		case "reasoning":
		case "reasoning-file":
			// Reasoning is replayable only with its provider metadata (Anthropic's signature, OpenAI's
			// item id / encrypted content), which is always stripped above. Without it every provider
			// skips the part, and OpenAI logs the whole part, raw reasoning text included, as a warning
			// (W3 review r2 N1). So reasoning never reaches the model; the displayed history keeps it.
			return undefined;
		case "custom":
			// A custom part's content is its provider metadata, which is always stripped.
			return undefined;
		case "file":
			if (isImage(part.mediaType) && !target.capabilities.imageInput) {
				return { type: "text", text: IMAGE_OMITTED_TEXT };
			}
			return copy;
		default:
			if (isToolUIPart(part)) {
				if (INCOMPLETE_TOOL_STATES.has(part.state)) return undefined;
				if (part.providerExecuted === true && !sameProvider) return undefined;
			}
			return copy;
	}
}

/**
 * Adapts a UI history for the model that will answer the next turn (Req 3.3, ADR-7).
 *
 * Applied on the server right before `convertToModelMessages`, so the learner's displayed history
 * keeps everything. The history is client-supplied, so provider fields (`providerMetadata`,
 * `providerReference`, `callProviderMetadata`, `resultProviderMetadata`) and `custom` parts are
 * always dropped. Reasoning parts are always dropped too: without the stripped metadata no
 * provider can replay them. Provider-executed tool parts survive only when the message's
 * `metadata.modelId` is a catalog model of the target's provider; images become a text
 * placeholder for a model without image input; tool calls without a result are dropped. A message
 * left with no
 * sendable part is dropped. The input is never mutated: messages and parts are shallow copies,
 * nested values (tool input/output, data payloads) are shared and must be treated as read-only.
 */
export function adaptHistoryForModel(
	messages: readonly UIMessage[],
	target: ModelEntry,
): UIMessage[] {
	const adapted: UIMessage[] = [];
	for (const message of messages) {
		const context: PartContext = {
			target,
			sameProvider: originProvider(message) === target.provider,
		};
		const parts = message.parts.flatMap((part) => adaptPart(part, context) ?? []);
		if (parts.every((part) => part.type === "step-start")) continue;
		adapted.push({ ...message, parts });
	}
	return adapted;
}
