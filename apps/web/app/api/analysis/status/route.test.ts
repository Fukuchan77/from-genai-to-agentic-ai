import { DEFAULT_ANALYSIS } from "@platform/ai-core/config";
import { PlatformError } from "@platform/ai-core/errors";
import { createFakeClock } from "@platform/ai-core/ports";
import { createMockSandboxProvider, createSandboxRegistry } from "@platform/ai-core/sandbox";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createPlatform,
	getSandboxSelection,
	type SandboxSetup,
	setPlatformForTesting,
	setSandboxForTesting,
} from "@/lib/server/platform";
import { GET } from "./route";

const KEY = "changeme-e2b-route-secret";

vi.mock("@/lib/server/platform", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/server/platform")>();
	return { ...original, getSandboxSelection: vi.fn(original.getSandboxSelection) };
});

afterEach(() => {
	vi.mocked(getSandboxSelection).mockReset();
	setSandboxForTesting(undefined);
	setPlatformForTesting(undefined);
});

function enabled(kind: "e2b" | "docker" | "mock"): SandboxSetup {
	const provider = createMockSandboxProvider();
	return {
		kind,
		provider,
		registry: createSandboxRegistry({ provider, clock: createFakeClock(), idleTimeoutMs: 1000 }),
		stop: () => undefined,
	};
}

async function install(setup: SandboxSetup, env: Record<string, string> = {}) {
	setPlatformForTesting(
		await createPlatform({ env: { VITEST: "1", AI_TEST_RUN_MODE: "mock", ...env } }),
	);
	setSandboxForTesting(setup);
}

async function read(): Promise<{ status: number; body: Record<string, unknown>; text: string }> {
	const response = await GET();
	const text = await response.text();
	return { status: response.status, body: JSON.parse(text) as Record<string, unknown>, text };
}

describe("GET /api/analysis/status", () => {
	it.each(["e2b", "docker", "mock"] as const)(
		"reports the sandbox kind %s and the upload limits",
		async (kind) => {
			await install(enabled(kind));

			const { status, body } = await read();

			expect(status).toBe(200);
			expect(body).toEqual({
				sandbox: { kind },
				upload: { maxBytes: DEFAULT_ANALYSIS.maxUploadBytes, accepts: [".csv", ".xlsx", ".xls"] },
			});
		},
	);

	it("reports a disabled sandbox with the reason and what to set up", async () => {
		await install({
			kind: "disabled",
			reason: "E2B_API_KEY が未設定で、ローカルのコンテナ実行環境（Docker）にも接続できません。",
			guidance:
				"E2B_API_KEY を設定するか、Docker を起動して `mise run sandbox:build` で画像（agentic-ai-sandbox:local）を作ってください。",
		});

		const { status, body } = await read();

		expect(status).toBe(200);
		expect(body.sandbox).toMatchObject({ kind: "disabled" });
		const sandbox = body.sandbox as { reason: string; guidance: string };
		expect(sandbox.guidance).toContain("E2B_API_KEY");
		expect(sandbox.guidance).toContain("mise run sandbox:build");
		expect(sandbox.reason).toContain("Docker");
	});

	it("never carries a key, a socket path or a stack trace", async () => {
		await install(enabled("e2b"), { E2B_API_KEY: KEY });

		const { text } = await read();

		expect(text).not.toContain(KEY);
		expect(text).not.toMatch(/\.sock|node_modules|\bat \S+ \(/u);
	});

	it("answers with the error's own status and message when the sandbox cannot be assembled", async () => {
		vi.mocked(getSandboxSelection).mockRejectedValueOnce(
			new PlatformError("provider-unavailable", "サンドボックスを用意できませんでした。"),
		);

		const { status, body } = await read();

		expect(status).toBe(503);
		expect(body).toEqual({
			error: { code: "provider-unavailable", message: "サンドボックスを用意できませんでした。" },
		});
	});

	it("hides the text of an unexpected failure", async () => {
		vi.mocked(getSandboxSelection).mockRejectedValueOnce(
			new Error("secret detail /Users/me/engine-path"),
		);

		const { status, text } = await read();

		expect(status).toBe(500);
		expect(text).not.toContain("secret detail");
		expect(text).not.toContain("engine-path");
	});
});
