import type { ScoredChunk } from "@platform/ai-core/rag";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TraceView, type TraceViewData } from "./TraceView";

afterEach(cleanup);

function scored(
	id: string,
	over: Partial<ScoredChunk> & { page?: number | null } = {},
): ScoredChunk {
	const { page = null, ...rest } = over;
	return {
		chunk: {
			id,
			documentId: `doc-${id}`,
			documentTitle: `文書 ${id}`,
			ordinal: 0,
			headingPath: page === null ? ["第 1 章", "概要"] : [],
			page,
			body: `${id} の本文です。`,
		},
		score: 0.5,
		...rest,
	};
}

const METHODS_OFF = { hyde: false, multiQuery: false, hybrid: false, rerank: false };

function trace(over: Partial<TraceViewData> = {}): TraceViewData {
	return {
		settings: { topK: 4, minSimilarity: 0.2, pool: 20, methods: METHODS_OFF },
		vector: [{ query: "質問", candidates: [scored("a", { score: 0.91234, similarity: 0.91234 })] }],
		fullText: [],
		fused: [],
		rerank: { status: "disabled" },
		final: [scored("a")],
		stages: [],
		...over,
	};
}

function withMethods(methods: Partial<typeof METHODS_OFF>, over: Partial<TraceViewData> = {}) {
	return trace({
		settings: { topK: 4, minSimilarity: 0.2, pool: 20, methods: { ...METHODS_OFF, ...methods } },
		...over,
	});
}

/** The collapsible section whose summary reads `title` (a `<details>` has no accessible name). */
function section(title: string): HTMLDetailsElement {
	const found = [...document.querySelectorAll("details")].find(
		(details) => details.querySelector("summary")?.textContent === title,
	);
	if (!found) throw new Error(`no section titled ${title}`);
	return found;
}

function sectionTitles(): string[] {
	return screen
		.getAllByRole("group")
		.map((group) => group.querySelector("summary")?.textContent ?? "");
}

describe("TraceView", () => {
	it("draws nothing before the first trace arrives", () => {
		const { container } = render(<TraceView trace={undefined} />);

		expect(container.textContent).toBe("");
	});

	it("shows only the vector candidates and the chunks sent to the answer when every method is off", () => {
		render(<TraceView trace={trace()} />);

		expect(sectionTitles()).toEqual(["ベクトル検索の候補", "回答に使うチャンク"]);
	});

	it("adds one section per enabled method, in pipeline order", () => {
		render(
			<TraceView
				trace={withMethods(
					{ hyde: true, multiQuery: true, hybrid: true, rerank: true },
					{
						hypotheticalAnswer: "仮想の回答",
						subQueries: ["言い換え 1", "言い換え 2"],
						fullText: [{ query: "質問", candidates: [scored("b")] }],
						fused: [scored("a"), scored("b")],
						reranked: [scored("b"), scored("a")],
						rerank: { status: "applied" },
					},
				)}
			/>,
		);

		expect(sectionTitles()).toEqual([
			"仮想回答",
			"サブクエリ",
			"ベクトル検索の候補",
			"全文検索の候補",
			"統合後",
			"Rerank 後",
			"回答に使うチャンク",
		]);
		expect(screen.getByText("仮想の回答")).toBeTruthy();
		expect(screen.getByText("言い換え 2")).toBeTruthy();
	});

	it("shows the fused ranking for Multi-Query alone", () => {
		render(
			<TraceView
				trace={withMethods({ multiQuery: true }, { subQueries: ["a"], fused: [scored("a")] })}
			/>,
		);

		expect(sectionTitles()).toContain("統合後");
		expect(sectionTitles()).not.toContain("全文検索の候補");
	});

	it("shows why Rerank was skipped instead of a ranking", () => {
		render(
			<TraceView
				trace={withMethods(
					{ rerank: true },
					{ rerank: { status: "skipped", reason: "api-key-missing" } },
				)}
			/>,
		);

		const group = section("Rerank 後");
		expect(within(group).getByText(/API キーが未設定/)).toBeTruthy();
		expect(within(group).queryByRole("list")).toBeNull();
	});

	it("explains a provider error as a fallback to the fused order", () => {
		render(
			<TraceView
				trace={withMethods(
					{ rerank: true },
					{ rerank: { status: "skipped", reason: "provider-error" } },
				)}
			/>,
		);

		expect(screen.getByText(/統合後の順位を使います/)).toBeTruthy();
	});

	it("shows rank, title, location, score and a body excerpt for a candidate", () => {
		render(
			<TraceView
				trace={trace({
					vector: [
						{
							query: "質問",
							candidates: [
								scored("a", { score: 0.91234, similarity: 0.91234 }),
								scored("p", { page: 3, score: 0.4 }),
							],
						},
					],
				})}
			/>,
		);

		const group = section("ベクトル検索の候補");
		const [first, second] = within(group).getAllByRole("listitem");
		expect(first?.textContent?.startsWith("1")).toBe(true);
		expect(second?.textContent?.startsWith("2")).toBe(true);
		expect(first?.textContent).toContain("文書 a");
		expect(first?.textContent).toContain("第 1 章 › 概要");
		expect(first?.textContent).toContain("スコア 0.912");
		expect(first?.textContent).toContain("類似度 0.912");
		expect(first?.textContent).toContain("a の本文です。");
		expect(second?.textContent).toContain("ページ 3");
		expect(second?.textContent).not.toContain("類似度");
	});

	it("cuts a long body to an excerpt", () => {
		const long = scored("a", { chunk: { ...scored("a").chunk, body: "あ".repeat(120) } });
		render(<TraceView trace={trace({ vector: [{ query: "質問", candidates: [long] }] })} />);

		const text = section("ベクトル検索の候補").textContent ?? "";
		expect(text).toContain(`${"あ".repeat(80)}…`);
		expect(text).not.toContain("あ".repeat(81));
	});

	it("ignores recorded data of a method that is off", () => {
		render(
			<TraceView
				trace={trace({
					hypotheticalAnswer: "仮想の回答",
					subQueries: ["言い換え"],
					reranked: [scored("a")],
				})}
			/>,
		);

		expect(sectionTitles()).toEqual(["ベクトル検索の候補", "回答に使うチャンク"]);
	});

	it("says so when a search found no candidates", () => {
		render(<TraceView trace={trace({ vector: [{ query: "質問", candidates: [] }], final: [] })} />);

		const group = section("ベクトル検索の候補");
		expect(within(group).getByText("候補はありません。")).toBeTruthy();
		expect(within(section("回答に使うチャンク")).getByText("候補はありません。")).toBeTruthy();
	});

	it("shows the query of each search when there is more than one", () => {
		render(
			<TraceView
				trace={withMethods(
					{ multiQuery: true },
					{
						vector: [
							{ query: "元の質問", candidates: [scored("a")] },
							{ query: "言い換えた質問", candidates: [scored("b")] },
						],
						fused: [scored("a")],
					},
				)}
			/>,
		);

		expect(screen.getByText("元の質問")).toBeTruthy();
		expect(screen.getByText("言い換えた質問")).toBeTruthy();
	});

	it("starts collapsed and opens a section from its summary", () => {
		render(<TraceView trace={trace()} />);

		const details = section("ベクトル検索の候補");
		const summary = details.querySelector("summary") as HTMLElement;
		expect(details.open).toBe(false);

		fireEvent.click(summary);

		expect(details.open).toBe(true);
		// A native <summary> is a keyboard control (Enter / Space) without any script.
		expect(summary.tagName).toBe("SUMMARY");
	});
});
