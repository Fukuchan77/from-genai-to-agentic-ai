// Public API of `@platform/ai-core/agents` (plan C8). Server-only: `createGuardedAgent` pulls in the
// AI SDK agent runtime. Client components may import the types (e.g. `AgentRunSummary`,
// `StopReason`) with `import type`.
export {
	type AgentRunError,
	type AgentRunSummary,
	type AgentTokenTotals,
	createGuardedAgent,
	type GuardedAgent,
	type GuardedAgentOptions,
	type LoopLimits,
	MAX_AGENT_TOOLS,
	type RunMessageMetadata,
	type RunObserver,
} from "./guarded-agent";
export {
	createRunStopConditions,
	createStopConditionRecord,
	deadline,
	type GuardStopCondition,
	type RunStopConditions,
	type RunStopConditionsOptions,
	STOP_CONDITION_NAMES,
	type StepUsageView,
	type StopConditionName,
	type StopConditionRecord,
	type StopConditionRecorder,
	stepLimit,
	tokenBudget,
} from "./stop-conditions";
export {
	type AbortCause,
	deriveStopReason,
	STOP_REASONS,
	type StopReason,
	type StopReasonInput,
} from "./stop-reason";
