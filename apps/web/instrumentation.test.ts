import { ConfigError, loadPlatformConfig } from "@platform/ai-core/config";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatConfigError, register } from "./instrumentation";

vi.mock("@platform/ai-core/config", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@platform/ai-core/config")>();
	return { ...actual, loadPlatformConfig: vi.fn(actual.loadPlatformConfig) };
});

function stubLiveWithoutKey(provider = "anthropic"): void {
	vi.stubEnv("NEXT_RUNTIME", "nodejs");
	vi.stubEnv("AI_TEST_RUN_MODE", "live");
	vi.stubEnv("AI_LIVE_PROVIDER", provider);
	vi.stubEnv("ANTHROPIC_API_KEY", "");
	vi.stubEnv("AZURE_API_KEY", "");
	vi.stubEnv("AZURE_RESOURCE_NAME", "");
}

afterEach(() => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

describe("register", () => {
	it("validates silently in mock mode", async () => {
		vi.stubEnv("NEXT_RUNTIME", "nodejs");
		vi.stubEnv("AI_TEST_RUN_MODE", "mock");
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

		await expect(register()).resolves.toBeUndefined();

		expect(error).not.toHaveBeenCalled();
	});

	it("lists every missing variable with its feature and stops startup", async () => {
		stubLiveWithoutKey("azure");
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

		await expect(register()).rejects.toBeInstanceOf(ConfigError);

		expect(error).toHaveBeenCalledTimes(1);
		const output = String(error.mock.calls[0]?.[0]);
		expect(output).toContain("AZURE_API_KEY");
		expect(output).toContain("AZURE_RESOURCE_NAME");
		expect(output).toContain("live-azure");
		expect(output).not.toContain("ANTHROPIC_API_KEY");
	});

	it("reports a malformed variable without a missing-variable list", async () => {
		vi.stubEnv("NEXT_RUNTIME", "nodejs");
		vi.stubEnv("AI_TEST_RUN_MODE", "mock");
		vi.stubEnv("AGENT_MAX_STEPS", "zero");
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

		await expect(register()).rejects.toBeInstanceOf(ConfigError);

		expect(String(error.mock.calls[0]?.[0])).toContain("AGENT_MAX_STEPS");
	});

	it("rethrows unexpected errors without formatting them as configuration errors", async () => {
		vi.stubEnv("NEXT_RUNTIME", "nodejs");
		vi.mocked(loadPlatformConfig).mockImplementationOnce(() => {
			throw new RangeError("unexpected");
		});
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

		await expect(register()).rejects.toBeInstanceOf(RangeError);

		expect(error).not.toHaveBeenCalled();
	});

	it("does nothing outside the Node.js runtime", async () => {
		stubLiveWithoutKey();
		vi.stubEnv("NEXT_RUNTIME", "edge");
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

		await expect(register()).resolves.toBeUndefined();

		expect(error).not.toHaveBeenCalled();
	});
});

describe("formatConfigError", () => {
	it("names each missing variable and feature on its own line", () => {
		const text = formatConfigError(
			new ConfigError("必須の環境変数が不足しています", [
				{ variable: "TAVILY_API_KEY", feature: "web-search" },
				{ variable: "OPENAI_API_KEY", feature: "live-openai" },
			]),
		);

		expect(text.split("\n")).toEqual(
			expect.arrayContaining([
				expect.stringContaining("TAVILY_API_KEY（機能: web-search）"),
				expect.stringContaining("OPENAI_API_KEY（機能: live-openai）"),
			]),
		);
	});

	it("never prints environment values", () => {
		vi.stubEnv("OPENAI_API_KEY", "sk-should-not-appear-0123456789");
		const text = formatConfigError(
			new ConfigError("x", [{ variable: "OPENAI_API_KEY", feature: "live-openai" }]),
		);
		expect(text).not.toContain("sk-should-not-appear");
	});
});
