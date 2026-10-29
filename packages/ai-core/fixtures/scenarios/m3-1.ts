import { compareUserText } from "../../src/mcp/chat";
import { defineScenario, type ScenarioDefinition } from "../../src/mock/scenario";

// Mock responses for module 3-1 (ACI and MCP). `/api/mcp/chat` lists the allowed root and reads its
// first entry; reading a path outside the root ends the run with the fatal error; the comparison runs
// the same task twice, once with one high-level tool and once with two low-level tools. Every turn
// names the user text, so none of them answers a turn of another scenario.

/** Tasks that the scenarios below answer; the UI offers them as input examples in `mock`. */
export const M3_1_SAMPLE_TASKS = Object.freeze({
	listAndRead: "許可ルートのファイルを一覧して、いちばん上のファイルの内容を教えてください。",
	outsideRoot: "許可ルートの外にある /etc/hosts を読んで、内容を教えてください。",
});

const HIGH_LEVEL = compareUserText("list-and-read", "highLevel");
const LOW_LEVEL = compareUserText("list-and-read", "lowLevel");

export const M3_1_SCENARIOS: readonly ScenarioDefinition[] = [
	defineScenario({
		id: "m3-1/mcp-chat/list-and-read",
		turns: [
			{
				match: {
					purpose: "chat",
					lastUserTextIncludes: M3_1_SAMPLE_TASKS.listAndRead,
					stepIndex: 0,
				},
				respond: {
					toolCalls: [{ toolName: "listFiles", input: {} }],
					usage: { inputTokens: 320, outputTokens: 24 },
				},
			},
			{
				match: {
					purpose: "chat",
					lastUserTextIncludes: M3_1_SAMPLE_TASKS.listAndRead,
					stepIndex: 1,
					toolResultFor: "listFiles",
				},
				respond: {
					toolCalls: [{ toolName: "readFile", input: { index: 0 } }],
					usage: { inputTokens: 460, outputTokens: 24 },
				},
			},
			{
				match: {
					purpose: "chat",
					lastUserTextIncludes: M3_1_SAMPLE_TASKS.listAndRead,
					stepIndex: 2,
					toolResultFor: "readFile",
				},
				respond: {
					text: "一覧の先頭のファイルを読みました。内容は上のツールの結果のとおりです。",
					usage: { inputTokens: 640, outputTokens: 40 },
				},
			},
		],
	}),
	defineScenario({
		id: "m3-1/mcp-chat/outside-root",
		turns: [
			{
				match: {
					purpose: "chat",
					lastUserTextIncludes: M3_1_SAMPLE_TASKS.outsideRoot,
					stepIndex: 0,
				},
				respond: {
					toolCalls: [{ toolName: "readFile", input: { path: "/etc/hosts" } }],
					usage: { inputTokens: 310, outputTokens: 26 },
				},
			},
		],
	}),
	defineScenario({
		id: "m3-1/mcp-compare/high-level",
		turns: [
			{
				match: { purpose: "chat", lastUserTextIncludes: HIGH_LEVEL, stepIndex: 0 },
				respond: {
					toolCalls: [{ toolName: "findAndReadFiles", input: { query: "README", maxFiles: 1 } }],
					usage: { inputTokens: 300, outputTokens: 30 },
				},
			},
			{
				match: {
					purpose: "chat",
					lastUserTextIncludes: HIGH_LEVEL,
					stepIndex: 1,
					toolResultFor: "findAndReadFiles",
				},
				respond: {
					text: "README の内容を読みました。許可ルートの使い方が書かれています。",
					usage: { inputTokens: 520, outputTokens: 40 },
				},
			},
		],
	}),
	defineScenario({
		id: "m3-1/mcp-compare/low-level",
		turns: [
			{
				match: { purpose: "chat", lastUserTextIncludes: LOW_LEVEL, stepIndex: 0 },
				respond: {
					toolCalls: [{ toolName: "searchFiles", input: { query: "README" } }],
					usage: { inputTokens: 300, outputTokens: 24 },
				},
			},
			{
				match: {
					purpose: "chat",
					lastUserTextIncludes: LOW_LEVEL,
					stepIndex: 1,
					toolResultFor: "searchFiles",
				},
				respond: {
					toolCalls: [{ toolName: "readFile", input: { index: 0 } }],
					usage: { inputTokens: 450, outputTokens: 24 },
				},
			},
			{
				match: {
					purpose: "chat",
					lastUserTextIncludes: LOW_LEVEL,
					stepIndex: 2,
					toolResultFor: "readFile",
				},
				respond: {
					text: "README の内容を読みました。許可ルートの使い方が書かれています。",
					usage: { inputTokens: 640, outputTokens: 40 },
				},
			},
		],
	}),
];
