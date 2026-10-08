import { PlatformError } from "../../errors";
import { generalAssistant } from "./general-assistant";
import { pythonMentor } from "./python-mentor";
import { strictReviewer } from "./strict-reviewer";

/**
 * Values the server fills into a persona's system prompt. Both come from trusted sources
 * (the model catalog's display name, the injected Clock), never from the request body.
 */
export interface PersonaVars {
	/** `ModelEntry.displayName` of the model that will answer. */
	readonly modelName?: string;
	/** Today's date as `YYYY-MM-DD`, derived from the injected Clock by the caller. */
	readonly today?: string;
}

export interface PersonaTemplate<Id extends string = string> {
	readonly id: Id;
	/** Semantic version of the prompt text. Bump it whenever `render` output changes. */
	readonly version: string;
	/** Japanese label shown in the persona selector. */
	readonly title: string;
	render(vars: PersonaVars): string;
}

/** Data-only definition each persona module exports; `index.ts` turns it into a template. */
export interface PersonaSource {
	readonly id: string;
	readonly version: string;
	readonly title: string;
	readonly instructions: string;
}

const SOURCES = [generalAssistant, pythonMentor, strictReviewer] as const;

export type PersonaId = (typeof SOURCES)[number]["id"];

export const DEFAULT_PERSONA_ID: PersonaId = "general-assistant";

function renderPrompt(instructions: string, vars: PersonaVars): string {
	const context: string[] = [];
	if (vars.modelName !== undefined) context.push(`- モデル名: ${vars.modelName}`);
	if (vars.today !== undefined) context.push(`- 今日の日付: ${vars.today}`);
	if (context.length === 0) return instructions;
	return [instructions, "", "# 実行時の情報", ...context].join("\n");
}

function toTemplate<Id extends PersonaId>(
	source: PersonaSource & { readonly id: Id },
): PersonaTemplate<Id> {
	const { id, version, title, instructions } = source;
	return Object.freeze({
		id,
		version,
		title,
		render: (vars: PersonaVars) => renderPrompt(instructions, vars),
	});
}

export const PERSONAS: readonly PersonaTemplate<PersonaId>[] = Object.freeze(
	SOURCES.map((source) => toTemplate(source)),
);

export const PERSONA_IDS: readonly PersonaId[] = Object.freeze(
	PERSONAS.map((persona) => persona.id),
);

export function isPersonaId(value: string): value is PersonaId {
	return (PERSONA_IDS as readonly string[]).includes(value);
}

export function getPersona(id: string): PersonaTemplate<PersonaId> {
	const persona = PERSONAS.find((candidate) => candidate.id === id);
	if (persona === undefined) {
		throw new PlatformError(
			"invalid-request",
			`未知のペルソナ ID です。${PERSONA_IDS.join(", ")} のいずれかを指定してください。`,
			{ personaId: id },
		);
	}
	return persona;
}
