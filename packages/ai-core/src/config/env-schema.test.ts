import { describe, expect, it } from "vitest";
import { MAX_AGENT_TOOLS } from "../agents/guarded-agent";
import {
	DEFAULT_AGENT_LIMITS,
	DEFAULT_ANALYSIS,
	DEFAULT_ARXIV,
	DEFAULT_CHAT_RATE_LIMIT,
	DEFAULT_COUNCIL,
	DEFAULT_HELPDESK,
	DEFAULT_INPUT_LIMITS,
	DEFAULT_INTERVIEW,
	DEFAULT_MCP_FS_ROOT,
	DEFAULT_RAG,
	DEFAULT_RESEARCH,
	DEFAULT_SANDBOX,
	DEFAULT_TOOLS,
	DEFAULT_WORKFLOW_LIMITS,
} from "./defaults";
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

	it("accepts COHERE_API_KEY as an optional secret and treats empty as absent", () => {
		expect(envSchema.parse({}).COHERE_API_KEY).toBeUndefined();
		expect(envSchema.parse({ COHERE_API_KEY: "" }).COHERE_API_KEY).toBeUndefined();
		expect(envSchema.parse({ COHERE_API_KEY: "changeme" }).COHERE_API_KEY).toBe("changeme");
	});

	it("freezes the M2 retrieval and workflow defaults at the plan values", () => {
		expect(DEFAULT_RAG).toEqual({
			topK: 5,
			minSimilarity: 0.5,
			candidatePool: 20,
			rrfK: 60,
			subQueryCount: 3,
			chunkMaxCharacters: 800,
			maxQuestionCharacters: 2_000,
			maxIngestFiles: 50,
			maxIngestFileBytes: 5 * 1024 * 1024,
		});
		expect(DEFAULT_WORKFLOW_LIMITS).toEqual({
			maxSections: 8,
			defaultVotes: 3,
			maxVotes: 9,
			maxSubtasks: 6,
			maxPlanSteps: 8,
			defaultCandidates: 3,
			maxCandidates: 5,
			passScore: 85,
			defaultMaxIterations: 3,
			maxIterationsCap: 8,
			maxRoles: 5,
		});
		expect(Object.isFrozen(DEFAULT_RAG)).toBe(true);
		expect(Object.isFrozen(DEFAULT_WORKFLOW_LIMITS)).toBe(true);
	});

	it("freezes the M3 defaults at the plan values", () => {
		expect(DEFAULT_TOOLS).toEqual({
			maxToolsPerAgent: 20,
			conciseMaxCharacters: 1_000,
			thinkEnabled: true,
		});
		expect(DEFAULT_HELPDESK).toEqual({
			maxSteps: 12,
			maxPlanRegenerations: 2,
			maxPlanTasks: 8,
			maxInquiryCharacters: 4_000,
		});
		expect(DEFAULT_SANDBOX).toEqual({
			idleTimeoutMs: 600_000,
			executionTimeoutMs: 60_000,
			memoryBytes: 512 * 1024 * 1024,
			cpus: 1,
			pidsLimit: 128,
			image: "agentic-ai-sandbox:local",
		});
		expect(DEFAULT_ANALYSIS).toEqual({
			maxFixAttempts: 3,
			maxUploadBytes: 20 * 1024 * 1024,
			maxFigureBytes: 1024 * 1024,
			maxTableRows: 200,
			maxInstructionCharacters: 2_000,
		});
		expect(DEFAULT_ARXIV).toEqual({
			minIntervalMs: 3_000,
			maxRetries: 3,
			cacheTtlMs: 86_400_000,
			maxResponseBytes: 2 * 1024 * 1024,
			maxResults: 10,
		});
		expect(DEFAULT_RESEARCH).toEqual({
			maxSubagentCalls: 8,
			maxTotalTokens: 80_000,
			subagentSummaryCharacters: 800,
		});
		expect(DEFAULT_INTERVIEW).toEqual({
			personaCount: 3,
			maxRounds: 5,
			maxAnswerCharacters: 2_000,
		});
		expect(DEFAULT_COUNCIL).toEqual({
			maxRounds: 3,
			maxTotalTokens: 50_000,
			personaIds: ["marketer-strict", "consumer", "seo-specialist"],
			maxDraftCharacters: 2_000,
		});
		expect(DEFAULT_MCP_FS_ROOT).toBe("workspace/");
		for (const frozen of [
			DEFAULT_TOOLS,
			DEFAULT_HELPDESK,
			DEFAULT_SANDBOX,
			DEFAULT_ANALYSIS,
			DEFAULT_ARXIV,
			DEFAULT_RESEARCH,
			DEFAULT_INTERVIEW,
			DEFAULT_COUNCIL,
			DEFAULT_COUNCIL.personaIds,
		]) {
			expect(Object.isFrozen(frozen)).toBe(true);
		}
	});

	it("reuses the M1 agent tool cap", () => {
		expect(DEFAULT_TOOLS.maxToolsPerAgent).toBe(MAX_AGENT_TOOLS);
	});

	it.each([
		"E2B_API_KEY",
		"GITHUB_TOKEN",
		"MCP_FS_ROOT",
		"DOCKER_HOST",
		"DOCKER_SANDBOX_IMAGE",
	] as const)("accepts %s as an optional string and treats empty as absent", (name) => {
		expect(envSchema.parse({})[name]).toBeUndefined();
		expect(envSchema.parse({ [name]: "" })[name]).toBeUndefined();
		expect(envSchema.parse({ [name]: "changeme" })[name]).toBe("changeme");
	});

	it("publishes a unique list matching the schema shape", () => {
		expect(new Set(ENV_KEYS).size).toBe(ENV_KEYS.length);
		expect([...ENV_KEYS].sort()).toEqual(Object.keys(envSchema.shape).sort());
	});
});
