import { z } from "zod";
import { DEFAULT_AGENT_LIMITS, DEFAULT_CHAT_RATE_LIMIT } from "./defaults";

const emptyToUndefined = (value: unknown): unknown => (value === "" ? undefined : value);

const optionalString = z.preprocess(emptyToUndefined, z.string().min(1).optional());
const optionalModelId = z.preprocess(emptyToUndefined, z.string().min(1).optional());
const positiveInteger = (defaultValue: number) =>
	z.preprocess(emptyToUndefined, z.coerce.number().int().positive().default(defaultValue));

export const envSchema = z.object({
	AI_RUN_MODE: z.preprocess(emptyToUndefined, z.enum(["mock", "local", "live"]).default("local")),
	AI_TEST_RUN_MODE: z.preprocess(emptyToUndefined, z.enum(["mock", "local", "live"]).optional()),
	AI_LIVE_PROVIDER: z.preprocess(
		emptyToUndefined,
		z.enum(["anthropic", "openai", "azure", "google"]).default("anthropic"),
	),
	AI_MODEL_CHAT: optionalModelId,
	AI_MODEL_STRUCTURED: optionalModelId,
	AI_MODEL_EMBEDDING: optionalModelId,
	AI_MODEL_JUDGE: optionalModelId,
	AI_RECORD: z.preprocess(
		emptyToUndefined,
		z
			.enum(["1"])
			.transform(() => true)
			.optional()
			.default(false),
	),
	OLLAMA_BASE_URL: z.preprocess(
		emptyToUndefined,
		z.string().url().default("http://127.0.0.1:11434"),
	),
	ANTHROPIC_API_KEY: optionalString,
	OPENAI_API_KEY: optionalString,
	AZURE_API_KEY: optionalString,
	AZURE_RESOURCE_NAME: optionalString,
	GOOGLE_GENERATIVE_AI_API_KEY: optionalString,
	TAVILY_API_KEY: optionalString,
	AGENT_MAX_STEPS: positiveInteger(DEFAULT_AGENT_LIMITS.maxSteps),
	AGENT_MAX_TOTAL_TOKENS: positiveInteger(DEFAULT_AGENT_LIMITS.maxTotalTokens),
	AGENT_MAX_DURATION_MS: positiveInteger(DEFAULT_AGENT_LIMITS.maxDurationMs),
	AGENT_TOOL_TIMEOUT_MS: positiveInteger(DEFAULT_AGENT_LIMITS.toolTimeoutMs),
	CHAT_RATE_LIMIT_MAX: positiveInteger(DEFAULT_CHAT_RATE_LIMIT.maxRequests),
	CHAT_RATE_LIMIT_WINDOW_SECONDS: positiveInteger(DEFAULT_CHAT_RATE_LIMIT.windowSeconds),
	POSTGRES_USER: optionalString,
	POSTGRES_PASSWORD: optionalString,
	POSTGRES_DB: optionalString,
	POSTGRES_PORT: optionalString,
	LANGFUSE_BASE_URL: optionalString,
	LANGFUSE_PUBLIC_KEY: optionalString,
	LANGFUSE_SECRET_KEY: optionalString,
	LANGFUSE_PORT: optionalString,
	LANGFUSE_NEXTAUTH_SECRET: optionalString,
	LANGFUSE_SALT: optionalString,
	LANGFUSE_ENCRYPTION_KEY: optionalString,
	LANGFUSE_DB_NAME: optionalString,
	LANGFUSE_CLICKHOUSE_USER: optionalString,
	LANGFUSE_CLICKHOUSE_PASSWORD: optionalString,
	LANGFUSE_REDIS_AUTH: optionalString,
	LANGFUSE_MINIO_ROOT_USER: optionalString,
	LANGFUSE_MINIO_ROOT_PASSWORD: optionalString,
});

export const ENV_KEYS = Object.freeze(
	Object.keys(envSchema.shape),
) as readonly (keyof typeof envSchema.shape)[];

export type EnvSource = Readonly<Record<string, string | undefined>>;
export type ParsedEnv = z.output<typeof envSchema>;
