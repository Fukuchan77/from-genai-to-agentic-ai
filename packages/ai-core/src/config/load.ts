import { PlatformError } from "../errors";
import { type CatalogModelId, defaultModelFor, MODEL_CATALOG } from "../models/catalog";
import type { ModelPurpose, ProviderId, RunMode } from "../models/types";
import {
	DEFAULT_DATABASE,
	DEFAULT_INPUT_LIMITS,
	DEFAULT_MCP_FS_ROOT,
	DEFAULT_SANDBOX,
} from "./defaults";
import { type EnvSource, envSchema, type ParsedEnv } from "./env-schema";
import {
	FEATURE_REQUIREMENTS,
	type FeatureId,
	type RequiredEnvVariable,
} from "./feature-requirements";
import { resolveRunMode } from "./run-mode";

export interface MissingFeatureVariable {
	readonly variable: RequiredEnvVariable;
	readonly feature: FeatureId;
}

export class ConfigError extends PlatformError {
	readonly missing: readonly MissingFeatureVariable[];

	constructor(message: string, missing: readonly MissingFeatureVariable[] = []) {
		super("invalid-request", message, { missing });
		this.missing = missing;
	}
}

export interface PlatformConfig {
	readonly mode: RunMode;
	readonly provider: ProviderId;
	readonly models: Readonly<Partial<Record<ModelPurpose, CatalogModelId>>>;
	readonly recording: boolean;
	readonly ollamaBaseUrl: string;
	readonly credentials: Readonly<{
		anthropic?: string;
		openai?: string;
		azure?: Readonly<{ apiKey: string; resourceName: string }>;
		google?: string;
		tavily?: string;
		cohere?: string;
		e2b?: string;
		github?: string;
	}>;
	readonly agent: Readonly<{
		maxSteps: number;
		maxTotalTokens: number;
		maxDurationMs: number;
		toolTimeoutMs: number;
	}>;
	readonly rateLimit: Readonly<{ maxRequests: number; windowSeconds: number }>;
	readonly database: Readonly<{
		host: string;
		port: number;
		user: string;
		password: string;
		database: string;
	}>;
	readonly input: typeof DEFAULT_INPUT_LIMITS;
	/** Allowed root of the file MCP server; resolved to a real path when the server starts. */
	readonly mcpFsRoot: string;
	/** Local container sandbox settings. Whether Docker is usable is decided by a socket probe. */
	readonly docker: Readonly<{ host: string | undefined; image: string }>;
}

function featureForLiveProvider(provider: ParsedEnv["AI_LIVE_PROVIDER"]): FeatureId {
	return `live-${provider}`;
}

function selectedFeatures(
	mode: RunMode,
	provider: ParsedEnv["AI_LIVE_PROVIDER"],
	features: readonly FeatureId[],
): readonly FeatureId[] {
	return [...new Set(mode === "live" ? [featureForLiveProvider(provider), ...features] : features)];
}

function missingVariables(
	env: ParsedEnv,
	features: readonly FeatureId[],
): MissingFeatureVariable[] {
	return features.flatMap((feature) =>
		FEATURE_REQUIREMENTS[feature]
			.filter((variable) => env[variable] === undefined)
			.map((variable) => ({ variable, feature })),
	);
}

function catalogModelId(value: string, variable: string): CatalogModelId {
	if (!Object.hasOwn(MODEL_CATALOG, value)) {
		throw new ConfigError(`${variable} にモデルカタログ外の ID が指定されています。`);
	}
	return value as CatalogModelId;
}

function defaultModel(
	mode: RunMode,
	provider: ProviderId,
	purpose: ModelPurpose,
): CatalogModelId | undefined {
	try {
		return defaultModelFor(mode, provider, purpose);
	} catch (error) {
		if (error instanceof RangeError) return undefined;
		throw error;
	}
}

function resolveModels(
	env: ParsedEnv,
	mode: RunMode,
	provider: ProviderId,
): PlatformConfig["models"] {
	const configured = {
		chat: env.AI_MODEL_CHAT,
		structured: env.AI_MODEL_STRUCTURED,
		embedding: env.AI_MODEL_EMBEDDING,
		judge: env.AI_MODEL_JUDGE,
	} as const;
	const variableFor = {
		chat: "AI_MODEL_CHAT",
		structured: "AI_MODEL_STRUCTURED",
		embedding: "AI_MODEL_EMBEDDING",
		judge: "AI_MODEL_JUDGE",
	} as const;
	const models: Partial<Record<ModelPurpose, CatalogModelId>> = {};

	for (const purpose of Object.keys(configured) as ModelPurpose[]) {
		const explicit = configured[purpose];
		const id = explicit
			? catalogModelId(explicit, variableFor[purpose])
			: defaultModel(mode, provider, purpose);
		if (id) models[purpose] = id;
	}
	return models;
}

function resolveDatabase(env: ParsedEnv): PlatformConfig["database"] {
	// Plain decimal digits only: `Number()` would also accept "0x1538", "1e3", and padded input.
	const raw = env.POSTGRES_PORT;
	const port =
		raw === undefined ? DEFAULT_DATABASE.port : /^\d{1,5}$/u.test(raw) ? Number(raw) : -1;
	if (port < 1 || port > 65_535) {
		throw new ConfigError("POSTGRES_PORT は 1〜65535 の整数で指定してください。");
	}
	return {
		host: DEFAULT_DATABASE.host,
		port,
		user: env.POSTGRES_USER ?? DEFAULT_DATABASE.user,
		password: env.POSTGRES_PASSWORD ?? DEFAULT_DATABASE.password,
		database: env.POSTGRES_DB ?? DEFAULT_DATABASE.database,
	};
}

function resolveProvider(mode: RunMode, liveProvider: ParsedEnv["AI_LIVE_PROVIDER"]): ProviderId {
	if (mode === "mock") return "mock";
	if (mode === "local") return "ollama";
	return liveProvider;
}

export function loadPlatformConfig(
	env: EnvSource = process.env,
	options: { readonly features?: readonly FeatureId[] } = {},
): PlatformConfig {
	const parsed = envSchema.safeParse(env);
	if (!parsed.success) {
		throw new ConfigError(`環境変数の形式が正しくありません: ${parsed.error.message}`);
	}
	const mode = resolveRunMode(env);

	const selected = selectedFeatures(mode, parsed.data.AI_LIVE_PROVIDER, options.features ?? []);
	const missing = missingVariables(parsed.data, selected);
	if (missing.length > 0) {
		const summary = missing.map(({ variable, feature }) => `${variable} (${feature})`).join(", ");
		throw new ConfigError(`必須の環境変数が不足しています: ${summary}`, missing);
	}
	if (mode === "mock" && parsed.data.AI_RECORD) {
		throw new ConfigError(
			"mock モードでは録画を有効にできません。local または live を使用してください。",
		);
	}

	const provider = resolveProvider(mode, parsed.data.AI_LIVE_PROVIDER);
	return {
		mode,
		provider,
		models: resolveModels(parsed.data, mode, provider),
		recording: parsed.data.AI_RECORD,
		ollamaBaseUrl: parsed.data.OLLAMA_BASE_URL,
		credentials: {
			...(parsed.data.ANTHROPIC_API_KEY ? { anthropic: parsed.data.ANTHROPIC_API_KEY } : {}),
			...(parsed.data.OPENAI_API_KEY ? { openai: parsed.data.OPENAI_API_KEY } : {}),
			...(parsed.data.AZURE_API_KEY && parsed.data.AZURE_RESOURCE_NAME
				? {
						azure: {
							apiKey: parsed.data.AZURE_API_KEY,
							resourceName: parsed.data.AZURE_RESOURCE_NAME,
						},
					}
				: {}),
			...(parsed.data.GOOGLE_GENERATIVE_AI_API_KEY
				? { google: parsed.data.GOOGLE_GENERATIVE_AI_API_KEY }
				: {}),
			...(parsed.data.TAVILY_API_KEY ? { tavily: parsed.data.TAVILY_API_KEY } : {}),
			...(parsed.data.COHERE_API_KEY ? { cohere: parsed.data.COHERE_API_KEY } : {}),
			...(parsed.data.E2B_API_KEY ? { e2b: parsed.data.E2B_API_KEY } : {}),
			...(parsed.data.GITHUB_TOKEN ? { github: parsed.data.GITHUB_TOKEN } : {}),
		},
		agent: {
			maxSteps: parsed.data.AGENT_MAX_STEPS,
			maxTotalTokens: parsed.data.AGENT_MAX_TOTAL_TOKENS,
			maxDurationMs: parsed.data.AGENT_MAX_DURATION_MS,
			toolTimeoutMs: parsed.data.AGENT_TOOL_TIMEOUT_MS,
		},
		rateLimit: {
			maxRequests: parsed.data.CHAT_RATE_LIMIT_MAX,
			windowSeconds: parsed.data.CHAT_RATE_LIMIT_WINDOW_SECONDS,
		},
		database: resolveDatabase(parsed.data),
		input: DEFAULT_INPUT_LIMITS,
		mcpFsRoot: parsed.data.MCP_FS_ROOT ?? DEFAULT_MCP_FS_ROOT,
		docker: {
			host: parsed.data.DOCKER_HOST,
			image: parsed.data.DOCKER_SANDBOX_IMAGE ?? DEFAULT_SANDBOX.image,
		},
	};
}
