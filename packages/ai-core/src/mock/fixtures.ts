import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { PlatformError } from "../errors";
import type {
	HttpFetcher,
	SearchHit,
	TranscriptResult,
	TranscriptSource,
	WebSearchProvider,
} from "../ports";
import { TranscriptSourceError } from "../ports";
import type { RequestKey } from "./request-key";
import { MockFixtureMissingError } from "./resolve";

const transcriptFailureSchema = z.object({
	error: z.enum(["no-captions", "private", "fetch-failed"]),
});

const transcriptResultSchema = z
	.object({
		videoId: z.string(),
		title: z.string().optional(),
		language: z.string().optional(),
		segments: z.array(
			z.object({
				text: z.string(),
				startSeconds: z.number(),
				durationSeconds: z.number(),
			}),
		),
	})
	.transform(
		(value): TranscriptResult => ({
			videoId: value.videoId,
			...(value.title === undefined ? {} : { title: value.title }),
			...(value.language === undefined ? {} : { language: value.language }),
			segments: value.segments,
		}),
	);

const searchHitSchema = z
	.object({
		title: z.string(),
		url: z.string(),
		snippet: z.string(),
		score: z.number(),
		publishedDate: z.string().optional(),
	})
	.transform(
		(value): SearchHit => ({
			title: value.title,
			url: value.url,
			snippet: value.snippet,
			score: value.score,
			...(value.publishedDate === undefined ? {} : { publishedDate: value.publishedDate }),
		}),
	);

const requestKeySchema = z.string().regex(/^[a-f0-9]{64}$/u);
const httpRequestSchema = z.strictObject({
	method: z.string(),
	headersDigest: requestKeySchema.optional(),
	bodyDigest: requestKeySchema.optional(),
});

const httpFixtureSchema = z.object({
	url: z.string(),
	requestKey: requestKeySchema.optional(),
	request: httpRequestSchema.optional(),
	status: z.number().int(),
	headers: z.record(z.string(), z.string()),
	body: z.string(),
});

const transcriptFixtureSchema = z.object({
	videoId: z.string(),
	requestKey: requestKeySchema.optional(),
	result: z.union([transcriptResultSchema, transcriptFailureSchema]),
});

const webSearchFixtureSchema = z.object({
	query: z.string(),
	requestKey: requestKeySchema.optional(),
	result: z.union([z.array(searchHitSchema), z.object({ error: z.string() })]),
});

export interface HttpFixture {
	readonly url: string;
	readonly requestKey?: string | undefined;
	readonly request?: HttpFixtureRequest | undefined;
	readonly status: number;
	readonly headers: Readonly<Record<string, string>>;
	readonly body: string;
}

export interface TranscriptFixture {
	readonly videoId: string;
	readonly requestKey?: string | undefined;
	readonly result:
		| TranscriptResult
		| { readonly error: "no-captions" | "private" | "fetch-failed" };
}

export interface WebSearchFixture {
	readonly query: string;
	readonly requestKey?: string | undefined;
	readonly result: readonly SearchHit[] | { readonly error: string };
}

export interface HttpFixtureRequest {
	readonly method: string;
	readonly headersDigest?: string | undefined;
	readonly bodyDigest?: string | undefined;
}

export interface FixtureSet {
	readonly http: readonly HttpFixture[];
	readonly transcripts: readonly TranscriptFixture[];
	readonly webSearch: readonly WebSearchFixture[];
}

export const DEFAULT_FIXTURE_DIRECTORY = fileURLToPath(new URL("../../fixtures", import.meta.url));
export const CASSETTE_FIXTURE_DIRECTORY = path.join(DEFAULT_FIXTURE_DIRECTORY, "cassettes");

const SENSITIVE_HEADER = /^(?:authorization|cookie|proxy-authorization|set-cookie|x-api-key)$/iu;
const SENSITIVE_QUERY_PARAMETER =
	/^(?:api[-_]?key|access[-_]?token|auth|authorization|key|password|secret|token)$/iu;

function digest(value: string): RequestKey {
	return createHash("sha256").update(value).digest("hex") as RequestKey;
}

function canonicalUrl(url: string): string {
	try {
		const parsed = new URL(url);
		for (const key of parsed.searchParams.keys()) {
			if (SENSITIVE_QUERY_PARAMETER.test(key)) parsed.searchParams.set(key, "[REDACTED]");
		}
		parsed.searchParams.sort();
		return parsed.toString();
	} catch {
		return url;
	}
}

function bodyBytes(body: BodyInit | null | undefined): string | undefined {
	if (body === undefined || body === null) return undefined;
	if (typeof body === "string") return body;
	if (body instanceof URLSearchParams) return body.toString();
	if (body instanceof ArrayBuffer) return Buffer.from(body).toString("base64");
	if (ArrayBuffer.isView(body)) {
		return Buffer.from(body.buffer, body.byteOffset, body.byteLength).toString("base64");
	}
	return String(body);
}

export function describeHttpFixtureRequest(init: RequestInit = {}): HttpFixtureRequest {
	const headers = [...new Headers(init.headers).entries()]
		.filter(([name]) => !SENSITIVE_HEADER.test(name))
		.sort(([left], [right]) => left.localeCompare(right));
	const body = bodyBytes(init.body);
	return {
		method: (init.method ?? "GET").toUpperCase(),
		...(headers.length > 0 ? { headersDigest: digest(JSON.stringify(headers)) } : {}),
		...(body === undefined ? {} : { bodyDigest: digest(body) }),
	};
}

export function httpFixtureRequestKey(url: string, init: RequestInit = {}): RequestKey {
	return digest(
		JSON.stringify({ url: canonicalUrl(url), request: describeHttpFixtureRequest(init) }),
	);
}

export function transcriptFixtureRequestKey(videoId: string): RequestKey {
	return digest(`transcript\0${videoId}`);
}

export function webSearchFixtureRequestKey(query: string): RequestKey {
	return digest(`web-search\0${query}`);
}

function fixtureKey(kind: string, request: string): RequestKey {
	return createHash("sha256").update(`${kind}\0${request}`).digest("hex") as RequestKey;
}

function missingFixture(kind: string, request: string): MockFixtureMissingError {
	return new MockFixtureMissingError(fixtureKey(kind, request), []);
}

function indexFirst<T>(
	fixtures: readonly T[],
	keyFor: (fixture: T) => string,
): ReadonlyMap<string, T> {
	const index = new Map<string, T>();
	for (const fixture of fixtures) {
		const key = keyFor(fixture);
		if (!index.has(key)) index.set(key, fixture);
	}
	return index;
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw signal.reason;
}

export function createFixtureHttpFetcher(fixtures: readonly HttpFixture[]): HttpFetcher {
	const byRequestKey = indexFirst(
		fixtures.filter((fixture) => fixture.requestKey !== undefined),
		(fixture) => fixture.requestKey as string,
	);
	const byUrl = indexFirst(
		fixtures.filter((fixture) => fixture.requestKey === undefined),
		(fixture) => fixture.url,
	);
	return {
		async fetch(url, init) {
			throwIfAborted(init?.signal ?? undefined);
			const fixture = byRequestKey.get(httpFixtureRequestKey(url, init)) ?? byUrl.get(url);
			if (!fixture) throw missingFixture("http", url);
			return { status: fixture.status, headers: fixture.headers, body: fixture.body };
		},
	};
}

export function createFixtureTranscriptSource(
	fixtures: readonly TranscriptFixture[],
): TranscriptSource {
	const byRequestKey = indexFirst(
		fixtures.filter((fixture) => fixture.requestKey !== undefined),
		(fixture) => fixture.requestKey as string,
	);
	const byVideoId = indexFirst(
		fixtures.filter((fixture) => fixture.requestKey === undefined),
		(fixture) => fixture.videoId,
	);
	return {
		async fetchTranscript(videoId, signal) {
			throwIfAborted(signal);
			const fixture =
				byRequestKey.get(transcriptFixtureRequestKey(videoId)) ?? byVideoId.get(videoId);
			if (!fixture) throw missingFixture("transcript", videoId);
			if ("error" in fixture.result) {
				throw new TranscriptSourceError(fixture.result.error, videoId);
			}
			return { ...fixture.result, videoId };
		},
	};
}

export function createFixtureWebSearch(fixtures: readonly WebSearchFixture[]): WebSearchProvider {
	const byRequestKey = indexFirst(
		fixtures.filter((fixture) => fixture.requestKey !== undefined),
		(fixture) => fixture.requestKey as string,
	);
	const byQuery = indexFirst(
		fixtures.filter((fixture) => fixture.requestKey === undefined),
		(fixture) => fixture.query,
	);
	return {
		async search(query, signal) {
			throwIfAborted(signal);
			const fixture = byRequestKey.get(webSearchFixtureRequestKey(query)) ?? byQuery.get(query);
			if (!fixture) throw missingFixture("web-search", query);
			if ("error" in fixture.result) {
				throw new PlatformError("source-unavailable", fixture.result.error, {
					provider: "fixture",
				});
			}
			return fixture.result;
		},
	};
}

async function jsonFiles(directory: string): Promise<readonly string[]> {
	try {
		return (await readdir(directory, { withFileTypes: true }))
			.filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
			.map((entry) => path.join(directory, entry.name))
			.sort();
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
}

async function loadFixtures<T>(directory: string, schema: z.ZodType<T>): Promise<readonly T[]> {
	return Promise.all(
		(await jsonFiles(directory)).map(async (file) =>
			schema.parse(JSON.parse(await readFile(file, "utf8"))),
		),
	);
}

export async function loadFixtureSet(directory = DEFAULT_FIXTURE_DIRECTORY): Promise<FixtureSet> {
	const cassettes = path.join(directory, "cassettes");
	const [http, recordedHttp, transcripts, recordedTranscripts, webSearch, recordedWebSearch] =
		await Promise.all([
			loadFixtures(path.join(directory, "http"), httpFixtureSchema),
			loadFixtures(path.join(cassettes, "http"), httpFixtureSchema),
			loadFixtures(path.join(directory, "transcripts"), transcriptFixtureSchema),
			loadFixtures(path.join(cassettes, "transcripts"), transcriptFixtureSchema),
			loadFixtures(path.join(directory, "web-search"), webSearchFixtureSchema),
			loadFixtures(path.join(cassettes, "web-search"), webSearchFixtureSchema),
		]);
	return {
		http: [...http, ...recordedHttp],
		transcripts: [...transcripts, ...recordedTranscripts],
		webSearch: [...webSearch, ...recordedWebSearch],
	};
}
