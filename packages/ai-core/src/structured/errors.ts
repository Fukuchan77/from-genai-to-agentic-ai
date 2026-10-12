import { PlatformError } from "../errors";

export interface StructuredUsage {
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly totalTokens: number;
	readonly cacheReadTokens: number;
}

/**
 * Every attempt of `generateValidated` produced output that broke the schema or the extra
 * validation (plan C3). `issuesByAttempt` holds each attempt's problems; they describe schema paths
 * and constraints only, never the generated text. `usage` is the sum over all attempts.
 */
export class StructuredOutputError extends PlatformError {
	readonly attempts: number;
	readonly issues: readonly string[];
	readonly issuesByAttempt: readonly (readonly string[])[];
	readonly usage: StructuredUsage;

	constructor(issuesByAttempt: readonly (readonly string[])[], usage: StructuredUsage) {
		const attempts = issuesByAttempt.length;
		const issues = issuesByAttempt.at(-1) ?? [];
		super("output-invalid", `モデルの出力が ${attempts} 回とも期待した形式になりませんでした。`, {
			attempts,
			issues,
			issuesByAttempt,
		});
		this.attempts = attempts;
		this.issues = issues;
		this.issuesByAttempt = issuesByAttempt;
		this.usage = usage;
	}
}
