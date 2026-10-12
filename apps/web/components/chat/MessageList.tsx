import type { ResponseMetadata } from "@platform/ai-core/chat";
import type { ChatStatus, UIMessage } from "ai";
import { cn } from "@/components/ui/utils";
import { MessageMeta } from "./MessageMeta";
import { ReasoningDisclosure } from "./ReasoningDisclosure";

/** A chat message whose metadata is the server's `ResponseMetadata` (assistant messages only). */
export type ChatMessage = UIMessage<ResponseMetadata>;

type Part = ChatMessage["parts"][number];

const AUTHOR_LABELS = { user: "あなた", assistant: "アシスタント", system: "システム" } as const;

function isImage(mediaType: string): boolean {
	return mediaType === "image" || mediaType.startsWith("image/");
}

function PartView({ part }: { readonly part: Part }) {
	switch (part.type) {
		case "text":
			return <p className="whitespace-pre-wrap break-words">{part.text}</p>;
		case "reasoning":
			return part.text.length > 0 ? <ReasoningDisclosure text={part.text} /> : null;
		case "file":
			return isImage(part.mediaType) ? (
				// biome-ignore lint/performance/noImgElement: a data: URL chosen by the learner; next/image cannot optimise it
				<img
					src={part.url}
					alt={`添付画像: ${part.filename ?? "名称なし"}`}
					className="max-h-64 max-w-full rounded-md border border-border"
				/>
			) : null;
		default:
			// step-start, sources, data and tool parts are not part of the plain chat.
			return null;
	}
}

export function MessageList({
	messages,
	status,
}: {
	readonly messages: readonly ChatMessage[];
	readonly status: ChatStatus;
}) {
	const generating = status === "submitted" || status === "streaming";
	return (
		<div role="log" aria-label="会話" aria-live="polite" className="flex flex-col gap-4">
			{messages.length === 0 ? (
				<p className="text-sm text-muted-foreground">メッセージを送信すると会話が始まります。</p>
			) : (
				<ol className="flex flex-col gap-4">
					{messages.map((message) => (
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
							{message.parts.map((part, index) => (
								// Parts have no id and never reorder, so the index is a stable key.
								// biome-ignore lint/suspicious/noArrayIndexKey: see above
								<PartView key={index} part={part} />
							))}
							{message.role === "assistant" ? <MessageMeta metadata={message.metadata} /> : null}
						</li>
					))}
				</ol>
			)}
			{generating ? (
				<p role="status" className="text-sm text-muted-foreground">
					回答を生成しています
				</p>
			) : null}
		</div>
	);
}
