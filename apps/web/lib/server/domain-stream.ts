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
