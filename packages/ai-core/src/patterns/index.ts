// Public API of `@platform/ai-core/patterns` (plan C12). Six agent design patterns: all but
// `cooperateByRole` are plain compositions of model calls; `cooperateByRole` is the one pattern that
// builds agent loops (through `createGuardedAgent`).
export {
	PATTERN_DEMO_NAMES,
	type PatternDemoDeps,
	type PatternDemoInput,
	type PatternDemoName,
	type PatternDemoRun,
	patternDemoMaxCalls,
	runPatternDemo,
} from "./demos";
export {
	type CandidateEvaluation,
	type MultiPathParams,
	type MultiPathResult,
	planMultiPath,
} from "./multi-path-plan";
export {
	createPassiveGoal,
	type GoalSpec,
} from "./passive-goal-creator";
export {
	type Optimization,
	type OptimizeTarget,
	optimizePromptOrResponse,
} from "./prompt-optimizer";
export {
	type ReflectionMode,
	type ReflectionRecord,
	type ReflectionResult,
	type ReflectParams,
	reflect,
} from "./reflection";
export {
	type CooperateByRoleParams,
	type CooperationResult,
	cooperateByRole,
	type Role,
	type RoleOutput,
} from "./role-based-cooperation";
export {
	type Plan,
	type Planner,
	type PlanStepContext,
	type PlanStepResult,
	planSinglePath,
	type SinglePathParams,
	type SinglePathResult,
} from "./single-path-plan";
