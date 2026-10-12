import { DEFAULT_INPUT_LIMITS } from "@platform/ai-core/config";
import { PlatformError } from "@platform/ai-core/errors";
import {
	loadSource,
	planSummary,
	type SummarizeRequest,
	streamSummary,
	summarizeRequestSchema,
} from "@platform/ai-core/summarize";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { GuardError, toErrorResponse, toStreamErrorText } from "@/lib/server/errors";
import { type GuardPolicy, guardRequest } from "@/lib/server/guard";
import { getPlatform } from "@/lib/server/platform";

// POST /api/summarize (plan C17, Req 4.5, 4.7, 4.8, 4.11): guard -> resolve model -> load the source
// (a failure answers 422 before the stream starts and before any LLM call) -> plan -> stream the
// summary events as `data-summary`, `data-summary-restart` and `data-summary-meta` parts.

export const dynamic = "force-dynamic";

// Limits beyond the schema (the 512 KiB body limit is checked first). Not exported: Next.js route
// modules may only export handlers and route config.
const SUMMARIZE_INPUT_LIMITS = Object.freeze({
	maxUrlCharacters: 2_048,
	maxTranscriptCharacters: 100_000,
});

const PROVIDER_FAILURE_MESSAGE =
	"要約の生成に失敗しました。しばらくしてからもう一度お試しください。";

function inspectSummarizeRequest(body: SummarizeRequest): GuardError | undefined {
	const { input } = body;
	if (input.kind === "transcript") {
		let characters = 0;
		for (const _ of input.text) characters += 1;
		if (characters > SUMMARIZE_INPUT_LIMITS.maxTranscriptCharacters) {
			return new GuardError(
				"limit-exceeded",
				`字幕テキストは ${SUMMARIZE_INPUT_LIMITS.maxTranscriptCharacters.toLocaleString("ja-JP")} 文字までです。`,
			);
		}
		return undefined;
	}
	if (input.url.length > SUMMARIZE_INPUT_LIMITS.maxUrlCharacters) {
		return new GuardError(
			"limit-exceeded",
			`URL は ${SUMMARIZE_INPUT_LIMITS.maxUrlCharacters.toLocaleString("ja-JP")} 文字までです。`,
		);
	}
	return undefined;
}

const SUMMARIZE_POLICY: GuardPolicy<SummarizeRequest> = {
	schema: summarizeRequestSchema,
	limits: DEFAULT_INPUT_LIMITS,
	inspect: inspectSummarizeRequest,
};

/**
 * A platform or guard error keeps its code. Anything else came from the provider or the SDK and may
 * hold request content or credentials, so only a fixed Japanese message is sent.
 */
function toStreamError(error: unknown): string {
	if (error instanceof PlatformError || error instanceof GuardError) {
		return toStreamErrorText(error);
	}
	return toStreamErrorText(new PlatformError("provider-unavailable", PROVIDER_FAILURE_MESSAGE));
}

export async function POST(request: Request): Promise<Response> {
	try {
		const platform = await getPlatform();
		const guarded = await guardRequest(request, SUMMARIZE_POLICY, {
			limiter: platform.limiter,
			mode: platform.mode,
		});
		if (!guarded.ok) return guarded.response;
		const { body } = guarded;

		const { model, entry } = await platform.gateway.resolve({
			purpose: "structured",
			modelId: body.modelId,
			require: ["structuredOutput"],
		});
		// Raised here, not inside the stream: the learner gets a 422 with the reason (Req 4.7, 4.11).
		const source = await loadSource(body.input, {
			http: platform.ports.http,
			transcripts: platform.ports.transcript,
			clock: platform.clock,
			signal: request.signal,
		});
		const plan = planSummary(source, entry);

		const stream = createUIMessageStream({
			execute: async ({ writer }) => {
				// Each attempt writes under its own id, so a restart leaves the discarded attempt behind
				// and the client shows only the part of the newest attempt.
				let attempt = 1;
				for await (const event of streamSummary(plan, {
					model,
					entry,
					abortSignal: request.signal,
				})) {
					switch (event.type) {
						case "partial":
						case "final":
							writer.write({ type: "data-summary", id: `summary-${attempt}`, data: event.summary });
							break;
						case "restart":
							attempt = event.attempt;
							writer.write({
								type: "data-summary-restart",
								id: `summary-restart-${event.attempt}`,
								data: { attempt: event.attempt, issues: event.issues },
							});
							break;
						case "meta":
							writer.write({ type: "data-summary-meta", id: "summary-meta", data: event.meta });
							break;
					}
				}
			},
			onError: toStreamError,
		});
		return createUIMessageStreamResponse({ stream });
	} catch (error) {
		return toErrorResponse(error);
	}
}
