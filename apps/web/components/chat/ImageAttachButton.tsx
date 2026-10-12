"use client";

import { ImageIcon, XIcon } from "lucide-react";
import { type ChangeEvent, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

/** An image ready to send: the shape `sendMessage({ files })` accepts. */
export interface ImageAttachment {
	readonly type: "file";
	readonly mediaType: string;
	readonly filename: string;
	/** A `data:` URL; the request guard measures only `data:` URLs. */
	readonly url: string;
}

export interface ImageAttachButtonProps {
	/** Whether the selected model has image input (`capabilities.imageInput`). */
	readonly supported: boolean;
	readonly attachment: ImageAttachment | undefined;
	readonly onAttach: (attachment: ImageAttachment) => void;
	readonly onClear: () => void;
	readonly disabled?: boolean;
}

function readAsDataUrl(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result));
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(file);
	});
}

/** Image attachment (Req 3.9): enabled only for a model that accepts image input. */
export function ImageAttachButton({
	supported,
	attachment,
	onAttach,
	onClear,
	disabled = false,
}: ImageAttachButtonProps) {
	const inputRef = useRef<HTMLInputElement>(null);
	const hintId = useId();
	const [problem, setProblem] = useState<string | undefined>();

	async function handleChange(event: ChangeEvent<HTMLInputElement>) {
		const file = event.target.files?.[0];
		event.target.value = "";
		if (!file) return;
		if (!file.type.startsWith("image/")) {
			setProblem("画像ファイルを選択してください。");
			return;
		}
		try {
			const url = await readAsDataUrl(file);
			setProblem(undefined);
			onAttach({ type: "file", mediaType: file.type, filename: file.name, url });
		} catch {
			setProblem("画像を読み込めませんでした。別のファイルを選択してください。");
		}
	}

	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex flex-wrap items-center gap-2">
				<Button
					type="button"
					variant="outline"
					disabled={!supported || disabled}
					aria-describedby={supported ? undefined : hintId}
					onClick={() => inputRef.current?.click()}
				>
					<ImageIcon aria-hidden="true" />
					画像を添付
				</Button>
				<input
					ref={inputRef}
					type="file"
					accept="image/*"
					tabIndex={-1}
					aria-hidden="true"
					className="hidden"
					onChange={(event) => void handleChange(event)}
				/>
				{attachment ? (
					<span className="inline-flex items-center gap-1 text-sm">
						<span>{attachment.filename}</span>
						<Button
							type="button"
							variant="ghost"
							size="icon"
							aria-label={`添付を削除: ${attachment.filename}`}
							onClick={onClear}
						>
							<XIcon aria-hidden="true" />
						</Button>
					</span>
				) : null}
			</div>
			{supported ? null : (
				<p id={hintId} className="text-sm text-muted-foreground">
					選択中のモデルは画像入力に対応していません。
				</p>
			)}
			{problem ? (
				<p role="alert" className="text-sm text-destructive">
					{problem}
				</p>
			) : null}
		</div>
	);
}
