// Public API of `@platform/ai-core/chat` (plan C11). Client components may import the types (e.g.
// `ResponseMetadata` for `useChat` messages, `PersonaId`) with `import type`; the persona list and
// the request schemas are plain data and Zod, so the persona selector may import them as values.
export { adaptHistoryForModel, IMAGE_OMITTED_TEXT } from "./adapt-history";
export {
	buildResponseMetadata,
	type ResponseMetadata,
	type ResponseMetadataInput,
	type ResponseUsage,
} from "./metadata";
export {
	DEFAULT_PERSONA_ID,
	getPersona,
	isPersonaId,
	PERSONA_IDS,
	PERSONAS,
	type PersonaId,
	type PersonaSource,
	type PersonaTemplate,
	type PersonaVars,
} from "./personas";
export {
	type AgentRequest,
	agentRequestSchema,
	CHAT_REQUEST_LIMITS,
	type ChatRequest,
	chatRequestSchema,
} from "./request-schema";
