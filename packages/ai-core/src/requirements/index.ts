// Public API of `@platform/ai-core/requirements` (plan C11). Server-only: the persona and
// interview steps call the model through `generateValidated`.
export {
	NONE_TEXT,
	REQUIREMENT_DOCUMENT_HEADINGS,
	REQUIREMENT_DOCUMENT_TITLE,
	type RenderRequirementDocumentOptions,
	renderRequirementDocument,
} from "./document";
export {
	type AskRoundParams,
	askRound,
	type ExtractRequirementsParams,
	extractRequirements,
	type JudgeSufficiencyParams,
	judgeSufficiency,
	MAX_EXCERPT_CHARACTERS,
	MAX_SUFFICIENCY_MISSING,
	type Question,
	type SufficiencyVerdict,
} from "./interview";
export {
	MESSAGES_REQUEST_LIMITS,
	type RequirementsMessagesRequest,
	requirementsMessagesRequestSchema,
} from "./messages-schema";
export {
	type GeneratePersonasParams,
	generatePersonas,
	MAX_OVERVIEW_CHARACTERS,
	MAX_PERSONA_COUNT,
	MIN_PERSONA_COUNT,
	type Persona,
} from "./personas";
export {
	REQUIREMENTS_REQUEST_DEFAULTS,
	REQUIREMENTS_REQUEST_LIMITS,
	type RequirementsSessionRequest,
	requirementsSessionRequestSchema,
} from "./request-schema";
export {
	closeRound,
	createInterviewState,
	EMPTY_REQUIREMENTS,
	type InterviewAnswer,
	type InterviewState,
	isRoundLimitReached,
	mergeRequirements,
	REQUIREMENT_CATEGORIES,
	type RecordedAnswer,
	type RequirementCategory,
	type RequirementItem,
	type Requirements,
	type RoundVerdict,
	recordAnswer,
} from "./session";
export {
	getRequirementsSessions,
	type RawRequirementsSessionStore,
	REQUIREMENTS_MAX_SESSIONS,
	REQUIREMENTS_SESSION_IDLE_MS,
	REQUIREMENTS_SESSION_REGISTRY,
	type RequirementsSession,
	type RequirementsSessionStore,
	type SessionStoreFactory,
} from "./web-session";
