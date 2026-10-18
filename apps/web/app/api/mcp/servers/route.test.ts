import { DEFAULT_TOOLS } from "@platform/ai-core/config";
import { PlatformError } from "@platform/ai-core/errors";
import type { McpRegistry, McpServerStatus } from "@platform/ai-core/mcp";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createPlatform,
	getMcpRegistry,
	setMcpRegistryForTesting,
	setPlatformForTesting,
} from "@/lib/server/platform";
import { GET } from "./route";

vi.mock("@/lib/server/platform", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/server/platform")>();
	return { ...original, getMcpRegistry: vi.fn(original.getMcpRegistry) };
});

const TOKEN = "ghp_secret-token-for-route-tests";

const STATUS: readonly McpServerStatus[] = [
	{
		id: "files",
		state: "connected",
		tools: [
			{ name: "listFiles", risk: "read-only", registered: true },
			{
				name: "writeFile",
				risk: "destructive",
				registered: false,
				disabledReason: "リスク区分が destructive のため登録しません。",
			},
		],
	},
	{ id: "github", state: "unavailable", reason: "認証に失敗しました（auth-failed）。", tools: [] },
];

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
