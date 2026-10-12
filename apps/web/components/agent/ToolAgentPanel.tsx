"use client";

import { useChat } from "@ai-sdk/react";
import type { ModelOption } from "@platform/ai-core/models";
import { DefaultChatTransport } from "ai";
import { type FormEvent, useState } from "react";
import { ErrorBanner } from "@/components/chat/ErrorBanner";
import type { ChatMessage } from "@/components/chat/MessageList";
import { ModelSelector } from "@/components/chat/ModelSelector";
import { type PersonaOption, PersonaSelector } from "@/components/chat/PersonaSelector";
import { ReasoningDisclosure } from "@/components/chat/ReasoningDisclosure";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/components/ui/utils";
import { DisabledToolsNotice } from "./DisabledToolsNotice";
import { RunSummaryBadge } from "./RunSummaryBadge";
import { isToolPart, type ToolPartLike, ToolPartView } from "./ToolPartView";

export interface ToolAgentPanelProps {
	/** Models that support tool calling. */
	readonly models: readonly ModelOption[];
	readonly defaultModelId: string;
	readonly personas: readonly PersonaOption[];
	readonly defaultPersonaId: string;
}

const AUTHOR_LABELS = { user: "あなた", assistant: "エージェント", system: "システム" } as const;

type Part = ChatMessage["parts"][number];

function PartView({ part }: { readonly part: Part }) {
	if (part.type === "text") {
		return <p className="whitespace-pre-wrap break-words">{part.text}</p>;
	}
	if (part.type === "reasoning") {
		return part.text.length > 0 ? <ReasoningDisclosure text={part.text} /> : null;
	}
	if (isToolPart(part)) return <ToolPartView part={part as unknown as ToolPartLike} />;
	// step-start, sources, files and data parts are not part of the tool agent screen.
	return null;
}

/**
 * The tool agent screen (plan C16). Parts are drawn in stream order, so a tool call appears
 * between the text before and after it. The disabled-tools notice and the run summary come from
 * the server's message metadata only.
 */
export function ToolAgentPanel({
	models,
	defaultModelId,
	personas,
	defaultPersonaId,
}: ToolAgentPanelProps) {
	const [modelId, setModelId] = useState(defaultModelId);
	const [personaId, setPersonaId] = useState(defaultPersonaId);
	const [input, setInput] = useState("");
	const [transport] = useState(() => new DefaultChatTransport({ api: "/api/agent/tools" }));
	const { messages, sendMessage, status, stop, error, regenerate, clearError } =
		useChat<ChatMessage>({ transport });

	const generating = status === "submitted" || status === "streaming";
	const canSend = !generating && input.trim().length > 0;
	const lastAssistant = messages.findLast((message) => message.role === "assistant");
	const disabledTools = lastAssistant?.metadata?.disabledTools ?? [];

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!canSend) return;
		const text = input.trim();
		setInput("");
		void sendMessage({ text }, { body: { modelId, personaId } });
	}

	return (
		<div className="flex flex-col gap-6">
			<div className="grid gap-4 sm:grid-cols-2">
				<ModelSelector
					models={models}
					value={modelId}
					onValueChange={setModelId}
					disabled={generating}
				/>
				<PersonaSelector
					personas={personas}
					value={personaId}
					onValueChange={setPersonaId}
					disabled={generating}
				/>
			</div>
			<DisabledToolsNotice tools={disabledTools} />
			<div role="log" aria-label="会話" aria-live="polite" className="flex flex-col gap-4">
				{messages.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						メッセージを送信すると、エージェントがツールを呼び出して答えます。
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
										<RunSummaryBadge
											run={message.metadata?.run}
											outcome={error && index === messages.length - 1 ? "error" : "interrupted"}
										/>
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
						void regenerate({ body: { modelId, personaId } });
					}}
					onDismiss={clearError}
				/>
			) : null}
			<form onSubmit={handleSubmit} className="flex flex-col gap-3">
				<label htmlFor="agent-input" className="text-sm font-medium">
					メッセージ
				</label>
				<Textarea
					id="agent-input"
					value={input}
					onChange={(event) => setInput(event.target.value)}
					placeholder="例: 東京の天気と、100 ドルが何円か教えて"
				/>
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
		</div>
	);
}
