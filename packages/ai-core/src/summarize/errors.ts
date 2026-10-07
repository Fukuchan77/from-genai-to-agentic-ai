import { PlatformError } from "../errors";

export type SourceFetchFailureReason = "http-status" | "empty-body" | "network";

export type TranscriptUnavailableReason = "no-captions" | "private" | "fetch-failed";

function sourceFetchMessage(reason: SourceFetchFailureReason, status?: number): string {
	switch (reason) {
		case "http-status":
			return `記事を取得できませんでした（HTTP ステータス ${status ?? "不明"}）。`;
		case "empty-body":
			return "本文が空のため要約できません。";
		case "network":
			return "ネットワークエラーのため記事を取得できませんでした。";
	}
}

/** The article could not be fetched or had no text; raised before any LLM call (Req 4.7). */
export class SourceFetchError extends PlatformError {
	readonly reason: SourceFetchFailureReason;
	readonly status: number | undefined;

	constructor(reason: SourceFetchFailureReason, options: { readonly status?: number } = {}) {
		super("source-unavailable", sourceFetchMessage(reason, options.status), {
			reason,
			...(options.status === undefined ? {} : { status: options.status }),
		});
		this.reason = reason;
		this.status = options.status;
	}
}

function transcriptMessage(reason: TranscriptUnavailableReason): string {
	switch (reason) {
		case "no-captions":
			return "この動画には利用できる字幕がありません。";
		case "private":
			return "非公開の動画のため字幕を取得できません。";
		case "fetch-failed":
			return "動画の字幕を取得できませんでした。";
	}
}

/** The video's captions could not be obtained; raised before any LLM call (Req 4.11). */
export class TranscriptUnavailableError extends PlatformError {
	readonly reason: TranscriptUnavailableReason;

	constructor(reason: TranscriptUnavailableReason) {
		super("source-unavailable", transcriptMessage(reason), { reason });
		this.reason = reason;
	}
}

/**
 * Every attempt (the first generation plus up to two regenerations) failed schema validation
 * (Req 4.4). `issues` are the last attempt's validation errors; `issuesByAttempt` keeps all of them.
 * The issues describe schema paths and constraint messages only, never the generated text.
 */
export class SummaryValidationError extends PlatformError {
	readonly attempts: number;
	readonly issues: readonly string[];
	readonly issuesByAttempt: readonly (readonly string[])[];

	constructor(issuesByAttempt: readonly (readonly string[])[]) {
		const attempts = issuesByAttempt.length;
		const issues = issuesByAttempt.at(-1) ?? [];
		// PlatformErrorCode has no dedicated "invalid model output" code yet; the model failing to
		// produce a valid object is reported as a provider-side failure.
		super("provider-unavailable", `要約がスキーマ検証に ${attempts} 回失敗しました。`, {
			attempts,
			issues,
			issuesByAttempt,
		});
		this.attempts = attempts;
		this.issues = issues;
		this.issuesByAttempt = issuesByAttempt;
	}
}
