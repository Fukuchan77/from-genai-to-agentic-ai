// Public API of `@platform/ai-core/structured` (plan C3).
export { StructuredOutputError, type StructuredUsage } from "./errors";
export {
	DEFAULT_MAX_REGENERATIONS,
	type GenerateValidatedParams,
	type GenerateValidatedResult,
	generateValidated,
} from "./generate-validated";
