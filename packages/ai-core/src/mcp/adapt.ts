import { z } from "zod";
import {
	type AnyAciTool,
	checkJsonSchemaDescription,
	defineAciTool,
	FATAL_ERROR_CODES,
	type FatalErrorCode,
	FatalToolError,
	type JsonSchemaNode,
	ToolExecutionError,
	type ToolRisk,
} from "../aci";
import { ConfigError } from "../config/load";
import type { McpClientTool } from "./allow-list";

/** The key under `_meta` of a failed tool result that carries `{ kind, code }` (CL-24). */
export const MCP_ERROR_META_KEY = "agentic-ai/error";

/** The most characters of one tool result the model receives. */
export const MAX_MCP_OUTPUT_CHARACTERS = 20_000;

const GENERIC_NEXT_ACTION = "入力を見直して再試行するか、ツールを使わずに回答してください。";
const EMPTY_RESULT = "（結果は空でした）";
const MAX_FIX_GUIDE_CHARACTERS = 800;

export type LearnerMessageFor = (code: FatalErrorCode) => string | undefined;

export type McpToolClassification =
	| { readonly ok: true; readonly output: string }
	| {
			readonly ok: false;
			readonly kind: "recoverable";
			readonly summary: string;
			readonly nextAction: string;
	  }
	| { readonly ok: false; readonly kind: "fatal"; readonly error: FatalToolError };

export interface ClassifyContext {
	readonly serverId: string;
	readonly toolName: string;
	/** True only for the platform's own server: its `_meta` error kind and code are believed. */
	readonly trustErrorMeta: boolean;
	/** Builds the learner-facing text of a fatal error from the client's configuration. */
	readonly learnerMessageFor?: LearnerMessageFor | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function truncate(text: string, limit: number): string {
	const characters = Array.from(text);
	if (characters.length <= limit) return text;
	return `${characters.slice(0, limit).join("")}\n（残り ${characters.length - limit} 文字を省略しました。）`;
}

function textOf(result: Record<string, unknown>): string {
	const content = Array.isArray(result.content) ? result.content : [];
	const parts = content.flatMap((part): string[] => {
		if (!isRecord(part)) return [];
		if (part.type === "text" && typeof part.text === "string") return [part.text];
		return [`（${typeof part.type === "string" ? part.type : "不明な内容"} は省略しました）`];
	});
	if (parts.length > 0) return parts.join("\n");
	if (result.structuredContent !== undefined) return JSON.stringify(result.structuredContent);
	return EMPTY_RESULT;
}

function fatalMeta(result: Record<string, unknown>): FatalErrorCode | undefined {
	const meta = isRecord(result._meta) ? result._meta[MCP_ERROR_META_KEY] : undefined;
	if (!isRecord(meta) || meta.kind !== "fatal") return undefined;
	return (FATAL_ERROR_CODES as readonly unknown[]).includes(meta.code)
		? (meta.code as FatalErrorCode)
		: undefined;
}

function recoverableMeta(result: Record<string, unknown>): boolean {
	const meta = isRecord(result._meta) ? result._meta[MCP_ERROR_META_KEY] : undefined;
	return isRecord(meta) && meta.kind === "recoverable";
}

/**
 * Decides what a tool result means (CL-24). Only a server the platform trusts can end the run, and
 * only with a code from the closed vocabulary; the learner's message comes from the client's own
 * configuration. Nothing of an untrusted server's text reaches a message.
 */
export function classifyMcpToolResult(
	result: unknown,
	context: ClassifyContext,
): McpToolClassification {
	if (!isRecord(result)) {
		return {
			ok: false,
			kind: "recoverable",
			summary: `サーバー「${context.serverId}」の応答の形式が正しくありません。`,
			nextAction: GENERIC_NEXT_ACTION,
		};
	}
	if (result.isError !== true) {
		return { ok: true, output: truncate(textOf(result), MAX_MCP_OUTPUT_CHARACTERS) };
	}
	if (context.trustErrorMeta) {
		const code = fatalMeta(result);
		if (code !== undefined) {
			const message =
				context.learnerMessageFor?.(code) ??
				`サーバー「${context.serverId}」の操作が許可されず、この実行を終了します（${code}）。`;
			return { ok: false, kind: "fatal", error: new FatalToolError(code, message) };
		}
	}
	// A trusted server writes its own fix guide (summary and next action); any other text is not passed on.
	const guide =
		context.trustErrorMeta && recoverableMeta(result)
			? truncate(textOf(result), MAX_FIX_GUIDE_CHARACTERS)
			: GENERIC_NEXT_ACTION;
	return {
		ok: false,
		kind: "recoverable",
		summary: `ツール「${context.toolName}」がサーバー「${context.serverId}」でエラーになりました。`,
		nextAction: guide,
	};
}

export interface AdaptMcpToolOptions {
	readonly serverId: string;
	readonly risk: ToolRisk;
	/** The effective description: the configured override, or else the server's own (CL-25). */
	readonly description: string;
	readonly trustErrorMeta: boolean;
	readonly learnerMessageFor?: LearnerMessageFor | undefined;
	/**
	 * Called with an error the transport raised while calling the tool (a closed connection, say).
	 * It may return the error to throw instead; `undefined` keeps the original.
	 */
	readonly onCallError?: ((error: unknown) => unknown) | undefined;
}

export type AdaptedMcpTool =
	| { readonly ok: true; readonly tool: AnyAciTool }
	| { readonly ok: false; readonly reason: string };

function httpStatus(error: unknown): number | undefined {
	if (!isRecord(error) && !(error instanceof Error)) return undefined;
	const record = error as { status?: unknown; statusCode?: unknown };
	const status = record.statusCode ?? record.status;
	return typeof status === "number" ? status : undefined;
}

/**
 * Turns an MCP client tool into the same kind of tool `defineAciTool` makes, so `buildToolSet` and
 * the fatal latch treat it like any other (Req 1.1, 1.11, 1.16). A tool whose effective description
 * does not satisfy the CL-18 form is not adapted; `reason` says why (CL-25).
 */
export function adaptMcpTool(
	name: string,
	tool: McpClientTool,
	options: AdaptMcpToolOptions,
): AdaptedMcpTool {
	const schema = tool.inputSchema?.jsonSchema;
	if (!isRecord(schema) || typeof tool.execute !== "function") {
		return { ok: false, reason: "入力スキーマまたは実行関数を読み取れません。" };
	}
	const issues = checkJsonSchemaDescription(options.description, schema as JsonSchemaNode);
	if (issues.length > 0) {
		return {
			ok: false,
			reason: `説明文の形式が規約を満たしていません: ${issues.map((issue) => issue.message).join(" ")}`,
		};
	}
	const learnerMessageFor = (code: FatalErrorCode): string =>
		options.learnerMessageFor?.(code) ??
		`サーバー「${options.serverId}」の操作が失敗し、この実行を終了します（${code}）。`;
	const execute = tool.execute;

	try {
		const aciTool = defineAciTool<Record<string, unknown>, string>({
			name,
			description: options.description,
			// Checks that the input is an object; the server validates its fields (it owns the schema).
			inputSchema: z.looseObject({}),
			externalInputSchema: schema as JsonSchemaNode,
			risk: options.risk,
			execute: async (input, { abortSignal, toolCallId }) => {
				let result: unknown;
				try {
					result = await execute(input, { toolCallId, messages: [], abortSignal });
				} catch (error) {
					// A stop by the learner or a time limit is the runtime's to handle, not a sign of a broken server.
					if (abortSignal.aborted) throw error;
					const status = httpStatus(error);
					if (status === 401 || status === 403) {
						throw new FatalToolError("auth-failed", learnerMessageFor("auth-failed"));
					}
					throw options.onCallError?.(error) ?? error;
				}
				const classified = classifyMcpToolResult(result, {
					serverId: options.serverId,
					toolName: name,
					trustErrorMeta: options.trustErrorMeta,
					learnerMessageFor,
				});
				if (classified.ok) return classified.output;
				if (classified.kind === "fatal") throw classified.error;
				throw new ToolExecutionError(classified.summary, { nextAction: classified.nextAction });
			},
		});
		return { ok: true, tool: aciTool };
	} catch (error) {
		if (error instanceof ConfigError) return { ok: false, reason: error.message };
		throw error;
	}
}
