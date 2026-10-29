import { describe, expect, it } from "vitest";
import * as marketing from "./index";

describe("marketing public API", () => {
	it("re-exports the functions and constants of every module", () => {
		for (const name of [
			"createCatalogRepo",
			"seedMarketing",
			"loadSampleProducts",
			"loadSamplePersonas",
			"judgeAgreement",
			"extractProfile",
			"mergeProfile",
			"EMPTY_PROFILE",
			"runCouncil",
			"recommend",
			"MAX_RECOMMENDATIONS",
		]) {
			expect(marketing, name).toHaveProperty(name);
			expect(typeof (marketing as Record<string, unknown>)[name], name).not.toBe("undefined");
		}
	});
});
