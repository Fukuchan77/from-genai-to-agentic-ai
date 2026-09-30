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
