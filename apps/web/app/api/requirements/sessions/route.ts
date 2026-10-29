import { DEFAULT_INPUT_LIMITS } from "@platform/ai-core/config";
import {
	askRound,
	createInterviewState,
	generatePersonas,
	getRequirementsSessions,
	REQUIREMENTS_REQUEST_DEFAULTS,
	type RequirementsSessionRequest,
	requirementsSessionRequestSchema,
} from "@platform/ai-core/requirements";
import { toErrorResponse } from "@/lib/server/errors";
import { type GuardPolicy, guardRequest } from "@/lib/server/guard";
import { getPlatform } from "@/lib/server/platform";
import { getSessionRegistry } from "@/lib/server/sessions";

// POST /api/requirements/sessions (plan C13, Req 5.1, 5.2): guard (413 -> 400 -> 429) -> resolve a
// model with structured output (400 capability-unsupported) -> personas (one structured-output
// call; 502 output-invalid after three bad outputs) -> the first round's questions -> the interview
// session in the shared registry (CL-11) -> JSON. The session exists only once everything has
// succeeded, so a failed start leaves nothing behind. The id is handed out by the server.

export const dynamic = "force-dynamic";

const POLICY: GuardPolicy<RequirementsSessionRequest> = {
	schema: requirementsSessionRequestSchema,
	limits: DEFAULT_INPUT_LIMITS,
	// The overview length and the numeric ranges are part of the schema.
	inspect: () => undefined,
};

export async function POST(request: Request): Promise<Response> {
	try {
		const platform = await getPlatform();
		const guarded = await guardRequest(request, POLICY, {
			limiter: platform.limiter,
			mode: platform.mode,
		});
		if (!guarded.ok) return guarded.response;
		const { body } = guarded;

		// Refuse before any LLM call when the registry is full (it sweeps expired interviews first).
		const sessions = getRequirementsSessions(getSessionRegistry, platform.clock);
		sessions.ensureCapacity();

		// Personas and questions are structured outputs: refuse a model without them before any LLM call.
		const { model } = await platform.gateway.resolve({
			purpose: "chat",
			...(body.modelId ? { modelId: body.modelId } : {}),
			require: ["structuredOutput"],
		});

		const personas = await generatePersonas({
			model,
			overview: body.overview,
			count: body.personaCount ?? REQUIREMENTS_REQUEST_DEFAULTS.personaCount,
			signal: request.signal,
		});
		const state = createInterviewState({
			maxRounds: body.maxRounds ?? REQUIREMENTS_REQUEST_DEFAULTS.maxRounds,
		});
		const questions = await askRound({ model, personas, state, signal: request.signal });
		request.signal.throwIfAborted();

		const sessionId = crypto.randomUUID();
		sessions.create(sessionId, () => ({
			overview: body.overview,
			personas,
			modelId: body.modelId,
			state,
			questions,
			document: null,
		}));

		return Response.json({ sessionId, personas, questions });
	} catch (error) {
		return toErrorResponse(error);
	}
}
