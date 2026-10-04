import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_LIMITS, DEFAULT_CHAT_RATE_LIMIT, DEFAULT_INPUT_LIMITS } from "./defaults";
import { ENV_KEYS, envSchema } from "./env-schema";

describe("envSchema", () => {
	it("applies runtime, provider, URL, agent, and rate-limit defaults", () => {
		const env = envSchema.parse({});

		expect(env).toMatchObject({
			AI_RUN_MODE: "local",
			AI_LIVE_PROVIDER: "anthropic",
			AI_RECORD: false,
			OLLAMA_BASE_URL: "http://127.0.0.1:11434",
			AGENT_MAX_STEPS: 10,
			AGENT_MAX_TOTAL_TOKENS: 50_000,
			AGENT_MAX_DURATION_MS: 120_000,
			AGENT_TOOL_TIMEOUT_MS: 15_000,
			CHAT_RATE_LIMIT_MAX: 20,
			CHAT_RATE_LIMIT_WINDOW_SECONDS: 60,
		});
		expect(DEFAULT_AGENT_LIMITS).toEqual({
			maxSteps: 10,
			maxTotalTokens: 50_000,
			maxDurationMs: 120_000,
			toolTimeoutMs: 15_000,
		});
		expect(DEFAULT_CHAT_RATE_LIMIT).toEqual({ maxRequests: 20, windowSeconds: 60 });
		expect(DEFAULT_INPUT_LIMITS).toEqual({
			maxBodyBytes: 512 * 1024,
			maxMessages: 50,
			maxTextCharacters: 8_000,
			maxImages: 4,
			maxImageBytes: 5 * 1024 * 1024,
		});
	});

	it("converts non-empty numeric and recording values while treating empty fields as absent", () => {
		const env = envSchema.parse({
			AI_RUN_MODE: "live",
			AI_TEST_RUN_MODE: "",
			AI_RECORD: "1",
			AI_MODEL_CHAT: "",
			AGENT_MAX_STEPS: "7",
			CHAT_RATE_LIMIT_WINDOW_SECONDS: "90",
		});

		expect(env.AI_RUN_MODE).toBe("live");
		expect(env.AI_TEST_RUN_MODE).toBeUndefined();
		expect(env.AI_RECORD).toBe(true);
		expect(env.AI_MODEL_CHAT).toBeUndefined();
		expect(env.AGENT_MAX_STEPS).toBe(7);
		expect(env.CHAT_RATE_LIMIT_WINDOW_SECONDS).toBe(90);
	});

	it.each([
		["AI_RUN_MODE", "offline"],
		["AI_LIVE_PROVIDER", "ollama"],
		["AI_RECORD", "true"],
		["OLLAMA_BASE_URL", "not-a-url"],
		["AGENT_MAX_STEPS", "0"],
		["AGENT_MAX_TOTAL_TOKENS", "1.5"],
	])("rejects an invalid %s value", (key, value) => {
		expect(() => envSchema.parse({ [key]: value })).toThrow();
	});

	it("publishes a unique list matching the schema shape", () => {
		expect(new Set(ENV_KEYS).size).toBe(ENV_KEYS.length);
		expect([...ENV_KEYS].sort()).toEqual(Object.keys(envSchema.shape).sort());
	});
});
