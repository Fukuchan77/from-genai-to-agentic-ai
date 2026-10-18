import { GuardError, toErrorResponse } from "@/lib/server/errors";
import { getSandboxSelection } from "@/lib/server/platform";

// DELETE /api/analysis/sessions/[id] (plan C13, Req 3.7): the learner ends the analysis session and
// its sandbox is closed at once. It acts on the same registry `/api/analysis` made the sandbox in
// (one registry for the whole process), so a session made by one route is ended by another. Asking
// again, or for a session that never existed or already ended, is not an error.

export const dynamic = "force-dynamic";

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export async function DELETE(
	_request: Request,
	context: { params: Promise<{ id: string }> },
): Promise<Response> {
	try {
		const { id } = await context.params;
		if (!SESSION_ID.test(id)) {
			throw new GuardError("invalid-request", "セッション ID の形式が正しくありません。");
		}
		const setup = await getSandboxSelection();
		// A disabled setup never made a sandbox, so there is nothing to close. A 204 has no body, so
		// whether a sandbox was closed is told in a header (the real-server check reads it).
		const released = setup.kind === "disabled" ? false : await setup.registry.release(id);
		return new Response(null, {
			status: 204,
			headers: { "x-analysis-session": released ? "released" : "absent" },
		});
	} catch (error) {
		return toErrorResponse(error);
	}
}
