"use client";

import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";

export interface PersonaOption {
	readonly id: string;
	readonly title: string;
}

export interface PersonaSelectorProps {
	readonly personas: readonly PersonaOption[];
	readonly value: string;
	readonly onValueChange: (personaId: string) => void;
	readonly disabled?: boolean;
}

/** Persona picker (Req 3.10). The persona's system prompt lives on the server. */
export function PersonaSelector({
	personas,
	value,
	onValueChange,
	disabled,
}: PersonaSelectorProps) {
	return (
		<div className="flex flex-col gap-1.5">
			<label htmlFor="chat-persona" className="text-sm font-medium">
				ペルソナ
			</label>
			<Select value={value} onValueChange={onValueChange} {...(disabled ? { disabled } : {})}>
				<SelectTrigger id="chat-persona">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{personas.map((persona) => (
						<SelectItem key={persona.id} value={persona.id}>
							{persona.title}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}
