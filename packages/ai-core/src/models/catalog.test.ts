import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
	type CatalogModelId,
	defaultModelFor,
	defaultRerankModel,
	estimateCost,
	getModelEntry,
	listModels,
	MODEL_CATALOG,
	MODEL_DEFAULTS,
	MODEL_TIERS,
	RERANK_MODELS,
} from "./catalog";
import type {
	Capability,
	ModelCatalog,
	ModelEntry,
	ModelId,
	ModelPurpose,
	ProviderId,
	RunMode,
} from "./types";

const PURPOSE_CAPABILITY = {
	chat: undefined,
	structured: "structuredOutput",
	embedding: "embedding",
	judge: "structuredOutput",
} as const satisfies Record<ModelPurpose, Capability | undefined>;

function cassetteModelIds(directory: string): string[] {
	if (!existsSync(directory)) return [];

	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) return cassetteModelIds(path);
		if (!entry.isFile() || extname(entry.name) !== ".json") return [];

		const fixture: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (
			typeof fixture === "object" &&
			fixture !== null &&
			"modelId" in fixture &&
			typeof fixture.modelId === "string"
		) {
			return [fixture.modelId];
		}
		if (
			typeof fixture === "object" &&
			fixture !== null &&
			"request" in fixture &&
			typeof fixture.request === "object" &&
			fixture.request !== null &&
			"modelId" in fixture.request &&
			typeof fixture.request.modelId === "string"
		) {
			return [fixture.request.modelId];
		}
		return [];
	});
}

describe("MODEL_CATALOG", () => {
	it("keeps model IDs, entries, providers, modes, and live pricing consistent", () => {
		const entries = Object.entries(MODEL_CATALOG);
		const providers = new Set(entries.map(([, entry]) => entry.provider));

		expect(entries.length).toBeGreaterThan(0);
		expect(providers).toEqual(
			new Set<ProviderId>(["anthropic", "openai", "azure", "google", "ollama", "mock"]),
		);
		expect(providers).not.toContain("watsonx");

		for (const [id, entry] of entries) {
			expect(entry.id).toBe(id);
			expect(entry.contextWindow).toBeGreaterThan(0);
			expect(entry.maxOutputTokens).toBeGreaterThanOrEqual(0);
			expect(entry.modes.length).toBeGreaterThan(0);
			if (entry.modes.some((mode) => mode === "live")) {
				expect(entry.pricing).not.toBeNull();
			} else {
				expect(entry.pricing).toBeNull();
			}
		}
	});

	it("keeps every declared default present and compatible with its mode, provider, and purpose", () => {
		for (const [mode, providers] of Object.entries(MODEL_DEFAULTS)) {
			for (const [provider, purposes] of Object.entries(providers)) {
				for (const [purpose, id] of Object.entries(purposes)) {
					const entry = getModelEntry(id as CatalogModelId);
					const capability = PURPOSE_CAPABILITY[purpose as ModelPurpose];

					expect(entry.modes).toContain(mode);
					expect(entry.provider).toBe(provider);
					if (capability) expect(entry.capabilities[capability]).not.toBe(false);
					expect(
						defaultModelFor(mode as RunMode, provider as ProviderId, purpose as ModelPurpose),
					).toBe(id);
				}
			}
		}
	});

	it("filters models by mode, provider, and capability without changing catalog order", () => {
		const liveStructured = listModels({ mode: "live", capability: "structuredOutput" });
		const expected = Object.values(MODEL_CATALOG).filter(
			(entry) => entry.modes.some((mode) => mode === "live") && entry.capabilities.structuredOutput,
		);

		expect(liveStructured).toEqual(expected);
		expect(listModels({ mode: "local", provider: "ollama" }).length).toBeGreaterThan(0);
		expect(listModels({ mode: "mock", provider: "anthropic" })).toEqual([]);
	});

	it("estimates input, output, and cache-read cost in USD and omits unpriced modes", () => {
		const priced = Object.values(MODEL_CATALOG).find((entry) => entry.pricing !== null);
		const unpriced = Object.values(MODEL_CATALOG).find((entry) => entry.pricing === null);
		expect(priced).toBeDefined();
		expect(unpriced).toBeDefined();
		if (!priced?.pricing || !unpriced) throw new Error("Catalog fixture is incomplete");

		const usage = { inputTokens: 2_000_000, outputTokens: 3_000_000, cacheReadTokens: 4_000_000 };
		const estimate = estimateCost(usage, priced);
		const cacheReadPerMTok =
			"cacheReadPerMTok" in priced.pricing
				? priced.pricing.cacheReadPerMTok
				: priced.pricing.inputPerMTok;

		expect(estimate).toEqual({
			input: 2 * priced.pricing.inputPerMTok,
			output: 3 * priced.pricing.outputPerMTok,
			cacheRead: 4 * cacheReadPerMTok,
			total:
				2 * priced.pricing.inputPerMTok + 3 * priced.pricing.outputPerMTok + 4 * cacheReadPerMTok,
			currency: "USD",
		});
		expect(estimateCost(usage, unpriced)).toBeUndefined();
	});

	it("rejects unknown IDs and missing mode/provider/purpose defaults", () => {
		expect(() => getModelEntry("not-in-catalog" as CatalogModelId)).toThrow(RangeError);
		expect(() => defaultModelFor("mock", "anthropic", "chat")).toThrow(RangeError);
	});

	it("keeps every bundled cassette model ID in the catalog", () => {
		const bundledIds = cassetteModelIds(join(import.meta.dirname, "../../fixtures/cassettes"));
		const temporaryDirectory = mkdtempSync(join(tmpdir(), "model-catalog-cassettes-"));
		const catalogId = Object.keys(MODEL_CATALOG)[0];
		if (!catalogId) throw new Error("Catalog must not be empty");

		try {
			writeFileSync(
				join(temporaryDirectory, "cassette.json"),
				JSON.stringify({ request: { modelId: catalogId } }),
			);
			const discoveredIds = cassetteModelIds(temporaryDirectory);

			expect(discoveredIds).toEqual([catalogId]);
			for (const id of [...bundledIds, ...discoveredIds]) {
				expect(MODEL_CATALOG).toHaveProperty(id);
			}
		} finally {
			rmSync(temporaryDirectory, { recursive: true, force: true });
		}
	});

	it("adds a separate mock judge model and makes it the mock judge default (CL-5)", () => {
		const judgeId = defaultModelFor("mock", "mock", "judge");
		const chatId = defaultModelFor("mock", "mock", "chat");

		expect(judgeId).toBe("mock:judge-v1");
		expect(judgeId).not.toBe(chatId);
		expect(MODEL_CATALOG["mock:judge-v1"]).toMatchObject({
			provider: "mock",
			modes: ["mock"],
			pricing: null,
			capabilities: { structuredOutput: true, embedding: false },
		});
		expect(listModels({ mode: "mock" }).map((entry) => entry.id)).toContain(judgeId);
	});

	it("keeps the other mock purposes on their existing defaults", () => {
		expect(defaultModelFor("mock", "mock", "structured")).toBe("mock:general-v1");
		expect(defaultModelFor("mock", "mock", "embedding")).toBe("mock:embedding-v1");
	});

	it("declares a structured-output-capable light and capable tier for every default provider (CL-10)", () => {
		for (const [mode, providers] of Object.entries(MODEL_DEFAULTS)) {
			for (const provider of Object.keys(providers)) {
				const tiers = (
					MODEL_TIERS as Record<string, Record<string, { light: string; capable: string }>>
				)[mode]?.[provider];
				expect(tiers, `${mode}/${provider}`).toBeDefined();
				if (!tiers) continue;
				for (const id of [tiers.light, tiers.capable]) {
					const entry = getModelEntry(id as CatalogModelId);
					expect(entry.modes).toContain(mode);
					expect(entry.provider).toBe(provider);
					expect(entry.capabilities.structuredOutput).toBe(true);
				}
			}
		}
	});

	it("uses one model for both tiers where a provider has a single chat model", () => {
		expect(MODEL_TIERS.mock.mock).toEqual({
			light: defaultModelFor("mock", "mock", "chat"),
			capable: defaultModelFor("mock", "mock", "chat"),
		});
		for (const provider of ["anthropic", "openai", "azure", "google"] as const) {
			const chat = defaultModelFor("live", provider, "chat");
			expect(MODEL_TIERS.live[provider], provider).toEqual({ light: chat, capable: chat });
		}
	});

	it("uses a distinct lighter local model for the light tier", () => {
		expect(MODEL_TIERS.local.ollama.capable).toBe(defaultModelFor("local", "ollama", "chat"));
		expect(MODEL_TIERS.local.ollama.light).not.toBe(MODEL_TIERS.local.ollama.capable);
		// ADR-11 keeps the judge's model and the embedding model out of the chat tiers.
		expect(MODEL_TIERS.local.ollama.light).not.toBe(MODEL_DEFAULTS.local.ollama.judge);
		expect(MODEL_TIERS.local.ollama.light).not.toBe(MODEL_DEFAULTS.local.ollama.embedding);
		expect(getModelEntry(MODEL_TIERS.local.ollama.light).capabilities.embedding).toBe(false);
	});

	it("keeps rerank models outside the chat catalog and exposes a default", () => {
		const ids = Object.keys(RERANK_MODELS);
		const entry = defaultRerankModel();

		expect(ids.length).toBeGreaterThan(0);
		expect(RERANK_MODELS).toHaveProperty(entry.id);
		expect(entry).toMatchObject({ provider: "cohere" });
		expect(entry.displayName.length).toBeGreaterThan(0);
		for (const id of ids) expect(MODEL_CATALOG).not.toHaveProperty(id);
		expect(listModels({ mode: "live" }).map((model) => model.id)).not.toContain(entry.id);
	});

	it("exposes Zod-independent client-safe catalog types", () => {
		expectTypeOf(MODEL_CATALOG).toMatchTypeOf<ModelCatalog>();
		expectTypeOf<CatalogModelId>().toMatchTypeOf<ModelId>();
		expectTypeOf<ModelEntry>().not.toBeAny();

		const source = readFileSync(new URL("types.ts", import.meta.url), "utf8");
		expect(source).not.toMatch(/from\s+["']zod["']/u);
	});
});
