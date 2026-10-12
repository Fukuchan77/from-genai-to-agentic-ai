"use client";

import type { ModelOption } from "@platform/ai-core/models";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";

export interface ModelSelectorProps {
	readonly models: readonly ModelOption[];
	readonly value: string;
	readonly onValueChange: (modelId: string) => void;
	readonly disabled?: boolean;
}

/** Model picker (Req 3.2). The options come from the server's `availableModels()`. */
export function ModelSelector({ models, value, onValueChange, disabled }: ModelSelectorProps) {
	return (
		<div className="flex flex-col gap-1.5">
			<label htmlFor="chat-model" className="text-sm font-medium">
				モデル
			</label>
			<Select value={value} onValueChange={onValueChange} {...(disabled ? { disabled } : {})}>
				<SelectTrigger id="chat-model">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{models.map((model) => (
						<SelectItem key={model.id} value={model.id}>
							{model.displayName}（{model.provider}）
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}
