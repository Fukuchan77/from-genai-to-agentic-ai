import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_RAG } from "../../config";
import { createDeterministicEmbeddingModel } from "../../mock/deterministic-embedding";
import { getModelEntry, MODEL_DEFAULTS, type ResolvedEmbeddingModel } from "../../models";
import { createFakeClock } from "../../ports/clock";
import { buildTextPdf } from "../../testing";
import { createPgliteDatabase, type RagDatabaseHandle, ragChunks, ragDocuments } from "../db";
import { createKnowledgeStore, type KnowledgeStore } from "../store";
import { chunkDocument } from "./chunk";
import { ingestDocuments, listIngestableFiles } from "./ingest";
import { isSkippedFile, loadKnowledgeFile } from "./loader";

const MOCK_ENTRY = getModelEntry("mock:embedding-v1");
const OTHER_ENTRY = getModelEntry(MODEL_DEFAULTS.local.ollama.embedding);

function resolvedMock(model = createDeterministicEmbeddingModel({ dimensions: 768 })) {
	return { model, entry: MOCK_ENTRY, mode: "mock" } satisfies ResolvedEmbeddingModel;
}

let handle: RagDatabaseHandle;
let store: KnowledgeStore;
let workDir: string;

const GUIDE = [
	"---",
	"tags: [rag, guide]",
	"---",
	"# RAG の手引き",
	"",
	"概要の本文です。",
	"",
	"## 検索",
	"",
	"ベクトル検索と全文検索を組み合わせます。",
].join("\n");

async function put(name: string, content: string | Uint8Array): Promise<void> {
	await writeFile(path.join(workDir, name), content);
}

async function chunkIds(): Promise<string[]> {
	const rows = await handle.db.select({ id: ragChunks.id }).from(ragChunks).orderBy(ragChunks.id);
	return rows.map((row) => row.id);
}

beforeAll(async () => {
	handle = await createPgliteDatabase();
});

afterAll(async () => {
	await handle.close();
});

beforeEach(async () => {
	await handle.db.execute(sql`TRUNCATE rag_chunks, rag_documents, rag_meta CASCADE`);
	store = createKnowledgeStore(handle.db);
	workDir = await mkdtemp(path.join(tmpdir(), "rag-ingest-"));
});

afterEach(async () => {
	await rm(workDir, { recursive: true, force: true });
});

describe("ingestDocuments", () => {
	it("stores a Markdown document with its source metadata, tags and embeddings", async () => {
		await put("guide.md", GUIDE);

		const result = await ingestDocuments({
			db: handle.db,
			embedding: resolvedMock(),
			source: "knowledge",
			root: workDir,
			files: ["guide.md"],
			tags: ["extra", "rag"],
		});

		expect(result.embeddingModelId).toBe("mock:embedding-v1");
		expect(result.skipped).toEqual([]);
		expect(result.ingested).toEqual([
			{ documentId: "kb:guide.md", title: "RAG の手引き", chunks: 2 },
		]);
		const [document] = await store.listDocuments();
		expect(document).toMatchObject({ id: "kb:guide.md", sourceType: "markdown", chunkCount: 2 });
		expect(document?.tags.sort()).toEqual(["extra", "guide", "rag"]);
		const rows = await handle.db.select().from(ragChunks).orderBy(ragChunks.ordinal);
		expect(rows.map((row) => row.headingPath)).toEqual([
			["RAG の手引き"],
			["RAG の手引き", "検索"],
		]);
		expect(rows.map((row) => row.body)).toEqual([
			"概要の本文です。",
			"ベクトル検索と全文検索を組み合わせます。",
		]);
		expect(rows.every((row) => row.embedding.length === 768)).toBe(true);
		expect(rows.every((row) => row.page === null)).toBe(true);
		expect(rows[1]?.searchText).toContain("全文");
		expect(await store.getMeta()).toEqual({
			embeddingModelId: "mock:embedding-v1",
			dimensions: 768,
		});
	});

	it("stores a PDF with one page number per chunk", async () => {
		await put("paper.pdf", buildTextPdf(["first page text", "second page text"]));

		const result = await ingestDocuments({
			db: handle.db,
			embedding: resolvedMock(),
			source: "knowledge",
			root: workDir,
			files: ["paper.pdf"],
		});

		expect(result.ingested).toEqual([{ documentId: "kb:paper.pdf", title: "paper", chunks: 2 }]);
		const rows = await handle.db.select().from(ragChunks).orderBy(ragChunks.ordinal);
		expect(rows.map((row) => row.page)).toEqual([1, 2]);
		expect(rows.every((row) => row.headingPath.length === 0)).toBe(true);
	});

	it("replaces a re-ingested document instead of duplicating it", async () => {
		await put("guide.md", GUIDE);
		const params = {
			db: handle.db,
			embedding: resolvedMock(),
			source: "knowledge",
			root: workDir,
			files: ["guide.md"],
		} as const;
		await ingestDocuments(params);
		const first = await chunkIds();

		await ingestDocuments(params);
		expect(await chunkIds()).toEqual(first);

		await put("guide.md", GUIDE.replace("概要の本文です。", "書き換えた本文です。"));
		await ingestDocuments(params);
		const third = await chunkIds();
		expect(third).toHaveLength(2);
		expect(third).not.toEqual(first);
		expect(await handle.db.$count(ragDocuments)).toBe(1);
	});

	it("keeps the existing chunks when the embedding call fails", async () => {
		await put("guide.md", GUIDE);
		const params = {
			db: handle.db,
			source: "knowledge",
			root: workDir,
			files: ["guide.md"],
		} as const;
		await ingestDocuments({ ...params, embedding: resolvedMock() });
		const before = await chunkIds();
		await put("guide.md", GUIDE.replace("概要の本文です。", "書き換えた本文です。"));
		const failing = resolvedMock({
			...createDeterministicEmbeddingModel({ dimensions: 768 }),
			doEmbed: async () => {
				throw new Error("embedding backend down");
			},
		});

		await expect(ingestDocuments({ ...params, embedding: failing })).rejects.toThrow(
			"embedding backend down",
		);

		expect(await chunkIds()).toEqual(before);
	});

	it("reports every skip reason and still ingests the remaining files", async () => {
		await put("good.md", GUIDE);
		await put("notes.txt", "plain text");
		await put("scan.pdf", buildTextPdf([""]));
		await put("broken.pdf", new Uint8Array([1, 2, 3, 4]));
		await put("huge.md", new Uint8Array(DEFAULT_RAG.maxIngestFileBytes + 1).fill(97));

		const result = await ingestDocuments({
			db: handle.db,
			embedding: resolvedMock(),
			source: "knowledge",
			root: workDir,
			files: ["good.md", "notes.txt", "scan.pdf", "broken.pdf", "huge.md", "absent.md"],
		});

		expect(result.ingested.map((entry) => entry.documentId)).toEqual(["kb:good.md"]);
		expect(result.skipped).toEqual([
			{ file: "notes.txt", reason: "unsupported-format" },
			{ file: "scan.pdf", reason: "no-text" },
			{ file: "broken.pdf", reason: "parse-failed" },
			{ file: "huge.md", reason: "too-large" },
			{ file: "absent.md", reason: "not-found" },
		]);
		expect(await handle.db.$count(ragDocuments)).toBe(1);
	});

	it("does not touch the knowledge base when every file is skipped", async () => {
		await put("notes.txt", "plain text");

		const result = await ingestDocuments({
			db: handle.db,
			embedding: resolvedMock(),
			source: "knowledge",
			root: workDir,
			files: ["notes.txt"],
		});

		expect(result.ingested).toEqual([]);
		expect(await store.getMeta()).toBeUndefined();
	});

	it("keeps knowledge and eval-corpus documents of the same name apart", async () => {
		await put("same.md", GUIDE);
		const common = { db: handle.db, embedding: resolvedMock(), root: workDir, files: ["same.md"] };

		await ingestDocuments({ ...common, source: "knowledge" });
		await ingestDocuments({ ...common, source: "eval-corpus" });

		const ids = (await store.listDocuments()).map((document) => document.id);
		expect(ids).toEqual(["eval:same.md", "kb:same.md"]);
		expect(await handle.db.$count(ragChunks)).toBe(4);
	});

	it("ingests the same file name twice in one request only once", async () => {
		await put("guide.md", GUIDE);

		const result = await ingestDocuments({
			db: handle.db,
			embedding: resolvedMock(),
			source: "knowledge",
			root: workDir,
			files: ["guide.md", "guide.md"],
		});

		expect(result.ingested).toHaveLength(1);
	});

	it("rejects another embedding model, then rebuilds the base with reset", async () => {
		await put("guide.md", GUIDE);
		const params = {
			db: handle.db,
			source: "knowledge",
			root: workDir,
			files: ["guide.md"],
		} as const;
		await ingestDocuments({ ...params, embedding: resolvedMock() });
		const before = await chunkIds();
		const other = {
			model: createDeterministicEmbeddingModel({ dimensions: 768 }),
			entry: OTHER_ENTRY,
			mode: "local",
		} satisfies ResolvedEmbeddingModel;

		await expect(ingestDocuments({ ...params, embedding: other })).rejects.toMatchObject({
			code: "invalid-request",
			details: { reason: "embedding-model-changed" },
		});
		expect(await chunkIds()).toEqual(before);

		await put("second.md", "# 二つ目\n\n別の文書です。");
		const rebuilt = await ingestDocuments({
			...params,
			files: ["second.md"],
			embedding: other,
			reset: true,
		});

		expect(rebuilt.embeddingModelId).toBe(MODEL_DEFAULTS.local.ollama.embedding);
		expect((await store.listDocuments()).map((document) => document.id)).toEqual(["kb:second.md"]);
		expect((await store.getMeta())?.embeddingModelId).toBe(MODEL_DEFAULTS.local.ollama.embedding);
	});

	it("rejects another embedding model before calling the embedding API", async () => {
		await put("guide.md", GUIDE);
		const params = {
			db: handle.db,
			source: "knowledge",
			root: workDir,
			files: ["guide.md"],
		} as const;
		await ingestDocuments({ ...params, embedding: resolvedMock() });
		let calls = 0;
		const base = createDeterministicEmbeddingModel({ dimensions: 768 });
		const counting = {
			model: {
				...base,
				doEmbed: async (options: Parameters<typeof base.doEmbed>[0]) => {
					calls += 1;
					return base.doEmbed(options);
				},
			},
			entry: OTHER_ENTRY,
			mode: "local",
		} satisfies ResolvedEmbeddingModel;

		await expect(ingestDocuments({ ...params, embedding: counting })).rejects.toMatchObject({
			details: { reason: "embedding-model-changed" },
		});

		expect(calls).toBe(0);
	});

	it("passes the abort signal to the embedding model", async () => {
		await put("guide.md", GUIDE);
		const controller = new AbortController();
		const seen: (AbortSignal | undefined)[] = [];
		const base = createDeterministicEmbeddingModel({ dimensions: 768 });
		const spying = resolvedMock({
			...base,
			doEmbed: async (options) => {
				seen.push(options.abortSignal);
				return base.doEmbed(options);
			},
		});

		await ingestDocuments({
			db: handle.db,
			embedding: spying,
			source: "knowledge",
			root: workDir,
			files: ["guide.md"],
			signal: controller.signal,
		});

		expect(seen.length).toBeGreaterThan(0);
		expect(seen.every((signal) => signal !== undefined && !signal.aborted)).toBe(true);
	});

	it("writes all documents or none: a failure on the second document rolls back the first", async () => {
		await put("old.md", "# 旧\n\n既存の本文");
		await ingestDocuments({
			db: handle.db,
			embedding: resolvedMock(),
			source: "knowledge",
			root: workDir,
			files: ["old.md"],
		});
		await put("a.md", GUIDE);
		await put("b.md", "# B\n\n本文");
		let reads = 0;
		const clock = createFakeClock(0);
		const flaky = {
			...clock,
			now: () => {
				reads += 1;
				if (reads === 2) throw new Error("disk full");
				return clock.now();
			},
		};

		await expect(
			ingestDocuments({
				db: handle.db,
				embedding: resolvedMock(),
				source: "knowledge",
				root: workDir,
				files: ["a.md", "b.md"],
				reset: true,
				clock: flaky,
			}),
		).rejects.toThrow("disk full");

		expect((await store.listDocuments()).map((document) => document.id)).toEqual(["kb:old.md"]);
	});

	it("keeps the old knowledge base when a reset ingest fails", async () => {
		await put("guide.md", GUIDE);
		const params = {
			db: handle.db,
			source: "knowledge",
			root: workDir,
			files: ["guide.md"],
		} as const;
		await ingestDocuments({ ...params, embedding: resolvedMock() });
		const before = await chunkIds();
		const failing = resolvedMock({
			...createDeterministicEmbeddingModel({ dimensions: 768 }),
			doEmbed: async () => {
				throw new Error("embedding backend down");
			},
		});

		await expect(ingestDocuments({ ...params, embedding: failing, reset: true })).rejects.toThrow(
			"embedding backend down",
		);

		expect(await chunkIds()).toEqual(before);
	});

	it("rejects an embedding model that returns the wrong dimension and writes nothing", async () => {
		await put("guide.md", GUIDE);

		await expect(
			ingestDocuments({
				db: handle.db,
				embedding: resolvedMock(createDeterministicEmbeddingModel({ dimensions: 16 })),
				source: "knowledge",
				root: workDir,
				files: ["guide.md"],
			}),
		).rejects.toMatchObject({ code: "output-invalid" });

		expect(await handle.db.$count(ragDocuments)).toBe(0);
	});

	it("refuses unsafe file names before reading anything, and writes nothing", async () => {
		await put("guide.md", GUIDE);
		const outside = await mkdtemp(path.join(tmpdir(), "rag-outside-"));
		try {
			await writeFile(path.join(outside, "secret.md"), "# 秘密\n\n本文");
			await symlink(path.join(outside, "secret.md"), path.join(workDir, "link.md"));
			for (const name of ["../guide.md", "sub/guide.md", ".hidden.md", "link.md"]) {
				await expect(
					ingestDocuments({
						db: handle.db,
						embedding: resolvedMock(),
						source: "knowledge",
						root: workDir,
						files: ["guide.md", name],
					}),
				).rejects.toMatchObject({ code: "invalid-request" });
			}
		} finally {
			await rm(outside, { recursive: true, force: true });
		}

		expect(await handle.db.$count(ragDocuments)).toBe(0);
	});

	it("rejects more files than the ingest limit", async () => {
		const files = Array.from(
			{ length: DEFAULT_RAG.maxIngestFiles + 1 },
			(_, index) => `f${index}.md`,
		);

		await expect(
			ingestDocuments({
				db: handle.db,
				embedding: resolvedMock(),
				source: "knowledge",
				root: workDir,
				files,
			}),
		).rejects.toMatchObject({ code: "invalid-request", details: { reason: "too-many-files" } });
	});

	it("stops before embedding when the signal is already aborted", async () => {
		await put("guide.md", GUIDE);
		const controller = new AbortController();
		controller.abort(new DOMException("stop", "AbortError"));

		await expect(
			ingestDocuments({
				db: handle.db,
				embedding: resolvedMock(),
				source: "knowledge",
				root: workDir,
				files: ["guide.md"],
				signal: controller.signal,
			}),
		).rejects.toMatchObject({ name: "AbortError" });

		expect(await handle.db.$count(ragDocuments)).toBe(0);
	});

	it("does not start the transaction when the signal aborts during embedding", async () => {
		await put("guide.md", GUIDE);
		const controller = new AbortController();
		const base = createDeterministicEmbeddingModel({ dimensions: 768 });
		const aborting = resolvedMock({
			...base,
			doEmbed: async (options) => {
				const result = await base.doEmbed(options);
				controller.abort(new DOMException("stop", "AbortError"));
				return result;
			},
		});

		await expect(
			ingestDocuments({
				db: handle.db,
				embedding: aborting,
				source: "knowledge",
				root: workDir,
				files: ["guide.md"],
				signal: controller.signal,
			}),
		).rejects.toMatchObject({ name: "AbortError" });

		expect(await handle.db.$count(ragDocuments)).toBe(0);
		expect(await store.getMeta()).toBeUndefined();
	});

	it("completes the write once the transaction has started, even if the signal aborts", async () => {
		await put("a.md", GUIDE);
		await put("b.md", "# B\n\n本文");
		const controller = new AbortController();
		const clock = createFakeClock(0);
		// The store reads the clock inside the transaction; abort at that point.
		const abortingClock = {
			...clock,
			now: () => {
				controller.abort(new DOMException("stop", "AbortError"));
				return clock.now();
			},
		};

		const result = await ingestDocuments({
			db: handle.db,
			embedding: resolvedMock(),
			source: "knowledge",
			root: workDir,
			files: ["a.md", "b.md"],
			signal: controller.signal,
			clock: abortingClock,
		});

		expect(result.ingested).toHaveLength(2);
		expect(await handle.db.$count(ragDocuments)).toBe(2);
	});
});

describe("ingestDocuments: review findings F-1, F-2", () => {
	const base = () => ({
		db: handle.db,
		embedding: resolvedMock(),
		source: "knowledge" as const,
		root: workDir,
	});

	it("stores one document when the same file is named with another case (F-1)", async () => {
		await put("guide.md", GUIDE);
		if ((await listIngestableFiles(workDir)).length === 0) throw new Error("fixture not written");
		const probe = await ingestDocuments({ ...base(), files: ["GUIDE.md"] });
		if (probe.skipped.length > 0) return; // case-sensitive file system
		await handle.db.execute(sql`TRUNCATE rag_chunks, rag_documents, rag_meta CASCADE`);

		await ingestDocuments({ ...base(), files: ["guide.md"] });
		await ingestDocuments({ ...base(), files: ["GUIDE.md"] });

		expect((await store.listDocuments()).map((document) => document.id)).toEqual(["kb:guide.md"]);
	});

	it("ingests a file only once when two spellings of it are in one request (F-1)", async () => {
		await put("guide.md", GUIDE);
		const probe = await ingestDocuments({ ...base(), files: ["GUIDE.md"] });
		if (probe.skipped.length > 0) return;
		await handle.db.execute(sql`TRUNCATE rag_chunks, rag_documents, rag_meta CASCADE`);

		const result = await ingestDocuments({ ...base(), files: ["guide.md", "GUIDE.md"] });

		expect(result.ingested).toHaveLength(1);
		expect(await handle.db.$count(ragDocuments)).toBe(1);
	});

	it("empties the knowledge base on reset even when no file could be ingested (F-2)", async () => {
		await put("guide.md", GUIDE);
		await ingestDocuments({ ...base(), files: ["guide.md"] });
		await put("notes.txt", "plain text");

		const result = await ingestDocuments({ ...base(), files: ["notes.txt"], reset: true });

		expect(result.ingested).toEqual([]);
		expect(result.skipped).toEqual([{ file: "notes.txt", reason: "unsupported-format" }]);
		expect(await handle.db.$count(ragDocuments)).toBe(0);
		expect(await store.getMeta()).toBeUndefined();
	});

	it("reports the model of the existing base when nothing was ingested (F-2)", async () => {
		await put("guide.md", GUIDE);
		await ingestDocuments({ ...base(), files: ["guide.md"] });
		await put("notes.txt", "plain text");

		const result = await ingestDocuments({
			...base(),
			embedding: { ...resolvedMock(), entry: OTHER_ENTRY },
			files: ["notes.txt"],
		});

		expect(result.embeddingModelId).toBe("mock:embedding-v1");
		expect(await handle.db.$count(ragDocuments)).toBe(1);
	});

	it("reports the requested model when the base is empty and nothing was ingested", async () => {
		await put("notes.txt", "plain text");

		const result = await ingestDocuments({ ...base(), files: ["notes.txt"] });

		expect(result.embeddingModelId).toBe("mock:embedding-v1");
	});
});

describe("listIngestableFiles", () => {
	it("lists supported regular files in name order, without hidden files, README and directories", async () => {
		await put("b.md", "# b");
		await put("a.PDF", buildTextPdf(["x"]));
		await put("c.markdown", "# c");
		await put("notes.txt", "x");
		await put(".hidden.md", "# h");
		await put("README.md", "# readme");
		await mkdir(path.join(workDir, "dir.md"));

		expect(await listIngestableFiles(workDir)).toEqual(["a.PDF", "b.md", "c.markdown"]);
	});

	it("returns an empty list for a missing directory", async () => {
		expect(await listIngestableFiles(path.join(workDir, "missing"))).toEqual([]);
	});
});

describe("the evaluation corpus fixtures", () => {
	const CORPUS_ROOT = path.resolve(import.meta.dirname, "../../../fixtures/rag/corpus");
	const CORPUS_FILES = [
		"01-rag-overview.md",
		"02-chunking.md",
		"03-embeddings-and-search.md",
		"04-hybrid-and-rrf.md",
		"05-rerank-and-evaluation.md",
		"06-agentic-rag.md",
	];

	it("ingests all six documents under the eval: prefix without skipping any", async () => {
		const result = await ingestDocuments({
			db: handle.db,
			embedding: resolvedMock(),
			source: "eval-corpus",
			root: CORPUS_ROOT,
			files: CORPUS_FILES,
		});

		expect(result.skipped).toEqual([]);
		expect(result.ingested.map((entry) => entry.documentId)).toEqual(
			CORPUS_FILES.map((file) => `eval:${file}`),
		);
		expect(result.ingested.every((entry) => entry.chunks >= 3)).toBe(true);
		expect(result.ingested.every((entry) => entry.title.length > 0)).toBe(true);
	});

	it("lists exactly these six files as ingestable", async () => {
		expect(await listIngestableFiles(CORPUS_ROOT)).toEqual(CORPUS_FILES);
	});

	it("keeps every chunk within the size limit and inside one heading section, with unique ids", async () => {
		const ids = new Set<string>();
		let splitSections = 0;
		for (const file of CORPUS_FILES) {
			const loaded = await loadKnowledgeFile(CORPUS_ROOT, file);
			if (isSkippedFile(loaded) || loaded.sourceType !== "markdown") {
				throw new Error(`${file} was not loaded as Markdown`);
			}
			const chunks = chunkDocument(loaded, { documentId: `eval:${file}` });
			for (const chunk of chunks) {
				expect([...chunk.body].length).toBeLessThanOrEqual(DEFAULT_RAG.chunkMaxCharacters);
				const owners = loaded.sections.filter(
					(section) =>
						section.headingPath.join("\u0000") === chunk.headingPath.join("\u0000") &&
						section.body.includes(chunk.body),
				);
				expect(owners, `${file}: ${chunk.id}`).toHaveLength(1);
				expect(ids.has(chunk.id), `duplicate ${chunk.id}`).toBe(false);
				ids.add(chunk.id);
			}
			const perPath = new Map<string, number>();
			for (const chunk of chunks) {
				const key = chunk.headingPath.join("\u0000");
				perPath.set(key, (perPath.get(key) ?? 0) + 1);
			}
			splitSections += [...perPath.values()].filter((count) => count > 1).length;
		}
		// At least one section is long enough to be split, so the splitting path is exercised.
		expect(splitSections).toBeGreaterThanOrEqual(1);
	});
});
