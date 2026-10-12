import { describe, expect, it } from "vitest";
import { MODEL_CATALOG } from "./catalog";
import { ollamaRuntimeOptions } from "./runtime-options";

const entries = Object.values(MODEL_CATALOG);
const ollamaEntries = entries.filter((entry) => entry.provider === "ollama");
const otherEntries = entries.filter((entry) => entry.provider !== "ollama");

describe("ollamaRuntimeOptions", () => {
	it("covers both Ollama and non-Ollama catalog entries", () => {
		expect(ollamaEntries.length).toBeGreaterThan(0);
		expect(otherEntries.length).toBeGreaterThan(0);
	});

	it.each(ollamaEntries.map((entry) => [entry.id, entry] as const))(
		"sets num_ctx to the catalog context window for %s",
		(_id, entry) => {
			expect(ollamaRuntimeOptions(entry)).toEqual({
				providerOptions: { ollama: { options: { num_ctx: entry.contextWindow } } },
			});
		},
	);

	it.each(otherEntries.map((entry) => [entry.id, entry] as const))(
		"adds nothing for %s",
		(_id, entry) => {
			expect(ollamaRuntimeOptions(entry)).toEqual({});
		},
	);
});
