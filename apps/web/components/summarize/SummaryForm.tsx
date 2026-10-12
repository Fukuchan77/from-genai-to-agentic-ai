"use client";

import type { ModelOption } from "@platform/ai-core/models";
import type { SummaryInput } from "@platform/ai-core/summarize";
import { type FormEvent, useId, useState } from "react";
import { ModelSelector } from "@/components/chat/ModelSelector";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type Kind = SummaryInput["kind"];

const KINDS: readonly {
	readonly kind: Kind;
	readonly label: string;
	readonly fieldLabel: string;
}[] = [
	{ kind: "article", label: "記事の URL", fieldLabel: "記事の URL（http / https）" },
	{ kind: "youtube", label: "YouTube の URL", fieldLabel: "YouTube 動画の URL" },
	{ kind: "transcript", label: "字幕テキスト", fieldLabel: "字幕テキストを貼り付け" },
];

export interface SummaryFormProps {
	readonly models: readonly ModelOption[];
	readonly modelId: string;
	readonly onModelChange: (modelId: string) => void;
	readonly onSubmit: (input: SummaryInput) => void;
	/** True while a summary is being generated: the fields lock and submit does nothing. */
	readonly disabled?: boolean;
}

/** Article URL, YouTube URL or transcript text input (plan C17). Submits one `SummaryInput`. */
export function SummaryForm({
	models,
	modelId,
	onModelChange,
	onSubmit,
	disabled,
}: SummaryFormProps) {
	const groupName = useId();
	const fieldId = useId();
	const [kind, setKind] = useState<Kind>("article");
	const [values, setValues] = useState<Record<Kind, string>>({
		article: "",
		youtube: "",
		transcript: "",
	});
	const current = KINDS.find((item) => item.kind === kind) ?? KINDS[0];
	const value = values[kind];
	const canSubmit = !disabled && value.trim().length > 0;

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!canSubmit) return;
		const trimmed = value.trim();
		onSubmit(kind === "transcript" ? { kind, text: trimmed } : { kind, url: trimmed });
	}

	const setValue = (next: string) => setValues((previous) => ({ ...previous, [kind]: next }));

	return (
		<form onSubmit={handleSubmit} className="flex flex-col gap-4">
			<fieldset className="flex flex-col gap-2" disabled={disabled}>
				<legend className="text-sm font-medium">入力の種類</legend>
				<div role="radiogroup" aria-label="入力の種類" className="flex flex-wrap gap-4">
					{KINDS.map((item) => (
						<label key={item.kind} className="flex items-center gap-2 text-sm">
							<input
								type="radio"
								name={groupName}
								checked={kind === item.kind}
								onChange={() => setKind(item.kind)}
								className="size-4 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2"
							/>
							{item.label}
						</label>
					))}
				</div>
			</fieldset>

			<div className="flex flex-col gap-1.5">
				<label htmlFor={fieldId} className="text-sm font-medium">
					{current?.fieldLabel}
				</label>
				{kind === "transcript" ? (
					<Textarea
						id={fieldId}
						value={value}
						onChange={(event) => setValue(event.target.value)}
						disabled={disabled === true}
						rows={8}
						placeholder="字幕のテキストをここに貼り付けてください"
					/>
				) : (
					<input
						id={fieldId}
						type="url"
						inputMode="url"
						value={value}
						onChange={(event) => setValue(event.target.value)}
						disabled={disabled === true}
						placeholder={
							kind === "article"
								? "https://example.com/article"
								: "https://www.youtube.com/watch?v=..."
						}
						className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
					/>
				)}
			</div>

			<div className="max-w-sm">
				<ModelSelector
					models={models}
					value={modelId}
					onValueChange={onModelChange}
					disabled={disabled === true}
				/>
			</div>

			<div>
				<Button type="submit" disabled={!canSubmit}>
					要約する
				</Button>
			</div>
		</form>
	);
}
