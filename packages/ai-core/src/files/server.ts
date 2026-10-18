// Loaded by `stdio.ts` under Node's type stripping (CL-3): relative imports carry the `.ts` extension
// and reach only dependency-free modules. Do not import `../aci` or `../config` here.
import { realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/server";
import { McpServer } from "@modelcontextprotocol/server";
import type { ToolRisk } from "../aci/types.ts";
import {
	type CreateFileOperationsOptions,
	createFileOperations,
	FatalFileError,
	type FileOperation,
	FileToolError,
} from "./operations.ts";

/** The key under `_meta` of a failed tool result that carries `{ kind, code }` (CL-24). */
export const FILES_ERROR_META_KEY = "agentic-ai/error";

export const FILES_SERVER_NAME = "agentic-ai-files";

/** The time one tool call may take on the server. The client applies its own limit as well. */
const SERVER_TOOL_TIMEOUT_MS = 30_000;

export type FilesServerOptions = CreateFileOperationsOptions;

/**
 * `readOnlyHint` is true only for read-only tools; `writeFile` and `deleteFile` say `false` so a
 * client that trusts annotations still keeps them out of a read-only agent (Req 1.17, ADR-7).
 */
function annotationsFor(risk: ToolRisk): ToolAnnotations {
	if (risk === "read-only") return { readOnlyHint: true };
	return { readOnlyHint: false, destructiveHint: risk === "destructive" };
}

function failureResult(error: FileToolError): CallToolResult {
	if (error instanceof FatalFileError) {
		return {
			isError: true,
			content: [{ type: "text", text: error.summary }],
			_meta: { [FILES_ERROR_META_KEY]: { kind: "fatal", code: error.code } },
		};
	}
	const text =
		error.nextAction === undefined
			? error.summary
			: `${error.summary}\n次の対応: ${error.nextAction}`;
	return {
		isError: true,
		content: [{ type: "text", text }],
		_meta: { [FILES_ERROR_META_KEY]: { kind: "recoverable" } },
	};
}

/**
 * A failure is a result with `isError: true`, never an exception, so the client can tell a path that
 * leaves the root (`kind: "fatal"`) from a mistake it can fix (CL-24). An unexpected error is reported
 * by name only: its message may hold a path or other details.
 */
async function callOperation(
	operation: FileOperation,
	args: unknown,
	cancelled: AbortSignal,
): Promise<CallToolResult> {
	try {
		const text = await operation.run(
			args,
			AbortSignal.any([cancelled, AbortSignal.timeout(SERVER_TOOL_TIMEOUT_MS)]),
		);
		return { content: [{ type: "text", text }] };
	} catch (error) {
		if (error instanceof FileToolError) return failureResult(error);
		const name = error instanceof Error ? error.name : typeof error;
		return failureResult(
			new FileToolError(
				"recoverable",
				`ツール「${operation.name}」の実行に失敗しました（${name}）。`,
				"入力を見直して再試行してください。",
			),
		);
	}
}

/**
 * Serves the file operations of module 3-1 over MCP (Req 1.7). Every tool is listed, including
 * `writeFile` and `deleteFile`, each with an annotation that says what it is; the platform's own
 * client decides which of them an agent may load.
 */
export function createFilesServer(options: FilesServerOptions): McpServer {
	const server = new McpServer({ name: FILES_SERVER_NAME, version: "1.0.0" });
	for (const operation of createFileOperations(options)) {
		server.registerTool(
			operation.name,
			{
				description: operation.description,
				inputSchema: operation.inputSchema,
				annotations: annotationsFor(operation.risk),
			},
			(args, ctx) => callOperation(operation, args, ctx.mcpReq.signal),
		);
	}
	return server;
}

/**
 * The real path of the allowed root the server was asked to serve, or the reason it cannot start.
 * It never creates the directory: a missing root is a configuration mistake to report, not a place
 * to invent (the learner may have mistyped `MCP_FS_ROOT`).
 */
export async function resolveServerRoot(
	requested: string,
): Promise<
	{ readonly ok: true; readonly root: string } | { readonly ok: false; readonly message: string }
> {
	const absolute = resolve(requested);
	try {
		const root = await realpath(absolute);
		if (!(await stat(root)).isDirectory()) throw new Error("not a directory");
		return { ok: true, root };
	} catch {
		return {
			ok: false,
			message: `MCP_FS_ROOT（${absolute}）のディレクトリが存在しません。作成せずに終了します。環境変数 MCP_FS_ROOT を確認してください。`,
		};
	}
}
