import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ConfigError } from "@platform/ai-core/config";
import { PlatformError } from "@platform/ai-core/errors";
import {
	connectMcpServers,
	filesServerConfig,
	type McpRegistry,
	type McpServerStatus,
} from "@platform/ai-core/mcp";
import { M3_1_SAMPLE_TASKS } from "@platform/ai-core/mock";
import { CapabilityUnsupportedError } from "@platform/ai-core/models";
import { createFakeClock } from "@platform/ai-core/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
	createPlatform,
	getMcpRegistry,
	type Platform,
	setMcpRegistryForTesting,
	setPlatformForTesting,
} from "@/lib/server/platform";
import { verifyOrWriteFixture } from "../../../../../../scripts/e2e/generate-sse-fixtures.mjs";
import { POST } from "./route";

// Every created GuardedAgent's options are recorded, so a test can see the tools and the signal.
const created = vi.hoisted(() => ({
	options: [] as { signal: AbortSignal; tools: Record<string, unknown> }[],
}));

vi.mock("@platform/ai-core/agents", async (importOriginal) => {
	const original = await importOriginal<typeof import("@platform/ai-core/agents")>();
	return {
		...original,
		createGuardedAgent: ((options: { signal: AbortSignal; tools: Record<string, unknown> }) => {
			created.options.push(options);
			return original.createGuardedAgent(options as never);
		}) as typeof original.createGuardedAgent,
	};
});

vi.mock("@/lib/server/platform", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/server/platform")>();
	return { ...original, getMcpRegistry: vi.fn(original.getMcpRegistry) };
});

const MOCK_ENV = { VITEST: "1", AI_TEST_RUN_MODE: "mock" } as const;
const FILES_SERVER_FILE = path.resolve(
	import.meta.dirname,
	"../../../../../..",
	"packages/ai-core/src/files/stdio.ts",
);

let sandbox: string;
let root: string;
let registry: McpRegistry;

beforeAll(async () => {
	sandbox = await realpath(await mkdtemp(path.join(tmpdir(), "mcp-chat-")));
	root = path.join(sandbox, "ws");
	await mkdir(root);
	await writeFile(path.join(root, "notes.txt"), "週次ミーティングは金曜日です。");
	registry = await connectMcpServers([filesServerConfig({ root, serverFile: FILES_SERVER_FILE })], {
		connectTimeoutMs: 20_000,
	});
}, 30_000);

afterAll(async () => {
	await registry.close();
	await rm(sandbox, { recursive: true, force: true });
});

afterEach(() => {
	setPlatformForTesting(undefined);
	setMcpRegistryForTesting(undefined);
	created.options.length = 0;
});

async function install(overrides: Partial<Platform> = {}, withRegistry: McpRegistry = registry) {
	const platform = await createPlatform({ env: MOCK_ENV, clock: createFakeClock(1_000) });
	setPlatformForTesting({ ...platform, ...overrides });
	setMcpRegistryForTesting(withRegistry);
}

function chatRequest(
	text: string,
	extra: Record<string, unknown> = {},
	signal?: AbortSignal,
): Request {
	return new Request("http://localhost/api/mcp/chat", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			id: "mcp-1",
			messages: [{ id: "u1", role: "user", parts: [{ type: "text", text }] }],
			...extra,
		}),
		...(signal ? { signal } : {}),
	});
}

type Chunk = { type: string; [key: string]: unknown };

async function readChunks(response: Response): Promise<Chunk[]> {
	const text = await response.text();
	return text
		.split("\n\n")
		.map((event) => event.trim())
		.filter((event) => event.startsWith("data: ") && event !== "data: [DONE]")
		.map((event) => JSON.parse(event.slice("data: ".length)) as Chunk);
}

interface FinishMetadata {
	run: {
		stopReason: string;
		toolsCalled: string[];
		error?: { code: string; message: string };
	};
	mcp: McpServerStatus[];
}

function finishMetadata(chunks: readonly Chunk[]): FinishMetadata {
	const finish = chunks.find((chunk) => chunk.type === "finish");
	if (!finish) throw new Error("the stream has no finish chunk");
	return finish.messageMetadata as FinishMetadata;
}

async function errorBody(response: Response) {
	return (await response.json()) as { error: { code: string; message: string } };
}

describe("POST /api/mcp/chat — rejections before any LLM call", () => {
	it("rejects an oversized body with 413 before reading its shape", async () => {
		await install();
		const response = await POST(chatRequest("x".repeat(600 * 1024)));

		expect(response.status).toBe(413);
		expect((await errorBody(response)).error.code).toBe("payload-too-large");
	});

	it("rejects a body that is not an MCP chat request with 400 invalid-request", async () => {
		await install();
		for (const extra of [{ personaId: "general-assistant" }, { tools: ["x"] }, { think: "yes" }]) {
			const response = await POST(chatRequest("こんにちは", extra));
			expect(response.status).toBe(400);
			expect((await errorBody(response)).error.code).toBe("invalid-request");
		}
	});

	it("rejects too many messages with 400 limit-exceeded", async () => {
		await install();
		const messages = Array.from({ length: 51 }, (_, index) => ({
			id: `m${index}`,
			role: "user",
			parts: [{ type: "text", text: "x" }],
		}));
		const response = await POST(
			new Request("http://localhost/api/mcp/chat", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ id: "mcp-1", messages }),
			}),
		);

		expect(response.status).toBe(400);
		expect((await errorBody(response)).error.code).toBe("limit-exceeded");
	});

	it("applies the rate limit only in live mode, after the other checks", async () => {
		const limiter = { check: vi.fn(() => ({ allowed: false as const, retryAfterSeconds: 7 })) };
		await install({ limiter });
		await POST(chatRequest("一覧してください"));
		expect(limiter.check).not.toHaveBeenCalled();

		await install({ mode: "live", limiter });
		const limited = await POST(chatRequest("一覧してください"));
		expect(limited.status).toBe(429);
		expect(limiter.check).toHaveBeenCalledTimes(1);

		limiter.check.mockClear();
		const malformed = await POST(chatRequest("x", { personaId: "nope" }));
		expect(malformed.status).toBe(400);
		expect(limiter.check).not.toHaveBeenCalled();
	});

	it("rejects an allow-list that names an unknown server or an unknown tool with 400", async () => {
		await install();
		const unknownServer = await POST(chatRequest("x", { allow: { elsewhere: ["listFiles"] } }));
		const unknownTool = await POST(chatRequest("x", { allow: { files: ["noSuchTool"] } }));

		for (const response of [unknownServer, unknownTool]) {
			expect(response.status).toBe(400);
			expect((await errorBody(response)).error.code).toBe("invalid-request");
		}
		expect(
			(await errorBody(await POST(chatRequest("x", { allow: { elsewhere: [] } })))).error.message,
		).toContain("elsewhere");
		expect(created.options).toHaveLength(0);
	});

	it("rejects an allow-list that asks for a write or destructive tool with 400 (Req 1.17)", async () => {
		await install();
		for (const name of ["writeFile", "deleteFile"]) {
			const response = await POST(chatRequest("x", { allow: { files: [name] } }));
			expect(response.status).toBe(400);
			const { error } = await errorBody(response);
			expect(error.code).toBe("invalid-request");
			expect(error.message).toContain(name);
			expect(error.message).toContain("destructive");
		}
		expect(created.options).toHaveLength(0);
	});

	it("rejects a configuration the registry refuses (more than 20 tools) with 400, starting no agent", async () => {
		const tooMany: McpRegistry = {
			status: () => [],
			toolsFor: () => {
				throw new ConfigError("エージェントのツールが 20 個を超えます（21 個）。");
			},
			close: async () => undefined,
		};
		await install({}, tooMany);

		const response = await POST(chatRequest("x"));

		expect(response.status).toBe(400);
		expect((await errorBody(response)).error.message).toContain("20");
		expect(created.options).toHaveLength(0);
	});

	it("requires a tool-capable model and answers capability-unsupported when there is none", async () => {
		const platform = await createPlatform({ env: MOCK_ENV, clock: createFakeClock(1_000) });
		const resolve = vi.fn(async () => {
			throw new CapabilityUnsupportedError("tools", "mock:general-v1", "Mock General");
		});
		await install({ gateway: { ...platform.gateway, resolve } as never });

		const response = await POST(chatRequest("x"));

		expect(response.status).toBe(400);
		expect((await errorBody(response)).error.code).toBe("capability-unsupported");
		expect(resolve).toHaveBeenCalledWith(
			expect.objectContaining({ purpose: "chat", require: ["tools"] }),
		);
		expect(created.options).toHaveLength(0);
	});

	it("reports a registry that cannot be prepared as 503 provider-unavailable", async () => {
		await install();
		vi.mocked(getMcpRegistry).mockRejectedValueOnce(
			new PlatformError("provider-unavailable", "MCP サーバーへの接続を準備できませんでした。"),
		);

		const response = await POST(chatRequest("x"));

		expect(response.status).toBe(503);
		expect((await errorBody(response)).error.code).toBe("provider-unavailable");
		expect(created.options).toHaveLength(0);
	});
});

describe("POST /api/mcp/chat — a run in mock mode", () => {
	it("lists the root and reads the first file, then answers, and reports { run, mcp } on finish", async () => {
		await install();
		const response = await POST(chatRequest(M3_1_SAMPLE_TASKS.listAndRead));

		expect(response.status).toBe(200);
		const chunks = await readChunks(response);
		const toolOutputs = chunks.filter((chunk) => chunk.type === "tool-output-available");
		expect(toolOutputs).toHaveLength(2);
		expect(JSON.stringify(toolOutputs[0])).toContain("[0] notes.txt");
		expect(JSON.stringify(toolOutputs[1])).toContain("週次ミーティングは金曜日です。");

		const metadata = finishMetadata(chunks);
		expect(metadata.run.stopReason).toBe("completed");
		expect(metadata.run.toolsCalled).toEqual(["listFiles", "readFile"]);
		expect(metadata.mcp.map((server) => [server.id, server.state])).toEqual([
			["files", "connected"],
		]);
		expect(JSON.stringify(metadata.mcp)).not.toContain(root);
	});

	it("stops the run with stop reason error and the allowed root in the message when a path leaves the root", async () => {
		await install();
		const response = await POST(chatRequest(M3_1_SAMPLE_TASKS.outsideRoot));

		expect(response.status).toBe(200);
		const chunks = await readChunks(response);
		const metadata = finishMetadata(chunks);
		expect(metadata.run.stopReason).toBe("error");
		expect(metadata.run.error?.code).toBe("not-allowed");
		expect(metadata.run.error?.message).toContain(root);
		expect(JSON.stringify(chunks)).not.toContain("127.0.0.1");
	});

	it("gives the agent the think tool by default and leaves it out when think is false (Req 1.14)", async () => {
		await install();
		await (await POST(chatRequest(M3_1_SAMPLE_TASKS.listAndRead))).text();
		await (await POST(chatRequest(M3_1_SAMPLE_TASKS.listAndRead, { think: false }))).text();

		expect(Object.keys(created.options[0]?.tools ?? {}).sort()).toEqual([
			"findAndReadFiles",
			"listFiles",
			"readFile",
			"searchFiles",
			"think",
		]);
		expect(Object.keys(created.options[1]?.tools ?? {}).sort()).toEqual([
			"findAndReadFiles",
			"listFiles",
			"readFile",
			"searchFiles",
		]);
	});

	it("counts the think tool against the agent's 20 tools, and nothing when think is off", async () => {
		const seen: unknown[] = [];
		const recording: McpRegistry = {
			status: () => [],
			toolsFor: (_agentId, options) => {
				seen.push(options?.reservedTools);
				return [];
			},
			close: async () => undefined,
		};
		await install({}, recording);

		await (await POST(chatRequest("x"))).text();
		await (await POST(chatRequest("x", { think: false }))).text();

		expect(seen).toEqual([1, 0]);
	});

	it("loads only the tools the request's allow-list names", async () => {
		await install();
		await (
			await POST(chatRequest("どれでもよい", { allow: { files: ["readFile"] }, think: false }))
		)
			.text()
			.catch(() => undefined);

		expect(Object.keys(created.options[0]?.tools ?? {})).toEqual(["readFile"]);
	});

	it("passes the request's abort signal to the agent (Req 4.9 style propagation)", async () => {
		await install();
		const controller = new AbortController();
		await (await POST(chatRequest(M3_1_SAMPLE_TASKS.listAndRead, {}, controller.signal))).text();

		expect(created.options[0]?.signal).toBeDefined();
		controller.abort();
		expect(created.options[0]?.signal.aborted).toBe(true);
	});
});

describe("POST /api/mcp/chat: generated SSE fixtures used by the E2E specs", () => {
	// The allowed root is a temporary directory whose name differs on every machine; the fixture
	// carries a fixed stand-in so that it is the same everywhere.
	const STABLE_ROOT = "/srv/mcp-workspace";
	const stable = (text: string) => text.replaceAll(root, STABLE_ROOT);

	it("matches the generated SSE fixture of listing the root and reading a file", async () => {
		await install();

		const response = await POST(chatRequest(M3_1_SAMPLE_TASKS.listAndRead));

		expect(response.status).toBe(200);
		verifyOrWriteFixture("mcp-chat.sse", stable(await response.text()));
	});

	it("matches the generated SSE fixture of a run that stops on a path outside the allowed root", async () => {
		await install();

		const response = await POST(chatRequest(M3_1_SAMPLE_TASKS.outsideRoot));

		expect(response.status).toBe(200);
		verifyOrWriteFixture("mcp-chat-error.sse", stable(await response.text()));
	});
});
