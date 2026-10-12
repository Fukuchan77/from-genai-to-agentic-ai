import { MockLanguageModelV4 } from "ai/test";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PlatformError } from "../errors";
import { getModelEntry, type ResolvedEmbeddingModel } from "../models";
import { createFakeClock } from "../ports/clock";
import { createTextStreamModel } from "../testing";
import { NO_EVIDENCE_MESSAGE } from "./answer";
import { createPgliteDatabase, type RagDatabaseHandle } from "./db";
import type { KnowledgeBaseMeta } from "./embedding";
import { toSearchText } from "./ingest/search-text";
import type { RagQueryDeps } from "./query";
import { type RagEvent, type RagQueryRequest, streamRagQuery } from "./query";
import { createKnowledgeStore, type KnowledgeStore } from "./store";

const MOCK_ENTRY = getModelEntry("mock:embedding-v1");
const META: KnowledgeBaseMeta = { embeddingModelId: "mock:embedding-v1", dimensions: 768 };

let handle: RagDatabaseHandle;
let store: KnowledgeStore;

function axis(index: number): number[] {
	return Array.from({ length: 768 }, (_, position) => (position === index ? 1 : 0));
}

function embeddingFor(table: Record<string, number[]>): ResolvedEmbeddingModel {
	return {
		mode: "mock",
		entry: MOCK_ENTRY,
		model: {
			specificationVersion: "v4",
			provider: "mock",
			modelId: "table",
			maxEmbeddingsPerCall: Number.POSITIVE_INFINITY,
			supportsParallelCalls: true,
			async doEmbed({ values }) {
				return { embeddings: values.map((value) => table[value] ?? axis(767)), warnings: [] };
			},
		},
	};
}

async function seedChunks(count: number): Promise<void> {
	const bodies = Array.from({ length: count }, (_, index) => `資料その${index + 1}`);
	await store.replaceDocument(
		{ id: "kb:doc.md", title: "doc.md", sourceType: "markdown", tags: [] },
		bodies.map((body, ordinal) => ({
			id: `chunk-${ordinal + 1}`,
			ordinal,
			headingPath: ["章"],
			page: null,
			body,
			searchText: toSearchText(body),
		})),
		bodies.map(() => axis(0)),
		META,
	);
}

const REQUEST: RagQueryRequest = {
	question: "質問A",
	settings: {
		topK: 2,
		minSimilarity: 0.5,
		filter: {},
		methods: { hyde: false, multiQuery: false, hybrid: false, rerank: false },
	},
};

function deps(chatModel: RagQueryDeps["chatModel"], overrides: Partial<RagQueryDeps> = {}) {
	return {
		store,
		embedding: embeddingFor({ 質問A: axis(0) }),
		structuredModel: undefined as never,
		chatModel,
		rerank: undefined,
		clock: createFakeClock(0),
		...overrides,
	} satisfies RagQueryDeps;
}

async function collect(
	generator: AsyncGenerator<RagEvent, void>,
	until?: (event: RagEvent) => boolean,
): Promise<RagEvent[]> {
	const events: RagEvent[] = [];
	for await (const event of generator) {
		events.push(event);
		if (until?.(event)) break;
	}
	return events;
}

function resultOf(events: readonly RagEvent[]) {
	const found = events.find((event) => event.type === "result");
	if (found?.type !== "result") throw new Error("no result event");
	return found.result;
}

beforeAll(async () => {
	handle = await createPgliteDatabase();
});

afterAll(async () => {
	await handle.close();
});

beforeEach(async () => {
	await handle.db.execute(sql`TRUNCATE rag_chunks, rag_documents, rag_meta CASCADE`);
	store = createKnowledgeStore(handle.db, { clock: createFakeClock(0) });
});

describe("streamRagQuery", () => {
	it("emits stage and trace events while retrieving, then the answer text, then the result", async () => {
		await seedChunks(3);
		const events = await collect(
			streamRagQuery(deps(createTextStreamModel("答えは [1] です。")), REQUEST),
		);
		const types = events.map((event) => event.type);
		const lastTrace = types.lastIndexOf("trace");
		const firstText = types.indexOf("text-delta");
		expect(lastTrace).toBeGreaterThan(0);
		// before the answer only retrieval stages and traces
		expect(
			types.slice(0, lastTrace + 1).every((type) => type === "stage" || type === "trace"),
		).toBe(true);
		expect(firstText).toBeGreaterThan(lastTrace);
		expect(types.at(-1)).toBe("result");
		expect(types.filter((type) => type === "result")).toHaveLength(1);
		// after the last trace only generation stages, text and the result follow
		const tail = events.slice(lastTrace + 1);
		expect(
			tail.every(
				(event) =>
					event.type === "text-delta" ||
					event.type === "result" ||
					(event.type === "stage" && event.stage === "generate"),
			),
		).toBe(true);
		const text = events.flatMap((event) => (event.type === "text-delta" ? [event.text] : []));
		expect(text.join("")).toBe("答えは [1] です。");
	});

	it("sends the intermediate results as retrieval proceeds, each trace including the previous ones (Req 2.11)", async () => {
		await seedChunks(3);
		const events = await collect(streamRagQuery(deps(createTextStreamModel("答え [1]")), REQUEST));
		const traces = events.flatMap((event) => (event.type === "trace" ? [event.trace] : []));
		expect(traces.length).toBeGreaterThanOrEqual(2);
		// the first trace arrives before retrieval has finished: no final chunks yet
		expect(traces[0]?.final).toEqual([]);
		expect(traces.at(-1)?.final.length).toBeGreaterThan(0);
		const recorded = traces.map((trace) => trace.stages.length);
		expect(recorded).toEqual([...recorded].sort((a, b) => a - b));
		// the vector candidates are already in a trace that is sent before the retrieval ends
		const firstWithCandidates = traces.findIndex((trace) => trace.vector.length > 0);
		expect(firstWithCandidates).toBeGreaterThanOrEqual(0);
		expect(firstWithCandidates).toBeLessThan(traces.length - 1);
	});

	it("reports the retrieval stages and a generate stage", async () => {
		await seedChunks(2);
		const events = await collect(streamRagQuery(deps(createTextStreamModel("答え [1]")), REQUEST));
		const stages = events.flatMap((event) =>
			event.type === "stage" ? [`${event.stage}:${event.status}`] : [],
		);
		expect(stages).toContain("vector-search:running");
		expect(stages).toContain("vector-search:done");
		expect(stages.indexOf("generate:running")).toBeGreaterThan(
			stages.indexOf("vector-search:done"),
		);
		expect(stages.at(-1)).toBe("generate:done");
	});

	it("returns citations for every retrieved chunk and marks the cited ones", async () => {
		await seedChunks(3);
		const result = resultOf(
			await collect(streamRagQuery(deps(createTextStreamModel("根拠は [2] です。")), REQUEST)),
		);
		expect(result.noEvidence).toBe(false);
		expect(result.citations).toHaveLength(2);
		expect(result.citations.map((citation) => citation.cited)).toEqual([false, true]);
		expect(result.answer).toBe("根拠は [2] です。");
		expect(result.settings.topK).toBe(2);
		expect(result.rerank).toEqual({ status: "disabled" });
	});

	it("removes citations outside the retrieved range and records them", async () => {
		await seedChunks(3);
		const result = resultOf(
			await collect(streamRagQuery(deps(createTextStreamModel("正しい [1]。嘘の [7]。")), REQUEST)),
		);
		expect(result.answer).not.toContain("[7]");
		expect(result.answer).toContain("[1]");
		expect(result.removedCitations).toEqual([7]);
	});

	it("does not call the language model when there is no evidence", async () => {
		await seedChunks(2);
		const chat = new MockLanguageModelV4();
		const events = await collect(
			streamRagQuery(deps(chat, { embedding: embeddingFor({ 質問A: axis(9) }) }), REQUEST),
		);
		const text = events.flatMap((event) => (event.type === "text-delta" ? [event.text] : []));
		expect(text).toEqual([NO_EVIDENCE_MESSAGE]);
		const result = resultOf(events);
		expect(result.noEvidence).toBe(true);
		expect(result.answer).toBe(NO_EVIDENCE_MESSAGE);
		expect(result.citations).toEqual([]);
		expect(chat.doStreamCalls).toHaveLength(0);
		expect(chat.doGenerateCalls).toHaveLength(0);
	});

	it("answers no evidence for an empty knowledge base", async () => {
		const chat = new MockLanguageModelV4();
		const events = await collect(streamRagQuery(deps(chat), REQUEST));
		expect(resultOf(events).noEvidence).toBe(true);
		expect(chat.doStreamCalls).toHaveLength(0);
	});

	it("starts neither retrieval nor generation when the signal is already aborted", async () => {
		await seedChunks(2);
		const chat = new MockLanguageModelV4();
		const controller = new AbortController();
		controller.abort(new Error("stopped by caller"));
		await expect(collect(streamRagQuery(deps(chat), REQUEST, controller.signal))).rejects.toThrow(
			"stopped by caller",
		);
		expect(chat.doStreamCalls).toHaveLength(0);
	});

	it("does not start generation when the signal aborts during retrieval", async () => {
		await seedChunks(2);
		const chat = new MockLanguageModelV4();
		const controller = new AbortController();
		const events: RagEvent[] = [];
		await expect(
			(async () => {
				for await (const event of streamRagQuery(deps(chat), REQUEST, controller.signal)) {
					events.push(event);
					// abort as soon as the trace arrives, before generation can begin
					if (event.type === "trace") controller.abort(new Error("stopped by caller"));
				}
			})(),
		).rejects.toThrow("stopped by caller");
		expect(chat.doStreamCalls).toHaveLength(0);
		expect(events.some((event) => event.type === "result")).toBe(false);
	});

	it("sends no result when the signal aborts while the answer is streaming", async () => {
		await seedChunks(2);
		const controller = new AbortController();
		const events: RagEvent[] = [];
		await expect(
			(async () => {
				for await (const event of streamRagQuery(
					deps(createTextStreamModel("途中まで [1]")),
					REQUEST,
					controller.signal,
				)) {
					events.push(event);
					if (event.type === "text-delta") controller.abort(new Error("stopped by caller"));
				}
			})(),
		).rejects.toThrow("stopped by caller");
		expect(events.some((event) => event.type === "result")).toBe(false);
	});

	it("turns a failing answer generation into a fixed provider-unavailable error", async () => {
		await seedChunks(2);
		const failing = new MockLanguageModelV4({
			doStream: async () => {
				throw new Error("secret connection string postgres://user:pw@host");
			},
		});
		const error = await collect(streamRagQuery(deps(failing), REQUEST)).catch(
			(caught: unknown) => caught,
		);
		expect(error).toBeInstanceOf(PlatformError);
		expect(error).toMatchObject({ code: "provider-unavailable" });
		expect((error as PlatformError).message).not.toContain("secret");
		expect(JSON.stringify((error as PlatformError).details ?? {})).not.toContain("secret");
	});

	it("passes retrieval errors through unchanged", async () => {
		await seedChunks(2);
		const otherModel: ResolvedEmbeddingModel = {
			...embeddingFor({}),
			entry: { ...MOCK_ENTRY, id: "other:embedding" },
		};
		const error = await collect(
			streamRagQuery(deps(createTextStreamModel("x"), { embedding: otherModel }), REQUEST),
		).catch((caught: unknown) => caught);
		expect(error).toMatchObject({ code: "invalid-request" });
		expect((error as PlatformError).details).toMatchObject({ reason: "embedding-model-changed" });
	});

	it("reports the token usage of the answer", async () => {
		await seedChunks(2);
		const model = new MockLanguageModelV4({
			doStream: async () => ({
				stream: new ReadableStream({
					start(controller) {
						controller.enqueue({ type: "stream-start", warnings: [] });
						controller.enqueue({ type: "text-start", id: "t" });
						controller.enqueue({ type: "text-delta", id: "t", delta: "答え [1]" });
						controller.enqueue({ type: "text-end", id: "t" });
						controller.enqueue({
							type: "finish",
							finishReason: { unified: "stop", raw: undefined },
							usage: {
								inputTokens: { total: 120, noCache: 120, cacheRead: 0, cacheWrite: 0 },
								outputTokens: { total: 15, text: 15, reasoning: 0 },
							},
						});
						controller.close();
					},
				}),
			}),
		});
		const result = resultOf(await collect(streamRagQuery(deps(model), REQUEST)));
		expect(result.usage.inputTokens).toBe(120);
		expect(result.usage.outputTokens).toBe(15);
	});

	it("applies the metadata filter of the request to the search", async () => {
		await seedChunks(2);
		const chat = new MockLanguageModelV4();
		const filtered = {
			...REQUEST,
			settings: { ...REQUEST.settings, filter: { documentIds: ["kb:other.md"] } },
		};
		const result = resultOf(await collect(streamRagQuery(deps(chat), filtered)));
		expect(result.noEvidence).toBe(true);
		expect(chat.doStreamCalls).toHaveLength(0);
		expect(result.settings.filter).toEqual({ documentIds: ["kb:other.md"] });
	});

	it("turns a failing embedding call into a fixed provider-unavailable error (review F-5)", async () => {
		await seedChunks(2);
		const base = embeddingFor({ 質問A: axis(0) });
		const failing: ResolvedEmbeddingModel = {
			...base,
			model: {
				...base.model,
				async doEmbed() {
					throw new Error("embedding backend said: key sk-secret-777 rejected");
				},
			},
		};
		const error = await collect(
			streamRagQuery(deps(createTextStreamModel("x"), { embedding: failing }), REQUEST),
		).catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(PlatformError);
		expect(error).toMatchObject({ code: "provider-unavailable" });
		expect(JSON.stringify(error)).not.toContain("sk-secret-777");
		expect((error as PlatformError).message).not.toContain("sk-secret-777");
	});

	it("turns a failing HyDE call into provider-unavailable too", async () => {
		await seedChunks(2);
		const failing = new MockLanguageModelV4({
			doGenerate: async () => {
				throw new Error("hyde upstream: sk-secret-888");
			},
		});
		const hyde = {
			...REQUEST,
			settings: { ...REQUEST.settings, methods: { ...REQUEST.settings.methods, hyde: true } },
		};
		const error = await collect(
			streamRagQuery(deps(createTextStreamModel("x"), { structuredModel: failing }), hyde),
		).catch((caught: unknown) => caught);
		expect(error).toMatchObject({ code: "provider-unavailable" });
		expect(JSON.stringify(error)).not.toContain("sk-secret-888");
	});

	it("keeps a retrieval abort as the abort, not as a provider failure", async () => {
		await seedChunks(2);
		const controller = new AbortController();
		const base = embeddingFor({ 質問A: axis(0) });
		const slow: ResolvedEmbeddingModel = {
			...base,
			model: {
				...base.model,
				async doEmbed(options) {
					controller.abort(new Error("stopped by caller"));
					return base.model.doEmbed(options);
				},
			},
		};
		await expect(
			collect(
				streamRagQuery(
					deps(createTextStreamModel("x"), { embedding: slow }),
					REQUEST,
					controller.signal,
				),
			),
		).rejects.toThrow("stopped by caller");
	});
});
