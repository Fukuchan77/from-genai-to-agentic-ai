"use client";

import { useChat } from "@ai-sdk/react";
import type {
	CredentialKind,
	NextDecision,
	PlanDiff,
	PlanTaskView,
	TicketStatus,
} from "@platform/ai-core/helpdesk";
import type { ModelOption } from "@platform/ai-core/models";
import { DefaultChatTransport, type UIMessage } from "ai";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { ErrorBanner } from "@/components/chat/ErrorBanner";
import { ModelSelector } from "@/components/chat/ModelSelector";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { type HelpdeskPlanState, type HelpdeskProgressState, PlanDashboard } from "./PlanDashboard";
import { TicketList, type TicketSummary } from "./TicketList";

/** `data-helpdesk-result` as `createHelpdeskStreamer` writes it. */
export interface HelpdeskResultState {
	readonly ticketId: string;
	readonly status: TicketStatus;
	readonly answer?: string;
	readonly reason?: string;
	readonly remaining?: readonly string[];
	readonly credentialKinds?: readonly string[];
}

type HelpdeskDataParts = {
	"helpdesk-plan": {
		revision: number;
		tasks: PlanTaskView[];
		diff?: PlanDiff;
	};
	"helpdesk-progress": {
		stepsUsed: number;
		maxSteps: number;
		current?: string;
		decision?: { decision: NextDecision; reason: string };
	};
	"helpdesk-result": HelpdeskResultState;
};

export type HelpdeskMessage = UIMessage<unknown, HelpdeskDataParts>;

export interface HelpdeskView {
	readonly plan: HelpdeskPlanState | undefined;
	readonly progress: HelpdeskProgressState | undefined;
	readonly result: HelpdeskResultState | undefined;
}

/**
 * Folds the newest assistant message into what the screen shows (plan C14). Plan and progress
 * parts keep one id each, so the newest of each wins; the result is the newest result part.
 */
export function selectHelpdeskView(messages: readonly HelpdeskMessage[]): HelpdeskView {
	const message = messages.findLast((candidate) => candidate.role === "assistant");
	let plan: HelpdeskPlanState | undefined;
	let progress: HelpdeskProgressState | undefined;
	let result: HelpdeskResultState | undefined;
	for (const part of message?.parts ?? []) {
		if (part.type === "data-helpdesk-plan") plan = part.data;
		else if (part.type === "data-helpdesk-progress") progress = part.data;
		else if (part.type === "data-helpdesk-result") result = part.data;
	}
	return { plan, progress, result };
}

/** The request of one inquiry: `/api/helpdesk` takes the inquiry text, not a message list. */
export function prepareHelpdeskRequest({
	messages,
	body,
}: {
	readonly id: string;
	readonly messages: readonly UIMessage[];
	readonly body: Record<string, unknown> | undefined;
}): { api: string; body: object } {
	const newest = messages.findLast((message) => message.role === "user");
	const inquiry = (newest?.parts ?? [])
		.map((part) => (part.type === "text" ? part.text : ""))
		.join("");
	return { api: "/api/helpdesk", body: { inquiry, modelId: body?.modelId } };
}

export interface HelpdeskExample {
	readonly label: string;
	readonly inquiry: string;
}

export interface HelpdeskPanelProps {
	/** Chat models that call tools and produce structured output. */
	readonly models: readonly ModelOption[];
	readonly defaultModelId: string;
	/** The tickets the server loaded, or why it could not. */
	readonly initial: { readonly tickets: readonly TicketSummary[] } | { readonly message: string };
	readonly inquiryMaxLength: number;
	readonly examples: readonly HelpdeskExample[];
}

const CREDENTIAL_LABELS: Readonly<Record<CredentialKind, string>> = {
	"plaintext-password": "パスワード（平文）",
	"temporary-password": "仮パスワード",
	"api-key": "API キー",
	"access-token": "アクセストークン",
};

const RESULT_LABELS: Readonly<Record<TicketStatus, string>> = {
	open: "未完了",
	resolved: "解決済み",
	escalated: "エスカレーション",
};

const RESULT_VARIANTS: Readonly<Record<TicketStatus, NonNullable<BadgeProps["variant"]>>> = {
	open: "secondary",
	resolved: "default",
	escalated: "destructive",
};

function isCredentialKind(kind: string): kind is CredentialKind {
	return Object.hasOwn(CREDENTIAL_LABELS, kind);
}

function ResultView({ result }: { readonly result: HelpdeskResultState }) {
	const kinds = (result.credentialKinds ?? []).filter(isCredentialKind);
	return (
		<section
			aria-label="最終結果"
			className="flex flex-col gap-2 rounded-lg border border-border p-3"
		>
			<div className="flex items-center gap-2">
				<span className="font-mono text-sm font-medium">{result.ticketId}</span>
				<Badge variant={RESULT_VARIANTS[result.status]}>{RESULT_LABELS[result.status]}</Badge>
			</div>
			{result.answer === undefined ? null : (
				<div className="flex flex-col gap-0.5 text-sm">
					<span className="text-xs font-medium">回答</span>
					<p className="whitespace-pre-wrap">{result.answer}</p>
				</div>
			)}
			{result.reason === undefined ? null : (
				<div className="flex flex-col gap-0.5 text-sm">
					<span className="text-xs font-medium">理由</span>
					<p className="whitespace-pre-wrap">{result.reason}</p>
				</div>
			)}
			{result.remaining !== undefined && result.remaining.length > 0 ? (
				<ul aria-label="未完了のタスク" className="flex flex-wrap gap-1">
					{result.remaining.map((id) => (
						<li key={id} className="rounded-md border border-border px-1.5 font-mono text-xs">
							{id}
						</li>
					))}
				</ul>
			) : null}
			{kinds.length > 0 ? (
				<div
					role="note"
					aria-label="検出された認証情報"
					className="flex flex-col gap-1 rounded-md border border-border p-2 text-sm"
				>
					<p>
						{result.status === "escalated"
							? "回答の下書きに認証情報の形をした文字列が見つかったため、担当者へエスカレーションしました（種別だけを表示し、値は表示しません）。"
							: "回答の下書きに認証情報の形をした文字列が見つかったため、回答を作り直しました（種別だけを表示し、値は表示しません）。"}
					</p>
					<ul className="flex flex-wrap gap-1">
						{kinds.map((kind) => (
							<li key={kind}>
								<Badge variant="outline">{CREDENTIAL_LABELS[kind]}</Badge>
							</li>
						))}
					</ul>
				</div>
			) : null}
		</section>
	);
}

function statusText(options: {
	generating: boolean;
	hasResult: boolean;
	hasMessage: boolean;
	hasError: boolean;
}): string {
	if (options.hasError) return "";
	if (options.generating) return "問い合わせを処理しています";
	if (options.hasResult) return "問い合わせの処理が完了しました";
	return options.hasMessage ? "生成を停止しました。表示は途中までです" : "";
}

/** The tasks of every plan revision the stream delivered in this run, by revision. */
type PlanHistory = Readonly<Record<number, readonly PlanTaskView[]>>;

/**
 * The help-desk screen (plan C14, Req 2.1 to 2.8): an inquiry form, the plan dashboard, the final
 * result and the ticket history. It sends the inquiry and shows what the server streamed; the
 * length limit is mirrored from the server only to stop a doomed request early.
 */
export function HelpdeskPanel({
	models,
	defaultModelId,
	initial,
	inquiryMaxLength,
	examples,
}: HelpdeskPanelProps) {
	const [modelId, setModelId] = useState(defaultModelId);
	const [input, setInput] = useState("");
	const [sent, setSent] = useState<string | undefined>();
	const [tickets, setTickets] = useState<readonly TicketSummary[] | undefined>(
		"tickets" in initial ? initial.tickets : undefined,
	);
	const [remainingById, setRemainingById] = useState<Readonly<Record<string, readonly string[]>>>(
		{},
	);
	const [planHistory, setPlanHistory] = useState<PlanHistory>({});
	const [transport] = useState(
		() =>
			new DefaultChatTransport<HelpdeskMessage>({
				api: "/api/helpdesk",
				prepareSendMessagesRequest: prepareHelpdeskRequest,
			}),
	);
	const { messages, sendMessage, stop, setMessages, status, error, clearError } =
		useChat<HelpdeskMessage>({
			transport,
			// Fires once per data part even when React batches several into one render, so no
			// revision is lost (a message part keeps only the newest plan).
			onData: (part) => {
				if (part.type !== "data-helpdesk-plan") return;
				const { revision, tasks } = part.data;
				setPlanHistory((current) => ({ ...current, [revision]: tasks }));
			},
		});

	const generating = status === "submitted" || status === "streaming";
	const view = selectHelpdeskView(messages);
	const hasMessage = messages.some((message) => message.role === "assistant");

	// A replan's diff is against the revision just before it; if that one never arrived, the
	// dashboard shows ids only rather than another revision's text.
	const previousTasks =
		view.plan?.diff === undefined ? undefined : planHistory[view.plan.revision - 1];

	const result = view.result;
	const resultKey =
		result === undefined ? "" : `${result.ticketId}:${(result.remaining ?? []).join(",")}`;
	// biome-ignore lint/correctness/useExhaustiveDependencies: resultKey stands for the result's content
	useEffect(() => {
		if (result?.remaining === undefined) return;
		const { ticketId, remaining } = result;
		setRemainingById((current) => ({ ...current, [ticketId]: remaining }));
	}, [resultKey]);

	// Reload the history once a run ends; a failed reload keeps the list that is shown.
	const wasGenerating = useRef(false);
	useEffect(() => {
		const runEnded = wasGenerating.current && !generating;
		wasGenerating.current = generating;
		if (!runEnded) return;
		void (async () => {
			try {
				const response = await fetch("/api/helpdesk/tickets");
				if (!response.ok) return;
				const body = (await response.json()) as { tickets: TicketSummary[] };
				setTickets(body.tickets);
			} catch {
				// Keep the list that is shown.
			}
		})();
	}, [generating]);

	const length = [...input].length;
	const tooLong = length > inquiryMaxLength;
	const canSend = !generating && !tooLong && input.trim() !== "";

	function send(inquiry: string) {
		setSent(inquiry);
		// Each inquiry starts from an empty screen.
		setMessages([]);
		setPlanHistory({});
		void sendMessage({ text: inquiry }, { body: { modelId } });
	}

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!canSend) return;
		send(input.trim());
	}

	const shownTickets = tickets?.map((ticket) => {
		const remaining = remainingById[ticket.id];
		return remaining === undefined ? ticket : { ...ticket, remaining };
	});

	return (
		<div className="flex flex-col gap-6">
			<div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
				<ModelSelector
					models={models}
					value={modelId}
					onValueChange={setModelId}
					disabled={generating}
				/>
				<form onSubmit={handleSubmit} className="flex flex-col gap-3">
					<label htmlFor="helpdesk-inquiry" className="text-sm font-medium">
						問い合わせ
					</label>
					<Textarea
						id="helpdesk-inquiry"
						value={input}
						onChange={(event) => setInput(event.target.value)}
						aria-invalid={tooLong}
						placeholder="例: 自宅から VPN に接続できません"
					/>
					{tooLong ? (
						<p role="alert" className="text-sm text-destructive">
							{`問い合わせは ${inquiryMaxLength} 文字までです（現在 ${length} 文字）。`}
						</p>
					) : (
						<p className="text-xs text-muted-foreground">{`${length} / ${inquiryMaxLength} 文字`}</p>
					)}
					<div className="flex flex-wrap items-center gap-2">
						<Button type="submit" disabled={!canSend}>
							問い合わせる
						</Button>
						{generating ? (
							<Button type="button" variant="outline" onClick={() => void stop()}>
								停止
							</Button>
						) : null}
					</div>
					{examples.length > 0 ? (
						<div className="flex flex-col gap-1.5">
							<span className="text-xs font-medium text-muted-foreground">入力例</span>
							<div className="flex flex-wrap gap-2">
								{examples.map((example) => (
									<Button
										key={example.label}
										type="button"
										variant="outline"
										size="sm"
										disabled={generating}
										onClick={() => setInput(example.inquiry)}
									>
										{example.label}
									</Button>
								))}
							</div>
						</div>
					) : null}
				</form>
			</div>
			<p
				role="status"
				aria-label="実行の状態"
				aria-live="polite"
				className="text-sm text-muted-foreground"
			>
				{statusText({
					generating,
					hasResult: result !== undefined,
					hasMessage,
					hasError: error !== undefined,
				})}
			</p>
			{error ? (
				<ErrorBanner
					error={error}
					onRetry={() => {
						clearError();
						if (sent !== undefined) send(sent);
					}}
					onDismiss={clearError}
				/>
			) : null}
			{hasMessage || generating ? (
				<section aria-label="実行結果" aria-busy={generating} className="flex flex-col gap-4">
					<PlanDashboard
						{...(view.plan === undefined ? {} : { plan: view.plan })}
						{...(view.progress === undefined ? {} : { progress: view.progress })}
						{...(previousTasks === undefined ? {} : { previousTasks })}
					/>
					{result === undefined ? null : <ResultView result={result} />}
				</section>
			) : null}
			<section aria-labelledby="helpdesk-tickets-title" className="flex flex-col gap-3">
				<h2 id="helpdesk-tickets-title" className="text-lg font-semibold">
					チケット
				</h2>
				{shownTickets === undefined ? (
					<Alert variant="destructive">
						<AlertTitle>チケットを取得できません</AlertTitle>
						<AlertDescription>{"message" in initial ? initial.message : ""}</AlertDescription>
					</Alert>
				) : (
					<TicketList tickets={shownTickets} />
				)}
			</section>
		</div>
	);
}
