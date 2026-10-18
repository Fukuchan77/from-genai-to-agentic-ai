import {
	chmod,
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryTransport, type JSONRPCMessage } from "@modelcontextprotocol/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_TOOLS } from "../config/defaults";
import { DEFAULT_CONCISE_MAX_CHARACTERS } from "./operations";
import { createFilesServer, FILES_ERROR_META_KEY, resolveServerRoot } from "./server";

const PROTOCOL_VERSION = "2025-11-25";

interface ToolCallResult {
	readonly isError?: boolean;
	readonly content: readonly { readonly type: string; readonly text: string }[];
	readonly _meta?: Record<string, unknown>;
}

interface RpcPeer {
	request(method: string, params?: Record<string, unknown>): Promise<unknown>;
	notify(method: string, params?: Record<string, unknown>): Promise<void>;
}

/** A minimal JSON-RPC peer, so these tests do not depend on a client package (only `mcp/` may import one). */
function rpcPeerOver(transport: {
	send(message: JSONRPCMessage): Promise<void>;
	onmessage?: ((message: JSONRPCMessage) => void) | undefined;
}): { peer: RpcPeer; accept(message: JSONRPCMessage): void } {
	let nextId = 1;
	const pending = new Map<
		number,
		{ resolve: (value: unknown) => void; reject: (error: Error) => void }
	>();
	return {
		accept(message) {
			if (!("id" in message) || typeof message.id !== "number") return;
			const waiter = pending.get(message.id);
			if (!waiter) return;
			pending.delete(message.id);
			if ("error" in message) waiter.reject(new Error(JSON.stringify(message.error)));
			else if ("result" in message) waiter.resolve(message.result);
		},
		peer: {
			request(method, params) {
				const id = nextId++;
				return new Promise((resolve, reject) => {
					pending.set(id, { resolve, reject });
					transport
						.send({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) })
						.catch(reject);
				});
			},
			notify(method, params) {
				return transport.send({
					jsonrpc: "2.0",
					method,
					...(params === undefined ? {} : { params }),
				});
			},
		},
	};
}

async function handshake(peer: RpcPeer): Promise<void> {
	await peer.request("initialize", {
		protocolVersion: PROTOCOL_VERSION,
		capabilities: {},
		clientInfo: { name: "files-server-test", version: "0.0.0" },
	});
	await peer.notify("notifications/initialized");
}

let sandbox: string;
let root: string;
let outside: string;

beforeAll(async () => {
	sandbox = await realpath(await mkdtemp(join(tmpdir(), "files-server-")));
	outside = join(sandbox, "outside");
	await mkdir(outside);
	await writeFile(join(outside, "secret.txt"), "TOP SECRET");
});

afterAll(async () => {
	await rm(sandbox, { recursive: true, force: true });
});

beforeEach(async () => {
	root = join(sandbox, "root");
	await rm(root, { recursive: true, force: true });
	await mkdir(join(root, "docs"), { recursive: true });
	await writeFile(join(root, "notes.txt"), "Alpha line\nsecond line with Needle inside");
	await writeFile(join(root, "docs", "guide.md"), "# Guide\nThe needle is documented here.\n");
});

describe("createFilesServer over an in-memory transport", () => {
	const cleanups: (() => Promise<void>)[] = [];

	afterEach(async () => {
		for (const cleanup of cleanups.splice(0)) await cleanup();
	});

	async function connect(rootPath = root): Promise<RpcPeer> {
		const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
		const server = createFilesServer({ root: rootPath });
		await server.connect(serverSide);
		const { peer, accept } = rpcPeerOver(clientSide);
		clientSide.onmessage = accept;
		await clientSide.start();
		cleanups.push(async () => {
			await clientSide.close();
			await server.close();
		});
		await handshake(peer);
		return peer;
	}

	async function call(peer: RpcPeer, name: string, args: unknown): Promise<ToolCallResult> {
		return (await peer.request("tools/call", { name, arguments: args })) as ToolCallResult;
	}

	it("lists the six tools with annotations that say which ones may not run unattended", async () => {
		const peer = await connect();
		const listed = (await peer.request("tools/list")) as {
			tools: { name: string; annotations?: Record<string, unknown> }[];
		};
		expect(listed.tools.map((tool) => [tool.name, tool.annotations])).toEqual([
			["listFiles", { readOnlyHint: true }],
			["readFile", { readOnlyHint: true }],
			["searchFiles", { readOnlyHint: true }],
			["findAndReadFiles", { readOnlyHint: true }],
			["writeFile", { readOnlyHint: false, destructiveHint: false }],
			["deleteFile", { readOnlyHint: false, destructiveHint: true }],
		]);
	});

	it("carries the CL-18 description and the field descriptions to the client", async () => {
		const peer = await connect();
		const listed = (await peer.request("tools/list")) as {
			tools: {
				name: string;
				description: string;
				inputSchema: { properties: Record<string, { description?: string }> };
			}[];
		};
		for (const tool of listed.tools) {
			expect(tool.description).toContain("使うとき:");
			expect(tool.description).toContain("使わないとき:");
			expect(tool.description).toContain("例:");
			for (const [field, schema] of Object.entries(tool.inputSchema.properties)) {
				expect(schema.description, `${tool.name}.${field}`).toBeTruthy();
			}
		}
	});

	it("runs the read-only tools", async () => {
		const peer = await connect();
		const listing = await call(peer, "listFiles", {});
		expect(listing.isError).toBeUndefined();
		expect(listing.content[0]?.text).toContain(`許可ルート: ${root}`);
		expect(listing.content[0]?.text).toContain("[1] notes.txt (ファイル)");

		const read = await call(peer, "readFile", { path: join(root, "notes.txt") });
		expect(read.content[0]?.text).toBe("Alpha line\nsecond line with Needle inside");

		const found = await call(peer, "findAndReadFiles", { query: "needle" });
		expect(found.content[0]?.text).toContain("The needle is documented here.");
	});

	it("returns a path outside the root as a fatal error result, not an exception", async () => {
		const peer = await connect();
		await symlink(outside, join(root, "link-out"));
		for (const path of [
			join(outside, "secret.txt"),
			join(root, "link-out", "secret.txt"),
			`${root}/docs/../../outside/secret.txt`,
		]) {
			const result = await call(peer, "readFile", { path });
			expect(result.isError).toBe(true);
			expect(result._meta?.[FILES_ERROR_META_KEY]).toEqual({ kind: "fatal", code: "not-allowed" });
			expect(result.content[0]?.text).toContain(root);
			expect(JSON.stringify(result)).not.toContain("TOP SECRET");
		}
	});

	it("returns a relative path and a missing path as recoverable error results", async () => {
		const peer = await connect();
		const relative = await call(peer, "readFile", { path: "notes.txt" });
		expect(relative.isError).toBe(true);
		expect(relative._meta?.[FILES_ERROR_META_KEY]).toEqual({ kind: "recoverable" });
		expect(relative.content[0]?.text).toContain("相対パス");
		expect(relative.content[0]?.text).toContain("次の対応:");

		const missing = await call(peer, "readFile", { path: join(root, "missing.txt") });
		expect(missing._meta?.[FILES_ERROR_META_KEY]).toEqual({ kind: "recoverable" });
	});

	it("never runs a tool with input that fails its schema", async () => {
		const peer = await connect();
		const outcome = await call(peer, "readFile", {}).then(
			(result) => ({ result }),
			(error: unknown) => ({ error: String(error) }),
		);
		if ("result" in outcome) {
			expect(outcome.result.isError).toBe(true);
			expect(outcome.result.content[0]?.text).not.toContain("Alpha line");
		} else {
			expect(outcome.error).toContain("path");
		}
	});

	it("executes writeFile and deleteFile inside the root and refuses them outside", async () => {
		const peer = await connect();
		const target = join(root, "docs", "new.txt");
		const written = await call(peer, "writeFile", { path: target, content: "hello" });
		expect(written.isError).toBeUndefined();
		expect(await readFile(target, "utf8")).toBe("hello");

		const removed = await call(peer, "deleteFile", { path: target });
		expect(removed.isError).toBeUndefined();
		await expect(stat(target)).rejects.toThrow();

		const outsideWrite = await call(peer, "writeFile", {
			path: join(outside, "planted.txt"),
			content: "x",
		});
		expect(outsideWrite._meta?.[FILES_ERROR_META_KEY]).toEqual({
			kind: "fatal",
			code: "not-allowed",
		});
		await expect(stat(join(outside, "planted.txt"))).rejects.toThrow();
		const outsideDelete = await call(peer, "deleteFile", { path: join(outside, "secret.txt") });
		expect(outsideDelete._meta?.[FILES_ERROR_META_KEY]).toEqual({
			kind: "fatal",
			code: "not-allowed",
		});
		expect(await readFile(join(outside, "secret.txt"), "utf8")).toBe("TOP SECRET");
	});

	it("reports an unexpected failure by its name only, never its message or path", async () => {
		const locked = join(root, "locked");
		await mkdir(locked);
		await writeFile(join(locked, "x.txt"), "needle");
		await chmod(locked, 0o000);
		try {
			const peer = await connect();
			const result = await call(peer, "searchFiles", { query: "needle" });
			expect(result.isError).toBe(true);
			expect(result._meta?.[FILES_ERROR_META_KEY]).toEqual({ kind: "recoverable" });
			expect(result.content[0]?.text).toContain("実行に失敗しました");
			expect(result.content[0]?.text).not.toContain("locked");
			expect(result.content[0]?.text).not.toContain("EACCES");
		} finally {
			await chmod(locked, 0o755);
		}
	});

	it("reports a missing root as a fatal configuration error result", async () => {
		const peer = await connect(join(sandbox, "no-such-root"));
		const result = await call(peer, "listFiles", {});
		expect(result.isError).toBe(true);
		expect(result._meta?.[FILES_ERROR_META_KEY]).toEqual({ kind: "fatal", code: "config-missing" });
	});
});

describe("resolveServerRoot (the check stdio.ts makes before it serves)", () => {
	it("returns the real path of an existing directory, with a symbolic link resolved", async () => {
		await symlink(root, join(sandbox, "alias"));
		expect(await resolveServerRoot(root)).toEqual({ ok: true, root });
		expect(await resolveServerRoot(join(sandbox, "alias"))).toEqual({ ok: true, root });
	});

	it("says which MCP_FS_ROOT does not exist, and does not create it", async () => {
		const missing = join(sandbox, "never-created");

		const result = await resolveServerRoot(missing);

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected a failure");
		expect(result.message).toContain("MCP_FS_ROOT");
		expect(result.message).toContain(missing);
		expect(result.message).toContain("作成せずに終了します");
		await expect(stat(missing)).rejects.toThrow();
	});

	it("refuses a file as the root", async () => {
		const result = await resolveServerRoot(join(root, "notes.txt"));

		expect(result.ok).toBe(false);
	});

	it("resolves a relative root against the working directory", async () => {
		const result = await resolveServerRoot(".");

		expect(result).toEqual({ ok: true, root: await realpath(process.cwd()) });
	});
});

describe("configuration", () => {
	it("keeps the concise default equal to the platform default (this layer cannot import config)", () => {
		expect(DEFAULT_CONCISE_MAX_CHARACTERS).toBe(DEFAULT_TOOLS.conciseMaxCharacters);
	});
});
