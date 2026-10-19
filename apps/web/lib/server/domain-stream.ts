import type { AnalysisEvent, AnalysisResult } from "@platform/ai-core/analysis";
import { DEFAULT_ANALYSIS } from "@platform/ai-core/config";
import { CREDENTIAL_KINDS, type HelpdeskEvent } from "@platform/ai-core/helpdesk";
import type { ResearchEvent, ResearchResult, ResearchUsage } from "@platform/ai-core/research";

// Maps the domain agents' events to UI message stream parts (plan C13, "ストリームのパート"). A state
// part keeps one `id`, so each write replaces the one before and the client holds the newest; an
// event part gets a running number, so every one is kept. Route Handlers pass the events of
// `runHelpdesk` (and, in later waves, of the other agents) here and write nothing else themselves.

/** The part of a UI message stream writer this module uses (`UIMessageStreamWriter` fits). */
export interface DomainStreamWriter {
	write(part: Record<string, unknown> & { type: string }): void;
}

const KNOWN_KINDS: readonly string[] = CREDENTIAL_KINDS;

/**
 * Returns the function to hand to `runHelpdesk` as `onEvent`. It writes synchronously, so a state
 * change reaches the stream before the next step starts (Req 2.5). Each field is copied by name:
 * an event is never spread into a part, and a credential kind outside the closed vocabulary (which
 * could be a value) is dropped (Req 2.8).
 */
export function createHelpdeskStreamer(writer: DomainStreamWriter): (event: HelpdeskEvent) => void {
	let results = 0;
	return (event) => {
		switch (event.type) {
			case "plan":
				writer.write({
					type: "data-helpdesk-plan",
					id: "plan",
					data: {
						revision: event.revision,
						tasks: event.tasks.map((task) => ({
							id: task.id,
							description: task.description,
							dependsOn: [...task.dependsOn],
							state: task.state,
						})),
						...(event.diff
							? {
									diff: {
										added: [...event.diff.added],
										removed: [...event.diff.removed],
										changed: [...event.diff.changed],
									},
								}
							: {}),
					},
				});
				break;
			case "progress":
				writer.write({
					type: "data-helpdesk-progress",
					id: "progress",
					data: {
						stepsUsed: event.stepsUsed,
						maxSteps: event.maxSteps,
						...(event.current === undefined ? {} : { current: event.current }),
						...(event.decision
							? {
									decision: {
										decision: event.decision.decision,
										reason: event.decision.reason,
									},
								}
							: {}),
					},
				});
				break;
			case "result": {
				results += 1;
				const kinds = (event.credentialKinds ?? []).filter((kind) => KNOWN_KINDS.includes(kind));
				writer.write({
					type: "data-helpdesk-result",
					id: `result-${results}`,
					data: {
						ticketId: event.ticketId,
						status: event.status,
						...(event.answer === undefined ? {} : { answer: event.answer }),
						...(event.reason === undefined ? {} : { reason: event.reason }),
						...(event.remaining === undefined ? {} : { remaining: [...event.remaining] }),
						...(kinds.length > 0 ? { credentialKinds: kinds } : {}),
					},
				});
				break;
			}
		}
	};
}

// --- Data analysis (Req 3.5, 3.6) ---

const MAX_ALT_CHARACTERS = 200;

/** The decoded size of a base64 string, without decoding it. */
function base64Bytes(base64: string): number {
	const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
	return (base64.length / 4) * 3 - padding;
}

/**
 * Returns the function to hand to `runAnalysis` as `onEvent`. `runAnalysis` already checks every
 * figure and table; this repeats the limits that protect the browser (a PNG with an alt, at most
 * 1 MiB; at most 200 rows) so that nothing past them reaches the stream, whatever the caller did.
 * Fields are copied by name. Attempts, figures, tables and notices are events with running ids.
 */
export function createAnalysisStreamer(writer: DomainStreamWriter): (event: AnalysisEvent) => void {
	const counts = { attempt: 0, figure: 0, table: 0, notice: 0 };
	return (event) => {
		switch (event.type) {
			case "attempt": {
				counts.attempt += 1;
				const { index, code, stdout, stderr, errorSummary } = event.attempt;
				writer.write({
					type: "data-analysis-attempt",
					id: `attempt-${counts.attempt}`,
					data: {
						index,
						code,
						stdout,
						stderr,
						...(errorSummary === undefined ? {} : { errorSummary }),
					},
				});
				break;
			}
			case "figure": {
				const { alt, mediaType, base64 } = event.figure;
				const shownAlt = alt.trim();
				if (
					mediaType !== "image/png" ||
					shownAlt.length < 1 ||
					[...shownAlt].length > MAX_ALT_CHARACTERS ||
					base64Bytes(base64) > DEFAULT_ANALYSIS.maxFigureBytes
				) {
					break;
				}
				counts.figure += 1;
				writer.write({
					type: "data-analysis-figure",
					id: `figure-${counts.figure}`,
					data: { alt: shownAlt, mediaType, base64 },
				});
				break;
			}
			case "table": {
				const { caption, columns, rows, totalRows } = event.table;
				counts.table += 1;
				writer.write({
					type: "data-analysis-table",
					id: `table-${counts.table}`,
					data: {
						caption,
						columns: [...columns],
						rows: rows.slice(0, DEFAULT_ANALYSIS.maxTableRows).map((row) => [...row]),
						totalRows: Math.max(totalRows, rows.length),
					},
				});
				break;
			}
			case "rejected":
				counts.notice += 1;
				writer.write({
					type: "data-analysis-notice",
					id: `notice-${counts.notice}`,
					data: { reasons: [...event.reasons] },
				});
				break;
		}
	};
}

/** The end of an analysis: a summary only. The code and the figures were streamed as they came. */
export function writeAnalysisResult(writer: DomainStreamWriter, result: AnalysisResult): void {
	writer.write({
		type: "data-analysis-result",
		id: "result",
		data: {
			status: result.status,
			attempts: result.attempts.length,
			fixes: result.fixes,
			text: result.text,
		},
	});
}

// --- Hierarchical research (Req 4.2, 4.5, 4.6, 4.8–4.10) ---

const RESEARCH_AGENTS: readonly string[] = ["supervisor", "search", "reading", "market"];

/** The detail each kind of event may carry, and the type of each field. Nothing else is copied. */
const RESEARCH_DETAIL_FIELDS: Readonly<
	Record<string, Readonly<Record<string, "string" | "number" | "strings">>>
> = {
	call: { callee: "string", task: "string" },
	tool: { name: "string", input: "string" },
	summary: { text: "string", characters: "number", missing: "number" },
	card: {
		arxivId: "string",
		title: "string",
		authors: "strings",
		publishedAt: "string",
		url: "string",
	},
	error: { reason: "string" },
};

function researchDetail(kind: string, detail: Readonly<Record<string, unknown>>) {
	const fields = RESEARCH_DETAIL_FIELDS[kind] ?? {};
	const copied: Record<string, unknown> = {};
	for (const [name, type] of Object.entries(fields)) {
		const value = detail[name];
		if (type === "string" && typeof value === "string") copied[name] = value;
		else if (type === "number" && typeof value === "number") copied[name] = value;
		else if (type === "strings" && Array.isArray(value)) {
			copied[name] = value.filter((item): item is string => typeof item === "string");
		}
	}
	return copied;
}

/**
 * Returns the function to hand to `runResearch` as `onEvent`. Every event is written at once as a
 * `data-research-event` with a running id, saying which agent it belongs to (Agent Inspector, Req
 * 4.9). The detail is copied field by field for its kind, so an abstract or a transcript that found
 * its way into one cannot reach the browser; an event of an unknown agent or kind is dropped.
 */
export function createResearchStreamer(writer: DomainStreamWriter): (event: ResearchEvent) => void {
	let events = 0;
	return (event) => {
		if (
			!RESEARCH_AGENTS.includes(event.agent) ||
			RESEARCH_DETAIL_FIELDS[event.kind] === undefined
		) {
			return;
		}
		events += 1;
		writer.write({
			type: "data-research-event",
			id: `event-${events}`,
			data: {
				agent: event.agent,
				kind: event.kind,
				detail: researchDetail(event.kind, event.detail),
			},
		});
	};
}

/** The tokens by role and the calls so far, as a state part: each write replaces the one before. */
export function writeResearchUsage(writer: DomainStreamWriter, report: ResearchUsage): void {
	const { usage, calls, maxCalls } = report;
	writer.write({
		type: "data-research-usage",
		id: "usage",
		data: {
			byRole: Object.fromEntries(
				Object.entries(usage.byRole).map(([role, value]) => [
					role,
					value === "unknown"
						? "unknown"
						: {
								inputTokens: value.inputTokens,
								outputTokens: value.outputTokens,
								totalTokens: value.totalTokens,
								calls: value.calls,
								unknownCalls: value.unknownCalls,
							},
				]),
			),
			total: {
				inputTokens: usage.total.inputTokens,
				outputTokens: usage.total.outputTokens,
				totalTokens: usage.total.totalTokens,
			},
			calls,
			maxCalls,
		},
	});
}

/** The end of a research run: the checked report, the citation warnings and the gaps (Req 4.5, 4.6). */
export function writeResearchResult(writer: DomainStreamWriter, result: ResearchResult): void {
	writer.write({
		type: "data-research-result",
		id: "result",
		data: {
			report: result.report,
			warnings: [...result.warnings],
			missing: result.missing.map(({ agent, reason }) => ({ agent, reason })),
		},
	});
}
