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
