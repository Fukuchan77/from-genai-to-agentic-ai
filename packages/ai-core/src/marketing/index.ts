// Public API of `@platform/ai-core/marketing` (plan C12). Server-only: it pulls in the database
// layer (`catalog.ts`, `seed.ts`).
export {
	type CatalogPersona,
	type CatalogRepo,
	createCatalogRepo,
	type Product,
} from "./catalog";
export {
	type CouncilEndReason,
	type CouncilMissing,
	type CouncilObserver,
	type CouncilResult,
	type CouncilRound,
	type CouncilStatement,
	type CouncilTurnEvent,
	type CouncilUsage,
	MAX_COUNCIL_PERSONAS,
	MIN_COUNCIL_PERSONAS,
	type RunCouncilParams,
	runCouncil,
} from "./council";
export {
	type AgreementVerdict,
	type CouncilTurn,
	type JudgeAgreementParams,
	judgeAgreement,
	MODERATOR_INSTRUCTIONS,
} from "./moderator";
export {
	EMPTY_PROFILE,
	type ExtractProfileParams,
	extractProfile,
	MAX_PROFILE_ITEMS,
	MAX_PROFILE_MESSAGES,
	mergeProfile,
	PROFILE_INSTRUCTIONS,
	type Profile,
	type ProfileMessage,
	type ProfilePatch,
} from "./profile";
export {
	MAX_RECOMMENDATIONS,
	NO_MATCH_REASON,
	NO_VALID_RECOMMENDATION_REASON,
	overBudgetNote,
	RECOMMEND_INSTRUCTIONS,
	type Recommendation,
	type RecommendParams,
	type RecommendResult,
	recommend,
	UNSEEDED_CATALOG_REASON,
} from "./recommend";
export {
	RECOMMEND_REQUEST_LIMITS,
	type RecommendRequest,
	recommendRequestSchema,
	storedProfileSchema,
} from "./recommend-request-schema";
export {
	COUNCIL_REQUEST_LIMITS,
	type CouncilRequest,
	councilRequestSchema,
} from "./request-schema";
export {
	loadSamplePersonas,
	loadSampleProducts,
	SamplePersonaSchema,
	SampleProductSchema,
	type SeedMarketingParams,
	type SeedMarketingResult,
	seedMarketing,
} from "./seed";
