"use client";

import { useChat } from "@ai-sdk/react";
import type { Persona, Question } from "@platform/ai-core/requirements";
import { DefaultChatTransport, type UIMessage } from "ai";
import { type FormEvent, useRef, useState } from "react";
import { ErrorBanner } from "@/components/chat/ErrorBanner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { DocumentDownload, type RequirementsJudgement } from "./DocumentDownload";
import { RequirementsPreview, type RequirementsPreviewData } from "./RequirementsPreview";

/** The data parts `/api/requirements/sessions/[id]/messages` streams (plan C13). */
type RequirementsDataParts = {
	"requirements-preview": RequirementsPreviewData;
	"requirements-judgement": RequirementsJudgement;
	"requirements-questions": { round: number; questions: readonly Question[] };
};

export type RequirementsMessage = UIMessage<unknown, RequirementsDataParts>;

/** The most answers one round request carries (the server's `answers` upper bound). */
const MAX_ANSWERS_PER_REQUEST = 10;

interface StartedSession {
	readonly sessionId: string;
	readonly personas: readonly Persona[];
	readonly questions: readonly Question[];
}

/** What the panel hands to `sendMessage` as `body`; `prepareRoundRequest` turns it into the wire body. */
interface RoundRequestOptions {
	readonly sessionId: string;
	readonly answers: readonly { readonly questionId: string; readonly text: string }[];
}

/** The request of one round: the answers go to the session's own route; the chat text is not sent. */
export function prepareRoundRequest({
	body,
}: {
	readonly body: Record<string, unknown> | undefined;
}): {
	api: string;
	body: object;
} {
	const { sessionId, answers } = body as unknown as RoundRequestOptions;
	return {
		api: `/api/requirements/sessions/${encodeURIComponent(sessionId)}/messages`,
		body: { answers },
	};
}

/**
 * Folds the stream into what the screen shows. Each part is read from the newest message that has
 * one, so a round that fails before its preview leaves the earlier round's state on screen. The
 * panel reads the server's flags and decides nothing itself.
 */
export function selectInterviewView(messages: readonly RequirementsMessage[]) {
	let preview: RequirementsPreviewData | null = null;
	let judgement: RequirementsJudgement | null = null;
	let next: { round: number; questions: readonly Question[] } | null = null;
	for (const message of messages) {
		if (message.role !== "assistant") continue;
		for (const part of message.parts) {
			if (part.type === "data-requirements-preview") preview = part.data;
			else if (part.type === "data-requirements-judgement") judgement = part.data;
			else if (part.type === "data-requirements-questions") next = part.data;
		}
	}
	return { preview, judgement, next };
}

export interface InterviewPanelProps {
	readonly overviewMaxLength: number;
	readonly answerMaxLength: number;
}

/** The `error.details.reason` of a rejected response, read from a clone; anything else is undefined. */
async function readReason(response: Response): Promise<string | undefined> {
	try {
		const body: unknown = await response.clone().json();
		const reason = (body as { error?: { details?: { reason?: unknown } } } | null)?.error?.details
			?.reason;
		return typeof reason === "string" ? reason : undefined;
	} catch {
		return undefined;
	}
}

function lengthOf(text: string): number {
	return [...text].length;
}

/** A field's character counter, or the announced overflow message. */
function LengthNote({ length, max, label }: { length: number; max: number; label: string }) {
	return length > max ? (
		<p role="alert" className="text-sm text-destructive">
			{`${label}は ${max} 文字までです（現在 ${length} 文字）。`}
		</p>
	) : (
		<p className="text-xs text-muted-foreground">{`${length} / ${max} 文字`}</p>
	);
}

/**
 * The requirements interview (Req 5.1-5.3, plan C14): an overview form, then rounds of questions
 * grouped by persona. The server generates personas and questions, extracts requirements, judges
 * sufficiency and ends the interview; this panel takes the input, sends it, and shows what comes
 * back (`aria-live`). It validates nothing beyond the limits it states next to the fields.
 */
export function InterviewPanel({ overviewMaxLength, answerMaxLength }: InterviewPanelProps) {
	const [overview, setOverview] = useState("");
	const [session, setSession] = useState<StartedSession | undefined>();
	const [starting, setStarting] = useState(false);
	const [startError, setStartError] = useState<Error | undefined>();
	const [answers, setAnswers] = useState<Readonly<Record<string, string>>>({});
	const [failureStatus, setFailureStatus] = useState<number | undefined>();
	const [failureReason, setFailureReason] = useState<string | undefined>();

	// The transport's fetch remembers the status of a rejected request: `useChat` only reports the body.
	const lastStatus = useRef<number | undefined>(undefined);
	// ... and the closed `details.reason` of its error body (a 409 is complete only for "completed").
	const lastReason = useRef<string | undefined>(undefined);
	const [transport] = useState(
		() =>
			new DefaultChatTransport<RequirementsMessage>({
				api: "/api/requirements/sessions",
				prepareSendMessagesRequest: prepareRoundRequest,
				fetch: async (input, init) => {
					const response = await fetch(input, init);
					lastStatus.current = response.ok ? undefined : response.status;
					lastReason.current = response.ok ? undefined : await readReason(response);
					return response;
				},
			}),
	);
	const { messages, sendMessage, setMessages, status, error, clearError } =
		useChat<RequirementsMessage>({
			transport,
			onError: () => {
				setFailureStatus(lastStatus.current);
				setFailureReason(lastReason.current);
			},
		});

	const running = status === "submitted" || status === "streaming";
	const view = selectInterviewView(messages);
	const expired = error !== undefined && failureStatus === 404;
	// Only the server's "completed" ends the interview; "busy" or a 409 without a reason keeps it alive.
	const alreadyComplete =
		error !== undefined && failureStatus === 409 && failureReason === "completed";
	const completed =
		alreadyComplete ||
		(view.judgement !== null && (view.judgement.sufficient || view.judgement.forcedEnd));
	const round = view.next?.round ?? 1;
	const questions = view.next?.questions ?? session?.questions ?? [];
	const personaNames = Object.fromEntries((session?.personas ?? []).map((p) => [p.id, p.name]));

	const overviewLength = lengthOf(overview);
	const overviewTooLong = overviewLength > overviewMaxLength;
	const canStart = !starting && overview.trim() !== "" && !overviewTooLong;

	const filled = questions.filter((question) => (answers[question.id] ?? "").trim() !== "");
	const tooManyAnswers = filled.length > MAX_ANSWERS_PER_REQUEST;
	const anyTooLong = filled.some(
		(question) => lengthOf(answers[question.id] ?? "") > answerMaxLength,
	);
	const canSend =
		session !== undefined &&
		!running &&
		!completed &&
		!expired &&
		filled.length >= 1 &&
		!tooManyAnswers &&
		!anyTooLong;

	async function start() {
		setStarting(true);
		setStartError(undefined);
		try {
			const response = await fetch("/api/requirements/sessions", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ overview }),
			});
			if (!response.ok) throw new Error(await response.text());
			setSession((await response.json()) as StartedSession);
		} catch (caught) {
			setStartError(caught instanceof Error ? caught : new Error(String(caught)));
		} finally {
			setStarting(false);
		}
	}

	function handleStart(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (canStart) void start();
	}

	function send() {
		if (!canSend || session === undefined) return;
		clearError();
		setFailureStatus(undefined);
		const options: RoundRequestOptions = {
			sessionId: session.sessionId,
			answers: filled.map((question) => ({
				questionId: question.id,
				text: answers[question.id] ?? "",
			})),
		};
		void sendMessage(
			{ text: `第 ${round} ラウンドの回答` },
			{ body: options as unknown as Record<string, unknown> },
		);
	}

	function handleSend(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		send();
	}

	function startOver() {
		clearError();
		setFailureStatus(undefined);
		setMessages([]);
		setSession(undefined);
		setAnswers({});
		setOverview("");
		setStartError(undefined);
	}

	if (session === undefined) {
		return (
			<div className="flex flex-col gap-4">
				<form onSubmit={handleStart} className="flex flex-col gap-3">
					<label htmlFor="requirements-overview" className="text-sm font-medium">
						プロダクトの概要
					</label>
					<Textarea
						id="requirements-overview"
						value={overview}
						onChange={(event) => setOverview(event.target.value)}
						aria-invalid={overviewTooLong}
						disabled={starting}
						placeholder="例: 中小企業向けに経費精算を自動化するサービス"
					/>
					<LengthNote length={overviewLength} max={overviewMaxLength} label="概要" />
					<div>
						<Button type="submit" disabled={!canStart}>
							面接を始める
						</Button>
					</div>
				</form>
				<p role="status" aria-live="polite" className="text-sm text-muted-foreground">
					{starting ? "ペルソナと最初の質問を用意しています" : ""}
				</p>
				{startError ? (
					<ErrorBanner
						error={startError}
						onRetry={() => void start()}
						onDismiss={() => setStartError(undefined)}
					/>
				) : null}
			</div>
		);
	}

	const statusMessage = running ? "回答を処理しています" : completed ? "面接が完了しました。" : "";
	const groups = [
		...session.personas.map((persona) => ({ id: persona.id, persona })),
		...questions
			.filter((q) => !session.personas.some((persona) => persona.id === q.personaId))
			.map((q) => ({ id: q.personaId, persona: undefined })),
	].filter((group, index, all) => all.findIndex((other) => other.id === group.id) === index);

	return (
		<div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
			<div className="flex flex-col gap-4">
				<p role="status" aria-live="polite" className="text-sm font-medium">
					{statusMessage}
				</p>
				{expired ? (
					<Alert variant="destructive">
						<AlertTitle>面接の有効期限が切れました</AlertTitle>
						<AlertDescription>
							<p>
								一定時間操作がなかったため、この面接は終了しました。概要を入力して、もう一度始めてください。
							</p>
							<Button type="button" variant="outline" size="sm" onClick={startOver}>
								新しい面接を始める
							</Button>
						</AlertDescription>
					</Alert>
				) : null}
				{error && !expired && !alreadyComplete ? (
					<ErrorBanner error={error} onRetry={send} onDismiss={clearError} />
				) : null}
				{completed ? (
					<div className="flex flex-col gap-3">
						<p className="text-sm text-muted-foreground">
							回答の受付は終了しました。要件定義書をダウンロードできます。
						</p>
						<Button type="button" variant="outline" className="self-start" onClick={startOver}>
							新しい面接を始める
						</Button>
					</div>
				) : expired ? null : (
					<form onSubmit={handleSend} className="flex flex-col gap-4">
						<h2 className="text-lg font-semibold">{`第 ${round} ラウンド`}</h2>
						<p className="text-sm text-muted-foreground">
							答えられる質問にだけ回答してください（1〜{MAX_ANSWERS_PER_REQUEST} 件）。
						</p>
						{groups.map(({ id, persona }) => {
							const own = questions.filter((question) => question.personaId === id);
							if (own.length === 0) return null;
							return (
								<fieldset
									key={id}
									disabled={running}
									className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3"
								>
									<legend className="px-1 text-sm font-semibold">{persona?.name ?? id}</legend>
									{persona ? <p className="text-xs text-muted-foreground">{persona.role}</p> : null}
									{own.map((question) => {
										const value = answers[question.id] ?? "";
										return (
											<div key={question.id} className="flex flex-col gap-2">
												<label htmlFor={`answer-${question.id}`} className="text-sm">
													{question.text}
												</label>
												<Textarea
													id={`answer-${question.id}`}
													value={value}
													onChange={(event) =>
														setAnswers((current) => ({
															...current,
															[question.id]: event.target.value,
														}))
													}
													aria-invalid={lengthOf(value) > answerMaxLength}
												/>
												<LengthNote length={lengthOf(value)} max={answerMaxLength} label="回答" />
											</div>
										);
									})}
								</fieldset>
							);
						})}
						{tooManyAnswers ? (
							<p role="alert" className="text-sm text-destructive">
								{`一度に送れる回答は ${MAX_ANSWERS_PER_REQUEST} 件までです（現在 ${filled.length} 件）。`}
							</p>
						) : null}
						<div>
							<Button type="submit" disabled={!canSend}>
								回答を送信
							</Button>
						</div>
					</form>
				)}
			</div>
			<div className="flex flex-col gap-6">
				<RequirementsPreview
					requirements={view.preview}
					personaNames={personaNames}
					{...(view.judgement ? { round: view.judgement.round } : {})}
				/>
				<DocumentDownload
					sessionId={session.sessionId}
					judgement={view.judgement}
					documentReady={completed}
				/>
			</div>
		</div>
	);
}
