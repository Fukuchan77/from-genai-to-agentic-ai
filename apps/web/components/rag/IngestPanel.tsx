"use client";

import type { DocumentSummary } from "@platform/ai-core/rag";
import { type FormEvent, useRef, useState } from "react";
import { ErrorBanner } from "@/components/chat/ErrorBanner";
import { Button } from "@/components/ui/button";

/** The body of `GET /api/rag/knowledge`: the state of the knowledge base and what can be ingested. */
export interface KnowledgeInfo {
	/** `null` when the provider has no embedding model. */
	readonly embedding: { readonly modelId: string; readonly dimensions: number } | null;
	readonly knowledgeBase: {
		readonly embeddingModelId: string | null;
		readonly documents: readonly DocumentSummary[];
	};
	readonly available: {
		readonly knowledge: readonly string[];
		readonly evalCorpus: readonly string[];
	};
	readonly rerank: { readonly available: boolean; readonly reason?: "api-key-missing" };
}

export interface IngestPanelProps {
	/** The server-rendered state; the panel refreshes it itself after an ingest. */
	readonly initial: KnowledgeInfo;
	readonly onIngested?: () => void;
}

type Source = "knowledge" | "eval-corpus";

interface IngestOutcome {
	readonly ingested: readonly { documentId: string; title: string; chunks: number }[];
	readonly skipped: readonly { file: string; reason: string }[];
}

const SOURCE_LABELS: Readonly<Record<Source, string>> = {
	knowledge: "knowledge/ フォルダ（自分の文書）",
	"eval-corpus": "評価用コーパス",
};

const SKIP_REASON_LABELS: Readonly<Record<string, string>> = {
	"unsupported-format": "対応していない形式です",
	"no-text": "テキストを取り出せませんでした",
	"parse-failed": "解析に失敗しました",
	"too-large": "ファイルが大きすぎます",
	"not-found": "ファイルが見つかりません",
};

const CHECKBOX_CLASS = "size-4 shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2";

function filesOf(info: KnowledgeInfo, source: Source): readonly string[] {
	return source === "knowledge" ? info.available.knowledge : info.available.evalCorpus;
}

/**
 * The ingest panel (plan C14, Req 1.1, 2.7): choose a server-side folder and files, ingest them,
 * and see what was ingested and what was skipped. Emptying the knowledge base (`reset`) goes
 * through a native modal `<dialog>` whose focus starts on Cancel; Escape closes it without sending.
 */
export function IngestPanel({ initial, onIngested }: IngestPanelProps) {
	const [info, setInfo] = useState(initial);
	const [source, setSource] = useState<Source>("knowledge");
	const [deselected, setDeselected] = useState<ReadonlySet<string>>(new Set());
	const [reset, setReset] = useState(false);
	const [pending, setPending] = useState(false);
	const [outcome, setOutcome] = useState<IngestOutcome | undefined>();
	const [error, setError] = useState<Error | undefined>();
	const dialogRef = useRef<HTMLDialogElement>(null);
	const cancelRef = useRef<HTMLButtonElement>(null);

	const files = filesOf(info, source);
	const selected = files.filter((file) => !deselected.has(file));
	const canSend = !pending && selected.length > 0 && info.embedding !== null;
	const documents = info.knowledgeBase.documents;

	function changeSource(next: Source) {
		setSource(next);
		setDeselected(new Set());
	}

	function toggleFile(file: string, checked: boolean) {
		const next = new Set(deselected);
		if (checked) next.delete(file);
		else next.add(file);
		setDeselected(next);
	}

	async function refresh() {
		try {
			const response = await fetch("/api/rag/knowledge");
			if (response.ok) setInfo((await response.json()) as KnowledgeInfo);
		} catch {
			// The ingest itself succeeded; a stale list is better than an error for it.
		}
	}

	async function send(withReset: boolean) {
		setPending(true);
		setError(undefined);
		setOutcome(undefined);
		try {
			const response = await fetch("/api/rag/ingest", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					source,
					// Every file selected means "the whole folder": the server lists it.
					...(selected.length === files.length ? {} : { files: selected }),
					reset: withReset,
				}),
			});
			if (!response.ok) {
				setError(new Error(await response.text()));
				return;
			}
			setOutcome((await response.json()) as IngestOutcome);
			if (withReset) setReset(false);
			await refresh();
			onIngested?.();
		} catch {
			// Network and parse failures can hold addresses or keys; only the fixed text is shown.
			setError(new Error("unexpected"));
		} finally {
			setPending(false);
		}
	}

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!canSend) return;
		if (reset) {
			dialogRef.current?.showModal();
			cancelRef.current?.focus();
			return;
		}
		void send(false);
	}

	return (
		<section aria-label="ナレッジベースの取り込み" className="flex flex-col gap-4">
			<div className="flex flex-col gap-2 text-sm">
				<p className="text-muted-foreground">
					{info.embedding
						? `埋め込みモデル: ${info.embedding.modelId}`
						: "埋め込みモデルが設定されていません。環境変数 AI_MODEL_EMBEDDING を設定してください。"}
				</p>
				{documents.length === 0 ? (
					<p>ナレッジベースは空です。質問する前に、文書の取り込みが必要です。</p>
				) : (
					<ul aria-label="取り込み済みの文書" className="flex flex-col gap-1">
						{documents.map((document) => (
							<li key={document.id} className="flex flex-wrap gap-x-3">
								<span className="font-medium">{document.title}</span>
								<span className="text-muted-foreground">{`${document.chunkCount} チャンク`}</span>
							</li>
						))}
					</ul>
				)}
			</div>
			<form onSubmit={handleSubmit} className="flex flex-col gap-4">
				<fieldset className="flex flex-col gap-2">
					<legend className="mb-1 text-sm font-semibold">取り込み元</legend>
					{(Object.keys(SOURCE_LABELS) as Source[]).map((value) => (
						<label key={value} className="flex items-center gap-2 text-sm">
							<input
								type="radio"
								name="ingest-source"
								className={CHECKBOX_CLASS}
								checked={source === value}
								disabled={pending}
								onChange={() => changeSource(value)}
							/>
							{SOURCE_LABELS[value]}
						</label>
					))}
				</fieldset>
				<fieldset className="flex flex-col gap-2">
					<legend className="mb-1 text-sm font-semibold">ファイル</legend>
					{files.length === 0 ? (
						<p className="text-sm text-muted-foreground">取り込める文書がありません。</p>
					) : (
						files.map((file) => (
							<label key={file} className="flex items-center gap-2 text-sm">
								<input
									type="checkbox"
									className={CHECKBOX_CLASS}
									checked={!deselected.has(file)}
									disabled={pending}
									onChange={(event) => toggleFile(file, event.target.checked)}
								/>
								{file}
							</label>
						))
					)}
				</fieldset>
				<label className="flex items-start gap-2 text-sm">
					<input
						type="checkbox"
						className={`${CHECKBOX_CLASS} mt-0.5`}
						checked={reset}
						disabled={pending}
						onChange={(event) => setReset(event.target.checked)}
					/>
					<span>
						ナレッジベースを空にしてから取り込む
						<span className="block text-xs text-muted-foreground">
							取り込み済みのすべての文書を削除します（確認があります）。
						</span>
					</span>
				</label>
				<div className="flex flex-wrap items-center gap-3">
					<Button type="submit" disabled={!canSend}>
						取り込む
					</Button>
					{pending ? (
						<p role="status" aria-label="取り込みの進行" className="text-sm text-muted-foreground">
							取り込み中です
						</p>
					) : null}
				</div>
			</form>
			{error ? (
				<ErrorBanner
					error={error}
					onRetry={() => {
						setError(undefined);
						if (reset) dialogRef.current?.showModal();
						else void send(false);
					}}
					onDismiss={() => setError(undefined)}
				/>
			) : null}
			{outcome ? <IngestResultView outcome={outcome} /> : null}
			<dialog
				ref={dialogRef}
				aria-labelledby="ingest-reset-title"
				className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-border bg-card p-6 text-card-foreground backdrop:bg-black/50"
			>
				<div className="flex flex-col gap-4">
					<h2 id="ingest-reset-title" className="text-lg font-semibold">
						ナレッジベースを削除しますか？
					</h2>
					<p className="text-sm">
						取り込み済みのすべての文書とチャンクを削除してから、選んだファイルを取り込みます。この操作は元に戻せません。
					</p>
					<div className="flex flex-wrap justify-end gap-2">
						<Button
							ref={cancelRef}
							type="button"
							variant="outline"
							onClick={() => dialogRef.current?.close()}
						>
							キャンセル
						</Button>
						<Button
							type="button"
							variant="destructive"
							onClick={() => {
								dialogRef.current?.close();
								void send(true);
							}}
						>
							削除して取り込む
						</Button>
					</div>
				</div>
			</dialog>
		</section>
	);
}

function IngestResultView({ outcome }: { readonly outcome: IngestOutcome }) {
	const chunks = outcome.ingested.reduce((sum, document) => sum + document.chunks, 0);
	return (
		<section
			role="status"
			aria-label="取り込み結果"
			className="flex flex-col gap-2 rounded-md border border-border bg-muted p-3 text-sm"
		>
			<p className="font-medium">
				{`${outcome.ingested.length} 件の文書を取り込みました（合計 ${chunks} チャンク）。`}
			</p>
			{outcome.ingested.length > 0 ? (
				<ul aria-label="取り込んだ文書" className="flex flex-col gap-1">
					{outcome.ingested.map((document) => (
						<li key={document.documentId}>{`${document.title}（${document.chunks} チャンク）`}</li>
					))}
				</ul>
			) : null}
			{outcome.skipped.length > 0 ? (
				<ul aria-label="取り込めなかったファイル" className="flex flex-col gap-1">
					{outcome.skipped.map((skipped) => (
						<li key={skipped.file}>
							<span className="font-medium">{skipped.file}</span>
							{` — ${SKIP_REASON_LABELS[skipped.reason] ?? "取り込めませんでした"}`}
						</li>
					))}
				</ul>
			) : null}
		</section>
	);
}
