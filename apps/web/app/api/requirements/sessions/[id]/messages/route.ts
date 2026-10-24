import { DEFAULT_INPUT_LIMITS } from "@platform/ai-core/config";
import {
	askRound,
	closeRound,
	extractRequirements,
	getRequirementsSessions,
	judgeSufficiency,
	type Question,
	type RequirementsMessagesRequest,
	type RequirementsSession,
	recordAnswer,
	renderRequirementDocument,
	requirementsMessagesRequestSchema,
} from "@platform/ai-core/requirements";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import {
	writeRequirementsJudgement,
	writeRequirementsPreview,
	writeRequirementsQuestions,
} from "@/lib/server/domain-stream";
import {
	GuardError,
	toErrorResponse,
	toNotFoundResponse,
	toStreamErrorText,
} from "@/lib/server/errors";
import { type GuardPolicy, guardRequest, rateLimitRejection } from "@/lib/server/guard";
import { getPlatform } from "@/lib/server/platform";
import { getSessionRegistry } from "@/lib/server/sessions";

// POST /api/requirements/sessions/[id]/messages (plan C13, Req 5.2-5.6): advances an interview by
// one round, a fixed sequence of workflow steps (ADR-9, no agent loop). Checks run cheapest first and
// none of them calls a model: 404 session (looked up before the body is read, like the other [id]
// routes) -> 413 -> 400 body -> 400 question that does not exist -> 409 interview completed -> 400
// question of an earlier round -> 409 a round is already running (the lock is taken here, in the
// same synchronous step as the state checks, before any await) -> 429 (`live` only) -> 400
// capability. Then, per answer in request order: extract the requirements and stream the preview
// (an extraction that stays invalid after the regenerations ends the stream with `output-invalid`
// and commits nothing); then judge sufficiency, close the round and,
// when the interview goes on, ask the next questions, or else render the document.
//
// Nothing is written to the session until every step has succeeded and the client is still there,
// and then all of it is written together (state, questions, document) before the verdict is
// streamed. A failure or an abort therefore leaves the session as the round found it and the
// learner can send the same answers again. The previews already streamed are the only trace.
//
// Stream parts (all written by `domain-stream.ts`):
//   data-requirements-preview    state, id "preview": after every answer
//   data-requirements-judgement  event, id "judgement-<round>": the verdict. The interview is over
//                                when `sufficient || forcedEnd`; the document is then ready at
//                                GET .../document
//   data-requirements-questions  event, id "questions-<round>": `{ round, questions }`, only when the
//                                interview goes on

export const dynamic = "force-dynamic";

const POLICY: GuardPolicy<RequirementsMessagesRequest> = {
	schema: requirementsMessagesRequestSchema,
	limits: DEFAULT_INPUT_LIMITS,
	// The answer count and lengths are part of the schema.
	inspect: () => undefined,
};

// The guard would rate-limit before the checks that need the session, so it runs with a limiter
// that always allows, and `rateLimitRejection` runs with the real one after those checks.
const UNLIMITED = { check: () => ({ allowed: true as const }) };

// Sessions with a round in flight: two rounds on one interview would interleave their commits.
const RUNNING = new WeakSet<RequirementsSession>();

function conflict(message: string): Response {
	return new Response(JSON.stringify({ error: { code: "invalid-request", message } }), {
		status: 409,
		headers: { "content-type": "application/json; charset=utf-8" },
	});
}

export async function POST(
	request: Request,
	context: { params: Promise<{ id: string }> },
): Promise<Response> {
	try {
		const { id } = await context.params;
		const platform = await getPlatform();
		const store = getRequirementsSessions(getSessionRegistry, platform.clock);
		const session = store.get(id); // an id that was never handed out is simply absent
		if (!session) return toNotFoundResponse("指定された面接は見つかりません。");
		// A request is activity (a plain `get` is not).
		store.touch(id);

		const guarded = await guardRequest(request, POLICY, {
			limiter: UNLIMITED,
			mode: platform.mode,
		});
		if (!guarded.ok) return guarded.response;
		const { answers } = guarded.body;

		// Messages name nothing from the request: a question id is learner input.
		const known = new Map(session.questions.map((question) => [question.id, question]));
		if (answers.some((answer) => !known.has(answer.questionId))) {
			throw new GuardError("invalid-request", "存在しない質問への回答が含まれています。");
		}
		if (session.state.completed) return conflict("この面接はすでに完了しています。");
		const currentPrefix = `q-${session.state.round + 1}-`;
		if (answers.some((answer) => !answer.questionId.startsWith(currentPrefix))) {
			throw new GuardError("invalid-request", "いまのラウンドの質問にだけ回答できます。");
		}
		// The checks above and this lock have no await between them, and nothing but the lock holder
		// changes `session.state`, so no other request can slip a round in between (W6 F-2).
		if (RUNNING.has(session))
			return conflict("前の回答を処理中です。終わってからもう一度送ってください。");
		RUNNING.add(session);

		try {
			const limited = rateLimitRejection({ limiter: platform.limiter, mode: platform.mode });
			if (limited) throw limited;

			// Personas and questions are structured outputs: refuse a model without them before any LLM call.
			const { model } = await platform.gateway.resolve({
				purpose: "chat",
				...(session.modelId ? { modelId: session.modelId } : {}),
				require: ["structuredOutput"],
			});

			const stream = createUIMessageStream({
				execute: async ({ writer }) => {
					try {
						const signal = request.signal;
						let state = session.state;
						for (const answer of answers) {
							const question = known.get(answer.questionId) as Question;
							const input = {
								questionId: question.id,
								personaId: question.personaId,
								text: answer.text,
							};
							const extracted = await extractRequirements({
								model,
								answer: input,
								current: state.requirements,
								signal,
							});
							signal.throwIfAborted();
							state = recordAnswer(state, input, extracted);
							writeRequirementsPreview(writer, state.requirements);
						}

						// `round` counts the round being judged, which `closeRound` is about to make.
						const verdict = await judgeSufficiency({
							model,
							requirements: state.requirements,
							round: state.round + 1,
							maxRounds: state.maxRounds,
							signal,
						});
						signal.throwIfAborted();
						const closed = closeRound(state, verdict);
						const next = closed.completed
							? []
							: await askRound({ model, personas: session.personas, state: closed, signal });
						const document = closed.completed
							? renderRequirementDocument(closed.requirements, {
									forcedEnd: closed.forcedEnd,
									missing: closed.missing,
								})
							: null;
						signal.throwIfAborted();

						session.state = closed;
						session.questions = [...session.questions, ...next];
						session.document = document;
						store.touch(id);

						writeRequirementsJudgement(writer, closed.round, verdict);
						if (!closed.completed) writeRequirementsQuestions(writer, closed.round + 1, next);
					} finally {
						RUNNING.delete(session);
					}
				},
				onError: toStreamErrorText,
			});
			return createUIMessageStreamResponse({ stream });
		} catch (error) {
			RUNNING.delete(session);
			throw error;
		}
	} catch (error) {
		return toErrorResponse(error);
	}
}
