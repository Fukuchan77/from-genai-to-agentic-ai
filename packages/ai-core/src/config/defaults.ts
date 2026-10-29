export const DEFAULT_AGENT_LIMITS = Object.freeze({
	maxSteps: 10,
	maxTotalTokens: 50_000,
	maxDurationMs: 120_000,
	toolTimeoutMs: 15_000,
});

export const DEFAULT_CHAT_RATE_LIMIT = Object.freeze({
	maxRequests: 20,
	windowSeconds: 60,
});

export const DEFAULT_INPUT_LIMITS = Object.freeze({
	maxBodyBytes: 512 * 1024,
	maxMessages: 50,
	maxTextCharacters: 8_000,
	maxImages: 4,
	maxImageBytes: 5 * 1024 * 1024,
});

export const DEFAULT_RAG = Object.freeze({
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

export const DEFAULT_WORKFLOW_LIMITS = Object.freeze({
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

/** Compose `postgres` service defaults (`compose.yaml`); the host is always loopback. */
export const DEFAULT_DATABASE = Object.freeze({
	host: "127.0.0.1",
	port: 5432,
	user: "postgres",
	password: "postgres",
	database: "agentic_ai",
});

/** Default allowed root of the self-made file MCP server, relative to the repository root (003 CL-5). */
export const DEFAULT_MCP_FS_ROOT = "workspace/";

export const DEFAULT_TOOLS = Object.freeze({
	/** Equals M1's `MAX_AGENT_TOOLS` (a test keeps them in step; `config` cannot import `agents`). */
	maxToolsPerAgent: 20,
	conciseMaxCharacters: 1_000,
	thinkEnabled: true,
});

export const DEFAULT_HELPDESK = Object.freeze({
	maxSteps: 12,
	maxPlanRegenerations: 2,
	maxPlanTasks: 8,
	maxInquiryCharacters: 4_000,
});

export const DEFAULT_SANDBOX = Object.freeze({
	idleTimeoutMs: 600_000,
	executionTimeoutMs: 60_000,
	memoryBytes: 512 * 1024 * 1024,
	cpus: 1,
	pidsLimit: 128,
	image: "agentic-ai-sandbox:local",
	/** Sandboxes alive at once; a new session over this evicts the idle one used longest ago. */
	maxSessions: 8,
});

export const DEFAULT_ANALYSIS = Object.freeze({
	maxFixAttempts: 3,
	maxUploadBytes: 20 * 1024 * 1024,
	maxFigureBytes: 1024 * 1024,
	maxTableRows: 200,
	maxInstructionCharacters: 2_000,
});

export const DEFAULT_ARXIV = Object.freeze({
	minIntervalMs: 3_000,
	maxRetries: 3,
	cacheTtlMs: 86_400_000,
	maxResponseBytes: 2 * 1024 * 1024,
	maxResults: 10,
});

export const DEFAULT_RESEARCH = Object.freeze({
	maxSubagentCalls: 8,
	maxTotalTokens: 80_000,
	subagentSummaryCharacters: 800,
});

export const DEFAULT_INTERVIEW = Object.freeze({
	personaCount: 3,
	maxRounds: 5,
	maxAnswerCharacters: 2_000,
});

export const DEFAULT_COUNCIL = Object.freeze({
	maxRounds: 3,
	maxTotalTokens: 50_000,
	/** Must match the seeded `marketing_personas` rows. */
	personaIds: Object.freeze(["marketer-strict", "consumer", "seo-specialist"]),
	maxDraftCharacters: 2_000,
});
