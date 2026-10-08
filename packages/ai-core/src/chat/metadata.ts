import type { LanguageModelUsage } from "ai";
import type { DisabledTool } from "../aci/types";
import type { AgentRunSummary } from "../agents/guarded-agent";
import type { ModelEntry, ModelId, ProviderId } from "../models/types";
import type { PersonaTemplate } from "./personas";

/** Token counts shown under each answer (Req 3.7). Optional details appear only when reported. */
export interface ResponseUsage {
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly cacheReadTokens?: number;
	readonly reasoningTokens?: number;
}

/**
 * The `messageMetadata` of an assistant message (plan "応答メタデータ（C11）"). Sent with the UI
 * stream's `start` chunk (identity only) and `finish` chunk (with `usage`, and `run` on the agent
 * route); the client merges the two. `modelId` (checked against the catalog, together with
 * `provider`) is also what `adaptHistoryForModel` reads to decide whether reasoning may be replayed,
 * so the field names must not change.
 */
export interface ResponseMetadata {
	readonly modelId: ModelId;
	readonly modelName: string;
	readonly provider: ProviderId;
	readonly personaId: string;
	readonly personaVersion: string;
	/** Absent on the `start` chunk, before the model has reported usage. */
	readonly usage?: ResponseUsage;
	/** Only on `POST /api/agent/tools`. */
	readonly run?: AgentRunSummary;
	/** Tools called for this answer, in call order with duplicates (Req 5.6). Absent without tools. */
	readonly toolsCalled?: readonly string[];
	/** Tools that were not registered and the settings that would enable them (Req 5.4). */
	readonly disabledTools: readonly DisabledTool[];
}

export interface ResponseMetadataInput {
	/** The catalog entry that answered; never a value taken from the request body. */
	readonly entry: ModelEntry;
	readonly persona: Pick<PersonaTemplate, "id" | "version">;
	/** `totalUsage` of the `finish` part. Omit it for the `start` part. */
	readonly usage?: LanguageModelUsage | undefined;
	readonly run?: AgentRunSummary | undefined;
	/** Overrides `run.toolsCalled`; for callers that track tools without a guarded run. */
	readonly toolsCalled?: readonly string[] | undefined;
	readonly disabledTools?: readonly DisabledTool[] | undefined;
}

function toResponseUsage(usage: LanguageModelUsage): ResponseUsage {
	const cacheReadTokens = usage.inputTokenDetails?.cacheReadTokens;
	const reasoningTokens = usage.outputTokenDetails?.reasoningTokens;
	return {
		inputTokens: usage.inputTokens ?? 0,
		outputTokens: usage.outputTokens ?? 0,
		...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
		...(reasoningTokens === undefined ? {} : { reasoningTokens }),
	};
}

/**
 * Builds the response metadata for one assistant message (Req 3.7, 3.10, 5.4, 5.6). Every value
 * comes from the server's own catalog entry, persona and run, so the client cannot spoof it in the
 * stream. The result is frozen and JSON-serialisable.
 */
export function buildResponseMetadata(input: ResponseMetadataInput): ResponseMetadata {
	const { entry, persona, usage, run } = input;
	const toolsCalled = input.toolsCalled ?? run?.toolsCalled;
	return Object.freeze({
		modelId: entry.id,
		modelName: entry.displayName,
		provider: entry.provider,
		personaId: persona.id,
		personaVersion: persona.version,
		...(usage === undefined ? {} : { usage: toResponseUsage(usage) }),
		...(run === undefined ? {} : { run }),
		...(toolsCalled === undefined ? {} : { toolsCalled: [...toolsCalled] }),
		disabledTools: [...(input.disabledTools ?? [])],
	});
}
