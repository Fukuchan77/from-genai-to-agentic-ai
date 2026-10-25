import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DEFAULT_TOOLS } from "@platform/ai-core/config";
import { PlatformError } from "@platform/ai-core/errors";
import {
	connectMcpServers,
	filesServerConfig,
	type McpRegistry,
	type McpServerConfig,
	type McpServerStatus,
} from "@platform/ai-core/mcp";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createPlatform,
	getMcpRegistry,
	setMcpRegistryForTesting,
	setPlatformForTesting,
} from "@/lib/server/platform";
import { verifyOrWriteFixture } from "../../../../../../scripts/e2e/generate-sse-fixtures.mjs";
import { GET } from "./route";

vi.mock("@/lib/server/platform", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/server/platform")>();
	return { ...original, getMcpRegistry: vi.fn(original.getMcpRegistry) };
});

const FILES_SERVER_FILE = path.resolve(
	import.meta.dirname,
	"../../../../../..",
	"packages/ai-core/src/files/stdio.ts",
);

const TOKEN = "ghp_secret-token-for-route-tests";

function registryWith(status: readonly McpServerStatus[]): McpRegistry {
	return { status: () => status, toolsFor: () => [], close: async () => undefined };
}

afterEach(() => {
	setMcpRegistryForTesting(undefined);
	setPlatformForTesting(undefined);
	vi.mocked(getMcpRegistry).mockReset();
});

async function install() {
	setPlatformForTesting(await createPlatform({ env: { VITEST: "1", AI_TEST_RUN_MODE: "mock" } }));
}

describe("GET /api/mcp/servers", () => {
	it("returns each server's state, its loaded and refused tools with the reason, and the limits", async () => {
		await install();
		const STATUS: readonly McpServerStatus[] = [
			{
				id: "files",
				state: "connected",
				tools: [
					{ name: "listFiles", risk: "read-only", registered: true },
					{ name: "writeFile", risk: "destructive", registered: false, disabledReason: "refused" },
				],
			},
			{ id: "github", state: "unavailable", reason: "down", tools: [] },
		];
		vi.mocked(getMcpRegistry).mockResolvedValue(registryWith(STATUS));

		const response = await GET();

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			servers: STATUS,
			limits: { maxTools: DEFAULT_TOOLS.maxToolsPerAgent },
			think: { enabled: DEFAULT_TOOLS.thinkEnabled },
		});
	});

	it("states the 20-tool limit and that the think tool is on by default", async () => {
		await install();
		vi.mocked(getMcpRegistry).mockResolvedValue(registryWith([]));

		const body = (await (await GET()).json()) as {
			limits: { maxTools: number };
			think: { enabled: boolean };
		};

		expect(body.limits.maxTools).toBe(20);
		expect(body.think.enabled).toBe(true);
	});

	it("sends only the public fields, never a header or a token the registry might carry", async () => {
		await install();
		const leaky = [
			{
				id: "github",
				state: "connected",
				tools: [{ name: "issue_read", risk: "read-only", registered: true, token: TOKEN }],
				headers: { Authorization: `Bearer ${TOKEN}` },
				transport: {
					kind: "http",
					url: "https://example.invalid",
					headers: { Authorization: TOKEN },
				},
			},
		] as unknown as readonly McpServerStatus[];
		vi.mocked(getMcpRegistry).mockResolvedValue(registryWith(leaky));

		const text = await (await GET()).text();

		expect(text).not.toContain(TOKEN);
		expect(JSON.parse(text).servers[0]).toEqual({
			id: "github",
			state: "connected",
			tools: [{ name: "issue_read", risk: "read-only", registered: true }],
		});
	});

	it("reports a failure to prepare the connections as 503 provider-unavailable", async () => {
		await install();
		vi.mocked(getMcpRegistry).mockRejectedValue(
			new PlatformError("provider-unavailable", "MCP サーバーへの接続を準備できませんでした。"),
		);

		const response = await GET();

		expect(response.status).toBe(503);
		expect(await response.json()).toMatchObject({ error: { code: "provider-unavailable" } });
	});
});

describe("GET /api/mcp/servers: generated SSE fixtures used by the E2E specs (JSON bodies)", () => {
	it("matches the generated SSE fixture (JSON) of a connected server with a refused tool and an unavailable one", async () => {
		await install();
		// The real connection code against the platform's own file server and a server whose start-up
		// command does not exist, so every reason in the fixture is text the product itself produced.
		const sandbox = await realpath(await mkdtemp(path.join(tmpdir(), "mcp-servers-")));
		const root = path.join(sandbox, "ws");
		await mkdir(root);
		const unreachable: McpServerConfig = {
			id: "github",
			transport: { kind: "stdio", command: "mcp-server-that-does-not-exist", args: [], env: {} },
			allow: ["issue_read"],
			trustErrorMeta: false,
		};
		const real = await connectMcpServers(
			[filesServerConfig({ root, serverFile: FILES_SERVER_FILE }), unreachable],
			{ connectTimeoutMs: 20_000 },
		);
		try {
			vi.mocked(getMcpRegistry).mockResolvedValue(real);

			const response = await GET();

			expect(response.status).toBe(200);
			// The temporary root differs on every machine; pin it if it ever appears.
			const text = (await response.text()).replaceAll(root, "/srv/mcp-workspace");
			verifyOrWriteFixture("mcp-servers.json", `${JSON.stringify(JSON.parse(text), null, "\t")}\n`);
		} finally {
			await real.close();
			await rm(sandbox, { recursive: true, force: true });
		}
	});
});
