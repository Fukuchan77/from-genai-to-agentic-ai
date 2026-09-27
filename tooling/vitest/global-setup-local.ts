import type { TestProject } from "vitest/node";
import { DEFAULT_OLLAMA_BASE_URL, normalizeOllamaBaseUrl, ollamaTagsUrl } from "./ollama";

export { DEFAULT_OLLAMA_BASE_URL } from "./ollama";

const OLLAMA_CHECK_TIMEOUT_MS = 2_000;
const OLLAMA_DEFAULT_TAG = ":latest";
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

export interface OllamaTagsResponse {
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

/** Models named by the `AI_MODEL_*` variables, trimmed, without blanks or duplicates. */
export function requiredModels(env: NodeJS.ProcessEnv): string[] {
	return [
		...new Set(
			REQUIRED_MODEL_ENV_KEYS.map((key) => env[key]?.trim()).filter((model): model is string =>
				Boolean(model),
			),
		),
	];
}

/** Parses an Ollama `/api/tags` body; returns `undefined` for any malformed shape. */
export function parseTagsResponse(value: unknown): OllamaTagsResponse | undefined {
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

function withDefaultTag(model: string): string {
	return model.includes(":") ? model : `${model}${OLLAMA_DEFAULT_TAG}`;
}

/**
 * Required models that are not installed. Ollama reports untagged pulls as `name:latest`, so an
 * untagged name and its `:latest` tag are treated as the same model.
 */
export function findMissingModels(
	required: readonly string[],
	installed: readonly string[],
): string[] {
	const installedModels = new Set(installed.map(withDefaultTag));
	return required.filter((model) => !installedModels.has(withDefaultTag(model)));
}

export function httpErrorReason(status: number, statusText: string, tagsUrl: string): string {
	const statusLabel = statusText ? `${status} ${statusText}` : String(status);
	return `Ollama returned HTTP ${statusLabel} from ${tagsUrl}.`;
}

function invalidTagsReason(tagsUrl: string): string {
	return `Ollama returned an invalid /api/tags response from ${tagsUrl}.`;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function readJson(response: Response): Promise<{ ok: true; value: unknown } | { ok: false }> {
	try {
		return { ok: true, value: await response.json() };
	} catch {
		return { ok: false };
	}
}

export async function checkLocalAvailability(
	options: CheckLocalAvailabilityOptions = {},
): Promise<LocalAvailability> {
	const env = options.env ?? process.env;
	const configuredBaseUrl = env.OLLAMA_BASE_URL?.trim() || DEFAULT_OLLAMA_BASE_URL;
	if (env.AI_TEST_RUN_MODE !== "local") {
		return unavailable(
			normalizeOllamaBaseUrl(configuredBaseUrl) ?? configuredBaseUrl,
			"Local tests require AI_TEST_RUN_MODE=local.",
		);
	}

	const baseUrl = normalizeOllamaBaseUrl(configuredBaseUrl);
	if (!baseUrl) {
		return unavailable(configuredBaseUrl, "OLLAMA_BASE_URL must be an absolute http or https URL.");
	}

	const fetchImpl = options.fetch ?? globalThis.fetch;
	const tagsUrl = ollamaTagsUrl(baseUrl);
	let response: Response;
	try {
		response = await fetchImpl(tagsUrl, {
			headers: { accept: "application/json" },
			signal: AbortSignal.timeout(options.timeoutMs ?? OLLAMA_CHECK_TIMEOUT_MS),
		});
	} catch (error) {
		return unavailable(
			baseUrl,
			`Ollama is unavailable at ${baseUrl}: ${errorMessage(error)}. Start it with \`ollama serve\`.`,
		);
	}
	if (!response.ok) {
		return unavailable(baseUrl, httpErrorReason(response.status, response.statusText, tagsUrl));
	}

	const body = await readJson(response);
	const tags = body.ok ? parseTagsResponse(body.value) : undefined;
	if (!tags) return unavailable(baseUrl, invalidTagsReason(tagsUrl));

	const missingModels = findMissingModels(requiredModels(env), tags.models);
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
}

export default async function setupLocalAvailability(
	project: TestProject,
	options: SetupLocalAvailabilityOptions = {},
): Promise<void> {
	project.provide("localAvailability", await checkLocalAvailability(options));
}
