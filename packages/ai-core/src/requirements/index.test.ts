import { describe, expect, it } from "vitest";
import {
	askRound,
	closeRound,
	createInterviewState,
	EMPTY_REQUIREMENTS,
	extractRequirements,
	generatePersonas,
	isRoundLimitReached,
	judgeSufficiency,
	MAX_PERSONA_COUNT,
	mergeRequirements,
	REQUIREMENT_CATEGORIES,
	REQUIREMENT_DOCUMENT_TITLE,
	recordAnswer,
	renderRequirementDocument,
} from "./index";

describe("@platform/ai-core/requirements public API", () => {
	it("re-exports the session, persona, interview and document functions", () => {
		for (const fn of [
			createInterviewState,
			recordAnswer,
			closeRound,
			mergeRequirements,
			isRoundLimitReached,
			generatePersonas,
			askRound,
			extractRequirements,
			judgeSufficiency,
			renderRequirementDocument,
		]) {
			expect(typeof fn).toBe("function");
		}
		expect(EMPTY_REQUIREMENTS.functional).toEqual([]);
		expect(REQUIREMENT_CATEGORIES).toHaveLength(4);
		expect(REQUIREMENT_DOCUMENT_TITLE).toBe("# 要件定義書");
		expect(MAX_PERSONA_COUNT).toBe(5);
	});
});
