import { readFileSync } from "node:fs";
import { describe, expect, expectTypeOf, it } from "vitest";
import { PlatformError } from "../errors";
import { MODEL_CATALOG } from "../models/catalog";
import { ConfigError, ENV_KEYS, loadPlatformConfig, type PlatformConfig } from "./index";

function envExampleEntries(): [string, string][] {
	const source = readFileSync(new URL("../../../../.env.example", import.meta.url), "utf8");
	return [...source.matchAll(/^([A-Z][A-Z0-9_]*)=(.*)$/gmu)].map((match) => [
		match[1] as string,
		match[2] as string,
	]);
}

function envNamesFromExample(): string[] {
	return envExampleEntries().map(([name]) => name);
}

describe("loadPlatformConfig", () => {
	it("returns typed defaults and catalog-backed models for local mode", () => {
		const config = loadPlatformConfig({});

		expect(config).toMatchObject({
			mode: "local",
			provider: "ollama",
			recording: false,
			ollamaBaseUrl: "http://127.0.0.1:11434",
			agent: {
				maxSteps: 10,
				maxTotalTokens: 50_000,
				maxDurationMs: 120_000,
				toolTimeoutMs: 15_000,
			},
			rateLimit: { maxRequests: 20, windowSeconds: 60 },
		});
		for (const id of Object.values(config.models)) expect(MODEL_CATALOG).toHaveProperty(id);
		expectTypeOf(config).toEqualTypeOf<PlatformConfig>();
	});

	it("uses explicit catalog model IDs and rejects IDs outside the catalog", () => {
		const chatId = Object.values(MODEL_CATALOG).find(
			(entry) => entry.provider === "ollama" && entry.capabilities.tools,
		)?.id;
		if (!chatId) throw new Error("Local chat model fixture is missing");

		expect(loadPlatformConfig({ AI_MODEL_CHAT: chatId }).models.chat).toBe(chatId);
		expect(() => loadPlatformConfig({ AI_MODEL_CHAT: ["outside", "catalog"].join("-") })).toThrow(
			ConfigError,
		);
	});

	it("lists every missing variable with the feature that requires it", () => {
		let thrown: unknown;
		try {
			loadPlatformConfig(
				{ AI_RUN_MODE: "live", AI_LIVE_PROVIDER: "azure" },
				{ features: ["web-search"] },
			);
		} catch (error) {
			thrown = error;
		}

		expect(thrown).toBeInstanceOf(ConfigError);
		expect(thrown).toBeInstanceOf(PlatformError);
		expect(thrown).toMatchObject({
			code: "invalid-request",
			missing: [
				{ variable: "AZURE_API_KEY", feature: "live-azure" },
				{ variable: "AZURE_RESOURCE_NAME", feature: "live-azure" },
				{ variable: "TAVILY_API_KEY", feature: "web-search" },
			],
		});
		expect((thrown as Error).message).toContain("AZURE_API_KEY");
		expect((thrown as Error).message).toContain("web-search");
	});

	it("rejects recording in mock mode", () => {
		expect(() =>
			loadPlatformConfig({ VITEST: "true", AI_TEST_RUN_MODE: "mock", AI_RECORD: "1" }),
		).toThrowError(/mock.*録画|録画.*mock/u);
	});

	it("accepts recording in local mode", () => {
		expect(loadPlatformConfig({ AI_RUN_MODE: "local", AI_RECORD: "1" }).recording).toBe(true);
	});

	it("loads the unedited .env.example template as local defaults", () => {
		const config = loadPlatformConfig(Object.fromEntries(envExampleEntries()));

		expect(config).toMatchObject({ mode: "local", provider: "ollama", recording: false });
	});

	it("reports an invalid run mode as ConfigError", () => {
		expect(() => loadPlatformConfig({ AI_RUN_MODE: "offline" })).toThrow(ConfigError);
		expect(() => loadPlatformConfig({ VITEST: "true", AI_TEST_RUN_MODE: "offline" })).toThrow(
			ConfigError,
		);
	});

	it("keeps the sample environment variable names identical to the schema", () => {
		expect(envNamesFromExample().sort()).toEqual([...ENV_KEYS].sort());
	});
});
