import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import type { ModelPurpose, RunMode } from "../models/types";
import type { RequestKey } from "./request-key";

type LanguageModelStreamPart =
	Awaited<ReturnType<MockLanguageModelV4["doStream"]>>["stream"] extends ReadableStream<infer Part>
		? Part
		: never;

const requestKeySchema = z.string().regex(/^[a-f0-9]{64}$/u);
const storageKeySchema = z.string().regex(/^(?:llm|http|transcripts|web-search)\/[a-f0-9]{64}$/u);
const idPart = (type: string) => z.looseObject({ type: z.literal(type), id: z.string() });
const deltaPart = (type: string) =>
	z.looseObject({ type: z.literal(type), id: z.string(), delta: z.string() });
const fileDataSchema = z.union([
	z.looseObject({ type: z.literal("data"), data: z.unknown() }),
	z.looseObject({ type: z.literal("url"), url: z.string() }),
]);
const streamPartSchema = z.discriminatedUnion("type", [
	idPart("text-start"),
	deltaPart("text-delta"),
	idPart("text-end"),
	idPart("reasoning-start"),
	deltaPart("reasoning-delta"),
	idPart("reasoning-end"),
	z.looseObject({ type: z.literal("tool-input-start"), id: z.string(), toolName: z.string() }),
	deltaPart("tool-input-delta"),
	idPart("tool-input-end"),
	z.looseObject({
		type: z.literal("tool-call"),
		toolCallId: z.string(),
		toolName: z.string(),
		input: z.string(),
	}),
	z.looseObject({
		type: z.literal("tool-result"),
		toolCallId: z.string(),
		toolName: z.string(),
		result: z.unknown(),
	}),
	z.looseObject({
		type: z.literal("tool-approval-request"),
		approvalId: z.string(),
		toolCallId: z.string(),
	}),
	z.looseObject({ type: z.literal("custom"), kind: z.string() }),
	z.looseObject({ type: z.literal("file"), mediaType: z.string(), data: fileDataSchema }),
	z.looseObject({ type: z.literal("reasoning-file"), mediaType: z.string(), data: fileDataSchema }),
	z.looseObject({
		type: z.literal("source"),
		sourceType: z.enum(["url", "document"]),
		id: z.string(),
	}),
	z.looseObject({ type: z.literal("stream-start"), warnings: z.array(z.unknown()) }),
	z.looseObject({ type: z.literal("response-metadata") }),
	z.looseObject({
		type: z.literal("finish"),
		usage: z.looseObject({
			inputTokens: z.looseObject({ total: z.number() }),
			outputTokens: z.looseObject({ total: z.number() }),
		}),
		finishReason: z.looseObject({ unified: z.string() }),
	}),
	z.looseObject({ type: z.literal("raw"), rawValue: z.unknown() }),
	z.looseObject({ type: z.literal("error"), error: z.unknown() }),
]);
const cassetteSchema = z.strictObject({
	version: z.literal(1),
	key: requestKeySchema,
	request: z.strictObject({
		purpose: z.enum(["chat", "structured", "embedding", "judge"]),
		modelId: z.string().min(1),
		promptDigest: requestKeySchema,
		toolNames: z.array(z.string()),
	}),
	parts: z.array(streamPartSchema),
	recordedAt: z.iso.datetime(),
	recordedWith: z.enum(["local", "live"]),
});

export interface Cassette {
	readonly version: 1;
	readonly key: RequestKey;
	readonly request: {
		readonly purpose: ModelPurpose;
		readonly modelId: string;
		readonly promptDigest: string;
		readonly toolNames: readonly string[];
	};
	readonly parts: readonly LanguageModelStreamPart[];
	readonly recordedAt: string;
	readonly recordedWith: Exclude<RunMode, "mock">;
}

export interface CassetteStore {
	get(key: RequestKey): Promise<Cassette | undefined>;
	put(key: string, value: unknown): Promise<void>;
}

function normalizeStorageKey(key: string): string {
	const candidate = requestKeySchema.safeParse(key).success ? `llm/${key}` : key;
	if (!storageKeySchema.safeParse(candidate).success) {
		throw new Error(`Invalid cassette storage key: ${key}`);
	}
	return candidate;
}

function parseCassette(value: unknown, expectedKey: RequestKey): Cassette {
	const parsed = cassetteSchema.parse(value);
	if (parsed.key !== expectedKey) throw new Error("Cassette key does not match its filename");
	return {
		...parsed,
		parts: parsed.parts.map((part) =>
			part.type === "response-metadata" && typeof part.timestamp === "string"
				? { ...part, timestamp: new Date(part.timestamp) }
				: part,
		),
	} as unknown as Cassette;
}

export function createCassetteStore(directory: string): CassetteStore {
	const root = path.resolve(directory);
	const fileFor = (key: string) => path.join(root, `${normalizeStorageKey(key)}.json`);
	return {
		async get(key) {
			try {
				return parseCassette(JSON.parse(await readFile(fileFor(key), "utf8")), key);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
				throw error;
			}
		},
		async put(key, value) {
			const target = fileFor(key);
			await mkdir(path.dirname(target), { recursive: true });
			const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
			await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
				encoding: "utf8",
				mode: 0o600,
			});
			await rename(temporary, target);
		},
	};
}
