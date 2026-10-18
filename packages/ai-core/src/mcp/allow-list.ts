import type { ListToolsResult, MCPClient } from "@ai-sdk/mcp";
import { jsonSchema, type Schema } from "ai";

export type McpToolDefinition = ListToolsResult["tools"][number];

export interface AllowListSelection {
	/**
	 * The `schemas` argument of `client.tools` / `client.toolsFromDefinitions`. The client loads
	 * exactly the tools named here, so a tool that is not allowed is never turned into a tool.
	 * A null-prototype object: a tool named `__proto__` or `constructor` is a plain key.
	 */
	readonly schemas: Record<string, { inputSchema: Schema<unknown> }>;
	/** Allowed tools the server exposes, in the server's order. */
	readonly loaded: readonly string[];
	/** Tools the server exposes that the allow-list does not name. */
	readonly skipped: readonly string[];
	/** Allowed names the server does not expose (a typo, or a tool the server removed). */
	readonly unknown: readonly string[];
}

/**
 * Narrows what the server lists to an allow-list (Req 1.8). Matching is by exact name. Each tool
 * keeps the server's own input schema, closed to unknown properties like the client's default.
 */
export function buildAllowedSchemas(
	definitions: readonly McpToolDefinition[],
	allow: readonly string[],
): AllowListSelection {
	const allowed = new Set(allow);
	const schemas: Record<string, { inputSchema: Schema<unknown> }> = Object.create(null);
	const loaded: string[] = [];
	const skipped: string[] = [];
	const exposed = new Set<string>();
	for (const definition of definitions) {
		exposed.add(definition.name);
		if (!allowed.has(definition.name)) {
			skipped.push(definition.name);
			continue;
		}
		loaded.push(definition.name);
		schemas[definition.name] = {
			inputSchema: jsonSchema({
				...definition.inputSchema,
				properties: definition.inputSchema.properties ?? {},
				additionalProperties: false,
			}),
		};
	}
	const unknown = [...allowed].filter((name) => !exposed.has(name));
	return { schemas, loaded, skipped, unknown };
}

/**
 * What this layer reads from a tool the client built. The SDK's own `McpToolBase` type is not
 * exported, and naming it through `ReturnType<MCPClient["tools"]>` hits the TypeScript problem below.
 */
export interface McpClientTool {
	readonly description?: string | undefined;
	/** The schema the client was given for this tool (see `buildAllowedSchemas`). */
	readonly inputSchema?: { readonly jsonSchema?: unknown } | undefined;
	/** The tool-level `_meta` the server sent in `tools/list`. */
	readonly _meta?: Readonly<Record<string, unknown>> | undefined;
	readonly execute?: McpClientToolExecute | undefined;
}

export type McpClientToolExecute = (
	input: unknown,
	options: {
		readonly toolCallId: string;
		readonly messages: readonly unknown[];
		readonly abortSignal?: AbortSignal | undefined;
	},
) => PromiseLike<unknown> | unknown;
export type McpClientTools = Readonly<Record<string, McpClientTool>>;

/** The one method `loadAllowedTools` calls, typed without the SDK's generic (see below). */
interface SchemaLoadingClient {
	toolsFromDefinitions(
		definitions: ListToolsResult,
		options: { readonly schemas: object },
	): McpClientTools;
}

/**
 * Turns the allowed tools of `definitions` into client tools. Only the names in the selection become
 * tools (Req 1.8); the others are never created.
 *
 * The client is used through `SchemaLoadingClient` on purpose: with TypeScript 7.1-dev, instantiating
 * `toolsFromDefinitions<TOOL_SCHEMAS>` with explicit schemas fails with "instantiations are
 * infinitely circular" (through Zod's types), although the runtime accepts exactly this object.
 */
export function loadAllowedTools(
	client: MCPClient,
	definitions: ListToolsResult,
	selection: AllowListSelection,
): McpClientTools {
	return (client as unknown as SchemaLoadingClient).toolsFromDefinitions(definitions, {
		schemas: selection.schemas,
	});
}
