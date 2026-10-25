"use client";

import { useChat } from "@ai-sdk/react";
import type { ModelOption } from "@platform/ai-core/models";
import { DefaultChatTransport, type UIMessage } from "ai";
import { type FormEvent, useState } from "react";
import { ErrorBanner } from "@/components/chat/ErrorBanner";
import { ModelSelector } from "@/components/chat/ModelSelector";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AgentInspector, type InspectorEvent, type ResearchEventData } from "./AgentInspector";
import { ReportView, type ResearchResultData } from "./ReportView";
import { type ResearchUsageData, UsageBreakdown } from "./UsageBreakdown";

/** The data parts `/api/research` streams (plan C13, "ストリームのパート"). */
type ResearchDataParts = {
	"research-event": ResearchEventData;
	"research-usage": ResearchUsageData;
	"research-result": ResearchResultData;
};

export type ResearchMessage = UIMessage<unknown, ResearchDataParts>;

/**
 * Example themes the learner can fill in. They are the themes the `m3-4` mock scenarios answer
 * (the second one has a failing sub-agent), so the screen works in `mock` mode without typing.
 */
export const EXAMPLE_THEMES: readonly string[] = [
	"階層型エージェントの最新動向",
	"リサーチエージェントの評価手法",
];

export interface ResearchView {
	readonly events: readonly InspectorEvent[];
	readonly usage: ResearchUsageData | undefined;
	readonly result: ResearchResultData | undefined;
}

/**
 * Folds the newest assistant message into what the screen shows (plan C14, Req 4.9). Event parts
 * are appended in arrival order under an incrementing id; usage and result are state parts, so the
 * latest of each wins.
 */
export function selectResearchView(messages: readonly ResearchMessage[]): ResearchView {
	const message = messages.findLast((candidate) => candidate.role === "assistant");
	const events: InspectorEvent[] = [];
	let usage: ResearchUsageData | undefined;
	let result: ResearchResultData | undefined;
	for (const part of message?.parts ?? []) {
		if (part.type === "data-research-event") {
			events.push({ ...part.data, id: `event-${events.length + 1}` });
		} else if (part.type === "data-research-usage") {
			usage = part.data;
		} else if (part.type === "data-research-result") {
			result = part.data;
		}
	}
	return { events, usage, result };
}

interface ResearchRequestOptions {
	readonly modelId: string;
	readonly maxSubagentCalls: number;
}

function textOf(message: UIMessage | undefined): string {
	return (message?.parts ?? []).map((part) => (part.type === "text" ? part.text : "")).join("");
}

/** The strict `/api/research` body: the theme (not a message list), the model and the call limit. */
export function prepareResearchRequest({
	messages,
	body,
}: {
	readonly messages: readonly UIMessage[];
	readonly body: Record<string, unknown> | undefined;
}): { api: string; body: object } {
	const options = body as unknown as ResearchRequestOptions;
	const newest = messages.findLast((message) => message.role === "user");
	return {
		api: "/api/research",
		body: {
			theme: textOf(newest),
			modelId: options.modelId,
			maxSubagentCalls: options.maxSubagentCalls,
		},
	};
}

export interface ResearchPanelProps {
	/** Chat models that call tools (the supervisor and the sub-agents need them). */
	readonly models: readonly ModelOption[];
	readonly defaultModelId: string;
	readonly themeMaxLength: number;
	readonly calls: { readonly min: number; readonly max: number; readonly default: number };
}

interface SentRun {
	readonly theme: string;
	readonly options: ResearchRequestOptions;
}

const INPUT_CLASS =
	"h-9 w-28 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60 aria-invalid:border-destructive";

function parseCalls(text: string, min: number, max: number): number | undefined {
	if (text.trim() === "") return undefined;
	const value = Number(text);
	if (!Number.isInteger(value) || value < min || value > max) return undefined;
	return value;
}

function statusText(options: {
	generating: boolean;
	hasResult: boolean;
	hasMessage: boolean;
	hasError: boolean;
}): string {
	const { generating, hasResult, hasMessage, hasError } = options;
	if (hasError) return "";
	if (generating) return "リサーチを実行しています";
	if (hasResult) return "リサーチが完了しました";
	return hasMessage ? "生成を停止しました。表示は途中までです" : "";
}

/**
 * The hierarchical research screen (plan C14, Req 4.2, 4.8, 4.9): a theme form with example
 * themes and the sub-agent call limit, and the Agent Inspector, the usage and the report. The
 * server checks the request and the citations; this panel only takes input and shows the parts.
 */
export function ResearchPanel({
	models,
	defaultModelId,
	themeMaxLength,
	calls,
}: ResearchPanelProps) {
	const [modelId, setModelId] = useState(defaultModelId);
	const [theme, setTheme] = useState("");
	const [callsText, setCallsText] = useState(String(calls.default));
	const [sent, setSent] = useState<SentRun | undefined>();
	const [transport] = useState(
		() =>
			new DefaultChatTransport<ResearchMessage>({
				api: "/api/research",
				prepareSendMessagesRequest: prepareResearchRequest,
			}),
	);
	const { messages, sendMessage, stop, setMessages, status, error, clearError } =
		useChat<ResearchMessage>({ transport });

	const generating = status === "submitted" || status === "streaming";
	const maxCalls = parseCalls(callsText, calls.min, calls.max);
	const callsInvalid = maxCalls === undefined;
	const themeLength = [...theme].length;
	const tooLong = themeLength > themeMaxLength;
	const effectiveModelId = models.some((model) => model.id === modelId) ? modelId : models[0]?.id;
	const canSend =
		!generating &&
		!callsInvalid &&
		!tooLong &&
		theme.trim() !== "" &&
		effectiveModelId !== undefined;

	const view = selectResearchView(messages);
	const hasMessage = messages.some((message) => message.role === "assistant");

	function send(run: SentRun) {
		setSent(run);
		// Each run starts from an empty screen; the earlier report is not kept.
		setMessages([]);
		void sendMessage(
			{ text: run.theme },
			{ body: run.options as unknown as Record<string, unknown> },
		);
	}

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!canSend || effectiveModelId === undefined || maxCalls === undefined) return;
		send({
			theme: theme.trim(),
			options: { modelId: effectiveModelId, maxSubagentCalls: maxCalls },
		});
	}

	return (
		<div className="flex flex-col gap-6">
			<form onSubmit={handleSubmit} className="flex flex-col gap-4">
				<ModelSelector
					models={models}
					value={effectiveModelId ?? ""}
					onValueChange={setModelId}
					disabled={generating}
				/>
				<div className="flex flex-col gap-2">
					<label htmlFor="research-theme" className="text-sm font-medium">
						テーマ
					</label>
					<Textarea
						id="research-theme"
						value={theme}
						onChange={(event) => setTheme(event.target.value)}
						disabled={generating}
						aria-invalid={tooLong}
						placeholder="例: 階層型エージェントの最新動向"
					/>
					{tooLong ? (
						<p role="alert" className="text-sm text-destructive">
							{`テーマは ${themeMaxLength} 文字までです（現在 ${themeLength} 文字）。`}
						</p>
					) : (
						<p className="text-xs text-muted-foreground">
							{`${themeLength} / ${themeMaxLength} 文字`}
						</p>
					)}
					<div className="flex flex-wrap items-center gap-2">
						<span className="text-xs text-muted-foreground">入力例:</span>
						{EXAMPLE_THEMES.map((example) => (
							<Button
								key={example}
								type="button"
								variant="outline"
								size="sm"
								disabled={generating}
								onClick={() => setTheme(example)}
							>
								{example}
							</Button>
						))}
					</div>
				</div>
				<div className="flex flex-col gap-1">
					<label htmlFor="research-max-calls" className="text-sm font-medium">
						サブエージェントの呼び出し回数の上限
					</label>
					<input
						id="research-max-calls"
						type="number"
						step={1}
						min={calls.min}
						max={calls.max}
						className={INPUT_CLASS}
						value={callsText}
						disabled={generating}
						aria-invalid={callsInvalid}
						aria-describedby={callsInvalid ? "research-max-calls-error" : undefined}
						onChange={(event) => setCallsText(event.target.value)}
					/>
					{callsInvalid ? (
						<p id="research-max-calls-error" role="alert" className="text-xs text-destructive">
							{`呼び出し回数の上限は ${calls.min}〜${calls.max} の整数で指定してください。`}
						</p>
					) : null}
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<Button type="submit" disabled={!canSend}>
						リサーチする
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
				{statusText({
					generating,
					hasResult: view.result !== undefined,
					hasMessage,
					hasError: error !== undefined,
				})}
			</p>
			{error ? (
				<ErrorBanner
					error={error}
					onRetry={() => {
						clearError();
						if (sent) send(sent);
					}}
					onDismiss={clearError}
				/>
			) : null}
			{hasMessage || generating ? (
				<section aria-label="リサーチ結果" aria-busy={generating} className="flex flex-col gap-6">
					<AgentInspector events={view.events} />
					<UsageBreakdown usage={view.usage} />
					<ReportView result={view.result} />
				</section>
			) : null}
		</div>
	);
}
