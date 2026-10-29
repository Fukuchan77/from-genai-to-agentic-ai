"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { type FormEvent, useState } from "react";
import { ErrorBanner, toDisplayError } from "@/components/chat/ErrorBanner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ProfileView, type ProfileViewData } from "./ProfileView";

/** The command that fills the catalog and the personas; the server's 503 message names it. */
export const SEED_COMMAND = "mise run seed:samples";

/** One `data-marketing-recommendation` product (Req 6.5). */
export interface RecommendationItemView {
	readonly productId: string;
	readonly name: string;
	readonly priceYen: number;
	readonly reason: string;
	readonly overBudget: boolean;
}

/** The `data-marketing-recommendation` part: the products and how many ids the catalog check removed. */
export interface RecommendationView {
	readonly items: readonly RecommendationItemView[];
	readonly dropped: number;
	readonly reason?: string;
}

/** The data parts `/api/marketing/recommend` streams (plan C13, "ストリームのパート"). */
type RecommendDataParts = {
	"marketing-profile": ProfileViewData;
	"marketing-recommendation": RecommendationView;
};

export type RecommendMessage = UIMessage<unknown, RecommendDataParts>;

const YEN = new Intl.NumberFormat("ja-JP");

/** Whether an error from `useChat` is the server's "catalog and personas are not seeded" 503. */
export function isUnseededError(error: Error): boolean {
	const { code, message } = toDisplayError(error);
	return code === "provider-unavailable" && message.includes("seed:samples");
}

/** What to run when the sample data is missing, with a button to try again afterwards. */
export function SeedGuidance({ onRetry }: { readonly onRetry: () => void }) {
	return (
		<Alert variant="destructive">
			<AlertTitle>サンプルデータが投入されていません</AlertTitle>
			<AlertDescription>
				<p>次のコマンドで商品カタログとペルソナを投入してから、もう一度実行してください。</p>
				<p>
					<code>{SEED_COMMAND}</code>
				</p>
				<div>
					<Button type="button" variant="outline" size="sm" onClick={onRetry}>
						再送信
					</Button>
				</div>
			</AlertDescription>
		</Alert>
	);
}

/**
 * The newest profile the stream delivered, over every assistant message. A turn that learned
 * nothing writes no profile part, so the earlier one stays (and is what the next request sends).
 */
export function selectProfile(messages: readonly UIMessage[]): ProfileViewData | undefined {
	let profile: ProfileViewData | undefined;
	for (const message of messages) {
		if (message.role !== "assistant") continue;
		for (const part of message.parts) {
			if (part.type === "data-marketing-profile")
				profile = (part as { data: ProfileViewData }).data;
		}
	}
	return profile;
}

/**
 * The request of one turn: the whole conversation (the route accepts the `data-*` parts of earlier
 * assistant messages and ignores them) and the profile the screen holds (Req 6.4).
 */
export function prepareRecommendRequest({
	id,
	messages,
	body,
	trigger,
	messageId,
}: {
	readonly id: string;
	readonly messages: readonly UIMessage[];
	readonly body: Record<string, unknown> | undefined;
	readonly trigger?: string;
	readonly messageId?: string | undefined;
}): { api: string; body: object } {
	const profile = body?.profile;
	return {
		api: "/api/marketing/recommend",
		body: {
			id,
			messages,
			...(profile === undefined ? {} : { profile }),
			...(trigger === undefined ? {} : { trigger }),
			...(messageId === undefined ? {} : { messageId }),
		},
	};
}

function RecommendationCards({ data }: { readonly data: RecommendationView }) {
	return (
		<div className="flex flex-col gap-2">
			{data.items.map((item) => (
				<article
					key={item.productId}
					aria-label={`${item.productId} ${item.name}`}
					className="flex flex-col gap-1 rounded-md border p-3"
				>
					<h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold">
						<code className="text-xs">{item.productId}</code>
						<span>{item.name}</span>
					</h3>
					<p className="flex flex-wrap items-center gap-2 text-sm">
						<span>{`${YEN.format(item.priceYen)} 円`}</span>
						{item.overBudget ? <Badge variant="secondary">予算を超えています</Badge> : null}
					</p>
					<p className="whitespace-pre-wrap text-sm text-muted-foreground">{item.reason}</p>
				</article>
			))}
			{data.dropped > 0 ? (
				<p className="text-xs text-muted-foreground">
					{`カタログにない商品 ID を ${data.dropped} 件除去しました`}
				</p>
			) : null}
		</div>
	);
}

function MessageView({ message }: { readonly message: RecommendMessage }) {
	return (
		<div
			className={
				message.role === "user"
					? "ml-auto max-w-[85%] rounded-md bg-muted p-3"
					: "flex max-w-[95%] flex-col gap-2"
			}
		>
			{message.parts.map((part, index) => {
				const key = `${message.id}-${index}`;
				if (part.type === "text") {
					return (
						<p key={key} className="whitespace-pre-wrap text-sm">
							{part.text}
						</p>
					);
				}
				if (part.type === "data-marketing-recommendation") {
					return <RecommendationCards key={key} data={part.data} />;
				}
				return null;
			})}
		</div>
	);
}

export interface RecommendPanelProps {
	/** The longest message, in characters (the server's limit, handed down by the page). */
	readonly messageMaxLength: number;
}

/**
 * The recommendation chat (plan C14, Req 6.4, 6.5): a conversation, the profile it builds up, and
 * the recommended products drawn from the `data-marketing-recommendation` part. Product names,
 * prices and the removal count come from the server; this panel only shows them.
 */
export function RecommendPanel({ messageMaxLength }: RecommendPanelProps) {
	const [input, setInput] = useState("");
	const [transport] = useState(
		() =>
			new DefaultChatTransport<RecommendMessage>({
				api: "/api/marketing/recommend",
				prepareSendMessagesRequest: prepareRecommendRequest,
			}),
	);
	const { messages, sendMessage, stop, status, error, clearError, regenerate } =
		useChat<RecommendMessage>({ transport });

	const generating = status === "submitted" || status === "streaming";
	const length = [...input].length;
	const tooLong = length > messageMaxLength;
	const canSend = !generating && !tooLong && input.trim() !== "";
	const profile = selectProfile(messages);

	const requestBody = profile === undefined ? {} : { profile };

	function send(text: string) {
		void sendMessage({ text }, { body: requestBody });
	}

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!canSend) return;
		send(input.trim());
		setInput("");
	}

	function retry() {
		clearError();
		// Resend the conversation as it stands: the failed user message is already in it.
		void regenerate({ body: requestBody });
	}

	return (
		<div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
			<div className="flex flex-col gap-4">
				<div
					role="log"
					aria-label="会話"
					aria-live="polite"
					className="flex min-h-24 flex-col gap-3"
				>
					{messages.map((message) => (
						<MessageView key={message.id} message={message} />
					))}
				</div>
				<p
					role="status"
					aria-label="実行の状態"
					aria-live="polite"
					className="text-sm text-muted-foreground"
				>
					{generating && error === undefined ? "おすすめを考えています" : ""}
				</p>
				{error === undefined ? null : isUnseededError(error) ? (
					<SeedGuidance onRetry={retry} />
				) : (
					<ErrorBanner error={error} onRetry={retry} onDismiss={clearError} />
				)}
				<form onSubmit={handleSubmit} className="flex flex-col gap-3">
					<label htmlFor="recommend-message" className="text-sm font-medium">
						メッセージ
					</label>
					<Textarea
						id="recommend-message"
						value={input}
						onChange={(event) => setInput(event.target.value)}
						aria-invalid={tooLong}
						placeholder="例: 初めてのキャンプで使う道具を探しています"
					/>
					{tooLong ? (
						<p role="alert" className="text-sm text-destructive">
							{`メッセージは ${messageMaxLength} 文字までです（現在 ${length} 文字）。`}
						</p>
					) : (
						<p className="text-xs text-muted-foreground">{`${length} / ${messageMaxLength} 文字`}</p>
					)}
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
			<ProfileView profile={profile} />
		</div>
	);
}
