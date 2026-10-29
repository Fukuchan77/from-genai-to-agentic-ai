"use client";

import { useChat } from "@ai-sdk/react";
import type { AgentRunSummary } from "@platform/ai-core/agents";
import type { McpAllowList, McpServerStatus } from "@platform/ai-core/mcp";
import type { ModelOption } from "@platform/ai-core/models";
import { DefaultChatTransport, type UIMessage } from "ai";
import { type FormEvent, useState } from "react";
import { RunSummaryBadge } from "@/components/agent/RunSummaryBadge";
import { isToolPart, type ToolPartLike, ToolPartView } from "@/components/agent/ToolPartView";
import { ErrorBanner, toDisplayError } from "@/components/chat/ErrorBanner";
import { ModelSelector } from "@/components/chat/ModelSelector";
import { ReasoningDisclosure } from "@/components/chat/ReasoningDisclosure";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/components/ui/utils";
import { AllowListEditor } from "./AllowListEditor";
import { type CompareResult, CompareView } from "./CompareView";
import { ServerStatusList } from "./ServerStatusList";

/** The finish metadata `POST /api/mcp/chat` sends: the run summary and the servers' state at the end. */
interface McpMessageMetadata {
	readonly run?: AgentRunSummary;
	readonly mcp?: readonly McpServerStatus[];
}

type McpMessage = UIMessage<McpMessageMetadata>;
type Part = McpMessage["parts"][number];

export interface McpExample {
	readonly label: string;
	readonly text: string;
}

export interface McpPanelProps {
	/** Models that support tool calling. */
	readonly models: readonly ModelOption[];
	readonly defaultModelId: string;
	/** The servers as `GET /api/mcp/servers` reported them when the page was rendered. */
	readonly initialServers: readonly McpServerStatus[];
	/** The per-agent tool limit the server reports. */
	readonly maxTools: number;
	/** Whether the server turns the think tool on by default. */
	readonly thinkEnabled: boolean;
	/** Sentences the `mock` scenarios answer; choosing one only fills the message box. */
	readonly examples: readonly McpExample[];
}

const AUTHOR_LABELS = { user: "あなた", assistant: "エージェント", system: "システム" } as const;
const REFRESH_FAILED_MESSAGE = "サーバーの状態を取得できませんでした。";
const COMPARE_TASK = "list-and-read";

function PartView({ part }: { readonly part: Part }) {
	if (part.type === "text") {
		return <p className="whitespace-pre-wrap break-words">{part.text}</p>;
	}
	if (part.type === "reasoning") {
		return part.text.length > 0 ? <ReasoningDisclosure text={part.text} /> : null;
	}
	if (isToolPart(part)) return <ToolPartView part={part as unknown as ToolPartLike} />;
	return null;
}

/** Every loaded tool of every connected server, up to the room left under the tool limit. */
function defaultAllow(servers: readonly McpServerStatus[], room: number): McpAllowList {
	let left = Math.max(0, room);
	const allow: Record<string, string[]> = {};
	for (const server of servers) {
		if (server.state !== "connected") continue;
		const names = server.tools
			.filter((tool) => tool.registered)
			.map((tool) => tool.name)
			.slice(0, left);
		left -= names.length;
		allow[server.id] = names;
	}
	return allow;
}

/** The error text of a non-2xx response: the server's `{ error }` body, or a fixed message. */
async function failureOf(response: Response, fallback: string): Promise<Error> {
	try {
		const body: unknown = await response.json();
		if (typeof body === "object" && body !== null && "error" in body) {
			return new Error(JSON.stringify(body));
		}
	} catch {
		// Not JSON: fall through to the fixed message.
	}
	return new Error(JSON.stringify({ error: { code: "unexpected", message: fallback } }));
}

function FatalNotice({ run }: { readonly run: AgentRunSummary | undefined }) {
	if (run?.stopReason !== "error") return null;
	return (
		<Alert variant="destructive">
			<AlertTitle>実行がエラーで終了しました</AlertTitle>
			<AlertDescription>
				<p>{run.error?.message ?? "原因は報告されていません。"}</p>
				{run.error ? (
					<p className="text-xs">
						エラーコード: <code>{run.error.code}</code>
					</p>
				) : null}
			</AlertDescription>
		</Alert>
	);
}

/**
 * The MCP screen (plan C14, Req 1.3, 1.7, 1.10). A chat whose tools come from the MCP servers, the
 * servers' state, the allow-list, the think tool switch and the high-level / low-level comparison.
 * Which tools load, and whether a request is acceptable, is the server's decision: this sends what
 * the learner chose and shows what the server reports.
 */
export function McpPanel({
	models,
	defaultModelId,
	initialServers,
	maxTools,
	thinkEnabled,
	examples,
}: McpPanelProps) {
	const [modelId, setModelId] = useState(defaultModelId);
	const [fetched, setFetched] = useState<readonly McpServerStatus[]>(initialServers);
	const [think, setThink] = useState(thinkEnabled);
	const [allow, setAllow] = useState<McpAllowList>(() =>
		defaultAllow(initialServers, maxTools - (thinkEnabled ? 1 : 0)),
	);
	const [input, setInput] = useState("");
	const [refreshing, setRefreshing] = useState(false);
	// The id of the last answer when the last successful refresh began: a different (newer) answer's
	// finish state is newer still. A count would include an answer that is still streaming.
	const [refreshedAfter, setRefreshedAfter] = useState<{ readonly id: string | undefined }>();
	const [refreshError, setRefreshError] = useState<string | undefined>();
	const [comparing, setComparing] = useState(false);
	const [compareResult, setCompareResult] = useState<CompareResult | undefined>();
	const [compareError, setCompareError] = useState<Error | undefined>();
	const [transport] = useState(() => new DefaultChatTransport({ api: "/api/mcp/chat" }));
	const { messages, sendMessage, status, stop, error, regenerate, clearError } =
		useChat<McpMessage>({ transport });

	const generating = status === "submitted" || status === "streaming";
	const canSend = !generating && input.trim().length > 0;
	const lastAssistant = messages.findLast((message) => message.role === "assistant");
	// A run reads the servers' state when it ends, so the newest answer's state wins over the page's.
	const servers =
		refreshedAfter !== undefined && refreshedAfter.id === lastAssistant?.id
			? fetched
			: (lastAssistant?.metadata?.mcp ?? fetched);
	const chatBody = { modelId, allow, think };

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!canSend) return;
		const text = input.trim();
		setInput("");
		void sendMessage({ text }, { body: chatBody });
	}

	async function refresh() {
		const answeredBefore = lastAssistant?.id;
		setRefreshing(true);
		setRefreshError(undefined);
		try {
			const response = await fetch("/api/mcp/servers", { cache: "no-store" });
			if (!response.ok) {
				setRefreshError(toDisplayError(await failureOf(response, REFRESH_FAILED_MESSAGE)).message);
				return;
			}
			const body = (await response.json()) as { servers: readonly McpServerStatus[] };
			setFetched(body.servers);
			setRefreshedAfter({ id: answeredBefore });
			setAllow((current) => {
				const next = defaultAllow(body.servers, maxTools - (think ? 1 : 0));
				return Object.fromEntries(
					Object.entries(next).map(([id, names]) => [
						id,
						current[id] ? names.filter((name) => current[id]?.includes(name)) : names,
					]),
				);
			});
		} catch {
			setRefreshError(REFRESH_FAILED_MESSAGE);
		} finally {
			setRefreshing(false);
		}
	}

	async function runComparison() {
		setComparing(true);
		setCompareError(undefined);
		try {
			const response = await fetch("/api/mcp/compare", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ task: COMPARE_TASK, modelId }),
			});
			if (!response.ok) throw await failureOf(response, "比較を実行できませんでした。");
			setCompareResult((await response.json()) as CompareResult);
		} catch (cause) {
			// ErrorBanner reads only a server-made { error } body; anything else becomes a fixed message.
			setCompareError(cause instanceof Error ? cause : new Error("unknown"));
		} finally {
			setComparing(false);
		}
	}

	return (
		<div className="flex flex-col gap-8">
			<section aria-labelledby="mcp-servers-title" className="flex flex-col gap-3">
				<div className="flex flex-wrap items-center gap-3">
					<h2 id="mcp-servers-title" className="text-lg font-semibold">
						サーバーの状態
					</h2>
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={refreshing || generating}
						onClick={() => void refresh()}
					>
						状態を更新
					</Button>
				</div>
				{refreshError ? (
					<Alert variant="destructive">
						<AlertTitle>状態を更新できません</AlertTitle>
						<AlertDescription>{refreshError}</AlertDescription>
					</Alert>
				) : null}
				<ServerStatusList servers={servers} />
			</section>

			<section aria-labelledby="mcp-tools-title" className="flex flex-col gap-3">
				<h2 id="mcp-tools-title" className="text-lg font-semibold">
					使うツール
				</h2>
				<label className="flex items-center gap-2 text-sm">
					<input
						type="checkbox"
						className="size-4 shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2"
						checked={think}
						disabled={generating}
						onChange={(event) => setThink(event.target.checked)}
					/>
					思考ツールを使う（ツールの枠を 1 つ使います）
				</label>
				<AllowListEditor
					servers={servers}
					value={allow}
					onChange={setAllow}
					maxTools={maxTools}
					reservedTools={think ? 1 : 0}
					disabled={generating}
				/>
			</section>

			<section aria-labelledby="mcp-chat-title" className="flex flex-col gap-4">
				<h2 id="mcp-chat-title" className="text-lg font-semibold">
					チャット
				</h2>
				<div className="max-w-sm">
					<ModelSelector
						models={models}
						value={modelId}
						onValueChange={setModelId}
						disabled={generating}
					/>
				</div>
				<div role="log" aria-label="会話" aria-live="polite" className="flex flex-col gap-4">
					{messages.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							メッセージを送信すると、エージェントが MCP のツールを呼び出して答えます。
						</p>
					) : (
						<ol className="flex flex-col gap-4">
							{messages.map((message, index) => {
								const running = generating && index === messages.length - 1;
								return (
									<li
										key={message.id}
										className={cn(
											"flex flex-col gap-2 rounded-lg border border-border p-4",
											message.role === "user" ? "bg-card" : "bg-background",
										)}
									>
										<span className="text-xs font-semibold text-muted-foreground">
											{AUTHOR_LABELS[message.role]}
										</span>
										{message.parts.map((part, partIndex) => (
											// Parts have no id and never reorder, so the index is a stable key.
											// biome-ignore lint/suspicious/noArrayIndexKey: see above
											<PartView key={partIndex} part={part} />
										))}
										{message.role === "assistant" && !running ? (
											<>
												<RunSummaryBadge
													run={message.metadata?.run}
													outcome={error && index === messages.length - 1 ? "error" : "interrupted"}
												/>
												<FatalNotice run={message.metadata?.run} />
											</>
										) : null}
									</li>
								);
							})}
						</ol>
					)}
					{generating ? (
						<p role="status" className="text-sm text-muted-foreground">
							エージェントが実行しています
						</p>
					) : null}
				</div>
				{error ? (
					<ErrorBanner
						error={error}
						onRetry={() => {
							clearError();
							void regenerate({ body: chatBody });
						}}
						onDismiss={clearError}
					/>
				) : null}
				<form onSubmit={handleSubmit} className="flex flex-col gap-3">
					<label htmlFor="mcp-input" className="text-sm font-medium">
						メッセージ
					</label>
					<Textarea
						id="mcp-input"
						value={input}
						onChange={(event) => setInput(event.target.value)}
						placeholder="例: 許可ルートのファイルを一覧して、いちばん上のファイルの内容を教えてください。"
					/>
					{examples.length > 0 ? (
						<div className="flex flex-col gap-2">
							<p className="text-sm font-medium">入力例</p>
							<p className="text-xs text-muted-foreground">
								mock モードで決まった応答が返る文です。選ぶと入力欄に入ります。
							</p>
							<div className="flex flex-wrap gap-2">
								{examples.map((example) => (
									<Button
										key={example.label}
										type="button"
										variant="outline"
										size="sm"
										disabled={generating}
										onClick={() => setInput(example.text)}
									>
										{example.label}
									</Button>
								))}
							</div>
						</div>
					) : null}
					<div className="flex flex-wrap items-center gap-2">
						<Button type="submit" disabled={!canSend}>
							送信
						</Button>
						{generating ? (
							<Button type="button" variant="outline" onClick={() => void stop()}>
								停止
							</Button>
						) : null}
					</div>
				</form>
			</section>

			<section aria-labelledby="mcp-compare-title" className="flex flex-col gap-3">
				<h2 id="mcp-compare-title" className="text-lg font-semibold">
					高水準と低レベルの比較
				</h2>
				<CompareView
					result={compareResult}
					running={comparing}
					error={compareError}
					onRun={() => void runComparison()}
				/>
			</section>
		</div>
	);
}
