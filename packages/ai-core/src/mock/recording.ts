import { createHash } from "node:crypto";
import type { LanguageModelMiddleware } from "ai";
import type { ModelPurpose, RunMode } from "../models/types";
import type {
	HttpFetcher,
	HttpResponse,
	TranscriptFailureReason,
	TranscriptSource,
	WebSearchProvider,
} from "../ports";
import { TranscriptSourceError } from "../ports";
import {
	describeHttpFixtureRequest,
	type HttpFixture,
	httpFixtureRequestKey,
	type TranscriptFixture,
	transcriptFixtureRequestKey,
	type WebSearchFixture,
	webSearchFixtureRequestKey,
} from "./fixtures";
import type { Redactor } from "./redactor";
import { type RequestKey, requestKey } from "./request-key";

type MiddlewareWrapGenerate = NonNullable<LanguageModelMiddleware["wrapGenerate"]>;
type MiddlewareWrapStream = NonNullable<LanguageModelMiddleware["wrapStream"]>;
type GenerateOptions = Parameters<MiddlewareWrapGenerate>[0];
type StreamOptions = Parameters<MiddlewareWrapStream>[0];

export type LanguageModelV4Middleware = LanguageModelMiddleware & {
	readonly specificationVersion: "v4";
};
export type LanguageModelV4 = GenerateOptions["model"];
export type LanguageModelV4CallOptions = GenerateOptions["params"];
export type LanguageModelV4GenerateResult = Awaited<ReturnType<GenerateOptions["doGenerate"]>>;
export type LanguageModelV4StreamResult = Awaited<ReturnType<StreamOptions["doStream"]>>;
export type LanguageModelV4StreamPart =
	LanguageModelV4StreamResult["stream"] extends ReadableStream<infer Part> ? Part : never;
type LanguageModelV4Content = LanguageModelV4GenerateResult["content"][number];

export interface RecordingStore {
	put(key: string, value: unknown): void | PromiseLike<void>;
}

interface Cassette {
	readonly version: 1;
	readonly key: RequestKey;
	readonly request: {
		readonly purpose: ModelPurpose;
		readonly modelId: string;
		readonly promptDigest: string;
		readonly toolNames: readonly string[];
	};
	readonly parts: readonly LanguageModelV4StreamPart[];
	readonly recordedAt: string;
	readonly recordedWith: Exclude<RunMode, "mock">;
}

export interface RecordingMiddlewareOptions {
	readonly purpose?: ModelPurpose;
	readonly recordedWith?: Exclude<RunMode, "mock">;
	readonly now?: () => Date;
}

function digest(value: unknown): string {
	return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value: unknown): string {
	return JSON.stringify(normalize(value));
}

function normalize(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(normalize);
	if (value === null || typeof value !== "object") return value;
	if (value instanceof Date) return value.toISOString();
	if (value instanceof Uint8Array) return Array.from(value);
	return Object.fromEntries(
		Object.entries(value as Readonly<Record<string, unknown>>)
			.filter(([, nested]) => nested !== undefined)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, nested]) => [key, normalize(nested)]),
	);
}

function requestSummary(
	params: LanguageModelV4CallOptions,
	purpose: ModelPurpose,
	modelId: string,
): Cassette["request"] {
	return {
		purpose,
		modelId,
		promptDigest: digest(params.prompt),
		toolNames: params.tools?.map((tool) => tool.name) ?? [],
	};
}

function contentParts(content: readonly LanguageModelV4Content[]): LanguageModelV4StreamPart[] {
	return content.flatMap((part, index): LanguageModelV4StreamPart[] => {
		if (part.type === "text") {
			const id = `text-${index}`;
			return [
				{
					type: "text-start",
					id,
					...(part.providerMetadata ? { providerMetadata: part.providerMetadata } : {}),
				},
				{
					type: "text-delta",
					id,
					delta: part.text,
					...(part.providerMetadata ? { providerMetadata: part.providerMetadata } : {}),
				},
				{
					type: "text-end",
					id,
					...(part.providerMetadata ? { providerMetadata: part.providerMetadata } : {}),
				},
			];
		}
		if (part.type === "reasoning") {
			const id = `reasoning-${index}`;
			return [
				{
					type: "reasoning-start",
					id,
					...(part.providerMetadata ? { providerMetadata: part.providerMetadata } : {}),
				},
				{
					type: "reasoning-delta",
					id,
					delta: part.text,
					...(part.providerMetadata ? { providerMetadata: part.providerMetadata } : {}),
				},
				{
					type: "reasoning-end",
					id,
					...(part.providerMetadata ? { providerMetadata: part.providerMetadata } : {}),
				},
			];
		}
		return [part];
	});
}

function generateParts(result: LanguageModelV4GenerateResult): LanguageModelV4StreamPart[] {
	return [
		{ type: "stream-start", warnings: result.warnings },
		...(result.response
			? [
					{
						type: "response-metadata" as const,
						...(result.response.id ? { id: result.response.id } : {}),
						...(result.response.timestamp ? { timestamp: result.response.timestamp } : {}),
						...(result.response.modelId ? { modelId: result.response.modelId } : {}),
					},
				]
			: []),
		...contentParts(result.content),
		{
			type: "finish",
			usage: result.usage,
			finishReason: result.finishReason,
			...(result.providerMetadata ? { providerMetadata: result.providerMetadata } : {}),
		},
	];
}

async function recordCassette(
	store: RecordingStore,
	redactor: Redactor,
	params: LanguageModelV4CallOptions,
	modelId: string,
	parts: readonly LanguageModelV4StreamPart[],
	options: Required<RecordingMiddlewareOptions>,
): Promise<void> {
	const key = requestKey(params, options.purpose);
	const cassette: Cassette = {
		version: 1,
		key,
		request: requestSummary(params, options.purpose, modelId),
		parts: redactor.redact(parts),
		recordedAt: options.now().toISOString(),
		recordedWith: options.recordedWith,
	};
	await store.put(`llm/${key}`, cassette);
}

/** Records only completed streams; cancelled streams never create partial cassettes. */
export function recordingMiddleware(
	store: RecordingStore,
	redactor: Redactor,
	options: RecordingMiddlewareOptions = {},
): LanguageModelV4Middleware {
	const resolved: Required<RecordingMiddlewareOptions> = {
		purpose: options.purpose ?? "chat",
		recordedWith: options.recordedWith ?? "live",
		now: options.now ?? (() => new Date()),
	};
	return {
		specificationVersion: "v4",
		async wrapGenerate({ doGenerate, params, model }) {
			const result = await doGenerate();
			await recordCassette(store, redactor, params, model.modelId, generateParts(result), resolved);
			return result;
		},
		async wrapStream({ doStream, params, model }) {
			const result = await doStream();
			const parts: LanguageModelV4StreamPart[] = [];
			return {
				...result,
				stream: result.stream.pipeThrough(
					new TransformStream<LanguageModelV4StreamPart, LanguageModelV4StreamPart>({
						transform(part, controller) {
							parts.push(redactor.redact(part));
							controller.enqueue(part);
						},
						async flush() {
							await recordCassette(store, redactor, params, model.modelId, parts, resolved);
						},
					}),
				),
			};
		},
	};
}

function redactedHeaders(response: HttpResponse, redactor: Redactor): Record<string, string> {
	return redactor.redact({ headers: response.headers }).headers;
}

export function recordingHttpFetcher(
	inner: HttpFetcher,
	store: RecordingStore,
	redactor: Redactor,
): HttpFetcher {
	return {
		async fetch(url, init) {
			const response = await inner.fetch(url, init);
			const fixtureKey = httpFixtureRequestKey(url, init);
			const fixture: HttpFixture = {
				url: redactor.redact(url),
				requestKey: fixtureKey,
				request: describeHttpFixtureRequest(init),
				status: response.status,
				headers: redactedHeaders(response, redactor),
				body: redactor.redact(response.body),
			};
			await store.put(`http/${fixtureKey}`, fixture);
			return response;
		},
	};
}

function transcriptFailure(cause: unknown): TranscriptFailureReason {
	return cause instanceof TranscriptSourceError ? cause.reason : "fetch-failed";
}

export function recordingTranscriptSource(
	inner: TranscriptSource,
	store: RecordingStore,
	redactor: Redactor,
): TranscriptSource {
	return {
		async fetchTranscript(videoId, signal) {
			const recordedVideoId = redactor.redact(videoId);
			const fixtureKey = transcriptFixtureRequestKey(videoId);
			try {
				const result = await inner.fetchTranscript(videoId, signal);
				const fixture: TranscriptFixture = {
					videoId: recordedVideoId,
					requestKey: fixtureKey,
					result: redactor.redact(result),
				};
				await store.put(`transcripts/${fixtureKey}`, fixture);
				return result;
			} catch (cause) {
				const fixture: TranscriptFixture = {
					videoId: recordedVideoId,
					requestKey: fixtureKey,
					result: { error: transcriptFailure(cause) },
				};
				await store.put(`transcripts/${fixtureKey}`, fixture);
				throw cause;
			}
		},
	};
}

export function recordingWebSearch(
	inner: WebSearchProvider,
	store: RecordingStore,
	redactor: Redactor,
): WebSearchProvider {
	return {
		async search(query, signal) {
			const recordedQuery = redactor.redact(query);
			const fixtureKey = webSearchFixtureRequestKey(query);
			try {
				const result = await inner.search(query, signal);
				const fixture: WebSearchFixture = {
					query: recordedQuery,
					requestKey: fixtureKey,
					result: redactor.redact(result),
				};
				await store.put(`web-search/${fixtureKey}`, fixture);
				return result;
			} catch (cause) {
				const message = cause instanceof Error ? cause.message : String(cause);
				const fixture: WebSearchFixture = {
					query: recordedQuery,
					requestKey: fixtureKey,
					result: { error: redactor.redact(message) },
				};
				await store.put(`web-search/${fixtureKey}`, fixture);
				throw cause;
			}
		},
	};
}
