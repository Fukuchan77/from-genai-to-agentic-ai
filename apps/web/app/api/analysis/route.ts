import { checkUpload, runAnalysis, type UploadRejection } from "@platform/ai-core/analysis";
import { DEFAULT_ANALYSIS, DEFAULT_SANDBOX } from "@platform/ai-core/config";
import { PlatformError } from "@platform/ai-core/errors";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { createAnalysisStreamer, writeAnalysisResult } from "@/lib/server/domain-stream";
import { GuardError, toErrorResponse, toStreamErrorText } from "@/lib/server/errors";
import { rateLimitRejection } from "@/lib/server/guard";
import {
	getPlatform,
	getSandboxSelection,
	invalidateSandboxSelection,
} from "@/lib/server/platform";
import { readUpload } from "@/lib/server/upload";

// POST /api/analysis (plan C13, Req 3.1, 3.5-3.9): multipart upload -> checks (size 413, form 400,
// counts and lengths 400, file kind 400) -> sandbox available (503) -> `live` rate limit (429) ->
// model (tools) -> the session's sandbox -> stream attempts, figures, tables and the result while
// `runAnalysis` works. Every rejection that needs no stream happens before a sandbox or a model
// starts, so a bad file or a missing setup costs nothing.

export const dynamic = "force-dynamic";

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const UPLOAD_MESSAGES: Readonly<Record<Exclude<UploadRejection, "size">, string>> = {
	extension:
		"対応していないファイル形式です。CSV（.csv）か Excel（.xlsx / .xls）のファイルを指定してください。",
	magic: "ファイルの中身が拡張子と一致しません。Excel か CSV として保存し直してください。",
	empty: "ファイルが空です。データの入ったファイルを指定してください。",
	encoding: "CSV の文字コードを読み取れません。UTF-8 で保存し直してください。",
};

function uploadRejection(reason: UploadRejection): GuardError {
	if (reason === "size") {
		return new GuardError(
			"payload-too-large",
			"アップロードしたファイルが大きすぎます（上限 20 MiB）。",
		);
	}
	return new GuardError("invalid-request", UPLOAD_MESSAGES[reason]);
}

function characterCount(text: string): number {
	return Array.from(text).length;
}

export async function POST(request: Request): Promise<Response> {
	try {
		const platform = await getPlatform();
		request.signal.throwIfAborted();

		const upload = await readUpload(request, { maxBytes: DEFAULT_ANALYSIS.maxUploadBytes });
		const instruction = upload.instruction.trim();
		if (instruction === "") {
			throw new GuardError("invalid-request", "分析の指示を入力してください。");
		}
		if (characterCount(instruction) > DEFAULT_ANALYSIS.maxInstructionCharacters) {
			throw new GuardError(
				"limit-exceeded",
				`分析の指示は ${DEFAULT_ANALYSIS.maxInstructionCharacters} 文字までです。`,
			);
		}
		if (!SESSION_ID.test(upload.sessionId)) {
			throw new GuardError("invalid-request", "セッション ID の形式が正しくありません。");
		}
		const checked = checkUpload({ name: upload.file.name, bytes: upload.file.bytes });
		if (!checked.ok) throw uploadRejection(checked.reason);

		const setup = await getSandboxSelection();
		if (setup.kind === "disabled") {
			throw new PlatformError(
				"provider-unavailable",
				`分析エージェントを使えません。${setup.reason}`,
				{
					guidance: setup.guidance,
				},
			);
		}
		// One analysis per session at a time: a second would overwrite the first one's input file, and
		// either one's disconnect would close the sandbox under the other.
		if (setup.registry.isBusy(upload.sessionId)) {
			throw new GuardError(
				"invalid-request",
				"このセッションでは別の分析が実行中です。終わるまでお待ちください。",
			);
		}
		const limited = rateLimitRejection({ limiter: platform.limiter, mode: platform.mode });
		if (limited) throw limited;

		const { model } = await platform.gateway.resolve({
			purpose: "chat",
			...(upload.modelId ? { modelId: upload.modelId } : {}),
			require: ["tools"],
		});

		const { registry } = setup;
		const { sessionId } = upload;
		// A lost connection ends the learner's sandbox at once (Req 3.7): this closes it even while a
		// run is in progress, so nothing keeps running for a page that is gone.
		const release = () => void registry.release(sessionId);
		request.signal.addEventListener("abort", release, { once: true });
		let lease: Awaited<ReturnType<typeof registry.acquire>>;
		try {
			lease = await registry.acquire(sessionId, { signal: request.signal });
		} catch (error) {
			request.signal.removeEventListener("abort", release);
			throw error;
		}

		const stream = createUIMessageStream({
			execute: async ({ writer }) => {
				try {
					const emit = createAnalysisStreamer(writer);
					if (lease.recreated) {
						writer.write({
							type: "data-analysis-notice",
							id: "notice-recreated",
							data: {
								reasons: [
									"サンドボックスの有効期限が切れていたため、作り直しました。ファイルを送り直して分析します。",
								],
							},
						});
					}
					const result = await runAnalysis({
						sandbox: lease.session,
						file: upload.file,
						instruction,
						model,
						options: {
							maxFixAttempts: DEFAULT_ANALYSIS.maxFixAttempts,
							executionTimeoutMs: DEFAULT_SANDBOX.executionTimeoutMs,
						},
						clock: platform.clock,
						signal: request.signal,
						onEvent: emit,
					});
					writeAnalysisResult(writer, result);
					// The sandbox chosen at start-up is gone (Docker stopped, say): forget the choice, so the
					// next request and the status page look again and show the guidance, not a stale kind.
					if (result.status === "sandbox-unavailable") await invalidateSandboxSelection();
				} finally {
					lease.done();
					request.signal.removeEventListener("abort", release);
				}
			},
			onError: toStreamErrorText,
		});
		return createUIMessageStreamResponse({ stream });
	} catch (error) {
		return toErrorResponse(error);
	}
}
