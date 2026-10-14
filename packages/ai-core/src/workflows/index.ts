// Public API of `@platform/ai-core/workflows` (plan C11). The five workflow patterns are plain
// TypeScript compositions of `generateText` / `streamText`; this area never imports `agents/`
// (repository rule `workflow-no-agent-loop`).
export {
	createUsageLedger,
	DEFAULT_SECTION_ASPECTS,
	type DemoUsage,
	runWorkflowDemo,
	type UsageLedger,
	WORKFLOW_DEMO_NAMES,
	type WorkflowDemoDeps,
	type WorkflowDemoInput,
	type WorkflowDemoName,
	type WorkflowDemoRun,
	workflowDemoMaxCalls,
} from "./demos";
export { WorkflowStepError } from "./errors";
export {
	createModelEvaluator,
	type EvaluateAndOptimizeParams,
	type EvaluateAndOptimizeResult,
	type EvaluateContext,
	type Evaluator,
	type EvaluatorScore,
	type EvaluatorVerdict,
	evaluateAndOptimize,
	type GenerateContext,
	type IterationRecord,
	type ModelEvaluatorParams,
} from "./evaluator-optimizer";
export {
	assertWithinLimit,
	resolveWorkflowLimits,
	type WorkflowLimitOverrides,
	type WorkflowLimits,
} from "./limits";
export {
	type Difficulty,
	type DifficultyClassification,
	EMPTY_USAGE,
	type ModelTier,
	type ModelTiers,
	type RouteByDifficultyParams,
	type RouteByDifficultyResult,
	resolveTiers,
	routeByDifficulty,
	sumUsage,
} from "./model-tier";
export {
	type OrchestrateParams,
	type OrchestrateResult,
	orchestrate,
	type Subtask,
	type WorkerContext,
	type WorkerResult,
} from "./orchestrator-workers";
export {
	type Ballot,
	type NamedSection,
	type ParallelSectionsParams,
	type ParallelVoteParams,
	parallelSections,
	parallelVote,
	type TallyEntry,
	type VoteResult,
} from "./parallelization";
export {
	type ChainStep,
	type ChainStepRecord,
	type PromptChainParams,
	type PromptChainResult,
	runPromptChain,
} from "./prompt-chaining";
export {
	type Classification,
	type ClassifyWithModelParams,
	classifyWithModel,
	type ModelClassification,
	type RouteParams,
	type RouteResult,
	route,
} from "./routing";
