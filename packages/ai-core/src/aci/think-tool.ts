import { z } from "zod";
import { defineAciTool } from "./define-tool";
import type { AciTool } from "./types";

export const THINK_TOOL_NAME = "think";

const THINK_DESCRIPTION = [
	"次の行動の前に、考えを整理するための場所。外部の情報は取得せず、何も変更しない。",
	"使うとき: ツールの結果を受けて方針を決め直すとき、複数の条件や制約を確かめてから行動するとき。",
	"使わないとき: 外部の情報が必要なとき（検索や取得のツールを使う）、単純で迷いのない操作のとき。",
	'例: thought="結果が 2 件ある。条件に合う方を選んでから回答する。"',
].join("\n");

const THINK_ACKNOWLEDGEMENT = "考えを受け取りました。計画に沿って、次の行動に進んでください。";

/**
 * The "think" tool (Req 1.14): a scratch pad that stores nothing. The thought is never kept or
 * returned; `onCall` only hears that the tool was called (for a run's tool-call count). Returns
 * `undefined` when disabled, so it is simply left out of the tool list.
 */
export function createThinkTool(options: {
	readonly enabled: boolean;
	readonly onCall?: (() => void) | undefined;
}): AciTool<{ thought: string }, string> | undefined {
	if (!options.enabled) return undefined;
	return defineAciTool({
		name: THINK_TOOL_NAME,
		description: THINK_DESCRIPTION,
		inputSchema: z.object({
			thought: z.string().min(1).max(2_000).describe("次の行動の前に整理したい考え（短い文章）"),
		}),
		risk: "read-only",
		execute: () => {
			options.onCall?.();
			return THINK_ACKNOWLEDGEMENT;
		},
	});
}
