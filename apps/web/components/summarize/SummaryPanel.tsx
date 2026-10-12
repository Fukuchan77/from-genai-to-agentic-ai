"use client";

import { useChat } from "@ai-sdk/react";
import type { ModelOption } from "@platform/ai-core/models";
import type { Summary, SummaryInput } from "@platform/ai-core/summarize";
import { type DeepPartial, DefaultChatTransport, type UIMessage } from "ai";
import { useState } from "react";
import { ErrorBanner } from "@/components/chat/ErrorBanner";
import { Button } from "@/components/ui/button";
import { SourceErrorView } from "./SourceErrorView";
import { SummaryCard } from "./SummaryCard";
import { SummaryForm } from "./SummaryForm";
import { SummaryMetaPanel, type SummaryMetaView } from "./SummaryMetaPanel";

/** The data parts `POST /api/summarize` streams (plan "HTTP API"). Names are without `data-`. */
export type SummaryDataParts = {
	summary: DeepPartial<Summary>;
	"summary-meta": SummaryMetaView;
	"summary-restart": { attempt: number; issues: string[] };
};

export type SummaryMessage = UIMessage<unknown, SummaryDataParts>;

export interface SummaryView {
	/** The provisional summary of the attempt in progress; undefined right after a restart. */
	readonly summary: DeepPartial<Summary> | undefined;
	readonly meta: SummaryMetaView | undefined;
	/** A regeneration has started (`data-summary-restart` was received). */
	readonly restarted: boolean;
}

/**
 * Reduces the newest assistant message to what the screen shows. Each attempt writes under its own
 * part id (`summary-<attempt>`); a `data-summary-restart` makes the later attempt the active one,
 * so whatever the discarded attempt streamed is never shown (Req 4.4, 4.5).
 */
export function selectSummaryView(messages: readonly SummaryMessage[]): SummaryView {
	const message = messages.findLast((candidate) => candidate.role === "assistant");
	let attempt = 1;
	let meta: SummaryMetaView | undefined;
	for (const part of message?.parts ?? []) {
		if (part.type === "data-summary-restart") attempt = Math.max(attempt, part.data.attempt);
		if (part.type === "data-summary-meta") meta = part.data;
	}
	let summary: DeepPartial<Summary> | undefined;
	for (const part of message?.parts ?? []) {
		if (part.type === "data-summary" && part.id === `summary-${attempt}`) summary = part.data;
	}
	return { summary, meta, restarted: attempt > 1 };
}

interface SourceErrorDetails {
	readonly reason?: string;
	readonly status?: number;
	readonly message: string;
}

/** The 422 `source-unavailable` body, if `error` is one (the reason is allowlisted server-side). */
function readSourceError(error: Error): SourceErrorDetails | undefined {
	try {
		const body: unknown = JSON.parse(error.message);
		const fields = (body as { error?: Record<string, unknown> } | null)?.error;
		if (fields?.code !== "source-unavailable" || typeof fields.message !== "string") {
			return undefined;
		}
		const details = (fields.details ?? {}) as Record<string, unknown>;
		return {
			message: fields.message,
			...(typeof details.reason === "string" ? { reason: details.reason } : {}),
			...(typeof details.status === "number" ? { status: details.status } : {}),
		};
	} catch {
		return undefined;
	}
}

interface SummaryRequestBody {
	readonly input: SummaryInput;
	readonly modelId: string;
}

export interface SummaryPanelProps {
	readonly models: readonly ModelOption[];
	readonly defaultModelId: string;
}

function statusText(options: {
	generating: boolean;
	view: SummaryView;
	hasError: boolean;
}): string {
	const { generating, view, hasError } = options;
	if (hasError) return "";
	if (generating) {
		return view.restarted && view.summary === undefined
			? "出力が検証に通らなかったため、もう一度生成しています"
			: "要約を生成しています";
	}
	if (view.meta) return "要約が完了しました";
	return view.summary ? "生成を停止しました。表示は途中までの暫定です" : "";
}

/**
 * The summarize screen (plan C17). `useChat` receives the data parts; the request body is the
 * strict `{ id, input, modelId }` of `summarizeRequestSchema`, not a message list.
 */
export function SummaryPanel({ models, defaultModelId }: SummaryPanelProps) {
	const [modelId, setModelId] = useState(defaultModelId);
	const [lastRequest, setLastRequest] = useState<SummaryRequestBody | undefined>();
	const [transport] = useState(
		() =>
			new DefaultChatTransport<SummaryMessage>({
				api: "/api/summarize",
				prepareSendMessagesRequest: ({ id, body }) => ({ body: { id, ...body } }),
			}),
	);
	const { messages, sendMessage, regenerate, stop, setMessages, status, error, clearError } =
		useChat<SummaryMessage>({ transport });

	const generating = status === "submitted" || status === "streaming";
	const view = selectSummaryView(messages);
	const sourceError = error ? readSourceError(error) : undefined;
	const showCard = !error && (generating || view.summary !== undefined);

	function handleSubmit(input: SummaryInput) {
		const body = { input, modelId };
		setLastRequest(body);
		// Each run starts from an empty screen; the earlier summary is not kept.
		setMessages([]);
		void sendMessage({ text: "要約をリクエストしました" }, { body });
	}

	return (
		<div className="flex flex-col gap-6">
			<SummaryForm
				models={models}
				modelId={modelId}
				onModelChange={setModelId}
				onSubmit={handleSubmit}
				disabled={generating}
			/>
			<div className="flex flex-wrap items-center gap-3">
				<p role="status" aria-live="polite" className="text-sm text-muted-foreground">
					{statusText({ generating, view, hasError: error !== undefined })}
				</p>
				{generating ? (
					<Button type="button" variant="outline" onClick={() => void stop()}>
						停止
					</Button>
				) : null}
			</div>
			{error ? (
				sourceError ? (
					<SourceErrorView
						reason={sourceError.reason}
						status={sourceError.status}
						message={sourceError.message}
					/>
				) : (
					<ErrorBanner
						error={error}
						onRetry={() => {
							clearError();
							if (lastRequest) void regenerate({ body: lastRequest });
						}}
						onDismiss={clearError}
					/>
				)
			) : null}
			{showCard ? <SummaryCard summary={view.summary} generating={generating} /> : null}
			{!error && view.meta ? <SummaryMetaPanel meta={view.meta} /> : null}
		</div>
	);
}
