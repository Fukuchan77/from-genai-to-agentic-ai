"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { type FormEvent, useState } from "react";
import { ErrorBanner } from "@/components/chat/ErrorBanner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
	type CouncilResultView,
	CouncilTimeline,
	type CouncilTurnView,
	type CouncilVerdictView,
	confirmedRoundTurns,
} from "./CouncilTimeline";
import { isUnseededError, SeedGuidance } from "./RecommendPanel";

/** A council persona as the page hands it down (id, name and stance; no server types). */
export interface PersonaOption {
	readonly id: string;
	readonly name: string;
	readonly viewpoint: string;
}

/** The data parts `/api/marketing/council` streams (plan C13, "ストリームのパート"). */
type CouncilDataParts = {
	"council-turn": Omit<CouncilTurnView, "id">;
	"council-verdict": CouncilVerdictView;
	"council-result": CouncilResultView;
};

export type CouncilMessage = UIMessage<unknown, CouncilDataParts>;

interface CouncilRequestOptions {
	readonly draft: string;
	readonly personaIds: readonly string[];
	readonly maxRounds: number;
}

/** The council takes a draft, not a conversation: the chat messages are not sent. */
export function prepareCouncilRequest({
	body,
}: {
	readonly id?: string;
	readonly messages?: readonly UIMessage[];
	readonly body: Record<string, unknown> | undefined;
}): { api: string; body: object } {
	const { draft, personaIds, maxRounds } = body as unknown as CouncilRequestOptions;
	return { api: "/api/marketing/council", body: { draft, personaIds, maxRounds } };
}

interface CouncilView {
	readonly turns: CouncilTurnView[];
	readonly verdicts: CouncilVerdictView[];
	readonly result: CouncilResultView | undefined;
}

/** Folds the newest assistant message into the timeline's inputs. */
function selectCouncilView(messages: readonly CouncilMessage[]): CouncilView {
	const message = messages.findLast((candidate) => candidate.role === "assistant");
	const turns: CouncilTurnView[] = [];
	const verdicts: CouncilVerdictView[] = [];
	let result: CouncilResultView | undefined;
	for (const part of message?.parts ?? []) {
		if (part.type === "data-council-turn") {
			turns.push({ ...part.data, id: part.id ?? `turn-${turns.length + 1}` });
		} else if (part.type === "data-council-verdict") {
			verdicts.push(part.data);
		} else if (part.type === "data-council-result") {
			result = part.data;
		}
	}
	return { turns, verdicts, result };
}

export interface CouncilPanelProps {
	readonly personas: readonly PersonaOption[];
	readonly defaultPersonaIds: readonly string[];
	/** The longest draft, in characters (the server's limit, handed down by the page). */
	readonly draftMaxLength: number;
	readonly personaLimits: { readonly min: number; readonly max: number };
	readonly roundLimits: { readonly min: number; readonly max: number; readonly default: number };
}

/**
 * The council form and its timeline (plan C14, Req 6.1-6.3): a draft, 2 to 5 personas and a round
 * limit go to the server, which validates them again. When the stream fails, only the rounds that
 * were settled stay on screen (W6 review F-17).
 */
export function CouncilPanel({
	personas,
	defaultPersonaIds,
	draftMaxLength,
	personaLimits,
	roundLimits,
}: CouncilPanelProps) {
	const [draft, setDraft] = useState("");
	const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(defaultPersonaIds));
	const [roundsText, setRoundsText] = useState(String(roundLimits.default));
	const [sent, setSent] = useState<CouncilRequestOptions | undefined>();
	const [transport] = useState(
		() =>
			new DefaultChatTransport<CouncilMessage>({
				api: "/api/marketing/council",
				prepareSendMessagesRequest: prepareCouncilRequest,
			}),
	);
	const { messages, sendMessage, stop, setMessages, status, error, clearError } =
		useChat<CouncilMessage>({ transport });

	const generating = status === "submitted" || status === "streaming";
	const length = [...draft].length;
	const tooLong = length > draftMaxLength;
	const personaCountOk = selected.size >= personaLimits.min && selected.size <= personaLimits.max;
	const rounds = roundsText.trim() === "" ? Number.NaN : Number(roundsText);
	const roundsOk =
		Number.isInteger(rounds) && rounds >= roundLimits.min && rounds <= roundLimits.max;
	const canSend = !generating && !tooLong && draft.trim() !== "" && personaCountOk && roundsOk;

	const view = selectCouncilView(messages);
	const hasView = view.turns.length > 0 || view.verdicts.length > 0 || view.result !== undefined;
	// A run that ended (finished, failed or stopped) without a result leaves its last round
	// unconfirmed; that is decided by the outcome, so dismissing the error banner cannot bring it back.
	const ended = status === "ready" || status === "error";
	const endedWithoutResult = ended && view.result === undefined && hasView;
	const shownTurns = endedWithoutResult
		? confirmedRoundTurns({ turns: view.turns, verdicts: view.verdicts, result: view.result })
		: view.turns;
	const stopped = endedWithoutResult && error === undefined;

	function start(options: CouncilRequestOptions) {
		setSent(options);
		setMessages([]);
		void sendMessage(
			{ text: options.draft },
			{ body: options as unknown as Record<string, unknown> },
		);
	}

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!canSend) return;
		start({
			draft: draft.trim(),
			// Catalog order, whatever order the learner ticked them in.
			personaIds: personas.filter(({ id }) => selected.has(id)).map(({ id }) => id),
			maxRounds: rounds,
		});
	}

	function toggle(id: string) {
		setSelected((current) => {
			const next = new Set(current);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}

	function retry() {
		clearError();
		if (sent) start(sent);
	}

	return (
		<div className="flex flex-col gap-6">
			<form onSubmit={handleSubmit} className="flex flex-col gap-4">
				<div className="flex flex-col gap-2">
					<label htmlFor="council-draft" className="text-sm font-medium">
						広告文案
					</label>
					<Textarea
						id="council-draft"
						value={draft}
						onChange={(event) => setDraft(event.target.value)}
						disabled={generating}
						aria-invalid={tooLong}
						placeholder="例: 新発売のコーヒー。深いコクと軽やかな後味。"
					/>
					{tooLong ? (
						<p role="alert" className="text-sm text-destructive">
							{`文案は ${draftMaxLength} 文字までです（現在 ${length} 文字）。`}
						</p>
					) : (
						<p className="text-xs text-muted-foreground">{`${length} / ${draftMaxLength} 文字`}</p>
					)}
				</div>
				<fieldset className="flex flex-col gap-2" disabled={generating}>
					<legend className="text-sm font-medium">参加するペルソナ</legend>
					{personas.map((persona) => {
						const checked = selected.has(persona.id);
						return (
							<label key={persona.id} className="flex items-start gap-2 text-sm">
								<input
									type="checkbox"
									className="mt-0.5 size-4 shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2"
									checked={checked}
									disabled={generating || (!checked && selected.size >= personaLimits.max)}
									onChange={() => toggle(persona.id)}
									aria-label={persona.name}
								/>
								<span className="flex flex-col">
									<span className="font-medium">{persona.name}</span>
									<span className="text-xs text-muted-foreground">{persona.viewpoint}</span>
								</span>
							</label>
						);
					})}
					<p className="text-xs text-muted-foreground">
						{`${selected.size} / ${personaLimits.max} 件を選択中（${personaLimits.min}〜${personaLimits.max} 件）`}
					</p>
					{personaCountOk ? null : (
						<p role="alert" className="text-sm text-destructive">
							{`ペルソナは ${personaLimits.min}〜${personaLimits.max} 件を選んでください。`}
						</p>
					)}
				</fieldset>
				<div className="flex flex-col gap-2">
					<label htmlFor="council-rounds" className="text-sm font-medium">
						ラウンドの上限
					</label>
					<input
						id="council-rounds"
						type="number"
						inputMode="numeric"
						min={roundLimits.min}
						max={roundLimits.max}
						step={1}
						value={roundsText}
						disabled={generating}
						onChange={(event) => setRoundsText(event.target.value)}
						aria-invalid={!roundsOk}
						className="h-9 w-24 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 aria-invalid:border-destructive"
					/>
					{roundsOk ? null : (
						<p role="alert" className="text-sm text-destructive">
							{`ラウンドは ${roundLimits.min}〜${roundLimits.max} の整数にしてください。`}
						</p>
					)}
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<Button type="submit" disabled={!canSend}>
						合議を始める
					</Button>
					{generating ? (
						<Button type="button" variant="outline" onClick={() => void stop()}>
							停止
						</Button>
					) : null}
				</div>
			</form>
			<p
				role="status"
				aria-label="実行の状態"
				aria-live="polite"
				className="text-sm text-muted-foreground"
			>
				{generating && error === undefined
					? "合議を進めています"
					: stopped
						? "生成を停止しました。確定したラウンドだけを表示しています"
						: ""}
			</p>
			{error === undefined ? null : isUnseededError(error) ? (
				<SeedGuidance onRetry={retry} />
			) : (
				<ErrorBanner error={error} onRetry={retry} onDismiss={clearError} />
			)}
			{hasView ? (
				<CouncilTimeline turns={shownTurns} verdicts={view.verdicts} result={view.result} />
			) : null}
		</div>
	);
}
