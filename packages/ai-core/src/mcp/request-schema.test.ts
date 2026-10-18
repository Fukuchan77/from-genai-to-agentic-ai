import { describe, expect, it } from "vitest";
import { MODEL_CATALOG } from "../models/catalog";
import {
	MCP_REQUEST_LIMITS,
	mcpChatRequestSchema,
	mcpCompareRequestSchema,
} from "./request-schema";

const MODEL_ID = Object.keys(MODEL_CATALOG)[0] as string;

function chatBody(extra: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id: "chat-1",
		messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "一覧してください" }] }],
		...extra,
	};
}

function issuesOf(
	schema: typeof mcpChatRequestSchema | typeof mcpCompareRequestSchema,
	body: unknown,
) {
	const result = schema.safeParse(body);
	expect(result.success).toBe(false);
	return result.error?.issues ?? [];
}

describe("mcpChatRequestSchema", () => {
	it("accepts the body useChat sends with only id and messages", () => {
		expect(mcpChatRequestSchema.parse(chatBody())).toEqual(chatBody());
	});

	it("accepts a model, an allow-list, the think switch and the transport fields", () => {
		const body = chatBody({
			modelId: MODEL_ID,
			allow: { files: ["listFiles", "readFile"], github: [] },
			think: false,
			trigger: "submit-message",
			messageId: "m1",
		});
		expect(mcpChatRequestSchema.parse(body)).toEqual(body);
	});

	it("rejects a persona, an unknown field and a system message", () => {
		for (const extra of [{ personaId: "assistant" }, { tools: ["x"] }, { system: "x" }]) {
			expect(mcpChatRequestSchema.safeParse(chatBody(extra)).success).toBe(false);
		}
		const withSystem = chatBody({
			messages: [{ id: "m1", role: "system", parts: [{ type: "text", text: "x" }] }],
		});
		expect(mcpChatRequestSchema.safeParse(withSystem).success).toBe(false);
	});

	it("rejects a model that is not in the catalog", () => {
		expect(
			issuesOf(mcpChatRequestSchema, chatBody({ modelId: "not-a-model" })).length,
		).toBeGreaterThan(0);
	});

	it("rejects an empty message list", () => {
		expect(mcpChatRequestSchema.safeParse(chatBody({ messages: [] })).success).toBe(false);
	});

	it.each([
		["an allow-list that is not an object", { allow: ["listFiles"] }],
		["tool names that are not an array", { allow: { files: "listFiles" } }],
		["a tool name that is not a string", { allow: { files: [1] } }],
		["an empty tool name", { allow: { files: [""] } }],
		[
			"a tool name over the length limit",
			{ allow: { files: ["x".repeat(MCP_REQUEST_LIMITS.toolNameMaxLength + 1)] } },
		],
		[
			"too many tool names for one server",
			{
				allow: {
					files: Array.from(
						{ length: MCP_REQUEST_LIMITS.maxToolsPerServer + 1 },
						(_, i) => `t${i}`,
					),
				},
			},
		],
		["an empty server id", { allow: { "": [] } }],
		[
			"a server id over the length limit",
			{ allow: { ["s".repeat(MCP_REQUEST_LIMITS.serverIdMaxLength + 1)]: [] } },
		],
		[
			"too many servers",
			{
				allow: Object.fromEntries(
					Array.from({ length: MCP_REQUEST_LIMITS.maxServers + 1 }, (_, i) => [`s${i}`, []]),
				),
			},
		],
		["think that is not a boolean", { think: "yes" }],
	])("rejects %s", (_label, extra) => {
		expect(mcpChatRequestSchema.safeParse(chatBody(extra)).success).toBe(false);
	});

	it("accepts the largest allow-list the limits allow", () => {
		const allow = Object.fromEntries(
			Array.from({ length: MCP_REQUEST_LIMITS.maxServers }, (_, i) => [
				`s${i}`,
				Array.from({ length: MCP_REQUEST_LIMITS.maxToolsPerServer }, (_, j) => `t${j}`),
			]),
		);
		expect(mcpChatRequestSchema.safeParse(chatBody({ allow })).success).toBe(true);
	});

	it("does not let an allow-list key reach the prototype", () => {
		const parsed = mcpChatRequestSchema.parse(
			chatBody({ allow: JSON.parse('{"__proto__":["x"]}') }),
		);
		expect(Object.getPrototypeOf(parsed.allow ?? {})).toBe(Object.prototype);
		expect(({} as Record<string, unknown>).x).toBeUndefined();
	});
});

describe("mcpCompareRequestSchema", () => {
	it("accepts the one task, with or without a model", () => {
		expect(mcpCompareRequestSchema.parse({ task: "list-and-read" })).toEqual({
			task: "list-and-read",
		});
		expect(mcpCompareRequestSchema.parse({ task: "list-and-read", modelId: MODEL_ID })).toEqual({
			task: "list-and-read",
			modelId: MODEL_ID,
		});
	});

	it("requires the task and rejects another one", () => {
		expect(mcpCompareRequestSchema.safeParse({}).success).toBe(false);
		expect(mcpCompareRequestSchema.safeParse({ task: "delete-everything" }).success).toBe(false);
	});

	it("rejects unknown fields", () => {
		expect(mcpCompareRequestSchema.safeParse({ task: "list-and-read", prompt: "x" }).success).toBe(
			false,
		);
	});
});
