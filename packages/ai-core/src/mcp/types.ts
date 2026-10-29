import type { FatalErrorCode } from "../aci/fatal";
import type { ToolRisk } from "../aci/types";

/** Names a caller of `McpRegistry.toolsFor`, so each agent gets its own allow-list (Req 1.8). */
export type AgentId = string;

/** Server ID → the tool names an agent may load from that server. */
export type McpAllowList = Readonly<Record<string, readonly string[]>>;

export type McpTransportConfig =
	| {
			readonly kind: "stdio";
			readonly command: string;
			readonly args: readonly string[];
			readonly env: Readonly<Record<string, string>>;
	  }
	| {
			readonly kind: "http";
			readonly url: string;
			/** May carry a secret (`Authorization`). Never copied into a status, a log or an error. */
			readonly headers: Readonly<Record<string, string>>;
	  };

/** One MCP server the platform may connect to. The code defines it; no request can add one. */
export interface McpServerConfig {
	readonly id: string;
	readonly transport: McpTransportConfig;
	/** The tool names that may be loaded from this server. Empty loads nothing. */
	readonly allow: readonly string[];
	/**
	 * Tool name → description in the CL-18 form. It replaces the server's own description, which does
	 * not follow that form (CL-25). Only repository code sets it.
	 */
	readonly descriptions?: Readonly<Record<string, string>> | undefined;
	/**
	 * Whether `_meta["agentic-ai/error"]` in a tool result can end the run. Only the platform's own
	 * server sets it (CL-24).
	 */
	readonly trustErrorMeta: boolean;
	/**
	 * What the learner reads when a tool of this server ends the run, by error code. The client builds
	 * it from this configuration, never from the server's text (CL-24); a code without an entry gets a
	 * generic sentence that names the server.
	 */
	/**
	 * Checked before the server is started; a returned text is the learner-facing reason the server is
	 * unavailable (a mistyped root, say), shown instead of a generic connection failure.
	 */
	readonly preflight?: (() => Promise<string | undefined>) | undefined;
	readonly fatalMessages?: Readonly<Partial<Record<FatalErrorCode, string>>> | undefined;
}

export interface McpToolStatus {
	readonly name: string;
	readonly risk: ToolRisk;
	/** False when the tool is not loaded, with the reason in `disabledReason`. */
	readonly registered: boolean;
	readonly disabledReason?: string | undefined;
}

/** What the screen shows for one server. Contains no secret (a header value, a token). */
export interface McpServerStatus {
	readonly id: string;
	readonly state: "connected" | "unavailable";
	readonly reason?: string | undefined;
	readonly tools: readonly McpToolStatus[];
}

/**
 * The status as the browser may see it: only the listed fields, copied one by one. A registry that
 * later carries more (a header, a transport, a token) cannot leak it through a route that sends
 * this value.
 */
export function publicMcpStatus(status: McpServerStatus): McpServerStatus {
	return {
		id: status.id,
		state: status.state,
		...(status.reason === undefined ? {} : { reason: status.reason }),
		tools: status.tools.map((tool) => ({
			name: tool.name,
			risk: tool.risk,
			registered: tool.registered,
			...(tool.disabledReason === undefined ? {} : { disabledReason: tool.disabledReason }),
		})),
	};
}
