// Public API of `@platform/ai-core/helpdesk` (plan C10). Server-only: it pulls in the agent runtime
// (`run.ts`) and the database layer (`ticket-store.ts`, `seed.ts`).
export { CREDENTIAL_KINDS, type CredentialKind, detectCredentialShapes } from "./credentials";
export {
	type HelpdeskEvent,
	type HelpdeskOutcome,
	type PlanTaskView,
	type RunHelpdeskParams,
	runHelpdesk,
	type TaskState,
} from "./helpdesk";
export {
	diffPlan,
	type Plan,
	type PlanDiff,
	PlanDiffSchema,
	type PlanIssue,
	type PlanIssueKind,
	PlanSchema,
	type PlanTask,
	PlanTaskSchema,
	validatePlan,
} from "./plan-schema";
export {
	PLANNER_INSTRUCTIONS,
	type PlanningKnowledge,
	type PlanTasksResult,
	planTasks,
} from "./planner";
export {
	type DecideNextParams,
	decideNext,
	type LastTaskResult,
	NEXT_DECISIONS,
	type NextDecision,
	type NextStep,
	type ReplanOutcome,
} from "./replanner";
export {
	HELPDESK_REQUEST_LIMITS,
	type HelpdeskRequest,
	helpdeskRequestSchema,
} from "./request-schema";
export {
	type HelpdeskKnowledge,
	RUN_TASK_SUMMARY_MAX_CHARACTERS,
	type RunTaskOutcome,
	type RunTaskParams,
	runTask,
	type TaskResult,
	TaskResultSchema,
} from "./run";
export { nextRunnable } from "./scheduler";
export {
	FAQ_DIRECTORY,
	loadSampleTickets,
	type SampleTicket,
	type SeedHelpdeskParams,
	type SeedKnowledge,
	type SeedResult,
	seedHelpdesk,
} from "./seed";
export {
	type CreateTicketParams,
	createTicketStore,
	type ListTicketsOptions,
	MAX_TICKET_LIST,
	type PlanRevision,
	type RecordRevisionParams,
	type StatusChange,
	type StoppedReason,
	type Ticket,
	type TicketStatus,
	type TicketStore,
	type TicketStoreOptions,
} from "./ticket-store";
