export const PLATFORM_ERROR_CODES = [
	"invalid-request",
	"capability-unsupported",
	"provider-unavailable",
	"source-unavailable",
] as const;

export type PlatformErrorCode = (typeof PLATFORM_ERROR_CODES)[number];

export type PlatformErrorDetails = Readonly<Record<string, unknown>>;

const EMPTY_DETAILS: PlatformErrorDetails = Object.freeze({});

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
