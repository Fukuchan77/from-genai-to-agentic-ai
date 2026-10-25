"use client";

import { type FormEvent, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/** The `upload` field of `GET /api/analysis/status`: what the server accepts. */
export interface UploadLimits {
	readonly maxBytes: number;
	/** File extensions with the leading dot, e.g. `.csv`. */
	readonly accepts: readonly string[];
}

/** What the form hands over on submit. The server checks the file and the instruction. */
export interface UploadSubmission {
	readonly file: File;
	readonly instruction: string;
}

export interface UploadFormProps {
	readonly upload: UploadLimits;
	readonly onSubmit: (submission: UploadSubmission) => void;
	/** True when the sandbox is disabled (Req 3.8): every input is locked. */
	readonly disabled?: boolean | undefined;
	/** True while an analysis is running: every input is locked. */
	readonly pending?: boolean | undefined;
}

const BYTES_PER_MEGABYTE = 1024 * 1024;

function formatLimit(bytes: number): string {
	const megabytes = bytes / BYTES_PER_MEGABYTE;
	return `${Number.isInteger(megabytes) ? megabytes : megabytes.toFixed(1)} MB`;
}

const INPUT_CLASS =
	"block w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1 file:text-sm file:font-medium file:text-secondary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60";

/**
 * The upload form of the analysis screen (plan C14, Req 3.8, 3.9): pick a file, type the
 * instruction, submit. It shows what the server accepts but checks neither the file's type nor its
 * size: the server rejects a bad file before any sandbox starts and the screen shows its reason.
 */
export function UploadForm({ upload, onSubmit, disabled, pending }: UploadFormProps) {
	const fileId = useId();
	const hintId = useId();
	const instructionId = useId();
	const [file, setFile] = useState<File | undefined>();
	const [instruction, setInstruction] = useState("");
	const locked = disabled === true || pending === true;
	const trimmed = instruction.trim();
	const canSubmit = !locked && file !== undefined && trimmed.length > 0;

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!canSubmit || !file) return;
		onSubmit({ file, instruction: trimmed });
	}

	return (
		<form onSubmit={handleSubmit} className="flex flex-col gap-4">
			<div className="flex flex-col gap-1.5">
				<label htmlFor={fileId} className="text-sm font-medium">
					分析するファイル
				</label>
				<input
					id={fileId}
					type="file"
					accept={upload.accepts.join(",")}
					aria-describedby={hintId}
					disabled={locked}
					onChange={(event) => setFile(event.target.files?.[0])}
					className={INPUT_CLASS}
				/>
				<p id={hintId} className="text-xs text-muted-foreground">
					{`対応形式: ${upload.accepts.join("、")}（上限 ${formatLimit(upload.maxBytes)}）`}
				</p>
			</div>
			<div className="flex flex-col gap-1.5">
				<label htmlFor={instructionId} className="text-sm font-medium">
					分析の指示
				</label>
				<Textarea
					id={instructionId}
					value={instruction}
					onChange={(event) => setInstruction(event.target.value)}
					disabled={locked}
					rows={4}
					placeholder="例: 月ごとの売上を集計して、折れ線グラフにしてください"
				/>
			</div>
			<div>
				<Button type="submit" disabled={!canSubmit}>
					分析する
				</Button>
			</div>
		</form>
	);
}
