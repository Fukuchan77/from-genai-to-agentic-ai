import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PlatformError } from "@platform/ai-core/errors";
import { createFileTools } from "@platform/ai-core/files";
import {
	connectMcpServers,
	filesServerConfig,
	type McpRegistry,
	type McpServerStatus,
} from "@platform/ai-core/mcp";
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

const created = vi.hoisted(() => ({ signals: [] as AbortSignal[] }));

vi.mock("@platform/ai-core/agents", async (importOriginal) => {
	const original = await importOriginal<typeof import("@platform/ai-core/agents")>();
	return {
		...original,
		createGuardedAgent: ((options: { signal: AbortSignal }) => {
			created.signals.push(options.signal);
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
let registry: McpRegistry;

beforeAll(async () => {
	sandbox = await realpath(await mkdtemp(path.join(tmpdir(), "mcp-compare-")));
	const root = path.join(sandbox, "ws");
	await mkdir(root);
	await writeFile(path.join(root, "README.md"), "# ワークスペース\n許可ルートの説明です。");
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
	vi.mocked(getMcpRegistry).mockReset();
	vi.mocked(getMcpRegistry).mockImplementation(async () => registry);
	created.signals.length = 0;
});

async function install(overrides: Partial<Platform> = {}, use: McpRegistry = registry) {
	const platform = await createPlatform({ env: MOCK_ENV, clock: createFakeClock(1_000) });
	setPlatformForTesting({ ...platform, ...overrides });
	vi.mocked(getMcpRegistry).mockResolvedValue(use);
}

function compareRequest(body: unknown, signal?: AbortSignal): Request {
	return new Request("http://localhost/api/mcp/compare", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
		...(signal ? { signal } : {}),
	});
}

interface RunBody {
	steps: number;
	tokens: number;
	failed?: boolean;
	stopReason: string;
	toolsCalled: string[];
	error?: { code: string; message: string };
}

interface CompareBody {
	highLevel: RunBody;
	lowLevel: RunBody;
	comparison: { steps: number; tokens: number; ratio?: number };
}

async function errorOf(response: Response) {
	return ((await response.json()) as { error: { code: string; message: string } }).error;
}

/**
 * The low-level run's `listFiles` ends the run with a fatal error: its tool is bound to a root that
 * does not exist (a configuration error). The high-level run uses the real registry.
 */
function brokenLowLevel(): McpRegistry {
	const brokenRoot = createFileTools({ root: path.join(sandbox, "no-such-root") });
	return {
		status: () => registry.status(),
		toolsFor: (agentId, options) =>
			agentId.endsWith("lowLevel")
				? brokenRoot.filter((tool) => tool.name === "searchFiles" || tool.name === "readFile")
				: registry.toolsFor(agentId, options),
		close: async () => undefined,
	};
}

describe("POST /api/mcp/compare — rejections before any LLM call", () => {
	it("rejects an oversized body with 413, a bad shape with 400 and an unknown task with 400", async () => {
		await install();

		const big = await POST(compareRequest({ task: "list-and-read", pad: "x".repeat(600 * 1024) }));
		const extra = await POST(compareRequest({ task: "list-and-read", prompt: "x" }));
		const unknown = await POST(compareRequest({ task: "format-the-disk" }));
		const missing = await POST(compareRequest({}));

		expect(big.status).toBe(413);
		for (const response of [extra, unknown, missing]) {
			expect(response.status).toBe(400);
			expect((await errorOf(response)).code).toBe("invalid-request");
		}
		expect(created.signals).toHaveLength(0);
	});

	it("applies the rate limit only in live mode", async () => {
		const limiter = { check: vi.fn(() => ({ allowed: false as const, retryAfterSeconds: 3 })) };
		await install({ limiter });
		await POST(compareRequest({ task: "list-and-read" }));
		expect(limiter.check).not.toHaveBeenCalled();

		await install({ mode: "live", limiter });
		const limited = await POST(compareRequest({ task: "list-and-read" }));
		expect(limited.status).toBe(429);
	});

	it("answers 503 provider-unavailable when the file server is not connected", async () => {
		const down: McpServerStatus[] = [
			{ id: "files", state: "unavailable", reason: "接続に失敗しました。", tools: [] },
		];
		await install({}, { status: () => down, toolsFor: () => [], close: async () => undefined });

		const response = await POST(compareRequest({ task: "list-and-read" }));

		expect(response.status).toBe(503);
		expect((await errorOf(response)).code).toBe("provider-unavailable");
		expect(created.signals).toHaveLength(0);
	});

	it("answers 503 when the registry cannot be prepared", async () => {
		await install();
		vi.mocked(getMcpRegistry).mockRejectedValueOnce(
			new PlatformError("provider-unavailable", "MCP サーバーへの接続を準備できませんでした。"),
		);

		expect((await POST(compareRequest({ task: "list-and-read" }))).status).toBe(503);
	});

	it("requires a tool-capable model", async () => {
		const platform = await createPlatform({ env: MOCK_ENV, clock: createFakeClock(1_000) });
		const resolve = vi.fn(async () => {
			throw new CapabilityUnsupportedError("tools", "mock:general-v1", "Mock General");
		});
		await install({ gateway: { ...platform.gateway, resolve } as never });

		const response = await POST(compareRequest({ task: "list-and-read" }));

		expect(response.status).toBe(400);
		expect((await errorOf(response)).code).toBe("capability-unsupported");
		expect(resolve).toHaveBeenCalledWith(expect.objectContaining({ require: ["tools"] }));
		expect(created.signals).toHaveLength(0);
	});
});

describe("POST /api/mcp/compare — the two runs in mock mode", () => {
	it("measures both ways with the fixed steps of the mock scenarios and compares them (Req 1.12)", async () => {
		await install();

		const response = await POST(compareRequest({ task: "list-and-read" }));

		expect(response.status).toBe(200);
		const body = (await response.json()) as CompareBody;
		expect(body.highLevel).toMatchObject({
			steps: 2,
			tokens: 300 + 30 + 520 + 40,
			stopReason: "completed",
			toolsCalled: ["findAndReadFiles"],
		});
		expect(body.lowLevel).toMatchObject({
			steps: 3,
			tokens: 300 + 24 + 450 + 24 + 640 + 40,
			stopReason: "completed",
			toolsCalled: ["searchFiles", "readFile"],
		});
		expect(body.highLevel.failed).toBeUndefined();
		expect(body.comparison.steps).toBe(1);
		expect(body.comparison.tokens).toBe(1478 - 890);
		expect(body.comparison.ratio).toBeCloseTo(890 / 1478, 6);
	});

	it("gives each run only its own tools", async () => {
		const loaded: { agentId: string; allow: unknown }[] = [];
		const recording: McpRegistry = {
			status: () => registry.status(),
			toolsFor: (agentId, options) => {
				loaded.push({ agentId, allow: options?.allow });
				return registry.toolsFor(agentId, options);
			},
			close: async () => undefined,
		};
		await install({}, recording);

		await POST(compareRequest({ task: "list-and-read" }));

		expect(loaded).toEqual([
			{ agentId: "mcp-compare-highLevel", allow: { files: ["findAndReadFiles"] } },
			{ agentId: "mcp-compare-lowLevel", allow: { files: ["searchFiles", "readFile"] } },
		]);
	});

	it("reports a run that could not finish as an error and computes no ratio", async () => {
		await install({}, brokenLowLevel());

		const response = await POST(compareRequest({ task: "list-and-read" }));

		expect(response.status).toBe(200);
		const body = (await response.json()) as CompareBody;
		expect(body.highLevel.failed).toBeUndefined();
		expect(body.lowLevel.failed).toBe(true);
		expect(body.lowLevel.stopReason).toBe("error");
		expect(body.lowLevel.error?.message).toBeTruthy();
		expect(body.comparison.ratio).toBeUndefined();
	});

	it("sends the vetted learner message for a failed run, never the raw error", async () => {
		await install({}, brokenLowLevel());

		const text = await (await POST(compareRequest({ task: "list-and-read" }))).text();

		// The vetted learner message names the root; the error object's own text and class do not appear.
		expect(text).toContain("許可ルート");
		expect(text).not.toContain("fatal tool error");
		expect(text).not.toContain("FatalToolError");
	});

	it("passes the request's abort signal to both runs", async () => {
		await install();
		const controller = new AbortController();

		await POST(compareRequest({ task: "list-and-read" }, controller.signal));

		expect(created.signals).toHaveLength(2);
		controller.abort();
		expect(created.signals.every((signal) => signal.aborted)).toBe(true);
	});
});

describe("POST /api/mcp/compare: generated SSE fixtures used by the E2E specs (JSON bodies)", () => {
	it("matches the generated SSE fixture (JSON) of the list-and-read comparison", async () => {
		await install();

		const response = await POST(compareRequest({ task: "list-and-read" }));

		expect(response.status).toBe(200);
		verifyOrWriteFixture(
			"mcp-compare.json",
			`${JSON.stringify(await response.json(), null, "\t")}\n`,
		);
	});
});
