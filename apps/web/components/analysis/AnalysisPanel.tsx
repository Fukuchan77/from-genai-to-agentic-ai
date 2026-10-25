"use client";

import { useChat } from "@ai-sdk/react";
import type { AnalysisAttempt, AnalysisStatus, Figure, Table } from "@platform/ai-core/analysis";
import type { ModelOption } from "@platform/ai-core/models";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useEffect, useRef, useState } from "react";
import { ErrorBanner } from "@/components/chat/ErrorBanner";
import { ModelSelector } from "@/components/chat/ModelSelector";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AttemptList } from "./AttemptList";
import { FigureView } from "./FigureView";
import { type AnalysisStatusResponse, SandboxNotice, type SandboxStatus } from "./SandboxNotice";
import { TableView } from "./TableView";
import { UploadForm, type UploadSubmission } from "./UploadForm";

/** The summary `/api/analysis` streams last (`data-analysis-result`). */
interface AnalysisResultData {
	readonly status: AnalysisStatus;
	readonly attempts: number;
	readonly fixes: number;
	readonly text: string;
}

/** The data parts `/api/analysis` streams (plan C13, "ストリームのパート"). */
type AnalysisDataParts = {
	"analysis-attempt": AnalysisAttempt;
	"analysis-figure": Figure;
	"analysis-table": Table;
	"analysis-notice": { reasons: string[] };
	"analysis-result": AnalysisResultData;
};

export type AnalysisMessage = UIMessage<unknown, AnalysisDataParts>;

export interface AnalysisView {
	readonly attempts: readonly AnalysisAttempt[];
	readonly figures: readonly Figure[];
	readonly tables: readonly Table[];
	readonly notices: readonly string[];
	readonly result: AnalysisResultData | undefined;
}

/**
 * Folds the newest assistant message into what the screen shows (plan C14). Every data part has
 * its own id, so the AI SDK keeps one part per id and the order of the parts is the order of the run.
 */
export function selectAnalysisView(messages: readonly AnalysisMessage[]): AnalysisView {
	const message = messages.findLast((candidate) => candidate.role === "assistant");
	const attempts: AnalysisAttempt[] = [];
	const figures: Figure[] = [];
	const tables: Table[] = [];
	const notices: string[] = [];
	let result: AnalysisResultData | undefined;
	for (const part of message?.parts ?? []) {
		if (part.type === "data-analysis-attempt") attempts.push(part.data);
		else if (part.type === "data-analysis-figure") figures.push(part.data);
		else if (part.type === "data-analysis-table") tables.push(part.data);
		else if (part.type === "data-analysis-notice") notices.push(...part.data.reasons);
		else if (part.type === "data-analysis-result") result = part.data;
	}
	return { attempts, figures, tables, notices, result };
}

export interface AnalysisPanelProps {
	/** The body of `GET /api/analysis/status`, loaded on the server. */
	readonly status: AnalysisStatusResponse;
	/** Chat models that call tools; the analysis agent needs them. */
	readonly models: readonly ModelOption[];
	readonly defaultModelId: string;
	/** What the figure and table views draw at most (`DEFAULT_ANALYSIS`), read on the server. */
	readonly limits: { readonly maxFigureBytes: number; readonly maxTableRows: number };
}

/** What the transport sends: the upload kept in memory until the request is made. */
interface PendingUpload {
	readonly file: File;
	readonly instruction: string;
	readonly modelId: string;
	readonly sessionId: string;
}

const RESULT_NOTES: Readonly<Partial<Record<AnalysisStatus, string>>> = {
	incomplete: "コードが最後まで成功しませんでした。",
	"sandbox-unavailable": "サンドボックスが使えなくなりました。しばらくしてからやり直してください。",
	unreadable: "ファイルを開けませんでした。ファイルの中身を確認してください。",
	stopped: "上限に達したため、実行を止めました。",
};

/**
 * The disabled sandbox a `provider-unavailable` rejection (503) describes: the route puts the
 * setup `guidance` into `details`. Anything else (no guidance, another code) is not it.
 */
function disabledFromError(error: Error | undefined): SandboxStatus | undefined {
	if (!error) return undefined;
	try {
		const body: unknown = JSON.parse(error.message);
		if (typeof body !== "object" || body === null || !("error" in body)) return undefined;
		const { code, message, details } = body.error as Record<string, unknown>;
		if (code !== "provider-unavailable" || typeof message !== "string") return undefined;
		const guidance = (details as { guidance?: unknown } | undefined)?.guidance;
		if (typeof guidance !== "string" || guidance === "") return undefined;
		return { kind: "disabled", reason: message, guidance };
	} catch {
		return undefined;
	}
}

function newSessionId(): string {
	return crypto.randomUUID();
}

/**
 * The data analysis screen (plan C14, Req 3.5-3.8): pick a file and an instruction, watch the
 * generated code run in the sandbox (attempts, figures, tables, the explanation), and end the
 * session explicitly. The request is multipart, which `useChat`'s JSON body cannot carry, so the
 * transport keeps its message handling and only the `fetch` is replaced to send a `FormData`.
 * The server decides everything; this panel shows what it streams.
 */
export function AnalysisPanel({
	status: setup,
	models,
	defaultModelId,
	limits,
}: AnalysisPanelProps) {
	// What the server reported at page load, replaced when a run shows the sandbox is gone.
	const [runtimeSandbox, setRuntimeSandbox] = useState<SandboxStatus | undefined>(undefined);
	const sandbox = runtimeSandbox ?? setup.sandbox;
	const disabled = sandbox.kind === "disabled";
	const [modelId, setModelId] = useState(defaultModelId);
	const [sessionId, setSessionId] = useState(newSessionId);
	const [sessionNote, setSessionNote] = useState("");
	const [endError, setEndError] = useState(false);
	const pending = useRef<PendingUpload | undefined>(undefined);
	const [transport] = useState(
		() =>
			new DefaultChatTransport<AnalysisMessage>({
				api: "/api/analysis",
				fetch: (input, init) => {
					const upload = pending.current;
					if (!upload) return Promise.reject(new Error("no upload to send"));
					const form = new FormData();
					form.set("file", upload.file);
					form.set("instruction", upload.instruction);
					form.set("sessionId", upload.sessionId);
					form.set("modelId", upload.modelId);
					// The browser sets the multipart content type, with its boundary.
					const headers = new Headers(init?.headers);
					headers.delete("content-type");
					return globalThis.fetch(input, { ...init, headers, body: form });
				},
			}),
	);
	const { messages, sendMessage, stop, setMessages, status, error, clearError } =
		useChat<AnalysisMessage>({ transport });

	const generating = status === "submitted" || status === "streaming";
	const view = selectAnalysisView(messages);
	const hasMessage = messages.some((message) => message.role === "assistant");
	const effectiveModelId = models.some((model) => model.id === modelId)
		? modelId
		: (models[0]?.id ?? "");

	const sandboxLost = view.result?.status === "sandbox-unavailable";
	useEffect(() => {
		const lost = disabledFromError(error);
		if (lost) setRuntimeSandbox(lost);
	}, [error]);
	useEffect(() => {
		// The server forgot its sandbox choice, so the status route looks again (Req 3.8).
		if (!sandboxLost) return;
		const controller = new AbortController();
		void (async () => {
			try {
				const response = await fetch("/api/analysis/status", { signal: controller.signal });
				if (!response.ok) return;
				const body = (await response.json()) as AnalysisStatusResponse;
				if (body.sandbox.kind === "disabled") setRuntimeSandbox(body.sandbox);
			} catch {
				// The note under the result still asks the learner to try again later.
			}
		})();
		return () => controller.abort();
	}, [sandboxLost]);

	function send(upload: PendingUpload) {
		pending.current = upload;
		setSessionNote("");
		setEndError(false);
		// Each analysis starts from an empty screen; the earlier one is not kept.
		setMessages([]);
		void sendMessage({ text: upload.instruction });
	}

	function handleSubmit({ file, instruction }: UploadSubmission) {
		send({ file, instruction, modelId: effectiveModelId, sessionId });
	}

	async function endSession() {
		if (generating) await stop();
		setEndError(false);
		try {
			const response = await fetch(`/api/analysis/sessions/${sessionId}`, { method: "DELETE" });
			if (!response.ok) throw new Error("end failed");
		} catch {
			setEndError(true);
			return;
		}
		pending.current = undefined;
		setMessages([]);
		clearError();
		setSessionId(newSessionId());
		setSessionNote("セッションを終了しました。サンドボックスを閉じました。");
	}

	const statusMessage = error
		? ""
		: generating
			? "分析しています"
			: view.result
				? "分析が完了しました"
				: hasMessage
					? "生成を停止しました。表示は途中までです"
					: "";

	return (
		<div className="flex flex-col gap-6">
			<SandboxNotice sandbox={sandbox} />
			{models.length === 0 ? (
				<Alert>
					<AlertTitle>利用できるモデルがありません</AlertTitle>
					<AlertDescription>
						ツール呼び出しに対応したモデルの認証情報（API キー）または Ollama
						の設定を確認してください。
					</AlertDescription>
				</Alert>
			) : null}
			<div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
				<div className="flex flex-col gap-4">
					<ModelSelector
						models={models}
						value={effectiveModelId}
						onValueChange={setModelId}
						disabled={disabled || generating}
					/>
					<div className="flex flex-wrap items-center gap-2">
						{generating ? (
							<Button type="button" variant="outline" onClick={() => void stop()}>
								停止
							</Button>
						) : null}
						{disabled ? null : (
							<Button type="button" variant="outline" onClick={() => void endSession()}>
								セッションを終了
							</Button>
						)}
					</div>
				</div>
				<UploadForm
					upload={setup.upload}
					onSubmit={handleSubmit}
					disabled={disabled || models.length === 0}
					pending={generating}
				/>
			</div>
			<p
				role="status"
				aria-label="セッションの状態"
				aria-live="polite"
				className="text-sm text-muted-foreground"
			>
				{sessionNote}
			</p>
			{endError ? (
				<Alert variant="destructive">
					<AlertTitle>セッションを終了できませんでした</AlertTitle>
					<AlertDescription>
						サンドボックスを閉じられませんでした。しばらくしてからもう一度試してください。
					</AlertDescription>
				</Alert>
			) : null}
			<p
				role="status"
				aria-label="実行の状態"
				aria-live="polite"
				className="text-sm text-muted-foreground"
			>
				{statusMessage}
			</p>
			{error ? (
				<ErrorBanner
					error={error}
					onRetry={() => {
						clearError();
						if (pending.current) send(pending.current);
					}}
					onDismiss={clearError}
				/>
			) : null}
			<section
				aria-label="お知らせ"
				// The recreated-sandbox notice appears while the analysis runs.
				role="status"
				aria-live="polite"
				className="flex flex-col gap-2"
			>
				{view.notices.map((reason, index) => (
					// Reasons can repeat; the list is append-only, so index plus reason is stable.
					// biome-ignore lint/suspicious/noArrayIndexKey: append-only list
					<Alert key={`${index}:${reason}`}>
						<AlertDescription>{reason}</AlertDescription>
					</Alert>
				))}
			</section>
			{hasMessage || generating ? (
				<section aria-label="分析の結果" aria-busy={generating} className="flex flex-col gap-4">
					<AttemptList
						attempts={view.attempts}
						status={view.result?.status}
						fixes={view.result?.fixes}
					/>
					{view.figures.map((figure, index) => (
						// Figures have no id of their own; the stream only appends them.
						// biome-ignore lint/suspicious/noArrayIndexKey: append-only list
						<FigureView key={index} figure={figure} maxBytes={limits.maxFigureBytes} />
					))}
					{view.tables.map((table, index) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: append-only list
						<TableView key={index} table={table} maxRows={limits.maxTableRows} />
					))}
					{view.result ? (
						<div className="flex flex-col gap-2">
							{RESULT_NOTES[view.result.status] ? (
								<p className="text-sm text-muted-foreground">{RESULT_NOTES[view.result.status]}</p>
							) : null}
							{view.result.text === "" ? null : (
								<p className="whitespace-pre-wrap text-sm">{view.result.text}</p>
							)}
						</div>
					) : null}
				</section>
			) : null}
		</div>
	);
}
