"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { parseStreamErrorText, type StreamError } from "@/lib/server/errors";

/**
 * The `{ code, message }` to show for an error from `useChat`. A request rejected before the
 * stream starts carries the JSON body `{ error: { code, message } }`; a failure inside the stream
 * carries the `toStreamErrorText` JSON. Anything else (network failure, a bug) becomes the fixed
 * unexpected error, so raw error text never reaches the screen.
 */
export function toDisplayError(error: Error): StreamError {
	try {
		const body: unknown = JSON.parse(error.message);
		if (typeof body === "object" && body !== null && "error" in body) {
			return parseStreamErrorText(JSON.stringify(body.error));
		}
	} catch {
		// Not an HTTP error body: read it as stream error text below.
	}
	return parseStreamErrorText(error.message);
}

export interface ErrorBannerProps {
	readonly error: Error;
	/** Sends the failed request again; the learner's message stays in the conversation (Req 3.6). */
	readonly onRetry: () => void;
	readonly onDismiss?: () => void;
}

export function ErrorBanner({ error, onRetry, onDismiss }: ErrorBannerProps) {
	const { code, message } = toDisplayError(error);
	return (
		<Alert variant="destructive">
			<AlertTitle>エラーが発生しました</AlertTitle>
			<AlertDescription>
				<p>{message}</p>
				<p className="text-xs">
					エラーコード: <code>{code}</code>
				</p>
				<div className="flex flex-wrap gap-2">
					<Button type="button" variant="outline" size="sm" onClick={onRetry}>
						再送信
					</Button>
					{onDismiss ? (
						<Button type="button" variant="ghost" size="sm" onClick={onDismiss}>
							閉じる
						</Button>
					) : null}
				</div>
			</AlertDescription>
		</Alert>
	);
}
