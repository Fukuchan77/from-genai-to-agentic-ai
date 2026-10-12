import { describe, expect, it } from "vitest";
import * as rag from "./index";

// The runtime symbols plan "後続 spec への契約" promises from `@platform/ai-core/rag`.
describe("@platform/ai-core/rag public API", () => {
	it.each([
		"createKnowledgeStore",
		"ingestDocuments",
		"runRetrieval",
		"createPgliteDatabase",
		"createSearchKnowledgeBaseTool",
		"SEARCH_KNOWLEDGE_BASE_TOOL_NAME",
		"createCitationRegistry",
		"judgeRagAnswer",
		"recallAtK",
		"loadEvalSet",
		"streamRagQuery",
		"resolveCitations",
		"reciprocalRankFusion",
		"createLexicalRerank",
		"queryRequestSchema",
	])("exports %s", (name) => {
		expect(rag).toHaveProperty(name);
		expect((rag as Record<string, unknown>)[name]).toBeDefined();
	});

	it("runs the re-exported tool under the contract's name and risk", () => {
		const tool = rag.createSearchKnowledgeBaseTool({
			search: async () => [],
			registry: rag.createCitationRegistry(),
		});
		expect(tool.name).toBe("searchKnowledgeBase");
		expect(tool.risk).toBe("read-only");
	});
});
