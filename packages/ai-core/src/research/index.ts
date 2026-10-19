// Public API of `@platform/ai-core/research` (plan C9): the arXiv client and its tools, the
// budget, the citation check, the sub-agents and the Supervisor. Server-only: `runResearch` pulls in
// the AI SDK agent runtime. Client components may import the types with `import type`.
export {
	type ArxivCache,
	type ArxivCacheEntry,
	type ArxivClient,
	type ArxivClientDependencies,
	type ArxivClientOptions,
	type ArxivSearchOptions,
	createArxivCache,
	createArxivClient,
} from "./arxiv/client";
export { parseArxivFeed } from "./arxiv/parse";
export { ARXIV_ID_PATTERN, ArxivFeedError, type ArxivLink, type ArxivPaper } from "./arxiv/types";
export {
	type Budget,
	type BudgetExhaustion,
	type BudgetLimits,
	type BudgetStatus,
	createBudget,
} from "./budget";
export { attachCitationWarnings, type CitationCheck, checkCitations } from "./citations";
export {
	RESEARCH_REQUEST_LIMITS,
	type ResearchRequest,
	researchRequestSchema,
} from "./request-schema";
export {
	createPaperCollector,
	createSubagent,
	DEFAULT_SUBAGENT_LIMITS,
	failureReasonOf,
	type PaperCollector,
	type ResearchAgentName,
	type ResearchEvent,
	type ResearchEventKind,
	SUBAGENT_INSTRUCTIONS,
	SUBAGENT_KINDS,
	SUBAGENT_TOOL_NAMES,
	type SubagentDependencies,
	type SubagentInput,
	type SubagentKind,
	type SubagentResult,
} from "./subagents";
export {
	type ResearchLimits,
	type ResearchMissing,
	type ResearchResult,
	type ResearchUsage,
	type RunResearchParams,
	runResearch,
	supervisorLimits,
	supervisorReserve,
} from "./supervisor";
export {
	createResearchTools,
	GET_PAPER_ABSTRACT_TOOL_NAME,
	type PaperAbstract,
	type PaperSearchResult,
	type PaperSummary,
	type ResearchToolDependencies,
	SEARCH_ARXIV_TOOL_NAME,
} from "./tools";
