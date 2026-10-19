import type { AgentRunSummary, RunObserver } from "./guarded-agent";

/** A run summary with the name of the agent that produced it (for the Agent Inspector, 003 C9). */
export interface RunEvent {
	readonly agent: string | undefined;
	readonly summary: AgentRunSummary;
}

/**
 * A `RunObserver` that tags the summary with the agent's name before handing it on. `RunObserver`
 * itself is unchanged: this only wraps a handler, so M1 observers keep working and a missing name
 * leaves `agent` undefined.
 */
export function createNamedObserver(
	agent: string | undefined,
	handler: (event: RunEvent) => void,
): RunObserver {
	if (agent === "") throw new RangeError("agent name must not be empty.");
	return { onRunEnd: (summary) => handler({ agent, summary }) };
}

/** The kinds of external content a run can take in (003 CL-10). Judgement is 004's job. */
export const EXTERNAL_CONTENT_KINDS = ["arxiv-abstract", "file-content", "mcp-response"] as const;
export type ExternalContentKind = (typeof EXTERNAL_CONTENT_KINDS)[number];

/** The longest `source` a record may carry: an origin is short, so a longer one is content. */
export const MAX_EXTERNAL_SOURCE_CHARACTERS = 512;

/** Where external content came from. Never the content itself. */
export interface ExternalContentIngestion {
	readonly kind: ExternalContentKind;
	/** A path, an arXiv ID or `server:tool`: enough to find the origin, never the text. */
	readonly source: string;
	/** The agent that took it in; set by a log's `forAgent` view. */
	readonly agent?: string | undefined;
}

export interface ExternalContentLog {
	record(ingestion: ExternalContentIngestion): void;
	entries(): readonly ExternalContentIngestion[];
	/** A view over the same log that stamps `agent` on every record, so 004 can tell who read what. */
	forAgent(agent: string): ExternalContentLog;
}

/**
 * The hook where tools report that external content entered the run (CL-10). It keeps the kind and
 * the source only; M3 does not act on it. 004 Req 4.8 reads it to judge taint.
 */
export function createExternalContentLog(): ExternalContentLog {
	const log: ExternalContentIngestion[] = [];
	function view(agent: string | undefined): ExternalContentLog {
		return {
			record: ({ kind, source, agent: given }) => {
				if (!(EXTERNAL_CONTENT_KINDS as readonly string[]).includes(kind)) {
					throw new RangeError(`unknown external content kind: ${String(kind)}`);
				}
				if (source === "") throw new RangeError("source must not be empty.");
				if (Array.from(source).length > MAX_EXTERNAL_SOURCE_CHARACTERS) {
					throw new RangeError(
						`source must be at most ${MAX_EXTERNAL_SOURCE_CHARACTERS} characters: it names an origin, not the content.`,
					);
				}
				const by = agent ?? given;
				log.push(Object.freeze({ kind, source, ...(by === undefined ? {} : { agent: by }) }));
			},
			entries: () => [...log],
			forAgent: (name) => {
				if (name === "") throw new RangeError("agent name must not be empty.");
				return view(name);
			},
		};
	}
	return view(undefined);
}
