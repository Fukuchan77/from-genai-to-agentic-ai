import type { AnalysisEvent, AnalysisResult } from "@platform/ai-core/analysis";
import { DEFAULT_ANALYSIS } from "@platform/ai-core/config";
import { CREDENTIAL_KINDS, type HelpdeskEvent } from "@platform/ai-core/helpdesk";

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
