import type { McpCompareTaskId } from "./request-schema";

/**
 * The system prompt of `POST /api/mcp/chat`. It tells the agent what the tools are for and how a
 * refusal looks; it names no tool, because the loaded tools depend on the allow-list.
 */
export const MCP_CHAT_INSTRUCTIONS = [
	"あなたは、MCP サーバーのツールで許可ルート内のファイルや GitHub のリポジトリを調べるアシスタントです。",
	"- 答えに必要な情報は、ツールで確かめてから日本語で簡潔に答えます。推測で埋めません。",
	"- ファイルのパスは許可ルートの内側の絶対パスで指定します。場所が分からないときは、先に一覧や検索のツールを使います。",
	"- ツールが修正の方法を返したら、それに従って入力を直し、もう一度呼びます。",
	"- 許可されていない操作でツールが停止を伝えたときは、ツールを呼び出さず、起きたことを説明して終えます。",
	"- ファイルの書き込みや削除はできません。頼まれたときは、できないことを伝えます。",
].join("\n");

/** What each compared run is asked to do (Req 1.12). Both runs get the same sentence. */
export const MCP_COMPARE_TASKS: Readonly<Record<McpCompareTaskId, string>> = Object.freeze({
	"list-and-read":
		"許可ルートの中から「README」を含むファイルを探して、その内容を読み、要点を 1 文で答えてください。",
});

/** The two ways of doing the same task: one high-level tool, or low-level tools in combination. */
export const MCP_COMPARE_APPROACHES = ["highLevel", "lowLevel"] as const;
export type McpCompareApproach = (typeof MCP_COMPARE_APPROACHES)[number];

/** The file tools each approach may use. */
export const MCP_COMPARE_TOOLS: Readonly<Record<McpCompareApproach, readonly string[]>> =
	Object.freeze({
		highLevel: ["findAndReadFiles"],
		lowLevel: ["searchFiles", "readFile"],
	});

/**
 * The user message of one compared run: the shared task and a run marker. The marker lets the `mock`
 * scenarios give each approach its own fixed steps; a real model sees it as a harmless label.
 */
export function compareUserText(task: McpCompareTaskId, approach: McpCompareApproach): string {
	return `${MCP_COMPARE_TASKS[task]}\n[run:${approach}]`;
}
