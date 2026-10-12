import { z } from "zod";
import { PlatformError } from "../../errors";
import { defineAciTool, ToolExecutionError } from "../define-tool";
import type { AciTool } from "../types";

export const SEARCH_KNOWLEDGE_BASE_TOOL_NAME = "searchKnowledgeBase";
export const SEARCH_QUERY_MAX_CHARACTERS = 500;
export const SEARCH_DOCUMENT_IDS_MAX = 20;
/** Characters of a chunk body returned to the model, the same cut as a citation's excerpt. */
export const SEARCH_EXCERPT_CHARACTERS = 200;

export const NO_RESULT_NOTICE =
	"該当する資料は見つかりませんでした。ナレッジベースに根拠が無いため、その旨を答えてください。";

/**
 * What the tool needs to know about a retrieved chunk. `aci/` must not import `rag/`, so this is
 * the structural subset of the knowledge base's `ScoredChunk` that a citation is built from.
 */
export interface KnowledgeSearchHit {
	readonly chunk: {
		readonly id: string;
		readonly documentId: string;
		readonly documentTitle: string;
		readonly headingPath: readonly string[];
		/** 1-based PDF page; `null` for Markdown. */
		readonly page: number | null;
		readonly body: string;
	};
}

/** Searches the knowledge base; the optional `documentIds` narrow the search to those documents. */
export type KnowledgeSearcher = (
	query: string,
	documentIds: readonly string[] | undefined,
	signal?: AbortSignal,
) => Promise<readonly KnowledgeSearchHit[]>;

/**
 * Per-request numbering of the chunks the agent has seen. The same chunk always gets the same
 * label, so the footnote `[label]` in the answer can be matched to a citation afterwards.
 */
export interface CitationRegistry {
	register(hit: KnowledgeSearchHit): number;
}

export type SearchResultLocator =
	| { readonly kind: "page"; readonly page: number }
	| { readonly kind: "heading"; readonly path: readonly string[] };

export interface SearchResultItem {
	/** The number to write as `[label]` after a sentence that relies on this chunk. */
	readonly label: number;
	readonly documentTitle: string;
	readonly locator: SearchResultLocator;
	readonly excerpt: string;
}

export interface SearchKnowledgeBaseResult {
	readonly results: readonly SearchResultItem[];
	/** Present only when nothing was found. */
	readonly notice?: string;
}

// The limit counts characters (code points), so an emoji or a kanji is one.
const searchInputSchema = z.object({
	query: z
		.string()
		.min(1)
		.refine((query) => [...query].length <= SEARCH_QUERY_MAX_CHARACTERS, {
			error: `検索クエリは ${SEARCH_QUERY_MAX_CHARACTERS} 文字までです。`,
		})
		.refine((query) => query.trim() !== "", { error: "検索クエリを入力してください。" })
		.describe(`検索クエリ（1〜${SEARCH_QUERY_MAX_CHARACTERS} 文字）。調べたい内容を短い文で書く`),
	documentIds: z
		.array(z.string().min(1))
		.max(SEARCH_DOCUMENT_IDS_MAX)
		.optional()
		.describe("検索対象の文書 ID。省略するとナレッジベース全体を検索する"),
});

function excerptOf(body: string): string {
	const characters = Array.from(body);
	return characters.length <= SEARCH_EXCERPT_CHARACTERS
		? body
		: characters.slice(0, SEARCH_EXCERPT_CHARACTERS).join("");
}

function locatorOf(chunk: KnowledgeSearchHit["chunk"]): SearchResultLocator {
	return chunk.page === null
		? { kind: "heading", path: [...chunk.headingPath] }
		: { kind: "page", page: chunk.page };
}

/**
 * Knowledge-base search for the agentic RAG route (plan C9). The search and the label numbering
 * are injected: `aci/` never imports `rag/` (the route wires `createKnowledgeSearcher` and
 * `createCitationRegistry` in). A search failure becomes a tool result, so the agent loop goes on.
 */
export function createSearchKnowledgeBaseTool(deps: {
	readonly search: KnowledgeSearcher;
	readonly registry: CitationRegistry;
}): AciTool<z.output<typeof searchInputSchema>, SearchKnowledgeBaseResult> {
	return defineAciTool<z.output<typeof searchInputSchema>, SearchKnowledgeBaseResult>({
		name: SEARCH_KNOWLEDGE_BASE_TOOL_NAME,
		description:
			"社内ナレッジベース（取り込み済みの資料）を検索して、関連する箇所の文書名・場所・抜粋と、引用用の番号 label を返します。" +
			"資料に基づいて答えるときに使い、答えの文末に使った資料の番号を [label] の形で付けてください。",
		inputSchema: searchInputSchema,
		risk: "read-only",
		execute: async ({ query, documentIds }, context) => {
			let hits: readonly KnowledgeSearchHit[];
			try {
				hits = await deps.search(
					query,
					documentIds === undefined || documentIds.length === 0 ? undefined : documentIds,
					context.abortSignal,
				);
			} catch (error) {
				// A PlatformError message is learner-facing by convention; anything else may carry
				// connection strings or SQL, so the model sees a fixed sentence instead.
				if (error instanceof PlatformError) throw error;
				throw new ToolExecutionError("ナレッジベースの検索に失敗しました。", {
					nextAction: "検索語を変えて再試行するか、検索せずに答えられる範囲で回答してください。",
				});
			}
			if (hits.length === 0) return { results: [], notice: NO_RESULT_NOTICE };
			return {
				results: hits.map((hit) => ({
					label: deps.registry.register(hit),
					documentTitle: hit.chunk.documentTitle,
					locator: locatorOf(hit.chunk),
					excerpt: excerptOf(hit.chunk.body),
				})),
			};
		},
	});
}
