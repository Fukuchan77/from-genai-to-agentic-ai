import type { TestProject } from "vitest/node";

export const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";
const OLLAMA_TAGS_PATH = "/api/tags";
const OLLAMA_CHECK_TIMEOUT_MS = 2_000;
const REQUIRED_MODEL_ENV_KEYS = [
	"AI_MODEL_CHAT",
	"AI_MODEL_STRUCTURED",
	"AI_MODEL_EMBEDDING",
	"AI_MODEL_JUDGE",
] as const;

export interface LocalAvailability {
	available: boolean;
	baseUrl: string;
	models: string[];
	missingModels: string[];
	reason: string | null;
}

interface CheckLocalAvailabilityOptions {
	env?: NodeJS.ProcessEnv;
	fetch?: typeof globalThis.fetch;
	timeoutMs?: number;
}

interface SetupLocalAvailabilityOptions extends CheckLocalAvailabilityOptions {}

interface OllamaTagsResponse {
	models: string[];
}

declare module "vitest" {
	export interface ProvidedContext {
		localAvailability: LocalAvailability;
	}
}

function unavailable(
	baseUrl: string,
	reason: string,
	options: { models?: string[]; missingModels?: string[] } = {},
): LocalAvailability {
	return {
		available: false,
		baseUrl,
		models: options.models ?? [],
		missingModels: options.missingModels ?? [],
		reason,
	};
}

function normalizeBaseUrl(value: string | undefined): string | undefined {
	const candidate = value?.trim() || DEFAULT_OLLAMA_BASE_URL;
	try {
		const url = new URL(candidate);
		if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
		return url.href.replace(/\/+$/u, "");
	} catch {
		return undefined;
	}
}

function requiredModels(env: NodeJS.ProcessEnv): string[] {
	return [
		...new Set(
			REQUIRED_MODEL_ENV_KEYS.map((key) => env[key]?.trim()).filter((model): model is string =>
				Boolean(model),
			),
		),
	];
}

function parseTagsResponse(value: unknown): OllamaTagsResponse | undefined {
	if (typeof value !== "object" || value === null || !("models" in value)) return undefined;
	const models = (value as { models?: unknown }).models;
	if (!Array.isArray(models)) return undefined;

	const names: string[] = [];
	for (const model of models) {
		if (typeof model !== "object" || model === null) return undefined;
		const entry = model as { model?: unknown; name?: unknown };
		const name =
			typeof entry.name === "string"
				? entry.name
				: typeof entry.model === "string"
					? entry.model
					: undefined;
		if (!name) return undefined;
		names.push(name);
	}
	return { models: [...new Set(names)] };
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export async function checkLocalAvailability(
	options: CheckLocalAvailabilityOptions = {},
): Promise<LocalAvailability> {
	const env = options.env ?? process.env;
	const configuredBaseUrl = env.OLLAMA_BASE_URL?.trim() || DEFAULT_OLLAMA_BASE_URL;
	if (env.AI_TEST_RUN_MODE !== "local") {
		return unavailable(configuredBaseUrl, "Local tests require AI_TEST_RUN_MODE=local.");
	}

	const baseUrl = normalizeBaseUrl(configuredBaseUrl);
	if (!baseUrl) {
		return unavailable(configuredBaseUrl, "OLLAMA_BASE_URL must be an absolute http or https URL.");
	}

	const fetchImpl = options.fetch ?? globalThis.fetch;
	const tagsUrl = `${baseUrl}${OLLAMA_TAGS_PATH}`;
	try {
		const response = await fetchImpl(tagsUrl, {
			headers: { accept: "application/json" },
			signal: AbortSignal.timeout(options.timeoutMs ?? OLLAMA_CHECK_TIMEOUT_MS),
		});
		if (!response.ok) {
			return unavailable(baseUrl, `Ollama returned HTTP ${response.status} from ${tagsUrl}.`);
		}

		const tags = parseTagsResponse(await response.json());
		if (!tags) {
			return unavailable(baseUrl, "Ollama returned an invalid /api/tags response.");
		}

		const installedModels = new Set(tags.models);
		const missingModels = requiredModels(env).filter((model) => !installedModels.has(model));
		if (missingModels.length > 0) {
			const pullCommands = missingModels.map((model) => `\`ollama pull ${model}\``).join(", ");
			return unavailable(
				baseUrl,
				`Required Ollama models are not installed: ${missingModels.join(", ")}. Run ${pullCommands}.`,
				{ models: tags.models, missingModels },
			);
		}

		return {
			available: true,
			baseUrl,
			models: tags.models,
			missingModels: [],
			reason: null,
		};
	} catch (error) {
		return unavailable(
			baseUrl,
			`Ollama is unavailable at ${baseUrl}: ${errorMessage(error)}. Start it with \`ollama serve\`.`,
		);
	}
}

export default async function setupLocalAvailability(
	project: TestProject,
	options: SetupLocalAvailabilityOptions = {},
): Promise<void> {
	project.provide("localAvailability", await checkLocalAvailability(options));
}
