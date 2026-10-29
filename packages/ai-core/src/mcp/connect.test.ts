import { mkdir, mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MCPTransport } from "@ai-sdk/mcp";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { buildToolSet, FatalLatch, type ToolOutcome } from "../aci";
import { ConfigError } from "../config/load";
import { createFilesServer, FILES_ERROR_META_KEY } from "../files/server";
import { createFakeClock } from "../ports/clock";
import { MCP_ERROR_META_KEY } from "./adapt";
import { connectMcpServers, isDisconnectError, type McpRegistry } from "./connect";
import { filesServerConfig } from "./github";
import type { McpServerConfig } from "./types";

const SECRET = "ghp_SECRET-token-for-tests";

interface FixtureTool {
	readonly name: string;
	readonly annotations?: Record<string, unknown> | undefined;
	readonly text?: string;
}

const formDescription = (summary: string): string =>
	[summary, "使うとき: テストで呼ぶとき。", "使わないとき: テスト以外。", "例: {}"].join("\n");

/** A server with the given tools, each taking `{ value?: string }` and answering with `text`. */
function fixtureServer(tools: readonly FixtureTool[]): McpServer {
	const server = new McpServer({ name: "fixture", version: "1.0.0" });
	for (const definition of tools) {
		server.registerTool(
			definition.name,
			{
				description: formDescription(`${definition.name} のテスト用ツール。`),
				inputSchema: z.object({ value: z.string().optional().describe("任意の値") }),
				...(definition.annotations === undefined
					? {}
					: { annotations: definition.annotations as never }),
			},
			() => ({ content: [{ type: "text", text: definition.text ?? `${definition.name} done` }] }),
		);
	}
	return server;
}

const READ_ONLY = { readOnlyHint: true };

function configFor(
	id: string,
	allow: readonly string[],
	extra: Partial<McpServerConfig> = {},
): McpServerConfig {
	return {
		id,
		transport: { kind: "stdio", command: "unused", args: [], env: {} },
		allow,
		trustErrorMeta: false,
		...extra,
	};
}

const closers: (() => Promise<void>)[] = [];
let registry: McpRegistry | undefined;

afterEach(async () => {
	await registry?.close();
	registry = undefined;
	for (const close of closers.splice(0)) await close();
});

/** Serves `servers` by id over in-memory transports instead of spawning or dialling anything. */
function transports(servers: Record<string, McpServer>) {
	return (config: McpServerConfig): MCPTransport | undefined => {
		const server = servers[config.id];
		if (!server) return undefined;
		const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
		void server.connect(serverSide);
		closers.push(() => server.close());
		return clientSide as unknown as MCPTransport;
	};
}

async function connect(
	configs: readonly McpServerConfig[],
	servers: Record<string, McpServer>,
	options: Parameters<typeof connectMcpServers>[1] = {},
): Promise<McpRegistry> {
	registry = await connectMcpServers(configs, { transportFor: transports(servers), ...options });
	return registry;
}

function statusOf(reg: McpRegistry, id: string) {
	const status = reg.status().find((candidate) => candidate.id === id);
	if (!status) throw new Error(`no status for ${id}`);
	return status;
}

async function runTool(
	tools: ReturnType<McpRegistry["toolsFor"]>,
	name: string,
	input: unknown,
	latch?: FatalLatch,
): Promise<ToolOutcome<unknown>> {
	const aciTool = tools.find((candidate) => candidate.name === name);
	if (!aciTool) throw new Error(`no tool ${name}`);
	const execute = aciTool.toTool({
		clock: createFakeClock(),
		toolTimeoutMs: 5_000,
		fatal: latch,
	}).execute;
	if (!execute) throw new Error("must be executable");
	return (await execute(input, {
		toolCallId: "call-1",
		messages: [],
		context: undefined,
	})) as ToolOutcome<unknown>;
}

describe("connectMcpServers", () => {
	it("connects to a server, lists its tools and returns the allowed read-only ones", async () => {
		const reg = await connect([configFor("fixture", ["alpha"])], {
			fixture: fixtureServer([
				{ name: "alpha", annotations: READ_ONLY },
				{ name: "beta", annotations: READ_ONLY },
			]),
		});
		const status = statusOf(reg, "fixture");
		expect(status.state).toBe("connected");
		expect(status.tools.map((tool) => [tool.name, tool.registered])).toEqual([
			["alpha", true],
			["beta", false],
		]);
		expect(status.tools[1]?.disabledReason).toContain("許可リスト");
		expect(reg.toolsFor("agent").map((tool) => tool.name)).toEqual(["alpha"]);
		const outcome = await runTool(reg.toolsFor("agent"), "alpha", {});
		expect(outcome).toEqual({ ok: true, data: "alpha done" });
	});

	it("records a failed connection without throwing, and keeps the other servers working", async () => {
		const reg = await connect([configFor("good", ["alpha"]), configFor("bad", ["x"])], {
			good: fixtureServer([{ name: "alpha", annotations: READ_ONLY }]),
		});
		expect(statusOf(reg, "good").state).toBe("connected");
		const bad = statusOf(reg, "bad");
		expect(bad.state).toBe("unavailable");
		expect(bad.reason).toBeTruthy();
		expect(bad.tools).toEqual([]);
		expect(reg.toolsFor("agent").map((tool) => tool.name)).toEqual(["alpha"]);
	});

	it("reports a transport that throws while starting as unavailable, by error name only", async () => {
		const reg = await connectMcpServers([configFor("down", ["x"])], {
			transportFor: () => {
				throw new TypeError(`cannot start with ${SECRET}`);
			},
		});
		const down = statusOf(reg, "down");
		expect(down.state).toBe("unavailable");
		expect(down.reason).toContain("TypeError");
		expect(JSON.stringify(reg.status())).not.toContain(SECRET);
		await reg.close();
	});

	it("reports an authentication failure (HTTP 401 / 403) at connection with its code and never the token", async () => {
		const failing: MCPTransport = {
			start: async () => {
				throw Object.assign(new Error(`HTTP 401 Bad credentials for ${SECRET}`), {
					statusCode: 401,
				});
			},
			send: async () => {},
			close: async () => {},
		};
		const reg = await connectMcpServers(
			[
				configFor("github", ["x"], {
					transport: {
						kind: "http",
						url: "https://example.invalid/mcp",
						headers: { Authorization: `Bearer ${SECRET}` },
					},
				}),
			],
			{ transportFor: () => failing },
		);
		const status = statusOf(reg, "github");
		expect(status.state).toBe("unavailable");
		expect(status.reason).toContain("auth-failed");
		expect(JSON.stringify(reg.status())).not.toContain(SECRET);
		await reg.close();
	});

	it("gives up on a server that does not answer within the connection time limit", async () => {
		const silent: MCPTransport = {
			start: async () => {},
			send: async () => {},
			close: async () => {},
		};
		const reg = await connectMcpServers([configFor("silent", ["x"])], {
			transportFor: () => silent,
			connectTimeoutMs: 50,
		});
		const status = statusOf(reg, "silent");
		expect(status.state).toBe("unavailable");
		expect(status.reason).toBeTruthy();
		await reg.close();
	});

	it("rejects when the caller aborts, after closing what it opened", async () => {
		const controller = new AbortController();
		controller.abort(new Error("stop"));
		await expect(
			connectMcpServers([configFor("fixture", ["alpha"])], {
				transportFor: transports({
					fixture: fixtureServer([{ name: "alpha", annotations: READ_ONLY }]),
				}),
				signal: controller.signal,
			}),
		).rejects.toThrow("stop");
	});

	it("rejects configurations with a duplicate server id", async () => {
		await expect(
			connectMcpServers([configFor("same", []), configFor("same", [])], {
				transportFor: () => undefined,
			}),
		).rejects.toThrow(ConfigError);
	});
});

describe("risk classes and the allow-list (Req 1.8, 1.16, 1.17)", () => {
	const tools: FixtureTool[] = [
		{ name: "reader", annotations: READ_ONLY },
		{ name: "writer", annotations: { readOnlyHint: false, destructiveHint: false } },
		{ name: "remover", annotations: { readOnlyHint: false, destructiveHint: true } },
		{ name: "silent" },
		{ name: "liar", annotations: { readOnlyHint: true, destructiveHint: true } },
	];
	const allowAll = ["reader", "writer", "remover", "silent", "liar", "ghost"];

	it("keeps write, destructive and unannotated tools out and says why", async () => {
		const reg = await connect([configFor("fixture", allowAll)], { fixture: fixtureServer(tools) });
		const byName = Object.fromEntries(
			statusOf(reg, "fixture").tools.map((tool) => [tool.name, tool]),
		);
		expect(byName.reader).toMatchObject({ risk: "read-only", registered: true });
		for (const name of ["writer", "remover", "silent", "liar"]) {
			expect(byName[name]).toMatchObject({ risk: "destructive", registered: false });
			expect(byName[name]?.disabledReason).toContain("read-only");
		}
		expect(reg.toolsFor("agent").map((tool) => tool.name)).toEqual(["reader"]);
	});

	it("lists an allowed name the server does not expose as not registered", async () => {
		const reg = await connect([configFor("fixture", allowAll)], { fixture: fixtureServer(tools) });
		expect(statusOf(reg, "fixture").tools.find((tool) => tool.name === "ghost")).toMatchObject({
			registered: false,
			disabledReason: expect.stringContaining("公開していません"),
		});
	});

	it("loads only what an agent's own allow-list names, never more than the configured one", async () => {
		const reg = await connect([configFor("fixture", ["alpha", "beta"])], {
			fixture: fixtureServer([
				{ name: "alpha", annotations: READ_ONLY },
				{ name: "beta", annotations: READ_ONLY },
				{ name: "gamma", annotations: READ_ONLY },
			]),
		});
		expect(
			reg.toolsFor("narrow", { allow: { fixture: ["beta"] } }).map((tool) => tool.name),
		).toEqual(["beta"]);
		expect(reg.toolsFor("none", { allow: { fixture: [] } })).toEqual([]);
		expect(() => reg.toolsFor("greedy", { allow: { fixture: ["gamma"] } })).toThrow(ConfigError);
		expect(() => reg.toolsFor("lost", { allow: { elsewhere: ["alpha"] } })).toThrow(ConfigError);
	});

	it("does not register a tool whose effective description breaks the CL-18 form, and says why", async () => {
		const server = new McpServer({ name: "plain", version: "1.0.0" });
		server.registerTool(
			"plain_tool",
			{ description: "Does a thing", inputSchema: z.object({}), annotations: READ_ONLY },
			() => ({ content: [{ type: "text", text: "x" }] }),
		);
		const reg = await connect([configFor("plain", ["plain_tool"])], { plain: server });
		const tool = statusOf(reg, "plain").tools[0];
		expect(tool).toMatchObject({ name: "plain_tool", registered: false });
		expect(tool?.disabledReason).toContain("説明文の形式");
		expect(reg.toolsFor("agent")).toEqual([]);
	});

	it("registers the same tool once the configuration overrides its description (CL-25)", async () => {
		const server = new McpServer({ name: "plain", version: "1.0.0" });
		server.registerTool(
			"plain_tool",
			{ description: "Does a thing", inputSchema: z.object({}), annotations: READ_ONLY },
			() => ({ content: [{ type: "text", text: "x" }] }),
		);
		const reg = await connect(
			[
				configFor("plain", ["plain_tool"], {
					descriptions: { plain_tool: formDescription("上書きの説明文。") },
				}),
			],
			{ plain: server },
		);
		expect(statusOf(reg, "plain").tools[0]).toMatchObject({ registered: true });
		expect(reg.toolsFor("agent")[0]?.description).toContain("上書きの説明文");
	});

	it("keeps the first of two servers' tools with the same name and records the clash", async () => {
		const reg = await connect([configFor("one", ["dup"]), configFor("two", ["dup"])], {
			one: fixtureServer([{ name: "dup", annotations: READ_ONLY, text: "from one" }]),
			two: fixtureServer([{ name: "dup", annotations: READ_ONLY, text: "from two" }]),
		});
		const named = reg.toolsFor("agent");
		expect(named).toHaveLength(1);
		expect(await runTool(named, "dup", {})).toEqual({ ok: true, data: "from one" });
		expect(statusOf(reg, "two").tools[0]?.disabledReason).toContain("同名");
	});
});

describe("the 20-tool limit (Req 1.15)", () => {
	const names = (count: number) => Array.from({ length: count }, (_, index) => `tool${index}`);
	const toolsFor = (count: number): FixtureTool[] =>
		names(count).map((name) => ({ name, annotations: READ_ONLY }));

	it("accepts 20 tools", async () => {
		const reg = await connect([configFor("many", names(20))], {
			many: fixtureServer(toolsFor(20)),
		});
		expect(reg.toolsFor("agent")).toHaveLength(20);
	});

	it("refuses a configuration of 21 tools when the registry is built, instead of loading some of them", async () => {
		await expect(
			connect([configFor("many", names(21))], { many: fixtureServer(toolsFor(21)) }),
		).rejects.toThrow(/20/u);
		await expect(
			connect([configFor("many", names(21))], { many: fixtureServer(toolsFor(21)) }),
		).rejects.toThrow(ConfigError);
	});

	it("counts the tools the agent already has", async () => {
		const reg = await connect([configFor("many", names(20))], {
			many: fixtureServer(toolsFor(20)),
		});
		expect(() => reg.toolsFor("agent", { reservedTools: 1 })).toThrow(ConfigError);
		expect(reg.toolsFor("agent", { allow: { many: names(19) }, reservedTools: 1 })).toHaveLength(
			19,
		);
	});

	it("counts the tools of all servers together", async () => {
		await expect(
			connect(
				[
					configFor("a", names(11)),
					configFor(
						"b",
						names(11).map((name) => `b-${name}`),
					),
				],
				{
					a: fixtureServer(toolsFor(11)),
					b: fixtureServer(toolsFor(11).map((t) => ({ ...t, name: `b-${t.name}` }))),
				},
			),
		).rejects.toThrow(ConfigError);
	});
});

describe("a server that disconnects while the agent runs (Req 1.10)", () => {
	it("tells the model the server's name and cause, marks the server unavailable and drops its tools", async () => {
		const server = fixtureServer([{ name: "alpha", annotations: READ_ONLY }]);
		const reg = await connect([configFor("flaky", ["alpha"])], { flaky: server });
		const tools = reg.toolsFor("agent");
		expect(await runTool(tools, "alpha", {})).toEqual({ ok: true, data: "alpha done" });

		await server.close();
		const outcome = await runTool(tools, "alpha", {});
		if (outcome.ok) throw new Error("expected a failure after the disconnect");
		expect(outcome.failure.kind).toBe("recoverable");
		expect(outcome.failure.summary).toContain("flaky");
		expect(outcome.failure.summary).toContain("切断");
		expect(outcome.failure.nextAction).toContain("flaky");

		const status = statusOf(reg, "flaky");
		expect(status.state).toBe("unavailable");
		expect(status.reason).toContain("flaky");
		expect(status.tools.every((tool) => !tool.registered)).toBe(true);
		expect(reg.toolsFor("later")).toEqual([]);
	});

	it("shows a server as unavailable once the client reports a terminal transport error, without a call", async () => {
		const server = fixtureServer([{ name: "alpha", annotations: READ_ONLY }]);
		let transport: MCPTransport | undefined;
		registry = await connectMcpServers([configFor("quiet", ["alpha"])], {
			transportFor: (config) => {
				transport = transports({ quiet: server })(config);
				return transport;
			},
		});
		expect(statusOf(registry, "quiet").state).toBe("connected");

		transport?.onerror?.(
			Object.assign(
				new Error("MCP HTTP Transport Error: Maximum reconnection attempts (2) exceeded."),
				{
					name: "MCPClientError",
				},
			),
		);

		const status = statusOf(registry, "quiet");
		expect(status.state).toBe("unavailable");
		expect(status.reason).toContain("quiet");
		expect(status.reason).not.toContain("Maximum");
	});

	it("keeps a server connected when an unrelated transport error is reported", async () => {
		let transport: MCPTransport | undefined;
		registry = await connectMcpServers([configFor("steady", ["alpha"])], {
			transportFor: (config) => {
				transport = transports({
					steady: fixtureServer([{ name: "alpha", annotations: READ_ONLY }]),
				})(config);
				return transport;
			},
		});

		transport?.onerror?.(new Error("secret detail ghp_SECRET"));

		expect(statusOf(registry, "steady").state).toBe("connected");
	});

	it("does not mark a server unavailable because the caller aborted one call", async () => {
		const reg = await connect([configFor("steady", ["alpha"])], {
			steady: fixtureServer([{ name: "alpha", annotations: READ_ONLY }]),
		});
		const tools = reg.toolsFor("agent");
		const controller = new AbortController();
		controller.abort(new Error("learner stopped"));
		const aciTool = tools[0];
		const execute = aciTool?.toTool({ clock: createFakeClock(), toolTimeoutMs: 1_000 }).execute;
		await expect(
			execute?.(
				{},
				{ toolCallId: "c", messages: [], context: undefined, abortSignal: controller.signal },
			),
		).rejects.toThrow("learner stopped");
		expect(statusOf(reg, "steady").state).toBe("connected");
	});
});

describe("the platform's own file server over MCP (CL-24)", () => {
	let sandbox: string;
	let root: string;
	let outside: string;

	beforeAll(async () => {
		sandbox = await realpath(await mkdtemp(join(tmpdir(), "mcp-connect-")));
		root = join(sandbox, "ws");
		outside = join(sandbox, "outside");
		await mkdir(root);
		await mkdir(outside);
		await writeFile(join(root, "notes.txt"), "inside");
		await writeFile(join(outside, "secret.txt"), "TOP SECRET");
	});

	afterAll(async () => {
		await rm(sandbox, { recursive: true, force: true });
	});

	function filesRegistry() {
		return connect([filesServerConfig({ root })], { files: createFilesServer({ root }) });
	}

	it("agrees with the server on the metadata key", () => {
		expect(MCP_ERROR_META_KEY).toBe(FILES_ERROR_META_KEY);
	});

	it("loads the four read-only tools and none of the write or delete tools", async () => {
		const reg = await filesRegistry();
		expect(
			reg
				.toolsFor("agent")
				.map((tool) => tool.name)
				.sort(),
		).toEqual(["findAndReadFiles", "listFiles", "readFile", "searchFiles"]);
		const byName = Object.fromEntries(
			statusOf(reg, "files").tools.map((tool) => [tool.name, tool]),
		);
		expect(byName.writeFile).toMatchObject({ risk: "destructive", registered: false });
		expect(byName.deleteFile).toMatchObject({ risk: "destructive", registered: false });
	});

	it("reads a file through the tool set the agent receives", async () => {
		const reg = await filesRegistry();
		const outcome = await runTool(reg.toolsFor("agent"), "readFile", {
			path: join(root, "notes.txt"),
		});
		expect(outcome).toEqual({ ok: true, data: "inside" });
	});

	it("trips the latch for a path outside the root, with the learner's message built from the root", async () => {
		const reg = await filesRegistry();
		const latch = new FatalLatch();
		const outcome = await runTool(
			reg.toolsFor("agent"),
			"readFile",
			{ path: join(outside, "secret.txt") },
			latch,
		);
		expect(latch.error?.code).toBe("not-allowed");
		expect(latch.error?.learnerMessage).toContain(root);
		expect(JSON.stringify(outcome)).not.toContain("TOP SECRET");
	});

	it("returns a relative path as a recoverable result with the server's fix guide", async () => {
		const reg = await filesRegistry();
		const latch = new FatalLatch();
		const outcome = await runTool(reg.toolsFor("agent"), "readFile", { path: "notes.txt" }, latch);
		expect(latch.error).toBeUndefined();
		if (outcome.ok) throw new Error("expected a failure");
		expect(outcome.failure.nextAction).toContain("絶対パス");
	});

	it("hands the tools to buildToolSet like any other tool set", async () => {
		const reg = await filesRegistry();
		const built = buildToolSet(
			reg.toolsFor("agent"),
			{},
			{
				clock: createFakeClock(),
				toolTimeoutMs: 1_000,
				fatal: new FatalLatch(),
			},
		);
		expect(Object.keys(built.tools).sort()).toEqual([
			"findAndReadFiles",
			"listFiles",
			"readFile",
			"searchFiles",
		]);
	});
});

describe("the file server as a real child process (CL-3)", () => {
	let sandbox: string;
	let root: string;

	beforeAll(async () => {
		sandbox = await realpath(await mkdtemp(join(tmpdir(), "mcp-child-")));
		root = join(sandbox, "ws");
		await mkdir(root);
		await writeFile(join(root, "notes.txt"), "from a child process");
	});

	afterAll(async () => {
		await rm(sandbox, { recursive: true, force: true });
	});

	it("starts `files/stdio.ts` with the current Node and reads a file through it", async () => {
		registry = await connectMcpServers([filesServerConfig({ root })], { connectTimeoutMs: 20_000 });
		expect(statusOf(registry, "files").state).toBe("connected");
		const outcome = await runTool(registry.toolsFor("agent"), "readFile", {
			path: join(root, "notes.txt"),
		});
		expect(outcome).toEqual({ ok: true, data: "from a child process" });
	}, 30_000);

	it("reports a server whose root does not exist as unavailable instead of throwing", async () => {
		const missingRoot = join(sandbox, "missing-root");
		registry = await connectMcpServers([filesServerConfig({ root: missingRoot })], {
			connectTimeoutMs: 20_000,
		});
		const status = statusOf(registry, "files");
		expect(status.state).toBe("unavailable");
		expect(status.reason).toContain("MCP_FS_ROOT");
		expect(status.reason).toContain(missingRoot);
		expect(registry.toolsFor("agent")).toEqual([]);
		// The server reports the missing root and exits; it does not create the directory.
		await expect(stat(missingRoot)).rejects.toThrow();
	}, 30_000);
});

describe("close", () => {
	it("is safe to call twice", async () => {
		const reg = await connect([configFor("fixture", ["alpha"])], {
			fixture: fixtureServer([{ name: "alpha", annotations: READ_ONLY }]),
		});
		await reg.close();
		await expect(reg.close()).resolves.toBeUndefined();
	});
});

describe("isDisconnectError", () => {
	const clientError = (message: string, extra: Record<string, unknown> = {}) =>
		Object.assign(new Error(message), { name: "MCPClientError", ...extra });

	it("accepts the client's own connection-closed errors", () => {
		expect(isDisconnectError(clientError("Connection closed"))).toBe(true);
		expect(isDisconnectError(clientError("Attempted to send a request from a closed client"))).toBe(
			true,
		);
	});

	it("does not let a server word an error into a disconnect", () => {
		expect(isDisconnectError(clientError("Connection closed", { code: -32000 }))).toBe(false);
		expect(isDisconnectError(new Error("Connection closed"))).toBe(false);
		expect(isDisconnectError(clientError("Invalid params"))).toBe(false);
		expect(isDisconnectError("Connection closed")).toBe(false);
	});
});
