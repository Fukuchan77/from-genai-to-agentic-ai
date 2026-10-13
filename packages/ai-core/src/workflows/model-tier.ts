import { MODEL_TIERS, type ModelGateway, type ResolvedModel } from "../models";
import type { StructuredUsage } from "../structured";

export type ModelTier = "light" | "capable";

export interface ModelTiers {
	readonly light: ResolvedModel;
	readonly capable: ResolvedModel;
}

export const EMPTY_USAGE: StructuredUsage = Object.freeze({
	inputTokens: 0,
	outputTokens: 0,
	totalTokens: 0,
	cacheReadTokens: 0,
});

/** Sums token usages; an absent usage counts as zero. */
export function sumUsage(...usages: readonly (StructuredUsage | undefined)[]): StructuredUsage {
	return usages.reduce<StructuredUsage>(
		(total, usage) =>
			usage
				? {
						inputTokens: total.inputTokens + usage.inputTokens,
						outputTokens: total.outputTokens + usage.outputTokens,
						totalTokens: total.totalTokens + usage.totalTokens,
						cacheReadTokens: total.cacheReadTokens + usage.cacheReadTokens,
					}
				: total,
		EMPTY_USAGE,
	);
}

/**
 * Resolves the light and capable chat models for the gateway's run mode and provider from
 * `MODEL_TIERS` (CL-10). The default chat model tells which mode and provider are active; when no
 * tiers are listed for them, both tiers are that model. This is the only workflow function that
 * calls the gateway.
 */
export async function resolveTiers(gateway: ModelGateway): Promise<ModelTiers> {
	const base = await gateway.resolve({ purpose: "chat" });
	const listed = (
		MODEL_TIERS as Readonly<
			Record<string, Readonly<Record<string, { light: string; capable: string } | undefined>>>
		>
	)[base.mode]?.[base.entry.provider];
	const resolveTier = async (modelId: string | undefined): Promise<ResolvedModel> =>
		modelId === undefined || modelId === base.entry.id
			? base
			: gateway.resolve({ purpose: "chat", modelId });
	const [light, capable] = await Promise.all([
		resolveTier(listed?.light),
		resolveTier(listed?.capable),
	]);
	return { light, capable };
}

export type Difficulty = "easy" | "hard";

export interface DifficultyClassification {
	readonly difficulty: Difficulty;
	readonly reason: string;
	readonly usage?: StructuredUsage | undefined;
}

export interface RouteByDifficultyParams<T> {
	readonly input: unknown;
	readonly tiers: ModelTiers;
	/** Gets the light model, so classifying costs less than answering. */
	readonly classifyDifficulty: (args: {
		readonly input: unknown;
		readonly light: ResolvedModel;
		readonly signal: AbortSignal | undefined;
	}) => Promise<DifficultyClassification>;
	readonly run: (
		input: unknown,
		model: ResolvedModel,
		signal: AbortSignal | undefined,
	) => Promise<{ readonly output: T; readonly usage: StructuredUsage }>;
	readonly signal?: AbortSignal | undefined;
}

export interface RouteByDifficultyResult<T> {
	readonly difficulty: Difficulty;
	readonly reason: string;
	readonly tier: ModelTier;
	readonly modelId: string;
	readonly displayName: string;
	/** `false` when both tiers are the same model (the live catalog has one model per provider). */
	readonly distinct: boolean;
	readonly output: T;
	/** Classification plus answer. */
	readonly usage: StructuredUsage;
}

/**
 * Classifies the input's difficulty and answers it with the light or the capable model (Req 3.12).
 * The result names the model that answered and sums the tokens of both calls.
 */
export async function routeByDifficulty<T>(
	params: RouteByDifficultyParams<T>,
): Promise<RouteByDifficultyResult<T>> {
	const { signal, tiers } = params;
	signal?.throwIfAborted();
	const classification = await params.classifyDifficulty({
		input: params.input,
		light: tiers.light,
		signal,
	});
	signal?.throwIfAborted();
	const tier: ModelTier = classification.difficulty === "easy" ? "light" : "capable";
	const model = tiers[tier];
	const answer = await params.run(params.input, model, signal);
	return {
		difficulty: classification.difficulty,
		reason: classification.reason,
		tier,
		modelId: model.entry.id,
		displayName: model.entry.displayName,
		distinct: tiers.light.entry.id !== tiers.capable.entry.id,
		output: answer.output,
		usage: sumUsage(classification.usage, answer.usage),
	};
}
