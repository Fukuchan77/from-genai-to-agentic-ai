import type { PlanRevision, Ticket } from "@platform/ai-core/helpdesk";

// The JSON the help-desk read endpoints send (plan C13). Each field is copied by name, with dates as
// ISO strings and a field present only when it applies, so the response is the same shape whatever
// the store returns.

export function ticketJson(ticket: Ticket) {
	return {
		id: ticket.id,
		inquiry: ticket.inquiry,
		status: ticket.status,
		...(ticket.answer === undefined ? {} : { answer: ticket.answer }),
		...(ticket.escalationReason === undefined ? {} : { escalationReason: ticket.escalationReason }),
		stepsUsed: ticket.stepsUsed,
		...(ticket.stoppedReason === undefined ? {} : { stoppedReason: ticket.stoppedReason }),
		createdAt: ticket.createdAt.toISOString(),
		updatedAt: ticket.updatedAt.toISOString(),
	};
}

export function revisionJson(revision: PlanRevision) {
	return {
		revision: revision.revision,
		plan: revision.plan,
		...(revision.diff === undefined ? {} : { diff: revision.diff }),
		reason: revision.reason,
		createdAt: revision.createdAt.toISOString(),
	};
}
