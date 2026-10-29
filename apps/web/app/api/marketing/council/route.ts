import { DEFAULT_COUNCIL, DEFAULT_INPUT_LIMITS } from "@platform/ai-core/config";
import { PlatformError } from "@platform/ai-core/errors";
import { type CouncilRequest, councilRequestSchema, runCouncil } from "@platform/ai-core/marketing";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import {
	createCouncilStreamer,
	writeCouncilResult,
	writeCouncilVerdict,
} from "@/lib/server/domain-stream";
import { toErrorResponse, toStreamErrorText } from "@/lib/server/errors";
import { type GuardPolicy, guardRequest, rateLimitRejection } from "@/lib/server/guard";
import { getCatalogRepo, getPlatform } from "@/lib/server/platform";

// POST /api/marketing/council (plan C13, Req 6.1-6.3): the council needs the catalog's personas, so
// the order is body size 413 -> shape and limits 400 -> catalog 503 (unseeded, or no database) ->
// unknown persona ids 400 -> `live` rate limit 429 -> a model with structured output (400). Nothing
// that is refused before the 429 spends quota. The stream carries each statement as it is made
// (`onTurn`) and each round's verdict as soon as it is settled (`onRound`), so a failure in a later
// round does not lose the earlier verdicts; the result comes last. Personas always speak in catalog (`ordinal`) order.

export const dynamic = "force-dynamic";

const POLICY: GuardPolicy<CouncilRequest> = {
	schema: councilRequestSchema,
	limits: DEFAULT_INPUT_LIMITS,
	// The draft length, the round limit and the persona count are part of the schema.
	inspect: () => undefined,
};

export async function POST(request: Request): Promise<Response> {
	try {
		const platform = await getPlatform();
		// The guard here never rate-limits (`mock`): the quota is spent after the persona check below.
		const guarded = await guardRequest(request, POLICY, {
			limiter: platform.limiter,
			mode: "mock",
		});
		if (!guarded.ok) return guarded.response;
		const { body } = guarded;

		const repo = await getCatalogRepo();
		const catalog = await repo.listPersonas();
		const wanted = new Set(body.personaIds ?? DEFAULT_COUNCIL.personaIds);
		const known = new Set(catalog.map((persona) => persona.id));
		if ([...wanted].some((id) => !known.has(id))) {
			throw new PlatformError(
				"invalid-request",
				"存在しないペルソナが指定されています。ペルソナの ID を確認してください。",
			);
		}
		const personas = catalog.filter((persona) => wanted.has(persona.id));

		const limited = rateLimitRejection({ limiter: platform.limiter, mode: platform.mode });
		if (limited) return toErrorResponse(limited);

		// The moderator's verdict is structured output; the personas use no tools.
		const { model } = await platform.gateway.resolve({
			purpose: "chat",
			...(body.modelId ? { modelId: body.modelId } : {}),
			require: ["structuredOutput"],
		});

		const stream = createUIMessageStream({
			execute: async ({ writer }) => {
				const result = await runCouncil({
					draft: body.draft,
					personas,
					model,
					clock: platform.clock,
					signal: request.signal,
					...(body.maxRounds === undefined ? {} : { maxRounds: body.maxRounds }),
					onTurn: createCouncilStreamer(writer),
					// `runCouncil` swallows a failing listener, like `onTurn`.
					onRound: (round) => {
						if (round.verdict) writeCouncilVerdict(writer, round.round, round.verdict);
					},
				});
				// A run that was stopped throws before this line, so it never sends a result.
				writeCouncilResult(writer, result);
			},
			onError: toStreamErrorText,
		});
		return createUIMessageStreamResponse({ stream });
	} catch (error) {
		return toErrorResponse(error);
	}
}
