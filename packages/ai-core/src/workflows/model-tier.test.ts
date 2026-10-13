import { describe, expect, it, vi } from "vitest";
import { loadPlatformConfig } from "../config";
import {
	type CatalogModelId,
	createModelGateway,
	getModelEntry,
	MODEL_DEFAULTS,
	MODEL_TIERS,
	type ModelGateway,
	type ResolvedModel,
	type ResolveRequest,
} from "../models";
import { createObjectModel } from "../testing/mock-models";
import {
	EMPTY_USAGE,
	type ModelTiers,
	resolveTiers,
	routeByDifficulty,
	sumUsage,
} from "./model-tier";

function resolved(id: Parameters<typeof getModelEntry>[0]): ResolvedModel {
	return { model: createObjectModel({}), entry: getModelEntry(id), mode: "mock" };
}

const LIGHT = resolved(MODEL_TIERS.local.ollama.light);
const CAPABLE = resolved(MODEL_TIERS.local.ollama.capable);
const USAGE = (inputTokens: number, outputTokens: number) => ({
	inputTokens,
	outputTokens,
	totalTokens: inputTokens + outputTokens,
	cacheReadTokens: 0,
});

describe("routeByDifficulty", () => {
	function tiers(light = LIGHT, capable = CAPABLE): ModelTiers {
		return { light, capable };
	}

	it("runs an easy input on the light model and reports the model name and token usage", async () => {
		const run = vi.fn(async (_input: unknown, model: ResolvedModel) => ({
			output: `answered by ${model.entry.id}`,
			usage: USAGE(10, 5),
		}));

		const result = await routeByDifficulty({
			input: "2+2?",
			tiers: tiers(),
			classifyDifficulty: async () => ({
				difficulty: "easy",
				reason: "単純な計算",
				usage: USAGE(3, 1),
			}),
			run,
		});

		expect(run).toHaveBeenCalledTimes(1);
		expect(run.mock.calls[0]?.[1]).toBe(LIGHT);
		expect(result).toEqual({
			difficulty: "easy",
			reason: "単純な計算",
			tier: "light",
			modelId: LIGHT.entry.id,
			displayName: LIGHT.entry.displayName,
			distinct: true,
			output: `answered by ${LIGHT.entry.id}`,
			usage: USAGE(13, 6),
		});
	});

	it("runs a hard input on the capable model", async () => {
		const run = vi.fn(async (_input: unknown, model: ResolvedModel) => ({
			output: model.entry.id,
			usage: EMPTY_USAGE,
		}));

		const result = await routeByDifficulty({
			input: "prove it",
			tiers: tiers(),
			classifyDifficulty: async () => ({ difficulty: "hard", reason: "証明が要る" }),
			run,
		});

		expect(run.mock.calls[0]?.[1]).toBe(CAPABLE);
		expect(result).toMatchObject({
			tier: "capable",
			modelId: CAPABLE.entry.id,
			displayName: CAPABLE.entry.displayName,
			distinct: true,
		});
	});

	it("hands the light model, the input and the signal to the classifier", async () => {
		const controller = new AbortController();
		const classifyDifficulty = vi.fn(async () => ({ difficulty: "easy" as const, reason: "r" }));

		await routeByDifficulty({
			input: "q",
			tiers: tiers(),
			classifyDifficulty,
			run: async () => ({ output: "o", usage: EMPTY_USAGE }),
			signal: controller.signal,
		});

		expect(classifyDifficulty).toHaveBeenCalledWith({
			input: "q",
			light: LIGHT,
			signal: controller.signal,
		});
	});

	it("continues with distinct=false when both tiers are the same model", async () => {
		const same = resolved(MODEL_DEFAULTS.mock.mock.chat);

		const result = await routeByDifficulty({
			input: "q",
			tiers: tiers(same, same),
			classifyDifficulty: async () => ({ difficulty: "hard", reason: "r" }),
			run: async () => ({ output: "o", usage: EMPTY_USAGE }),
		});

		expect(result).toMatchObject({ distinct: false, tier: "capable", output: "o" });
	});

	it("does not run when the signal is already aborted", async () => {
		const controller = new AbortController();
		controller.abort(new Error("stop"));
		const run = vi.fn(async () => ({ output: "o", usage: EMPTY_USAGE }));
		const classifyDifficulty = vi.fn(async () => ({ difficulty: "easy" as const, reason: "r" }));

		await expect(
			routeByDifficulty({
				input: "q",
				tiers: tiers(),
				classifyDifficulty,
				run,
				signal: controller.signal,
			}),
		).rejects.toThrow("stop");
		expect(classifyDifficulty).not.toHaveBeenCalled();
		expect(run).not.toHaveBeenCalled();
	});
});

describe("sumUsage", () => {
	it("adds every field", () => {
		expect(
			sumUsage(
				{ inputTokens: 1, outputTokens: 2, totalTokens: 3, cacheReadTokens: 4 },
				{ inputTokens: 10, outputTokens: 20, totalTokens: 30, cacheReadTokens: 40 },
			),
		).toEqual({ inputTokens: 11, outputTokens: 22, totalTokens: 33, cacheReadTokens: 44 });
	});

	it("treats an absent usage as zero", () => {
		expect(sumUsage(USAGE(1, 1), undefined, USAGE(2, 2))).toEqual(USAGE(3, 3));
		expect(sumUsage()).toEqual(EMPTY_USAGE);
	});
});

describe("resolveTiers", () => {
	it("resolves both tiers through the mock gateway", async () => {
		const gateway = createModelGateway({ config: loadPlatformConfig({ VITEST: "true" }) });

		const tiers = await resolveTiers(gateway);

		expect(tiers.light.entry.id).toBe(MODEL_TIERS.mock.mock.light);
		expect(tiers.capable.entry.id).toBe(MODEL_TIERS.mock.mock.capable);
		expect(tiers.light.mode).toBe("mock");
	});

	function fakeGateway(mode: "local" | "live", provider: "ollama" | "anthropic") {
		const requests: ResolveRequest[] = [];
		const gateway: ModelGateway = {
			async resolve(request) {
				requests.push(request);
				const defaults = MODEL_DEFAULTS[mode] as Record<string, { chat?: string } | undefined>;
				const id = request.modelId ?? defaults[provider]?.chat;
				if (!id) throw new Error("no default chat model");
				return { model: createObjectModel({}), entry: getModelEntry(id as CatalogModelId), mode };
			},
			async resolveEmbedding() {
				throw new Error("not used");
			},
			availableModels: () => [],
		};
		return { gateway, requests };
	}

	it("uses the light and capable models listed for the gateway's mode and provider", async () => {
		const { gateway, requests } = fakeGateway("local", "ollama");

		const tiers = await resolveTiers(gateway);

		expect(tiers.light.entry.id).toBe(MODEL_TIERS.local.ollama.light);
		expect(tiers.capable.entry.id).toBe(MODEL_TIERS.local.ollama.capable);
		expect(requests.every((request) => request.purpose === "chat")).toBe(true);
		// The default chat model is the capable tier here, so it is not resolved a second time.
		expect(requests).toHaveLength(2);
	});

	it("gives both tiers the same model where the provider has a single chat model", async () => {
		const { gateway } = fakeGateway("live", "anthropic");

		const tiers = await resolveTiers(gateway);

		expect(tiers.light.entry.id).toBe(MODEL_TIERS.live.anthropic.light);
		expect(tiers.light.entry.id).toBe(tiers.capable.entry.id);
	});

	it("falls back to the default chat model for both tiers when no tiers are listed", async () => {
		const requests: ResolveRequest[] = [];
		const entry = getModelEntry(MODEL_DEFAULTS.mock.mock.chat);
		const gateway: ModelGateway = {
			async resolve(request) {
				requests.push(request);
				return {
					model: createObjectModel({}),
					entry: { ...entry, provider: "openai" },
					mode: "mock",
				};
			},
			async resolveEmbedding() {
				throw new Error("not used");
			},
			availableModels: () => [],
		};

		const tiers = await resolveTiers(gateway);

		expect(tiers.light.entry.id).toBe(entry.id);
		expect(tiers.capable.entry.id).toBe(entry.id);
	});
});
