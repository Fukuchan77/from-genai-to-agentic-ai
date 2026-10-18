import { type AnyAciTool, defineAciTool, FatalToolError, ToolExecutionError } from "../aci";
import { DEFAULT_TOOLS } from "../config/defaults";
import {
	createFileOperations,
	FatalFileError,
	type FileOperation,
	FileToolError,
} from "./operations";

export {
	DEFAULT_CONCISE_MAX_CHARACTERS,
	FILE_TOOL_NAMES,
	MAX_READ_BYTES,
} from "./operations";

export interface CreateFileToolsOptions {
	/** The allowed root. Resolved to a real path on first use; a missing root is a fatal config error. */
	readonly root: string;
	/** Upper bound of a `concise` response in characters. Defaults to `DEFAULT_TOOLS.conciseMaxCharacters`. */
	readonly conciseMaxCharacters?: number | undefined;
}

/** Maps the neutral file error to the ACI error types the tool runtime classifies (C2). */
function toAciError(error: unknown): unknown {
	if (!(error instanceof FileToolError)) return error;
	if (error instanceof FatalFileError) return new FatalToolError(error.code, error.summary);
	return new ToolExecutionError(error.summary, {
		...(error.nextAction === undefined ? {} : { nextAction: error.nextAction }),
	});
}

function toAciTool(operation: FileOperation): AnyAciTool {
	return defineAciTool({
		name: operation.name,
		description: operation.description,
		inputSchema: operation.inputSchema,
		risk: operation.risk,
		execute: async (input, { abortSignal }) => {
			try {
				return await operation.run(input, abortSignal);
			} catch (error) {
				throw toAciError(error);
			}
		},
	});
}

/**
 * The file tools of module 3-1 as ACI tools (Req 1.4–1.6, 1.12, 1.13). A relative path or a missing
 * file is a recoverable error with a fix guide; a path that leaves the allowed root is fatal and trips
 * the run's latch (CL-1, C2). `writeFile` (`write`) and `deleteFile` (`destructive`) are defined for the
 * MCP server to expose; `buildToolSet` refuses them for an agent until the approval gate exists (Req 1.17).
 */
export function createFileTools(options: CreateFileToolsOptions): readonly AnyAciTool[] {
	return createFileOperations({
		root: options.root,
		conciseMaxCharacters: options.conciseMaxCharacters ?? DEFAULT_TOOLS.conciseMaxCharacters,
	}).map(toAciTool);
}
