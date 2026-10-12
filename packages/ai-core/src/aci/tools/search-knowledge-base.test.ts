import { asSchema } from "ai";
import { describe, expect, it } from "vitest";
import { PlatformError } from "../../errors";
import { createFakeClock } from "../../ports/clock";
import { buildToolSet } from "../tool-set";
import type { AciTool, ToolOutcome, ToolRuntime } from "../types";
import {
	type CitationRegistry,
	createSearchKnowledgeBaseTool,
	type KnowledgeSearcher,
	type KnowledgeSearchHit,
	SEARCH_KNOWLEDGE_BASE_TOOL_NAME,
	type SearchKnowledgeBaseResult,
} from "./search-knowledge-base";

const RUNTIME: ToolRuntime = { clock: createFakeClock(), toolTimeoutMs: 1_000 };

function hit(id: string, overrides: Partial<KnowledgeSearchHit["chunk"]> = {}): KnowledgeSearchHit {
	return {
		chunk: {
			id,
			documentId: "doc-a",
			documentTitle: "RAG overview",
			headingPath: ["RAG", "Hybrid search"],
			page: null,
			body: `Body of ${id}.`,
			...overrides,
		},
	};
}

/** Numbers chunks from `first` in order of first registration; the same chunk keeps its label. */
function createFakeRegistry(first = 1): CitationRegistry & { readonly registered: string[] } {
	const labels = new Map<string, number>();
	const registered: string[] = [];
	return {
		registered,
		register(item) {
			registered.push(item.chunk.id);
			const existing = labels.get(item.chunk.id);
			if (existing !== undefined) return existing;
			const label = first + labels.size;
			labels.set(item.chunk.id, label);
			return label;
		},
	};
}

function searcherOf(hits: readonly KnowledgeSearchHit[]): KnowledgeSearcher {
	return async () => hits;
}

async function call(
	aciTool: AciTool<
		{ query: string; documentIds?: string[] | undefined },
		SearchKnowledgeBaseResult
	>,
	input: { query: string; documentIds?: string[] | undefined },
): Promise<ToolOutcome<SearchKnowledgeBaseResult>> {
	const execute = aciTool.toTool(RUNTIME).execute;
	if (!execute) throw new Error("searchKnowledgeBase must be executable");
	return (await execute(input, {
		toolCallId: "call-1",
		messages: [],
		context: undefined,
	})) as ToolOutcome<SearchKnowledgeBaseResult>;
}

async function validate(input: unknown) {
	const registry = createFakeRegistry();
	const tool = createSearchKnowledgeBaseTool({ search: searcherOf([]), registry }).toTool(RUNTIME);
	return await asSchema(tool.inputSchema).validate?.(input);
}

describe("createSearchKnowledgeBaseTool: definition", () => {
	it("is the read-only searchKnowledgeBase tool", () => {
		const aciTool = createSearchKnowledgeBaseTool({
			search: searcherOf([]),
			registry: createFakeRegistry(),
		});

		expect(SEARCH_KNOWLEDGE_BASE_TOOL_NAME).toBe("searchKnowledgeBase");
		expect(aciTool.name).toBe("searchKnowledgeBase");
		expect(aciTool.risk).toBe("read-only");
		expect(aciTool.requiredFeature).toBeUndefined();
	});

	it("is registered by buildToolSet under its name", () => {
		const aciTool = createSearchKnowledgeBaseTool({
			search: searcherOf([]),
			registry: createFakeRegistry(),
		});

		const built = buildToolSet([aciTool], {}, RUNTIME);

		expect(Object.keys(built.tools)).toEqual(["searchKnowledgeBase"]);
		expect(built.disabled).toEqual([]);
	});
});

describe("createSearchKnowledgeBaseTool: input validation", () => {
	it("accepts a query alone and a query with document IDs", async () => {
		expect(await validate({ query: "hybrid search" })).toMatchObject({ success: true });
		expect(await validate({ query: "q", documentIds: ["doc-a", "doc-b"] })).toMatchObject({
			success: true,
		});
	});

	it("accepts a query of 1 and 500 characters and rejects empty and 501", async () => {
		expect(await validate({ query: "a" })).toMatchObject({ success: true });
		expect(await validate({ query: "a".repeat(500) })).toMatchObject({ success: true });
		expect(await validate({ query: "" })).toMatchObject({ success: false });
		expect(await validate({ query: "a".repeat(501) })).toMatchObject({ success: false });
	});

	it("counts characters, not UTF-16 units, and rejects a blank query", async () => {
		expect(await validate({ query: "😀".repeat(500) })).toMatchObject({ success: true });
		expect(await validate({ query: "😀".repeat(501) })).toMatchObject({ success: false });
		expect(await validate({ query: " \n\t " })).toMatchObject({ success: false });
	});

	it("rejects a missing or non-string query", async () => {
		expect(await validate({})).toMatchObject({ success: false });
		expect(await validate({ query: 1 })).toMatchObject({ success: false });
	});

	it("limits document IDs to 20 non-empty strings", async () => {
		const ids = (count: number) => Array.from({ length: count }, (_, i) => `doc-${i}`);

		expect(await validate({ query: "q", documentIds: ids(20) })).toMatchObject({ success: true });
		expect(await validate({ query: "q", documentIds: ids(21) })).toMatchObject({ success: false });
		expect(await validate({ query: "q", documentIds: [""] })).toMatchObject({ success: false });
		expect(await validate({ query: "q", documentIds: "doc-a" })).toMatchObject({ success: false });
	});
});

describe("createSearchKnowledgeBaseTool: results", () => {
	it("returns label, document title, locator and excerpt for each hit", async () => {
		const search = searcherOf([
			hit("doc-a#1", { documentTitle: "Guide", headingPath: ["Guide", "RRF"], body: "RRF fuses." }),
			hit("paper#4", { documentId: "paper", documentTitle: "Paper", page: 12, headingPath: [] }),
		]);
		const aciTool = createSearchKnowledgeBaseTool({ search, registry: createFakeRegistry() });

		await expect(call(aciTool, { query: "fusion" })).resolves.toEqual({
			ok: true,
			data: {
				results: [
					{
						label: 1,
						documentTitle: "Guide",
						locator: { kind: "heading", path: ["Guide", "RRF"] },
						excerpt: "RRF fuses.",
					},
					{
						label: 2,
						documentTitle: "Paper",
						locator: { kind: "page", page: 12 },
						excerpt: "Body of paper#4.",
					},
				],
			},
		});
	});

	it("takes the labels from the injected registry, not from the position in the result", async () => {
		const registry = createFakeRegistry(40);
		const aciTool = createSearchKnowledgeBaseTool({
			search: searcherOf([hit("c#1"), hit("c#2")]),
			registry,
		});

		const outcome = await call(aciTool, { query: "q" });

		expect(outcome.ok && outcome.data.results.map((item) => item.label)).toEqual([40, 41]);
		expect(registry.registered).toEqual(["c#1", "c#2"]);
	});

	it("gives a chunk found by a second search the label it already has", async () => {
		const registry = createFakeRegistry();
		const batches = [
			[hit("c#1"), hit("c#2")],
			[hit("c#2"), hit("c#3")],
		];
		const search: KnowledgeSearcher = async () => batches.shift() ?? [];
		const aciTool = createSearchKnowledgeBaseTool({ search, registry });

		const first = await call(aciTool, { query: "first" });
		const second = await call(aciTool, { query: "second" });

		expect(first.ok && first.data.results.map((item) => item.label)).toEqual([1, 2]);
		expect(second.ok && second.data.results.map((item) => item.label)).toEqual([2, 3]);
	});

	it("cuts the excerpt to the first 200 characters", async () => {
		const body = `${"😀".repeat(199)}あtail`;
		const aciTool = createSearchKnowledgeBaseTool({
			search: searcherOf([hit("c#1", { body })]),
			registry: createFakeRegistry(),
		});

		const outcome = await call(aciTool, { query: "q" });

		expect(outcome.ok && outcome.data.results[0]?.excerpt).toBe(`${"😀".repeat(199)}あ`);
	});

	it("does not add a notice when there are hits", async () => {
		const aciTool = createSearchKnowledgeBaseTool({
			search: searcherOf([hit("c#1")]),
			registry: createFakeRegistry(),
		});

		const outcome = await call(aciTool, { query: "q" });

		expect(outcome.ok && outcome.data).not.toHaveProperty("notice");
	});

	it("tells the model nothing was found when there are no hits, and registers nothing", async () => {
		const registry = createFakeRegistry();
		const aciTool = createSearchKnowledgeBaseTool({ search: searcherOf([]), registry });

		const outcome = await call(aciTool, { query: "unrelated" });

		expect(outcome).toEqual({
			ok: true,
			data: { results: [], notice: expect.stringContaining("該当") },
		});
		expect(registry.registered).toEqual([]);
	});
});

describe("createSearchKnowledgeBaseTool: search call", () => {
	it("passes the query, the document IDs and the tool's abort signal to the searcher", async () => {
		const calls: {
			query: string;
			documentIds: readonly string[] | undefined;
			signal?: AbortSignal;
		}[] = [];
		const search: KnowledgeSearcher = async (query, documentIds, signal) => {
			calls.push({ query, documentIds, ...(signal === undefined ? {} : { signal }) });
			return [];
		};
		const aciTool = createSearchKnowledgeBaseTool({ search, registry: createFakeRegistry() });

		await call(aciTool, { query: "hyde", documentIds: ["doc-a"] });

		expect(calls).toHaveLength(1);
		expect(calls[0]?.query).toBe("hyde");
		expect(calls[0]?.documentIds).toEqual(["doc-a"]);
		expect(calls[0]?.signal).toBeInstanceOf(AbortSignal);
		expect(calls[0]?.signal?.aborted).toBe(false);
	});

	it("searches the whole knowledge base when no document IDs, or an empty list, are given", async () => {
		const seen: (readonly string[] | undefined)[] = [];
		const search: KnowledgeSearcher = async (_query, documentIds) => {
			seen.push(documentIds);
			return [];
		};
		const aciTool = createSearchKnowledgeBaseTool({ search, registry: createFakeRegistry() });

		await call(aciTool, { query: "a" });
		await call(aciTool, { query: "b", documentIds: [] });

		expect(seen).toEqual([undefined, undefined]);
	});
});

describe("createSearchKnowledgeBaseTool: search failures", () => {
	it("turns a search exception into a tool result, without leaking its message", async () => {
		const search: KnowledgeSearcher = async () => {
			throw new Error("connect ECONNREFUSED postgres://user:hunter2@db:5432/kb");
		};
		const aciTool = createSearchKnowledgeBaseTool({ search, registry: createFakeRegistry() });

		const outcome = await call(aciTool, { query: "q" });

		expect(outcome).toEqual({
			ok: false,
			failure: {
				kind: "recoverable",
				summary: "ナレッジベースの検索に失敗しました。",
				nextAction: expect.stringContaining("検索"),
			},
		});
		expect(JSON.stringify(outcome)).not.toContain("hunter2");
	});

	it("keeps the learner-facing message of a PlatformError", async () => {
		const search: KnowledgeSearcher = async () => {
			throw new PlatformError("source-unavailable", "ナレッジベースに接続できません。");
		};
		const aciTool = createSearchKnowledgeBaseTool({ search, registry: createFakeRegistry() });

		const outcome = await call(aciTool, { query: "q" });

		expect(outcome).toMatchObject({
			ok: false,
			failure: { kind: "recoverable", summary: "ナレッジベースに接続できません。" },
		});
	});

	it("keeps working after a failure, so the agent loop can continue", async () => {
		let attempts = 0;
		const search: KnowledgeSearcher = async () => {
			attempts += 1;
			if (attempts === 1) throw new Error("transient");
			return [hit("c#1")];
		};
		const aciTool = createSearchKnowledgeBaseTool({ search, registry: createFakeRegistry() });

		const failed = await call(aciTool, { query: "q" });
		const retried = await call(aciTool, { query: "q" });

		expect(failed.ok).toBe(false);
		expect(retried).toMatchObject({ ok: true, data: { results: [{ label: 1 }] } });
	});

	it("registers nothing when the search fails", async () => {
		const registry = createFakeRegistry();
		const search: KnowledgeSearcher = async () => {
			throw new Error("down");
		};
		const aciTool = createSearchKnowledgeBaseTool({ search, registry });

		await call(aciTool, { query: "q" });

		expect(registry.registered).toEqual([]);
	});
});
