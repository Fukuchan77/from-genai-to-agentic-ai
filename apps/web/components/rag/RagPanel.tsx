"use client";

import { useChat } from "@ai-sdk/react";
import type { AgentRunSummary } from "@platform/ai-core/agents";
import type { ModelOption } from "@platform/ai-core/models";
import type { AgenticRagSummary, RagResult, RagStage, RetrievalTrace } from "@platform/ai-core/rag";
import { DefaultChatTransport, type UIMessage } from "ai";
import { type FormEvent, useState } from "react";
import { RunSummaryBadge } from "@/components/agent/RunSummaryBadge";
import { isToolPart, type ToolPartLike, ToolPartView } from "@/components/agent/ToolPartView";
import { ErrorBanner } from "@/components/chat/ErrorBanner";
import { ModelSelector } from "@/components/chat/ModelSelector";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AnswerView } from "./AnswerView";
import { CitationList } from "./CitationList";
import { MethodSwitches, type RagSettings, type SettingsLimits } from "./MethodSwitches";
import { StageProgress, type StageState } from "./StageProgress";
import { TraceView } from "./TraceView";

/** The data parts `/api/rag/query` streams (plan C13, "ストリームのパート"). */
type RagDataParts = {
	"rag-stage": { stage: RagStage; status: "running" | "done" | "skipped"; detail?: string };
	"rag-trace": RetrievalTrace;
	"rag-result": RagResult;
};

/** The finish metadata of `/api/rag/agent`. */
interface RagMetadata {
	readonly run?: AgentRunSummary;
	readonly rag?: AgenticRagSummary;
}

export type RagMessage = UIMessage<RagMetadata, RagDataParts>;

type Mode = "query" | "agent";

/** What the panel hands to `sendMessage` as `body`; `prepareRagRequest` turns it into the wire body. */
interface RagRequestOptions {
	readonly mode: Mode;
	readonly modelId: string;
	/** The conversation schema of `/api/rag/agent` requires a persona; the route does not use it. */
	readonly personaId: string;
	readonly settings: {
		readonly topK: number;
		readonly minSimilarity: number;
		readonly methods: RagSettings["methods"];
	};
}

export interface RagView {
	readonly messageId: string | undefined;
	/** The settled answer once the server sent it, otherwise the text streamed so far. */
	readonly text: string;
	readonly stages: readonly StageState[];
	readonly trace: RetrievalTrace | undefined;
	readonly result: RagResult | undefined;
	/** The agent's finish metadata; absent for a pipeline answer or an unfinished run. */
	readonly agent:
		| { readonly rag: AgenticRagSummary | undefined; readonly run: AgentRunSummary | undefined }
		| undefined;
	readonly tools: readonly ToolPartLike[];
}

/**
 * Folds the newest assistant message into what the screen shows (plan C14). Stage parts share an
 * id per stage and the trace and result have one id each, so the newest of each wins; the text is
 * the last text part (the pipeline streams one, an agent writes one per step and the last is the
 * answer) until the server's settled answer replaces it.
 */
export function selectRagView(messages: readonly RagMessage[]): RagView {
	const message = messages.findLast((candidate) => candidate.role === "assistant");
	const stages = new Map<RagStage, StageState>();
	const tools: ToolPartLike[] = [];
	let trace: RetrievalTrace | undefined;
	let result: RagResult | undefined;
	let text = "";
	for (const part of message?.parts ?? []) {
		if (part.type === "text") {
			text = part.text;
		} else if (part.type === "data-rag-stage") {
			const { stage, status, detail } = part.data;
			stages.set(stage, { stage, status, ...(detail === undefined ? {} : { detail }) });
		} else if (part.type === "data-rag-trace") {
			trace = part.data;
		} else if (part.type === "data-rag-result") {
			result = part.data;
		} else if (isToolPart(part)) {
			tools.push(part as unknown as ToolPartLike);
		}
	}
	const rag = message?.metadata?.rag;
	const run = message?.metadata?.run;
	return {
		messageId: message?.id,
		text: result?.answer ?? rag?.answer ?? text,
		stages: [...stages.values()],
		trace,
		result,
		agent: rag === undefined && run === undefined ? undefined : { rag, run },
		tools,
	};
}

function textOf(message: UIMessage | undefined): string {
	return (message?.parts ?? []).map((part) => (part.type === "text" ? part.text : "")).join("");
}

/**
 * The request of one question. `/api/rag/query` takes the question and the settings, not a message
 * list; `/api/rag/agent` takes a conversation, and only the newest user message is sent because
 * each question is answered on its own.
 */
export function prepareRagRequest({
	id,
	messages,
	body,
}: {
	readonly id: string;
	readonly messages: readonly UIMessage[];
	readonly body: Record<string, unknown> | undefined;
}): { api: string; body: object } {
	const options = body as unknown as RagRequestOptions;
	const newest = messages.findLast((message) => message.role === "user");
	if (options.mode === "agent") {
		return {
			api: "/api/rag/agent",
			body: {
				id,
				messages: newest ? [newest] : [],
				modelId: options.modelId,
				personaId: options.personaId,
			},
		};
	}
	return {
		api: "/api/rag/query",
		body: { id, question: textOf(newest), modelId: options.modelId, settings: options.settings },
	};
}

export interface RagPanelProps {
	/** Chat models; with Agentic RAG on, only the ones that call tools are offered. */
	readonly models: readonly ModelOption[];
	readonly defaultModelId: string;
	readonly rerank: { readonly available: boolean; readonly reason?: "api-key-missing" };
	readonly limits: SettingsLimits;
	readonly defaults: { readonly topK: number; readonly minSimilarity: number };
	readonly questionMaxLength: number;
	readonly agentPersonaId: string;
}

interface SentRun {
	readonly mode: Mode;
	readonly settings: RagSettings;
	readonly question: string;
	readonly options: RagRequestOptions;
}

function statusText(options: {
	generating: boolean;
	mode: Mode;
	hasResult: boolean;
	hasMessage: boolean;
	hasError: boolean;
}): string {
	const { generating, mode, hasResult, hasMessage, hasError } = options;
	if (hasError) return "";
	if (generating) return mode === "agent" ? "エージェントが実行しています" : "回答を生成しています";
	if (hasResult) return "回答が完了しました";
	return hasMessage ? "生成を停止しました。表示は途中までです" : "";
}

/**
 * The RAG question screen (plan C14, Req 1.5, 1.10, 2.7, 2.8, 2.11): a question form, the method
 * switches, and the answer with its stages, citations and intermediate results. The server settles
 * citations (`data-rag-result`, `messageMetadata.rag`); this panel only shows them.
 */
export function RagPanel({
	models,
	defaultModelId,
	rerank,
	limits,
	defaults,
	questionMaxLength,
	agentPersonaId,
}: RagPanelProps) {
	const [modelId, setModelId] = useState(defaultModelId);
	const [settings, setSettings] = useState<RagSettings>({
		...defaults,
		methods: { hyde: false, multiQuery: false, hybrid: false, rerank: false },
		agentic: false,
	});
	const [settingsValid, setSettingsValid] = useState(true);
	const [input, setInput] = useState("");
	const [sent, setSent] = useState<SentRun | undefined>();
	const [transport] = useState(
		() =>
			new DefaultChatTransport<RagMessage>({
				api: "/api/rag/query",
				prepareSendMessagesRequest: prepareRagRequest,
			}),
	);
	const { messages, sendMessage, stop, setMessages, status, error, clearError } =
		useChat<RagMessage>({ transport });

	const generating = status === "submitted" || status === "streaming";
	const selectableModels = settings.agentic
		? models.filter((model) => model.capabilities.tools)
		: models;
	const effectiveModelId = selectableModels.some((model) => model.id === modelId)
		? modelId
		: selectableModels[0]?.id;
	const questionLength = [...input].length;
	const tooLong = questionLength > questionMaxLength;
	const canSend =
		!generating &&
		// The numeric fields are turned off (and ignored) while the agent decides how to search.
		(settingsValid || settings.agentic) &&
		!tooLong &&
		input.trim() !== "" &&
		effectiveModelId !== undefined;

	// The screen follows the run that was sent, not the switches as they are now.
	const mode: Mode = sent?.mode ?? (settings.agentic ? "agent" : "query");
	const runSettings = sent?.settings ?? settings;
	const view = selectRagView(messages);
	const hasMessage = messages.some((message) => message.role === "assistant");

	function send(question: string, options: RagRequestOptions, run: SentRun) {
		setSent(run);
		// Each question starts from an empty screen; the earlier answer is not kept.
		setMessages([]);
		void sendMessage({ text: question }, { body: options as unknown as Record<string, unknown> });
	}

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!canSend || effectiveModelId === undefined) return;
		const question = input.trim();
		const options: RagRequestOptions = {
			mode: settings.agentic ? "agent" : "query",
			modelId: effectiveModelId,
			personaId: agentPersonaId,
			settings: {
				topK: settings.topK,
				minSimilarity: settings.minSimilarity,
				methods: settings.methods,
			},
		};
		send(question, options, { mode: options.mode, settings, question, options });
	}

	function handleSettingsChange(next: RagSettings) {
		if (next.agentic !== settings.agentic) {
			// A pipeline answer and an agent run are different shapes: never show one as the other.
			setMessages([]);
			setSent(undefined);
		}
		setSettings(next);
	}

	return (
		<div className="flex flex-col gap-6">
			<div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
				<div className="flex flex-col gap-4">
					<ModelSelector
						models={selectableModels}
						value={effectiveModelId ?? ""}
						onValueChange={setModelId}
						disabled={generating}
					/>
					<MethodSwitches
						value={settings}
						onChange={handleSettingsChange}
						onValidityChange={setSettingsValid}
						limits={limits}
						rerank={rerank}
						disabled={generating}
					/>
				</div>
				<form onSubmit={handleSubmit} className="flex flex-col gap-3">
					<label htmlFor="rag-question" className="text-sm font-medium">
						質問
					</label>
					<Textarea
						id="rag-question"
						value={input}
						onChange={(event) => setInput(event.target.value)}
						aria-invalid={tooLong}
						placeholder="例: エージェントの停止条件はなぜ必要ですか？"
					/>
					{tooLong ? (
						<p role="alert" className="text-sm text-destructive">
							{`質問は ${questionMaxLength} 文字までです（現在 ${questionLength} 文字）。`}
						</p>
					) : (
						<p className="text-xs text-muted-foreground">
							{`${questionLength} / ${questionMaxLength} 文字`}
						</p>
					)}
					{effectiveModelId === undefined ? (
						<p className="text-sm text-destructive">
							ツール呼び出しに対応したモデルがありません。Agentic RAG は使えません。
						</p>
					) : null}
					<div className="flex flex-wrap items-center gap-2">
						<Button type="submit" disabled={!canSend}>
							質問する
						</Button>
						{generating ? (
							<Button type="button" variant="outline" onClick={() => void stop()}>
								停止
							</Button>
						) : null}
					</div>
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
					mode,
					hasResult: view.result !== undefined || view.agent?.rag !== undefined,
					hasMessage,
					hasError: error !== undefined,
				})}
			</p>
			{error ? (
				<ErrorBanner
					error={error}
					onRetry={() => {
						clearError();
						if (sent) send(sent.question, sent.options, sent);
					}}
					onDismiss={clearError}
				/>
			) : null}
			{hasMessage || generating ? (
				<section aria-label="回答" aria-busy={generating} className="flex flex-col gap-4">
					{mode === "agent" ? (
						<AgentResult
							view={view}
							generating={generating}
							interrupted={error ? "error" : "interrupted"}
						/>
					) : (
						<PipelineResult view={view} methods={runSettings.methods} />
					)}
				</section>
			) : null}
		</div>
	);
}

function PipelineResult({
	view,
	methods,
}: {
	readonly view: RagView;
	readonly methods: RagSettings["methods"];
}) {
	const idPrefix = `rag-${view.messageId ?? "pending"}`;
	const { result } = view;
	return (
		<>
			<StageProgress stages={view.stages} methods={methods} />
			{view.text !== "" || result ? (
				<AnswerView
					text={view.text}
					citations={result?.citations}
					noEvidence={result?.noEvidence ?? false}
					idPrefix={idPrefix}
				/>
			) : null}
			{result ? (
				<CitationList
					citations={result.citations}
					removedCitations={result.removedCitations}
					idPrefix={idPrefix}
				/>
			) : null}
			<TraceView trace={view.trace} />
		</>
	);
}

function AgentResult({
	view,
	generating,
	interrupted,
}: {
	readonly view: RagView;
	readonly generating: boolean;
	readonly interrupted: "interrupted" | "error";
}) {
	const idPrefix = `rag-${view.messageId ?? "pending"}`;
	const rag = view.agent?.rag;
	return (
		<>
			{rag ? (
				<div className="flex flex-col gap-1">
					<Badge variant={rag.searched ? "default" : "secondary"} className="self-start">
						{rag.searched ? `検索しました（${rag.searchCount} 回）` : "検索せずに回答しました"}
					</Badge>
					{rag.searched ? null : (
						<p className="text-sm text-muted-foreground">
							ナレッジベースを検索していません。この回答には、引用による裏付けがありません。
						</p>
					)}
				</div>
			) : null}
			{view.tools.length > 0 ? (
				<ul aria-label="検索の呼び出し" className="flex flex-col gap-2">
					{view.tools.map((tool, index) => (
						// The call id is the identity; the order only covers a part that has none yet.
						<li key={tool.toolCallId ?? index}>
							<ToolPartView part={tool} />
						</li>
					))}
				</ul>
			) : null}
			{view.text !== "" ? (
				<AnswerView text={view.text} citations={rag?.citations} idPrefix={idPrefix} />
			) : null}
			{rag?.searched ? (
				<CitationList
					citations={rag.citations}
					removedCitations={rag.removedCitations}
					idPrefix={idPrefix}
				/>
			) : null}
			{generating ? null : <RunSummaryBadge run={view.agent?.run} outcome={interrupted} />}
		</>
	);
}
