import { DEFAULT_ANALYSIS } from "@platform/ai-core/config";
import { toErrorResponse } from "@/lib/server/errors";
import { getSandboxSelection } from "@/lib/server/platform";

// GET /api/analysis/status (plan C13, Req 3.8): which sandbox the analysis would use, or why it is
// disabled and what to set up, and the upload limits the screen shows. It calls no LLM and starts no
// sandbox. Only the fields below are sent: no key, socket path or error text.

export const dynamic = "force-dynamic";

const ACCEPTS = [".csv", ".xlsx", ".xls"] as const;

export async function GET(): Promise<Response> {
	try {
		const setup = await getSandboxSelection();
		return Response.json({
			sandbox:
				setup.kind === "disabled"
					? { kind: "disabled", reason: setup.reason, guidance: setup.guidance }
					: { kind: setup.kind },
			upload: { maxBytes: DEFAULT_ANALYSIS.maxUploadBytes, accepts: ACCEPTS },
		});
	} catch (error) {
		return toErrorResponse(error);
	}
}
