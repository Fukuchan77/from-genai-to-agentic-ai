import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
	createSearchKnowledgeBaseTool,
	type SearchKnowledgeBaseResult,
} from "../aci/tools/search-knowledge-base";
import type { AciTool, ToolOutcome, ToolRuntime } from "../aci/types";
import { getModelEntry, type ResolvedEmbeddingModel } from "../models";
import { createFakeClock } from "../ports/clock";
import {
	AGENTIC_RAG_INSTRUCTIONS,
	createCitationRegistry,
	createKnowledgeSearcher,
	summarizeAgenticRun,
} from "./agentic";
import { createPgliteDatabase, type RagDatabaseHandle } from "./db";
import type { KnowledgeBaseMeta } from "./embedding";
import { toSearchText } from "./ingest/search-text";
import { createKnowledgeStore, type KnowledgeStore, type ScoredChunk } from "./store";

const MOCK_ENTRY = getModelEntry("mock:embedding-v1");
const META: KnowledgeBaseMeta = { embeddingModelId: "mock:embedding-v1", dimensions: 768 };
const RUNTIME: ToolRuntime = { clock: createFakeClock(), toolTimeoutMs: 1_000 };

function axis(index: number): number[] {
	return Array.from({ length: 768 }, (_, position) => (position === index ? 1 : 0));
}

function scored(id: string, body = `body ${id}`): ScoredChunk {
	return {
		chunk: {
			id,
			documentId: "kb:doc.md",
			documentTitle: "doc.md",
			ordinal: 0,
			headingPath: ["章"],
			page: null,
			body,
		},
		score: 0.9,
		similarity: 0.9,
	};
}

describe("createCitationRegistry", () => {
	it("numbers chunks 1, 2, 3 in order of first registration", () => {
		const registry = createCitationRegistry();
		expect([registry.register(scored("a")), registry.register(scored("b"))]).toEqual([1, 2]);
		expect(registry.register(scored("c"))).toBe(3);
		expect(registry.chunks().map((row) => row.chunk.id)).toEqual(["a", "b", "c"]);
	});

	it("gives the same chunk the same label and stores it once", () => {
		const registry = createCitationRegistry();
		const first = registry.register(scored("a"));
		registry.register(scored("b"));
		expect(registry.register(scored("a"))).toBe(first);
		expect(registry.chunks()).toHaveLength(2);
	});

	it("keeps the registries of two requests apart", () => {
		const one = createCitationRegistry();
		const two = createCitationRegistry();
		one.register(scored("a"));
		one.register(scored("b"));
		expect(two.register(scored("z"))).toBe(1);
		expect(two.chunks().map((row) => row.chunk.id)).toEqual(["z"]);
		expect(one.chunks().map((row) => row.chunk.id)).toEqual(["a", "b"]);
	});

	it("returns a copy, so callers cannot renumber the registry", () => {
		const registry = createCitationRegistry();
		registry.register(scored("a"));
		(registry.chunks() as ScoredChunk[]).pop();
		expect(registry.chunks()).toHaveLength(1);
	});
});

describe("summarizeAgenticRun", () => {
	function registryWith(ids: string[]) {
		const registry = createCitationRegistry();
		for (const id of ids) registry.register(scored(id));
		return registry;
	}

	it("reports that no search happened when the tool was never called", () => {
		const summary = summarizeAgenticRun(
			{ toolsCalled: [] },
			registryWith([]),
			"検索せずに答えました。",
		);
		expect(summary.searched).toBe(false);
		expect(summary.searchCount).toBe(0);
		expect(summary.citations).toEqual([]);
		expect(summary.answer).toBe("検索せずに答えました。");
	});

	it("counts the searchKnowledgeBase calls and ignores other tools", () => {
		const one = summarizeAgenticRun(
			{ toolsCalled: ["getCurrentTime", "searchKnowledgeBase"] },
			registryWith(["a"]),
			"[1]",
		);
		expect([one.searched, one.searchCount]).toEqual([true, 1]);
		const many = summarizeAgenticRun(
			{
				toolsCalled: [
					"searchKnowledgeBase",
					"calculator",
					"searchKnowledgeBase",
					"searchKnowledgeBase",
				],
			},
			registryWith(["a"]),
			"[1]",
		);
		expect([many.searched, many.searchCount]).toEqual([true, 3]);
		const other = summarizeAgenticRun({ toolsCalled: ["calculator"] }, registryWith([]), "x");
		expect([other.searched, other.searchCount]).toEqual([false, 0]);
	});

	it("resolves footnotes against the registered chunks and removes out-of-range ones", () => {
		const summary = summarizeAgenticRun(
			{ toolsCalled: ["searchKnowledgeBase"] },
			registryWith(["a", "b"]),
			"根拠は [2] です。存在しない [5] もあります。",
		);
		expect(summary.removedCitations).toEqual([5]);
		expect(summary.answer).not.toContain("[5]");
		expect(
			summary.citations.map((citation) => [citation.chunkId, citation.label, citation.cited]),
		).toEqual([
			["a", 1, false],
			["b", 2, true],
		]);
	});
});

describe("AGENTIC_RAG_INSTRUCTIONS", () => {
	it("tells the agent when to search, when not to, and what to do without evidence", () => {
		expect(AGENTIC_RAG_INSTRUCTIONS).toContain("searchKnowledgeBase");
		expect(AGENTIC_RAG_INSTRUCTIONS).toContain("検索せずに");
		expect(AGENTIC_RAG_INSTRUCTIONS).toContain("該当なし");
		expect(AGENTIC_RAG_INSTRUCTIONS).toContain("[");
	});
});

describe("createKnowledgeSearcher (with the tool, over a real knowledge base)", () => {
	let handle: RagDatabaseHandle;
	let store: KnowledgeStore;

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

	function embedding(table: Record<string, number[]>): ResolvedEmbeddingModel {
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

	async function seed(): Promise<void> {
		for (const [name, bodies] of [
			["a.md", ["Aの資料"]],
			["b.md", ["Bの資料"]],
		] as const) {
			await store.replaceDocument(
				{ id: `kb:${name}`, title: name, sourceType: "markdown", tags: [] },
				bodies.map((body, ordinal) => ({
					id: `${name}-${ordinal}`,
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
	}

	function searcher(table: Record<string, number[]> = { 検索語: axis(0) }) {
		return createKnowledgeSearcher({
			store,
			embedding: embedding(table),
			structuredModel: undefined as never,
			rerank: undefined,
			clock: createFakeClock(0),
		});
	}

	async function callTool(
		tool: AciTool<{ query: string; documentIds?: string[] | undefined }, SearchKnowledgeBaseResult>,
		input: { query: string; documentIds?: string[] | undefined },
	) {
		const execute = tool.toTool(RUNTIME).execute;
		if (!execute) throw new Error("not executable");
		return (await execute(input, {
			toolCallId: "call-1",
			messages: [],
			context: undefined,
		})) as ToolOutcome<SearchKnowledgeBaseResult>;
	}

	it("returns the knowledge base's chunks through the tool and registers them", async () => {
		await seed();
		const registry = createCitationRegistry();
		const tool = createSearchKnowledgeBaseTool({ search: searcher(), registry });
		const outcome = await callTool(tool, { query: "検索語" });
		expect(outcome.ok).toBe(true);
		if (!outcome.ok) return;
		expect(outcome.data.results.map((item) => item.excerpt).sort()).toEqual(["Aの資料", "Bの資料"]);
		expect(outcome.data.results.map((item) => item.label).sort()).toEqual([1, 2]);
		expect(registry.chunks()).toHaveLength(2);
	});

	it("narrows the search to the given documents", async () => {
		await seed();
		const registry = createCitationRegistry();
		const tool = createSearchKnowledgeBaseTool({ search: searcher(), registry });
		const outcome = await callTool(tool, { query: "検索語", documentIds: ["kb:b.md"] });
		if (!outcome.ok) throw new Error("tool failed");
		expect(outcome.data.results.map((item) => item.documentTitle)).toEqual(["b.md"]);
	});

	it("returns an empty result for a query that matches nothing", async () => {
		await seed();
		const registry = createCitationRegistry();
		const tool = createSearchKnowledgeBaseTool({ search: searcher({}), registry });
		const outcome = await callTool(tool, { query: "無関係" });
		if (!outcome.ok) throw new Error("tool failed");
		expect(outcome.data.results).toEqual([]);
		expect(registry.chunks()).toEqual([]);
	});

	it("gives the same label when a later search returns the same chunk", async () => {
		await seed();
		const registry = createCitationRegistry();
		const tool = createSearchKnowledgeBaseTool({ search: searcher(), registry });
		await callTool(tool, { query: "検索語", documentIds: ["kb:b.md"] });
		const second = await callTool(tool, { query: "検索語" });
		if (!second.ok) throw new Error("tool failed");
		const b = second.data.results.find((item) => item.documentTitle === "b.md");
		expect(b?.label).toBe(1);
		expect(registry.chunks()).toHaveLength(2);
	});

	it("passes the abort signal to the retrieval", async () => {
		await seed();
		const controller = new AbortController();
		controller.abort(new Error("stopped by caller"));
		await expect(searcher()("検索語", undefined, controller.signal)).rejects.toThrow(
			"stopped by caller",
		);
	});
});
