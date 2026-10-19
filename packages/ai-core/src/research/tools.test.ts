import { describe, expect, it } from "vitest";
import { checkDescription } from "../aci/description-check";
import type { ToolOutcome, ToolRuntime } from "../aci/types";
import { createExternalContentLog } from "../agents/observer";
import { PlatformError } from "../errors";
import { createFakeClock } from "../ports/clock";
import type { ArxivClient, ArxivSearchOptions } from "./arxiv/client";
import type { ArxivPaper } from "./arxiv/types";
import {
	createResearchTools,
	GET_PAPER_ABSTRACT_TOOL_NAME,
	type PaperAbstract,
	type PaperSearchResult,
	SEARCH_ARXIV_TOOL_NAME,
} from "./tools";

const RUNTIME: ToolRuntime = { clock: createFakeClock(), toolTimeoutMs: 1_000 };

function paper(overrides: Partial<ArxivPaper> = {}): ArxivPaper {
	return {
		arxivId: "2401.01234",
		title: "Hierarchical Agents",
		authors: ["Ann Example", "Bo Sample"],
		publishedAt: "2024-01-02T18:00:00.000Z",
		summary: "We study hierarchical agents.",
		links: [],
		...overrides,
	};
}

interface FakeClientCalls {
	readonly searches: { query: string; options: ArxivSearchOptions | undefined }[];
	readonly abstracts: string[];
}

function fakeClient(
	papers: readonly ArxivPaper[],
	behaviour: { searchError?: Error } = {},
): ArxivClient & FakeClientCalls {
	const searches: FakeClientCalls["searches"] = [];
	const abstracts: string[] = [];
	return {
		searches,
		abstracts,
		async search(query, options) {
			searches.push({ query, options });
			if (behaviour.searchError) throw behaviour.searchError;
			return papers;
		},
		async getAbstract(id) {
			abstracts.push(id);
			const bare = id.replace(/v\d+$/u, "");
			return papers.find((candidate) => candidate.arxivId === bare);
		},
	};
}

async function run<T>(
	tool: { toTool(runtime: ToolRuntime): { execute?: unknown } },
	input: unknown,
	signal?: AbortSignal,
): Promise<ToolOutcome<T>> {
	const execute = tool.toTool(RUNTIME).execute as
		| ((input: unknown, options: unknown) => Promise<unknown>)
		| undefined;
	if (!execute) throw new Error("tool must be executable");
	return (await execute(input, {
		toolCallId: "call-1",
		messages: [],
		context: undefined,
		...(signal ? { abortSignal: signal } : {}),
	})) as ToolOutcome<T>;
}

function dataOf<T>(outcome: ToolOutcome<T>): T {
	if (!outcome.ok) throw new Error(`expected success, got ${outcome.failure.summary}`);
	return outcome.data;
}

describe("createResearchTools", () => {
	describe("definitions", () => {
		const { searchArxiv, getPaperAbstract } = createResearchTools({ client: fakeClient([]) });

		it("names the two tools", () => {
			expect(searchArxiv.name).toBe(SEARCH_ARXIV_TOOL_NAME);
			expect(getPaperAbstract.name).toBe(GET_PAPER_ABSTRACT_TOOL_NAME);
			expect(SEARCH_ARXIV_TOOL_NAME).toBe("searchArxiv");
			expect(GET_PAPER_ABSTRACT_TOOL_NAME).toBe("getPaperAbstract");
		});

		it("declares both read-only (Req 1.16)", () => {
			expect(searchArxiv.risk).toBe("read-only");
			expect(getPaperAbstract.risk).toBe("read-only");
		});

		it.each([
			["searchArxiv", () => createResearchTools({ client: fakeClient([]) }).searchArxiv],
			["getPaperAbstract", () => createResearchTools({ client: fakeClient([]) }).getPaperAbstract],
		])("gives %s a description in the CL-18 format with every input described", (_name, build) => {
			const definition = build();
			expect(checkDescription(definition.description, definition.inputSchema)).toEqual([]);
		});

		it("tells the model when to use each tool and when not to", () => {
			expect(searchArxiv.description).toContain("使うとき:");
			expect(searchArxiv.description).toContain("使わないとき:");
			expect(getPaperAbstract.description).toContain("使うとき:");
		});
	});

	describe("searchArxiv", () => {
		it("returns title, authors, publication date, arXiv ID and abstract for each paper", async () => {
			const client = fakeClient([paper()]);
			const { searchArxiv } = createResearchTools({ client });
			const data = dataOf(
				await run<PaperSearchResult>(searchArxiv, { query: "hierarchical agents", maxResults: 3 }),
			);
			expect(data.query).toBe("hierarchical agents");
			expect(data.papers).toEqual([
				{
					arxivId: "2401.01234",
					title: "Hierarchical Agents",
					authors: ["Ann Example", "Bo Sample"],
					publishedAt: "2024-01-02",
					abstract: "We study hierarchical agents.",
					url: "https://arxiv.org/abs/2401.01234",
				},
			]);
			expect(data.notice).toBeUndefined();
		});

		it("forwards the query, the count and the abort signal to the client", async () => {
			const client = fakeClient([paper()]);
			const { searchArxiv } = createResearchTools({ client });
			const controller = new AbortController();
			await run(searchArxiv, { query: "planning", maxResults: 4 }, controller.signal);
			expect(client.searches).toHaveLength(1);
			expect(client.searches[0]?.query).toBe("planning");
			expect(client.searches[0]?.options?.maxResults).toBe(4);
			expect(client.searches[0]?.options?.signal).toBeInstanceOf(AbortSignal);
		});

		it("leaves the count to the client when the model gives none", async () => {
			const client = fakeClient([paper()]);
			const { searchArxiv } = createResearchTools({ client });
			await run(searchArxiv, { query: "planning" });
			expect(client.searches[0]?.options?.maxResults).toBeUndefined();
		});

		it("cuts a long abstract and says it was cut, so one search cannot fill the context", async () => {
			const long = "あ".repeat(2_000);
			const client = fakeClient([paper({ summary: long })]);
			const { searchArxiv } = createResearchTools({ client });
			const [first] = dataOf(await run<PaperSearchResult>(searchArxiv, { query: "q" })).papers;
			expect(Array.from(first?.abstract ?? "").length).toBeLessThan(1_300);
			expect(first?.abstract.startsWith("あ".repeat(1_200))).toBe(true);
			expect(first?.abstract).toContain("getPaperAbstract");
		});

		it("keeps an abstract at the limit whole", async () => {
			const exact = "x".repeat(1_200);
			const client = fakeClient([paper({ summary: exact })]);
			const { searchArxiv } = createResearchTools({ client });
			const [first] = dataOf(await run<PaperSearchResult>(searchArxiv, { query: "q" })).papers;
			expect(first?.abstract).toBe(exact);
		});

		it("cuts an abstract that is one character over the limit", async () => {
			const client = fakeClient([paper({ summary: "x".repeat(1_201) })]);
			const { searchArxiv } = createResearchTools({ client });
			const [first] = dataOf(await run<PaperSearchResult>(searchArxiv, { query: "q" })).papers;
			expect(first?.abstract.startsWith("x".repeat(1_200))).toBe(true);
			expect(first?.abstract).not.toBe("x".repeat(1_201));
			expect(first?.abstract).toContain("getPaperAbstract");
		});

		it("counts characters, not UTF-16 units, so it never cuts inside a surrogate pair", async () => {
			const whole = "😀".repeat(1_200);
			const over = "😀".repeat(1_201);
			const { searchArxiv } = createResearchTools({
				client: fakeClient([
					paper({ summary: whole }),
					paper({ arxivId: "2401.00002", summary: over }),
				]),
			});
			const [fits, cut] = dataOf(await run<PaperSearchResult>(searchArxiv, { query: "q" })).papers;
			expect(fits?.abstract).toBe(whole);
			expect(cut?.abstract.startsWith(whole)).toBe(true);
			expect(cut?.abstract.slice(whole.length).startsWith("😀")).toBe(false);
		});

		it("lists the first eight authors and counts the rest", async () => {
			const authors = Array.from({ length: 30 }, (_, index) => `Author ${index}`);
			const client = fakeClient([paper({ authors })]);
			const { searchArxiv } = createResearchTools({ client });
			const [first] = dataOf(await run<PaperSearchResult>(searchArxiv, { query: "q" })).papers;
			expect(first?.authors).toEqual(authors.slice(0, 8));
			expect(first?.authorsOmitted).toBe(22);
		});

		it("does not mention omitted authors when all are listed", async () => {
			const client = fakeClient([paper({ authors: Array.from({ length: 8 }, (_, i) => `A${i}`) })]);
			const { searchArxiv } = createResearchTools({ client });
			const [first] = dataOf(await run<PaperSearchResult>(searchArxiv, { query: "q" })).papers;
			expect(first?.authors).toHaveLength(8);
			expect(first).not.toHaveProperty("authorsOmitted");
		});

		it("says plainly that nothing was found, rather than returning an empty list alone", async () => {
			const { searchArxiv } = createResearchTools({ client: fakeClient([]) });
			const data = dataOf(await run<PaperSearchResult>(searchArxiv, { query: "zzzz" }));
			expect(data.papers).toEqual([]);
			expect(data.notice).toContain("見つかりませんでした");
		});

		it("returns a recoverable failure with the fixed message when arXiv cannot be reached", async () => {
			const client = fakeClient([], {
				searchError: new PlatformError(
					"source-unavailable",
					"arXiv から論文を取得できませんでした。",
					{
						attempts: 4,
					},
				),
			});
			const { searchArxiv } = createResearchTools({ client });
			const outcome = await run<PaperSearchResult>(searchArxiv, { query: "q" });
			expect(outcome.ok).toBe(false);
			if (!outcome.ok) {
				expect(outcome.failure.kind).toBe("recoverable");
				expect(outcome.failure.summary).toContain("arXiv");
			}
		});

		it("tells the run about a failed search with the error, and not about a good one", async () => {
			const failures: unknown[] = [];
			const error = new PlatformError(
				"source-unavailable",
				"arXiv から論文を取得できませんでした。",
			);
			const bad = createResearchTools({
				client: fakeClient([], { searchError: error }),
				onFailure: (failure) => failures.push(failure),
			});
			const outcome = await run<PaperSearchResult>(bad.searchArxiv, { query: "q" });
			expect(outcome.ok).toBe(false);
			expect(failures).toEqual([error]);

			const good = createResearchTools({
				client: fakeClient([paper()]),
				onFailure: (failure) => failures.push(failure),
			});
			await run(good.searchArxiv, { query: "q" });
			expect(failures).toHaveLength(1);
		});

		it("passes each returned paper to the run's collector, and nothing on a failure", async () => {
			const seen: ArxivPaper[][] = [];
			const ok = createResearchTools({
				client: fakeClient([paper(), paper({ arxivId: "2403.05678" })]),
				onPapers: (papers) => seen.push([...papers]),
			});
			await run(ok.searchArxiv, { query: "q" });
			expect(seen).toHaveLength(1);
			expect(seen[0]?.map((p) => p.arxivId)).toEqual(["2401.01234", "2403.05678"]);

			const failed: ArxivPaper[][] = [];
			const bad = createResearchTools({
				client: fakeClient([], { searchError: new PlatformError("source-unavailable", "x") }),
				onPapers: (papers) => failed.push([...papers]),
			});
			await run(bad.searchArxiv, { query: "q" });
			expect(failed).toEqual([]);
		});

		it("passes the collector the whole abstract, not the cut one", async () => {
			const long = "y".repeat(3_000);
			const seen: ArxivPaper[] = [];
			const { searchArxiv } = createResearchTools({
				client: fakeClient([paper({ summary: long })]),
				onPapers: (papers) => seen.push(...papers),
			});
			await run(searchArxiv, { query: "q" });
			expect(seen[0]?.summary).toBe(long);
		});

		it("records each abstract that entered the run as external content, by ID only", async () => {
			const externalContent = createExternalContentLog();
			const { searchArxiv } = createResearchTools({
				client: fakeClient([paper(), paper({ arxivId: "cs/0501001" })]),
				externalContent,
			});
			await run(searchArxiv, { query: "q" });
			expect(externalContent.entries()).toEqual([
				{ kind: "arxiv-abstract", source: "2401.01234" },
				{ kind: "arxiv-abstract", source: "cs/0501001" },
			]);
			expect(JSON.stringify(externalContent.entries())).not.toContain("hierarchical agents.");
		});

		it("reports each call to the run's observer before it asks arXiv, with what was asked", async () => {
			const calls: { tool: string; detail: string }[] = [];
			const client = fakeClient([paper()]);
			let searchesWhenTold = -1;
			const { searchArxiv } = createResearchTools({
				client,
				onCall: (call) => {
					calls.push(call);
					searchesWhenTold = client.searches.length;
				},
			});
			await run(searchArxiv, { query: "hierarchical agents", maxResults: 3 });
			expect(calls).toEqual([{ tool: "searchArxiv", detail: "hierarchical agents" }]);
			expect(searchesWhenTold).toBe(0);
		});

		it("records nothing when nothing was returned", async () => {
			const externalContent = createExternalContentLog();
			const { searchArxiv } = createResearchTools({ client: fakeClient([]), externalContent });
			await run(searchArxiv, { query: "q" });
			expect(externalContent.entries()).toEqual([]);
		});

		it.each([
			["an empty query", { query: "" }],
			["a query over 300 characters", { query: "x".repeat(301) }],
			["a count of 0", { query: "q", maxResults: 0 }],
			["a count over 10", { query: "q", maxResults: 11 }],
			["a fractional count", { query: "q", maxResults: 2.5 }],
			["an unknown field", { query: "q", sortBy: "date" }],
		])("rejects %s before calling the client", (_name, input) => {
			const { searchArxiv } = createResearchTools({ client: fakeClient([]) });
			expect(searchArxiv.inputSchema.safeParse(input).success).toBe(false);
		});

		it("accepts a query of exactly 300 characters and a count of exactly 10", () => {
			const { searchArxiv } = createResearchTools({ client: fakeClient([]) });
			expect(
				searchArxiv.inputSchema.safeParse({ query: "x".repeat(300), maxResults: 10 }).success,
			).toBe(true);
			expect(searchArxiv.inputSchema.safeParse({ query: "x", maxResults: 1 }).success).toBe(true);
		});
	});

	describe("getPaperAbstract", () => {
		it("returns the whole abstract of a paper a search returned", async () => {
			const long = "z".repeat(3_000);
			const client = fakeClient([paper({ summary: long })]);
			const { getPaperAbstract } = createResearchTools({ client });
			const data = dataOf(await run<PaperAbstract>(getPaperAbstract, { arxivId: "2401.01234" }));
			expect(data).toEqual({
				arxivId: "2401.01234",
				title: "Hierarchical Agents",
				authors: ["Ann Example", "Bo Sample"],
				publishedAt: "2024-01-02",
				abstract: long,
				url: "https://arxiv.org/abs/2401.01234",
			});
			expect(client.abstracts).toEqual(["2401.01234"]);
		});

		it("lists every author of the paper", async () => {
			const authors = Array.from({ length: 30 }, (_, index) => `Author ${index}`);
			const { getPaperAbstract } = createResearchTools({
				client: fakeClient([paper({ authors })]),
			});
			const data = dataOf(await run<PaperAbstract>(getPaperAbstract, { arxivId: "2401.01234" }));
			expect(data.authors).toEqual(authors);
			expect(data).not.toHaveProperty("authorsOmitted");
		});

		it("accepts an ID with a version suffix", async () => {
			const { getPaperAbstract } = createResearchTools({ client: fakeClient([paper()]) });
			const data = dataOf(await run<PaperAbstract>(getPaperAbstract, { arxivId: "2401.01234v2" }));
			expect(data.arxivId).toBe("2401.01234");
		});

		it("tells the model to search first when the paper is not among the search results", async () => {
			const { getPaperAbstract } = createResearchTools({ client: fakeClient([paper()]) });
			const outcome = await run<PaperAbstract>(getPaperAbstract, { arxivId: "2499.99999" });
			expect(outcome.ok).toBe(false);
			if (!outcome.ok) {
				expect(outcome.failure.kind).toBe("recoverable");
				expect(outcome.failure.summary).toContain("2499.99999");
				expect(outcome.failure.nextAction).toContain("searchArxiv");
			}
		});

		it("records the abstract as external content by ID, and does not add the paper to the run's set (W5 review F-5)", async () => {
			const externalContent = createExternalContentLog();
			const seen: ArxivPaper[] = [];
			const { getPaperAbstract } = createResearchTools({
				client: fakeClient([paper()]),
				externalContent,
				onPapers: (papers) => seen.push(...papers),
			});
			await run(getPaperAbstract, { arxivId: "2401.01234v1" });
			expect(externalContent.entries()).toEqual([{ kind: "arxiv-abstract", source: "2401.01234" }]);
			// Only a search puts a paper into the set the report is checked against.
			expect(seen).toEqual([]);
		});

		it("tells the run which paper it read", async () => {
			const read: string[] = [];
			const { getPaperAbstract } = createResearchTools({
				client: fakeClient([paper()]),
				onRead: (p) => read.push(p.arxivId),
			});
			await run(getPaperAbstract, { arxivId: "2401.01234" });
			expect(read).toEqual(["2401.01234"]);
		});

		it("reads only papers of the run's own set when it is given one, not the shared cache", async () => {
			const inRun = paper({ arxivId: "2403.05678", title: "In this run" });
			// The client's cache holds 2401.01234 (another run's search); this run only fetched 2403.05678.
			const { getPaperAbstract } = createResearchTools({
				client: fakeClient([paper(), inRun]),
				knownPapers: () => [inRun],
			});
			const cached = await run<PaperAbstract>(getPaperAbstract, { arxivId: "2401.01234" });
			expect(cached.ok).toBe(false);
			const own = await run<PaperAbstract>(getPaperAbstract, { arxivId: "2403.05678v2" });
			expect(dataOf(own).title).toBe("In this run");
		});

		it("reports the call with the ID that was asked for", async () => {
			const calls: { tool: string; detail: string }[] = [];
			const { getPaperAbstract } = createResearchTools({
				client: fakeClient([paper()]),
				onCall: (call) => calls.push(call),
			});
			await run(getPaperAbstract, { arxivId: "2401.01234v2" });
			expect(calls).toEqual([{ tool: "getPaperAbstract", detail: "2401.01234v2" }]);
		});

		it("records nothing for a paper it did not find", async () => {
			const externalContent = createExternalContentLog();
			const seen: ArxivPaper[] = [];
			const { getPaperAbstract } = createResearchTools({
				client: fakeClient([]),
				externalContent,
				onPapers: (papers) => seen.push(...papers),
			});
			await run(getPaperAbstract, { arxivId: "2401.01234" });
			expect(externalContent.entries()).toEqual([]);
			expect(seen).toEqual([]);
		});

		it.each([
			["a word", "agents"],
			["a path", "../../etc/passwd"],
			["a URL", "https://example.com/2401.01234"],
			["an empty string", ""],
			["a malformed number", "24011234"],
			["an ID followed by text", "2401.01234xyz"],
			["an ID with a malformed version", "2401.01234vx"],
			["text before an ID", "see 2401.01234"],
		])("rejects %s as an ID", (_name, arxivId) => {
			const { getPaperAbstract } = createResearchTools({ client: fakeClient([]) });
			expect(getPaperAbstract.inputSchema.safeParse({ arxivId }).success).toBe(false);
		});

		it.each(["2401.01234", "2401.01234v3", "cs/0501001", "math.GT/0309136v2"])(
			"accepts %s as an ID",
			(arxivId) => {
				const { getPaperAbstract } = createResearchTools({ client: fakeClient([]) });
				expect(getPaperAbstract.inputSchema.safeParse({ arxivId }).success).toBe(true);
			},
		);
	});
});
