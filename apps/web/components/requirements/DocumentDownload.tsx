import { useId } from "react";
import { Button } from "@/components/ui/button";

/** The `data-requirements-judgement` payload: one round's sufficiency verdict (Req 5.4). */
export interface RequirementsJudgement {
	readonly round: number;
	readonly sufficient: boolean;
	readonly missing: readonly string[];
	readonly forcedEnd: boolean;
}

export interface DocumentDownloadProps {
	/** The interview session, or `null` before one exists. */
	readonly sessionId: string | null;
	/** The latest verdict, or `null` before the first round has ended. */
	readonly judgement: RequirementsJudgement | null;
	/** True once the server has produced the document (the interview ended). */
	readonly documentReady: boolean;
}

export const REQUIREMENTS_FILE_NAME = "requirements.md";
const DOWNLOAD_LABEL = `${REQUIREMENTS_FILE_NAME} をダウンロード`;

function describeVerdict(judgement: RequirementsJudgement): string {
	const round = `第 ${judgement.round} ラウンド`;
	if (judgement.forcedEnd) {
		return `${round}: ラウンド数の上限に達したため終了しました。不足している項目は要件定義書の「未確認事項」に記載されます。`;
	}
	return judgement.sufficient
		? `${round}: 要件定義書を作るのに十分な情報が集まりました。`
		: `${round}: 情報が不足しています。不足項目を中心に次の質問を行います。`;
}

/**
 * The sufficiency verdict and the requirements.md download (Req 5.4, 5.7, plan C14). The server
 * judges and builds the document; this shows the verdict, and offers the download only once the
 * document exists, so the disabled state is a real `disabled` button, not a link that would 409.
 */
export function DocumentDownload({ sessionId, judgement, documentReady }: DocumentDownloadProps) {
	const reasonId = useId();
	const available = documentReady && sessionId !== null;
	return (
		<div className="flex flex-col gap-3">
			<section aria-label="十分性の判定" aria-live="polite" className="flex flex-col gap-2 text-sm">
				{judgement === null ? (
					<p className="text-muted-foreground">
						まだ判定されていません。最初のラウンドが終わると表示されます。
					</p>
				) : (
					<>
						<p>{describeVerdict(judgement)}</p>
						{judgement.missing.length === 0 ? null : (
							<ul aria-label="不足項目" className="list-disc pl-5">
								{judgement.missing.map((item, index) => (
									// biome-ignore lint/suspicious/noArrayIndexKey: missing items are plain strings and may repeat
									<li key={`${index}-${item}`} className="break-words">
										{item}
									</li>
								))}
							</ul>
						)}
					</>
				)}
			</section>
			{available ? (
				<Button asChild className="self-start">
					<a
						href={`/api/requirements/sessions/${encodeURIComponent(sessionId)}/document`}
						download={REQUIREMENTS_FILE_NAME}
					>
						{DOWNLOAD_LABEL}
					</a>
				</Button>
			) : (
				<>
					<Button type="button" disabled aria-describedby={reasonId} className="self-start">
						{DOWNLOAD_LABEL}
					</Button>
					<p id={reasonId} className="text-xs text-muted-foreground">
						要件定義書は面接が終わると作成され、ダウンロードできるようになります。
					</p>
				</>
			)}
		</div>
	);
}
