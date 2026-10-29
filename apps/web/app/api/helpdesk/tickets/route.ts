import { PlatformError } from "@platform/ai-core/errors";
import type { TicketStatus } from "@platform/ai-core/helpdesk";
import { toErrorResponse } from "@/lib/server/errors";
import { ticketJson } from "@/lib/server/helpdesk-json";
import { getHelpdeskStore } from "@/lib/server/platform";

// GET /api/helpdesk/tickets (plan C13, Req 2.6, 2.7): the tickets, newest first, at most 50, with an
// optional `status` filter. A read of the database only: no model is called.

export const dynamic = "force-dynamic";

const STATUSES: readonly TicketStatus[] = ["open", "resolved", "escalated"];

function parseStatus(url: URL): TicketStatus | undefined {
	for (const key of url.searchParams.keys()) {
		if (key !== "status") {
			throw new PlatformError("invalid-request", "指定できるクエリは status だけです。");
		}
	}
	const values = url.searchParams.getAll("status");
	if (values.length === 0) return undefined;
	const [value] = values;
	if (values.length > 1 || !STATUSES.includes(value as TicketStatus)) {
		throw new PlatformError(
			"invalid-request",
			`status は ${STATUSES.join(" / ")} のいずれか 1 つを指定してください。`,
		);
	}
	return value as TicketStatus;
}

export async function GET(request: Request): Promise<Response> {
	try {
		const status = parseStatus(new URL(request.url));
		const store = await getHelpdeskStore();
		const tickets = await store.list(status === undefined ? {} : { status });
		return Response.json({ tickets: tickets.map(ticketJson) });
	} catch (error) {
		return toErrorResponse(error);
	}
}
