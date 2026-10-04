import { describe, expect, expectTypeOf, it } from "vitest";
import { ENV_KEYS } from "./env-schema";
import {
	FEATURE_IDS,
	FEATURE_REQUIREMENTS,
	type FeatureId,
	type RequiredEnvVariable,
} from "./feature-requirements";

describe("FEATURE_REQUIREMENTS", () => {
	it("maps every feature to at least one environment variable", () => {
		expect(FEATURE_IDS).toEqual(Object.keys(FEATURE_REQUIREMENTS));
		for (const feature of FEATURE_IDS) {
			expect(FEATURE_REQUIREMENTS[feature].length, feature).toBeGreaterThan(0);
		}
	});

	it("references only variables declared by the environment schema", () => {
		const knownVariables = new Set<string>(ENV_KEYS);

		for (const variables of Object.values(FEATURE_REQUIREMENTS)) {
			for (const variable of variables) expect(knownVariables.has(variable), variable).toBe(true);
		}
	});

	it("keeps feature and required-variable types closed", () => {
		expect(FEATURE_IDS).toContain("web-search");
		expectTypeOf<FeatureId>().toEqualTypeOf<(typeof FEATURE_IDS)[number]>();
		expectTypeOf<RequiredEnvVariable>().toMatchTypeOf<(typeof ENV_KEYS)[number]>();
	});
});
