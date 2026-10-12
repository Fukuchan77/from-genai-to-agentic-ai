import type { RagEvent } from "@platform/ai-core/rag";
import { toStreamErrorText } from "./errors";

// Maps the closed `RagEvent` union to UI message stream parts (plan C13, "ストリームのパート").
// Route Handlers call `writeRagEvents` and nothing else with the events, so the part names, ids
// and ordering rules live here and in one test file.

/** The part of a UI message stream writer this module uses (`UIMessageStreamWriter` fits). */
export interface RagStreamWriter {
	write(part: Record<string, unknown> & { type: string }): void;
}

const TEXT_ID = "answer";

/**
 * Writes every event as a part. Stage and trace parts carry a fixed id per kind, so the client
 * keeps the newest of each. The text part is closed before the result, and nothing is closed or
 * sent when the stream fails or is aborted: the failure propagates to the caller's `onError`.
 */
export async function writeRagEvents(
	events: AsyncIterable<RagEvent>,
	writer: RagStreamWriter,
): Promise<void> {
	let textOpen = false;
	for await (const event of events) {
		switch (event.type) {
			case "stage": {
				const { stage, status, detail } = event;
				writer.write({
					type: "data-rag-stage",
					id: `stage-${stage}`,
					data: { stage, status, ...(detail === undefined ? {} : { detail }) },
				});
				break;
			}
			case "trace":
				writer.write({ type: "data-rag-trace", id: "trace", data: event.trace });
				break;
			case "text-delta":
				if (!textOpen) {
					writer.write({ type: "text-start", id: TEXT_ID });
					textOpen = true;
				}
				writer.write({ type: "text-delta", id: TEXT_ID, delta: event.text });
				break;
			case "result":
				if (textOpen) {
					writer.write({ type: "text-end", id: TEXT_ID });
					textOpen = false;
				}
				writer.write({ type: "data-rag-result", id: "result", data: event.result });
				break;
		}
	}
}

/**
 * The `onError` text of a stream that fails after it started: `code` and the Japanese message of
 * a platform or guard error, the fixed unexpected-error text for anything else (provider and SDK
 * errors can hold request content, SQL or credentials).
 */
export function toRagStreamError(error: unknown): string {
	return toStreamErrorText(error);
}
