import type { ENV_KEYS } from "./env-schema";

export const FEATURE_REQUIREMENTS = {
	"live-anthropic": ["ANTHROPIC_API_KEY"],
	"live-openai": ["OPENAI_API_KEY"],
	"live-azure": ["AZURE_API_KEY", "AZURE_RESOURCE_NAME"],
	"live-google": ["GOOGLE_GENERATIVE_AI_API_KEY"],
	"web-search": ["TAVILY_API_KEY"],
} as const satisfies Readonly<Record<string, readonly (typeof ENV_KEYS)[number][]>>;

export const FEATURE_IDS = Object.freeze(Object.keys(FEATURE_REQUIREMENTS)) as readonly FeatureId[];

export type FeatureId = keyof typeof FEATURE_REQUIREMENTS;
export type RequiredEnvVariable = (typeof FEATURE_REQUIREMENTS)[FeatureId][number];
