import { createMCPClient, type MCPTransport } from "@ai-sdk/mcp";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it } from "vitest";
import { createFilesServer } from "../files/server";
import { buildAllowedSchemas, loadAllowedTools } from "./allow-list";

const definitions = [
	{
		name: "alpha",
		description: "A",
		inputSchema: { type: "object" as const, properties: { x: {} } },
	},
	{ name: "beta", description: "B", inputSchema: { type: "object" as const } },
	{ name: "gamma", description: "C", inputSchema: { type: "object" as const, properties: {} } },
];

describe("buildAllowedSchemas", () => {
	it("selects only the allowed tools the server exposes, in the server's order", () => {
		const selection = buildAllowedSchemas(definitions, ["gamma", "alpha"]);
		expect(selection.loaded).toEqual(["alpha", "gamma"]);
		expect(Object.keys(selection.schemas)).toEqual(["alpha", "gamma"]);
		expect(selection.skipped).toEqual(["beta"]);
		expect(selection.unknown).toEqual([]);
	});

	it("loads nothing for an empty allow-list", () => {
		const selection = buildAllowedSchemas(definitions, []);
		expect(selection.loaded).toEqual([]);
		expect(Object.keys(selection.schemas)).toEqual([]);
		expect(selection.skipped).toEqual(["alpha", "beta", "gamma"]);
	});

	it("reports an allowed name the server does not expose instead of ignoring it", () => {
		const selection = buildAllowedSchemas(definitions, ["alpha", "deleteEverything"]);
		expect(selection.loaded).toEqual(["alpha"]);
		expect(selection.unknown).toEqual(["deleteEverything"]);
	});

	it("matches names exactly, with no prefix, case or whitespace tolerance", () => {
		const selection = buildAllowedSchemas(definitions, ["Alpha", "alph", " alpha", "alpha "]);
		expect(selection.loaded).toEqual([]);
		expect(selection.unknown).toEqual(["Alpha", "alph", " alpha", "alpha "]);
	});

	it("counts a name listed twice once", () => {
		const selection = buildAllowedSchemas(definitions, ["alpha", "alpha"]);
		expect(selection.loaded).toEqual(["alpha"]);
	});

	it("treats a hostile tool name as a plain key and does not touch the prototype", () => {
		const hostile = [
			{ name: "__proto__", inputSchema: { type: "object" as const } },
			{ name: "constructor", inputSchema: { type: "object" as const } },
		];
		const none = buildAllowedSchemas(hostile, ["alpha"]);
		expect(none.loaded).toEqual([]);
		const some = buildAllowedSchemas(hostile, ["constructor"]);
		expect(some.loaded).toEqual(["constructor"]);
		expect(Object.getPrototypeOf(some.schemas)).toBeNull();
		expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
	});

	it("gives each loaded tool the server's own input schema, closed to unknown properties", () => {
		const selection = buildAllowedSchemas(definitions, ["alpha", "beta"]);
		expect(selection.schemas.alpha?.inputSchema.jsonSchema).toEqual({
			type: "object",
			properties: { x: {} },
			additionalProperties: false,
		});
		expect(selection.schemas.beta?.inputSchema.jsonSchema).toEqual({
			type: "object",
			properties: {},
			additionalProperties: false,
		});
	});
});

describe("buildAllowedSchemas with a real client (Req 1.8)", () => {
	const closers: (() => Promise<void>)[] = [];

	afterEach(async () => {
		for (const close of closers.splice(0)) await close();
	});

	async function connectToFilesServer() {
		const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
		const server = createFilesServer({ root: import.meta.dirname });
		await server.connect(serverSide);
		const client = await createMCPClient({ transport: clientSide as unknown as MCPTransport });
		closers.push(async () => {
			await client.close();
			await server.close();
		});
		return client;
	}

	it("makes the client load only the allowed tools, and never the others", async () => {
		const client = await connectToFilesServer();
		const listed = await client.listTools();
		const selection = buildAllowedSchemas(listed.tools, ["listFiles", "readFile"]);
		const tools = loadAllowedTools(client, listed, selection);
		expect(Object.keys(tools).sort()).toEqual(["listFiles", "readFile"]);
		expect(selection.skipped).toEqual([
			"searchFiles",
			"findAndReadFiles",
			"writeFile",
			"deleteFile",
		]);
	});

	it("loads no tool at all for an empty allow-list", async () => {
		const client = await connectToFilesServer();
		const listed = await client.listTools();
		const tools = loadAllowedTools(client, listed, buildAllowedSchemas(listed.tools, []));
		expect(Object.keys(tools)).toEqual([]);
	});
});
