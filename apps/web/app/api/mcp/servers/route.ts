import { DEFAULT_TOOLS } from "@platform/ai-core/config";
import { publicMcpStatus } from "@platform/ai-core/mcp";
import { toErrorResponse } from "@/lib/server/errors";
import { getMcpRegistry } from "@/lib/server/platform";

// GET /api/mcp/servers (plan C13, Req 1.7, 1.8, 1.10, 1.15): each MCP server's state, the tools it
// loaded and the ones it refused with the reason, and the limits the screen shows. It calls no LLM,
// so there is no body to guard and no rate limit. Only the fields below are sent: a status can never
// carry a header or a token out of the process.

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
	try {
		const registry = await getMcpRegistry();
		return Response.json({
			servers: registry.status().map(publicMcpStatus),
			limits: { maxTools: DEFAULT_TOOLS.maxToolsPerAgent },
			think: { enabled: DEFAULT_TOOLS.thinkEnabled },
		});
	} catch (error) {
		return toErrorResponse(error);
	}
}
