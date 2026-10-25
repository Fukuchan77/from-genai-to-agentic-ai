export const PLATFORM_ERROR_CODES = [
	"invalid-request",
	"capability-unsupported",
	"provider-unavailable",
	"source-unavailable",
	"output-invalid",
] as const;

export type PlatformErrorCode = (typeof PLATFORM_ERROR_CODES)[number];

export type PlatformErrorDetails = Readonly<Record<string, unknown>>;

const EMPTY_DETAILS: PlatformErrorDetails = Object.freeze({});

const PLATFORM_ERROR_BRAND = Symbol.for("@platform/ai-core/platform-error");

/**
 * Base class of every error a learner can be told about. `instanceof PlatformError` is brand-based
 * for the base class itself: Next.js bundles a page and each Route Handler separately, so one
 * process can hold several copies of this module, and an error thrown by one copy must still be
 * classified as a PlatformError by another (`toPublicError`). The brand is a `Symbol.for` marker on
 * the prototype, so any code can forge it. That is acceptable: this is error classification, not a
 * security boundary. Subclass checks (`error instanceof ConfigError`) stay the ordinary
 * prototype-chain check and are therefore per copy.
 */
export class PlatformError extends Error {
	readonly code: PlatformErrorCode;
	readonly details: PlatformErrorDetails;

	constructor(code: PlatformErrorCode, message: string, details = EMPTY_DETAILS) {
		super(message);
		this.name = new.target.name;
		this.code = code;
		this.details = details;
	}
}

// Defined with a function (not `static [Symbol.hasInstance]`) so `this` is the class being tested:
// subclasses inherit it, and only the base class gets the brand fallback.
Object.defineProperty(PlatformError, Symbol.hasInstance, {
	value(this: unknown, value: unknown): boolean {
		if (Function.prototype[Symbol.hasInstance].call(this, value)) return true;
		return (
			this === PlatformError &&
			typeof value === "object" &&
			value !== null &&
			(value as Record<symbol, unknown>)[PLATFORM_ERROR_BRAND] === true
		);
	},
});

Object.defineProperty(PlatformError.prototype, PLATFORM_ERROR_BRAND, {
	value: true,
	enumerable: false,
});
