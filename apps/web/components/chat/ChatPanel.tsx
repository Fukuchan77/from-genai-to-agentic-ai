"use client";

import { useChat } from "@ai-sdk/react";
import type { ModelOption } from "@platform/ai-core/models";
import { DefaultChatTransport } from "ai";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ErrorBanner } from "./ErrorBanner";
import { ImageAttachButton, type ImageAttachment } from "./ImageAttachButton";
import { type ChatMessage, MessageList } from "./MessageList";
import { ModelSelector } from "./ModelSelector";
import { type PersonaOption, PersonaSelector } from "./PersonaSelector";

export interface ChatPanelProps {
	readonly models: readonly ModelOption[];
	readonly defaultModelId: string;
	readonly personas: readonly PersonaOption[];
	readonly defaultPersonaId: string;
}

/**
 * The chat screen (plan C15). `useChat` owns the conversation state, which is not persisted. The
 * model and persona travel in each request's body, so switching them applies to the next message.
 */
export function ChatPanel({ models, defaultModelId, personas, defaultPersonaId }: ChatPanelProps) {
	const [modelId, setModelId] = useState(defaultModelId);
	const [personaId, setPersonaId] = useState(defaultPersonaId);
	const [input, setInput] = useState("");
	const [attachment, setAttachment] = useState<ImageAttachment | undefined>();
	const [transport] = useState(() => new DefaultChatTransport({ api: "/api/chat" }));
	const { messages, sendMessage, status, stop, error, regenerate, clearError } =
		useChat<ChatMessage>({ transport });

	const generating = status === "submitted" || status === "streaming";
	const canSend = !generating && input.trim().length > 0;
	const imageSupported = models.find((model) => model.id === modelId)?.capabilities.imageInput;

	function handleModelChange(nextModelId: string) {
		setModelId(nextModelId);
		// An image cannot go to a model without image input (Req 3.9), so the attachment is dropped.
		if (!models.find((model) => model.id === nextModelId)?.capabilities.imageInput) {
			setAttachment(undefined);
		}
	}

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!canSend) return;
		const text = input.trim();
		const files = attachment ? [attachment] : undefined;
		setInput("");
		setAttachment(undefined);
		void sendMessage(files ? { text, files } : { text }, { body: { modelId, personaId } });
	}

	return (
		<div className="flex flex-col gap-6">
			<div className="grid gap-4 sm:grid-cols-2">
				<ModelSelector
					models={models}
					value={modelId}
					onValueChange={handleModelChange}
					disabled={generating}
				/>
				<PersonaSelector
					personas={personas}
					value={personaId}
					onValueChange={setPersonaId}
					disabled={generating}
				/>
			</div>
			<MessageList messages={messages} status={status} />
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
				<label htmlFor="chat-input" className="text-sm font-medium">
					メッセージ
				</label>
				<Textarea
					id="chat-input"
					value={input}
					onChange={(event) => setInput(event.target.value)}
					placeholder="質問や依頼を入力してください"
				/>
				<ImageAttachButton
					supported={imageSupported === true}
					attachment={attachment}
					onAttach={setAttachment}
					onClear={() => setAttachment(undefined)}
					disabled={generating}
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
