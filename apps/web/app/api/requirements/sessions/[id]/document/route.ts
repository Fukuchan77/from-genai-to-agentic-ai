import { getRequirementsSessions } from "@platform/ai-core/requirements";
import { toErrorResponse, toNotFoundResponse } from "@/lib/server/errors";
import { getPlatform } from "@/lib/server/platform";
import { getSessionRegistry } from "@/lib/server/sessions";

// GET /api/requirements/sessions/[id]/document (plan C13, Req 5.7): the requirements document the
// interview produced, as a Markdown download. The file name is fixed text, never built from the
// session id or anything the learner typed. A session that is missing or idle past its limit is a
// 404; one whose interview has not ended yet has no document and is a 409. Either way, a download
// counts as activity, so a learner reading the file does not lose the session.

export const dynamic = "force-dynamic";

const FILE_NAME = "requirements.md";

export async function GET(
	_request: Request,
	context: { params: Promise<{ id: string }> },
): Promise<Response> {
	try {
		const { id } = await context.params;
		const platform = await getPlatform();
		const store = getRequirementsSessions(getSessionRegistry, platform.clock);
		const session = store.get(id);
		if (!session) return toNotFoundResponse("指定された面接セッションは見つかりません。");
		store.touch(id);

		if (session.document === null) {
			return new Response(
				JSON.stringify({
					error: {
						code: "invalid-request",
						message:
							"要件定義書はまだ作成されていません。面接が終わってからダウンロードしてください。",
					},
				}),
				{ status: 409, headers: { "content-type": "application/json; charset=utf-8" } },
			);
		}
		return new Response(session.document, {
			status: 200,
			headers: {
				"content-type": "text/markdown; charset=utf-8",
				"content-disposition": `attachment; filename="${FILE_NAME}"`,
				"x-content-type-options": "nosniff",
				"cache-control": "no-store",
			},
		});
	} catch (error) {
		return toErrorResponse(error);
	}
}
