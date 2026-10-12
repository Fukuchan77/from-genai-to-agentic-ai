import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export interface SourceErrorViewProps {
	/** `details.reason` of a 422 `source-unavailable` response. */
	readonly reason?: string | undefined;
	/** `details.status`: the HTTP status the article server answered with. */
	readonly status?: number | undefined;
	/** The server's Japanese message, used when the reason is not one this view knows. */
	readonly message?: string | undefined;
}

const TRANSCRIPT_HINT = "字幕テキストを貼り付けて要約することもできます。";

const REASON_TEXT: Readonly<Record<string, { text: string; hint?: string }>> = {
	"http-status": { text: "記事のサーバーがエラーを返しました。" },
	"empty-body": { text: "ページに要約できる本文がありませんでした。" },
	network: { text: "ネットワークエラーのため記事を取得できませんでした。" },
	"disallowed-url": {
		text: "この URL は取得できません。",
		hint: "http / https で公開されている記事の URL を指定してください。",
	},
	timeout: { text: "記事の取得が時間内に終わりませんでした。" },
	"too-large": { text: "記事が大きすぎるため取得できません。" },
	"no-captions": { text: "この動画には利用できる字幕がありません。", hint: TRANSCRIPT_HINT },
	private: { text: "非公開の動画のため字幕を取得できません。", hint: TRANSCRIPT_HINT },
	"fetch-failed": { text: "動画の字幕を取得できませんでした。", hint: TRANSCRIPT_HINT },
};

const FALLBACK_TEXT = "ソースを取得できませんでした。";

/**
 * Why the article or captions could not be loaded (Req 4.7, 4.11). No summary was attempted, so
 * the model was never called. The raw reason code is never shown.
 */
export function SourceErrorView({ reason, status, message }: SourceErrorViewProps) {
	const known = reason === undefined ? undefined : REASON_TEXT[reason];
	return (
		<Alert variant="destructive">
			<AlertTitle>ソースを取得できませんでした</AlertTitle>
			<AlertDescription>
				<p>{known ? known.text : (message ?? FALLBACK_TEXT)}</p>
				{reason === "http-status" && status !== undefined ? <p>HTTP ステータス {status}</p> : null}
				{known?.hint ? <p>{known.hint}</p> : null}
			</AlertDescription>
		</Alert>
	);
}
