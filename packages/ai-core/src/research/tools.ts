import { z } from "zod";
import { defineAciTool, ToolExecutionError } from "../aci/define-tool";
import type { AciTool } from "../aci/types";
import type { ExternalContentLog } from "../agents/observer";
import type { ArxivClient } from "./arxiv/client";
import { ARXIV_ID_PATTERN, type ArxivPaper } from "./arxiv/types";

export const SEARCH_ARXIV_TOOL_NAME = "searchArxiv";
export const GET_PAPER_ABSTRACT_TOOL_NAME = "getPaperAbstract";

/** A search result keeps an abstract to this many characters; `getPaperAbstract` returns it whole. */
export const SEARCH_ABSTRACT_CHARACTERS = 1_200;
/** Papers can have hundreds of authors; the model needs the first few, not all of them. */
export const MAX_LISTED_AUTHORS = 8;
export const SEARCH_QUERY_MAX_CHARACTERS = 300;
export const SEARCH_MAX_RESULTS = 10;

// The version suffix is optional on input; the client strips it.
export const ARXIV_ID_WITH_VERSION = new RegExp(
	`${ARXIV_ID_PATTERN.source.slice(0, -1)}(?:v\\d+)?$`,
	"u",
);

const searchInputSchema = z.strictObject({
	query: z
		.string()
		.min(1)
		.max(SEARCH_QUERY_MAX_CHARACTERS)
		.describe("arXiv の論文を探す検索語（英語が最も当たる）。例: hierarchical agents tool use"),
	maxResults: z
		.number()
		.int()
		.min(1)
		.max(SEARCH_MAX_RESULTS)
		.optional()
		.describe(`返す論文の最大件数（1〜${SEARCH_MAX_RESULTS}）。省略すると既定の件数`),
});

const abstractInputSchema = z.strictObject({
	arxivId: z
		.string()
		.regex(ARXIV_ID_WITH_VERSION)
		.describe(
			"要旨を読みたい論文の arXiv ID。例: 2401.01234 または cs/0501001（版 v2 付きでもよい）",
		),
});

export type SearchArxivInput = z.output<typeof searchInputSchema>;
export type GetPaperAbstractInput = z.output<typeof abstractInputSchema>;

export interface PaperSummary {
	readonly arxivId: string;
	readonly title: string;
	/** The first {@link MAX_LISTED_AUTHORS} authors. */
	readonly authors: readonly string[];
	/** The number of authors left out; present only when there are more than were listed. */
	readonly authorsOmitted?: number;
	/** `YYYY-MM-DD`. */
	readonly publishedAt: string;
	readonly abstract: string;
	readonly url: string;
}

export interface PaperSearchResult {
	readonly query: string;
	readonly papers: readonly PaperSummary[];
	/** Present only when nothing was found. */
	readonly notice?: string;
}

export type PaperAbstract = PaperSummary;

export const NO_PAPER_NOTICE =
	"該当する論文は見つかりませんでした。検索語を変える（英語にする、短くする）か、見つからなかったと報告してください。";

export interface ResearchToolDependencies {
	readonly client: ArxivClient;
	/**
	 * Receives the papers a tool returned, whole. The run keeps them as the set that the report's
	 * citations are checked against (Req 4.5).
	 */
	readonly onPapers?: ((papers: readonly ArxivPaper[]) => void) | undefined;
	/** Where the run is told that arXiv text entered it (CL-10): the ID only, never the text. */
	readonly externalContent?: ExternalContentLog | undefined;
	/**
	 * The papers this run's search fetched. `getPaperAbstract` reads only from these when given, so a
	 * paper another run left in the shared cache cannot enter the report's set (W5 review F-5).
	 */
	readonly knownPapers?: (() => readonly ArxivPaper[]) | undefined;
	/** Told of each paper `getPaperAbstract` read; it never adds to the set `onPapers` feeds. */
	readonly onRead?: ((paper: ArxivPaper) => void) | undefined;
	/** Told when a search failed, with the error, before the tool reports the failure to the model. */
	readonly onFailure?: ((error: unknown) => void) | undefined;
	/** Told of each call before arXiv is asked: the tool and what it was asked for (Agent Inspector). */
	readonly onCall?:
		| ((call: { readonly tool: string; readonly detail: string }) => void)
		| undefined;
}

function cut(text: string, maxCharacters: number): string {
	const characters = Array.from(text);
	if (characters.length <= maxCharacters) return text;
	return `${characters.slice(0, maxCharacters).join("")}…（以下省略。全文は ${GET_PAPER_ABSTRACT_TOOL_NAME} で読めます）`;
}

function summaryOf(paper: ArxivPaper, abstract: string, authorLimit: number): PaperSummary {
	const omitted = paper.authors.length - authorLimit;
	return {
		arxivId: paper.arxivId,
		title: paper.title,
		authors: paper.authors.slice(0, authorLimit),
		...(omitted > 0 ? { authorsOmitted: omitted } : {}),
		publishedAt: paper.publishedAt.slice(0, 10),
		abstract,
		url: `https://arxiv.org/abs/${paper.arxivId}`,
	};
}

/**
 * The two research tools (plan C8): `searchArxiv` for the search sub-agent and `getPaperAbstract`
 * for the reading one. Both only read; neither can reach anything but the injected client, whose
 * `getAbstract` never makes a request.
 */
export function createResearchTools(dependencies: ResearchToolDependencies): {
	readonly searchArxiv: AciTool<SearchArxivInput, PaperSearchResult>;
	readonly getPaperAbstract: AciTool<GetPaperAbstractInput, PaperAbstract>;
} {
	const { client, onPapers, externalContent, onCall, onFailure, knownPapers, onRead } =
		dependencies;

	function recorded(papers: readonly ArxivPaper[]): void {
		for (const paper of papers) {
			externalContent?.record({ kind: "arxiv-abstract", source: paper.arxivId });
		}
	}

	const searchArxiv = defineAciTool<SearchArxivInput, PaperSearchResult>({
		name: SEARCH_ARXIV_TOOL_NAME,
		description: [
			"arXiv で論文を検索し、各論文のタイトル・著者・公開日・arXiv ID・要旨を返す。",
			"使うとき: テーマに関する論文を探すとき。論文を挙げる前に必ずこれで取得する。",
			"使わないとき: すでに検索結果にある論文の要旨を全文で読みたいとき（getPaperAbstract を使う）、論文以外の情報が欲しいとき。",
			'例: query="hierarchical agents tool use", maxResults=5',
		].join("\n"),
		inputSchema: searchInputSchema,
		risk: "read-only",
		execute: async ({ query, maxResults }, context) => {
			onCall?.({ tool: SEARCH_ARXIV_TOOL_NAME, detail: query });
			let papers: readonly ArxivPaper[];
			try {
				papers = await client.search(query, {
					...(maxResults === undefined ? {} : { maxResults }),
					signal: context.abortSignal,
				});
			} catch (error) {
				onFailure?.(error);
				throw error;
			}
			if (papers.length === 0) return { query, papers: [], notice: NO_PAPER_NOTICE };
			recorded(papers);
			onPapers?.(papers);
			return {
				query,
				papers: papers.map((paper) =>
					summaryOf(paper, cut(paper.summary, SEARCH_ABSTRACT_CHARACTERS), MAX_LISTED_AUTHORS),
				),
			};
		},
	});

	const getPaperAbstract = defineAciTool<GetPaperAbstractInput, PaperAbstract>({
		name: GET_PAPER_ABSTRACT_TOOL_NAME,
		description: [
			"検索で見つかった論文の要旨を、省略せずに返す。",
			"使うとき: searchArxiv の結果にある論文の手法を精読したいとき。",
			"使わないとき: まだ検索していない論文のとき（先に searchArxiv を使う）、論文の本文が欲しいとき（要旨しか返さない）。",
			'例: arxivId="2401.01234"',
		].join("\n"),
		inputSchema: abstractInputSchema,
		risk: "read-only",
		execute: async ({ arxivId }) => {
			onCall?.({ tool: GET_PAPER_ABSTRACT_TOOL_NAME, detail: arxivId });
			const id = arxivId.replace(/v\d+$/u, "");
			const paper =
				knownPapers === undefined
					? await client.getAbstract(arxivId)
					: knownPapers().find((candidate) => candidate.arxivId === id);
			if (paper === undefined) {
				throw new ToolExecutionError(
					`arXiv ID「${arxivId}」の論文は、この調査の検索結果にありません。`,
					{
						nextAction: `先に ${SEARCH_ARXIV_TOOL_NAME} で検索して、結果にある ID を指定してください。`,
					},
				);
			}
			recorded([paper]);
			onRead?.(paper);
			return summaryOf(paper, paper.summary, Number.POSITIVE_INFINITY);
		},
	});

	return { searchArxiv, getPaperAbstract };
}
