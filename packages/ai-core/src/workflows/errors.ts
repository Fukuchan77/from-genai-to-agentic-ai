import { AISDKError } from "ai";
import { PlatformError } from "../errors";

/**
 * A workflow stage failed (plan C11). `step` is the failed stage's name; the learner-facing message
 * and `details` carry only that name, never the cause's message, which can hold provider text.
 * The cause stays on `cause` for the server-side log.
 */
export class WorkflowStepError extends PlatformError {
	readonly step: string;
	override readonly cause: unknown;

	constructor(step: string, cause: unknown) {
		super("output-invalid", `ワークフローの「${step}」の段が失敗しました。`, { step });
		this.step = step;
		this.cause = cause;
	}
}

/**
 * What a failed stage surfaces as. A `PlatformError` other than `output-invalid` says something
 * about the request or the environment, not about the stage's output, so it keeps its identity and
 * the HTTP layer still answers 400 or 503 and not 502. So does an AI SDK error (a provider
 * failure; the route turns it into a fixed 503 message). Anything else becomes a `WorkflowStepError`
 * naming the stage.
 */
export function toStepError(step: string, error: unknown): unknown {
	if (error instanceof WorkflowStepError) return error;
	if (error instanceof PlatformError && error.code !== "output-invalid") return error;
	if (AISDKError.isInstance(error)) return error;
	return new WorkflowStepError(step, error);
}
