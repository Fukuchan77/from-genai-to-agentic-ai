import { toErrorResponse, toNotFoundResponse } from "@/lib/server/errors";
import { revisionJson, ticketJson } from "@/lib/server/helpdesk-json";
import { getHelpdeskStore } from "@/lib/server/platform";

// GET /api/helpdesk/tickets/[id] (plan C13, Req 2.3, 2.6, 2.7): the ticket and every revision of its
// plan with the diff of each replan. An id that is not a ticket id cannot exist, so it is a 404 like
// an unknown one, and it never reaches the database.

export const dynamic = "force-dynamic";

const TICKET_ID = /^T-\d{4,}$/u;

export async function GET(
	_request: Request,
	context: { params: Promise<{ id: string }> },
): Promise<Response> {
	try {
		const { id } = await context.params;
		const notFound = () => toNotFoundResponse("指定されたチケットは見つかりません。");
		if (!TICKET_ID.test(id)) return notFound();

		const store = await getHelpdeskStore();
		const ticket = await store.get(id);
		if (!ticket) return notFound();
		const revisions = await store.revisions(id);
		return Response.json({ ticket: ticketJson(ticket), revisions: revisions.map(revisionJson) });
	} catch (error) {
		return toErrorResponse(error);
	}
}
