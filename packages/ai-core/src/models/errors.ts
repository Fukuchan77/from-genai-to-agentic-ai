import { PlatformError } from "../errors";
import type { Capability, ModelId, ModelPurpose, ProviderId, RunMode } from "./types";

/** A selected provider has no credentials; raised before any LLM call (Req 2.6). */
export class ProviderCredentialsMissingError extends PlatformError {
	readonly provider: ProviderId;
	readonly envVars: readonly string[];

	constructor(provider: ProviderId, envVars: readonly string[]) {
		super(
			"provider-unavailable",
			`プロバイダ ${provider} の認証情報が設定されていません。環境変数 ${envVars.join(", ")} を設定してください。`,
			{ provider, envVars },
		);
		this.provider = provider;
		this.envVars = envVars;
	}
}

export type OllamaUnavailableReason =
	| "unreachable"
	| "http-status"
	| "invalid-response"
	| "model-missing";

/** Ollama cannot serve the request in `local` mode; the message tells how to fix it (Req 2.7). */
export class OllamaUnavailableError extends PlatformError {
	readonly baseUrl: string;
	readonly reason: OllamaUnavailableReason;
	readonly modelId: ModelId | undefined;

	constructor(
		baseUrl: string,
		reason: OllamaUnavailableReason,
		options: { readonly modelId?: ModelId; readonly status?: number } = {},
	) {
		super("provider-unavailable", ollamaMessage(baseUrl, reason, options), {
			baseUrl,
			reason,
			...(options.modelId === undefined ? {} : { modelId: options.modelId }),
			...(options.status === undefined ? {} : { status: options.status }),
		});
		this.baseUrl = baseUrl;
		this.reason = reason;
		this.modelId = options.modelId;
	}
}

function ollamaMessage(
	baseUrl: string,
	reason: OllamaUnavailableReason,
	options: { readonly modelId?: ModelId; readonly status?: number },
): string {
	if (reason === "model-missing") {
		return `Ollama（${baseUrl}）にモデル ${options.modelId} が取得されていません。\`ollama pull ${options.modelId}\` を実行してください。`;
	}
	const problem =
		reason === "http-status"
			? `Ollama（${baseUrl}）が HTTP ${options.status} を返しました`
			: reason === "invalid-response"
				? `Ollama（${baseUrl}）が不正な応答を返しました`
				: `Ollama（${baseUrl}）に接続できません`;
	return `${problem}。\`ollama serve\` で Ollama を起動し、OLLAMA_BASE_URL を確認してください。`;
}

/** The model does not support a capability the caller requires; raised before the call (Req 2.9). */
export class CapabilityUnsupportedError extends PlatformError {
	readonly capability: Capability;
	readonly modelId: ModelId;

	constructor(capability: Capability, modelId: ModelId, displayName: string) {
		super(
			"capability-unsupported",
			`モデル ${displayName}（${modelId}）は機能 ${capability} に対応していません。`,
			{ capability, modelId },
		);
		this.capability = capability;
		this.modelId = modelId;
	}
}

export type ModelSelectionFailure =
	| "unknown-model"
	| "mode-mismatch"
	| "no-default"
	| "purpose-mismatch";

export interface ModelSelectionDetails {
	readonly reason: ModelSelectionFailure;
	readonly mode: RunMode;
	readonly modelId?: ModelId;
	readonly modes?: readonly RunMode[];
	readonly provider?: ProviderId;
	readonly purpose?: ModelPurpose;
}

/**
 * The requested or configured model cannot be used: it is outside the catalog, its catalog
 * `modes` do not include the current run mode (W2 validation D9, including IDs set through
 * `AI_MODEL_*`), the purpose has no default model, or the model does not serve the purpose.
 */
export class ModelSelectionError extends PlatformError {
	readonly reason: ModelSelectionFailure;

	constructor(details: ModelSelectionDetails) {
		super("invalid-request", selectionMessage(details), { ...details });
		this.reason = details.reason;
	}
}

function selectionMessage(details: ModelSelectionDetails): string {
	switch (details.reason) {
		case "unknown-model":
			return `モデル ${details.modelId} はモデルカタログにありません。`;
		case "mode-mismatch":
			return `モデル ${details.modelId} は実行モード ${details.mode} では使えません（対応する実行モード: ${details.modes?.join(", ")}）。`;
		case "no-default":
			return `実行モード ${details.mode} のプロバイダ ${details.provider} には用途 ${details.purpose} の既定モデルがありません。AI_MODEL_${details.purpose?.toUpperCase()} でモデルを指定してください。`;
		case "purpose-mismatch":
			return `モデル ${details.modelId} は用途 ${details.purpose} には使えません。`;
	}
}
