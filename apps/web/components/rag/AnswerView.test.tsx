import { type Citation, resolveCitations } from "@platform/ai-core/rag";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AnswerView } from "./AnswerView";
import { CitationList } from "./CitationList";

afterEach(cleanup);

function citation(label: number, overrides: Partial<Citation> = {}): Citation {
	return {
		chunkId: `c${label}`,
		label,
		documentId: `d${label}`,
		documentTitle: `文書 ${label}`,
		locator: { kind: "page", page: label },
		excerpt: `抜粋 ${label}`,
		cited: true,
		...overrides,
	};
}

const CITATIONS = [citation(1), citation(2), citation(3)];

function Screen({ text, citations }: { text: string; citations?: Citation[] }) {
	return (
		<>
			<AnswerView text={text} citations={citations} idPrefix="t" />
			{citations ? <CitationList citations={citations} idPrefix="t" /> : null}
		</>
	);
}

describe("AnswerView footnotes", () => {
	it("draws a footnote that has a card as a link to that card", () => {
		render(<AnswerView text="停止条件を設定します[1]。" citations={CITATIONS} idPrefix="t" />);

		const link = screen.getByRole("link", { name: "[1]" });
		expect(link.getAttribute("href")).toBe("#t-1");
	});

	it("moves focus to the card on click, Enter and Space", () => {
		render(<Screen text="根拠 [1] と [2]。" citations={CITATIONS} />);

		for (const [name, label] of [
			["[1]", "t-1"],
			["[2]", "t-2"],
		] as const) {
			const link = screen.getByRole("link", { name });
			fireEvent.click(link);
			expect(document.activeElement?.id).toBe(label);
		}
		(document.activeElement as HTMLElement).blur();

		fireEvent.keyDown(screen.getByRole("link", { name: "[2]" }), { key: "Enter" });
		expect(document.activeElement?.id).toBe("t-2");

		fireEvent.keyDown(screen.getByRole("link", { name: "[1]" }), { key: " " });
		expect(document.activeElement?.id).toBe("t-1");
	});

	it("ignores other keys", () => {
		render(<Screen text="根拠 [1]。" citations={CITATIONS} />);

		fireEvent.keyDown(screen.getByRole("link", { name: "[1]" }), { key: "a" });

		expect(document.activeElement?.id).not.toBe("t-1");
	});

	it("keeps a footnote without a card as plain text", () => {
		render(<AnswerView text="根拠 [9]。" citations={CITATIONS} idPrefix="t" />);

		expect(screen.queryByRole("link")).toBeNull();
		expect(screen.getByText(/根拠 \[9\]。/)).toBeTruthy();
	});

	it("draws no links while the answer is still streaming (no citations yet)", () => {
		render(<AnswerView text="根拠 [1]" citations={undefined} idPrefix="t" />);

		expect(screen.queryByRole("link")).toBeNull();
		expect(screen.getByText(/根拠 \[1\]/)).toBeTruthy();
	});

	it("links every number of a grouped or ranged footnote", () => {
		render(<AnswerView text="A [1, 2] と B [1-3]。" citations={CITATIONS} idPrefix="t" />);

		const names = screen.getAllByRole("link").map((link) => link.textContent);
		expect(names).toEqual(["[1]", "[2]", "[1]", "[2]", "[3]"]);
	});

	it("reads full-width footnotes like the server does", () => {
		render(<AnswerView text="根拠［２］。" citations={CITATIONS} idPrefix="t" />);

		const link = screen.getByRole("link", { name: "[2]" });
		expect(link.getAttribute("href")).toBe("#t-2");
	});

	it("keeps only the unknown numbers of a group as plain text", () => {
		render(<AnswerView text="根拠 [2, 9]。" citations={CITATIONS} idPrefix="t" />);

		expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(["[2]"]);
		expect(screen.getByText(/\[9\]/)).toBeTruthy();
	});

	it("does not treat a Markdown link label as a footnote", () => {
		render(
			<AnswerView
				text="詳しくは [1](https://example.com) を参照。"
				citations={CITATIONS}
				idPrefix="t"
			/>,
		);

		expect(screen.queryByRole("link")).toBeNull();
	});

	it("does not link a footnote inside inline code or a fenced code block", () => {
		const text = ["配列は `xs[1]` で読む。", "```ts", "const a = xs[2];", "```", "本文 [3]。"].join(
			"\n",
		);
		render(<AnswerView text={text} citations={CITATIONS} idPrefix="t" />);

		expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(["[3]"]);
		// Markdown is not rendered, so the code keeps its backticks and only its footnote-like text is spared.
		expect(screen.getByText("`xs[1]`").tagName).toBe("CODE");
	});

	it("keeps the original spelling of a full-width footnote that has no card", () => {
		render(<AnswerView text="根拠［９］。" citations={CITATIONS} idPrefix="t" />);

		expect(screen.queryByRole("link")).toBeNull();
		expect(screen.getByText(/根拠［９］。/)).toBeTruthy();
	});

	it.each(["[3-1]", "[1-99]"])("does not read %s as a footnote (reversed or too wide)", (raw) => {
		render(<AnswerView text={`範囲 ${raw}。`} citations={CITATIONS} idPrefix="t" />);

		expect(screen.queryByRole("link")).toBeNull();
	});

	it("still links a footnote after a lone backtick that never closes", () => {
		render(<AnswerView text="記号 ` のあと [1]。" citations={CITATIONS} idPrefix="t" />);

		expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(["[1]"]);
	});

	it("still finds a code span after a backtick run that never closes", () => {
		render(<AnswerView text="x `` y `xs[1]` z [2]" citations={CITATIONS} idPrefix="t" />);

		expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(["[2]"]);
	});

	it("does not close a single-backtick span on a part of a longer run", () => {
		const { container } = render(
			<AnswerView text="`a ``b[1]`` c` と [2]" citations={CITATIONS} idPrefix="t" />,
		);

		const codes = [...container.querySelectorAll("code")].map((code) => code.textContent);
		expect(codes).toEqual(["`a ``b[1]`` c`"]);
		expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(["[2]"]);
	});

	it("separates the numbers of a group so they read as separate footnotes", () => {
		const { container } = render(
			<AnswerView text="A [1, 2] B" citations={CITATIONS} idPrefix="t" />,
		);

		expect(container.textContent).toBe("A [1] [2] B");
	});

	it("closes a double-backtick span only with a double run", () => {
		render(<AnswerView text="``a ` xs[1]`` のあと [2]" citations={CITATIONS} idPrefix="t" />);

		expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(["[2]"]);
	});

	it("treats a tilde fence like a backtick fence and ends it at the closing fence", () => {
		render(<AnswerView text={"~~~\nxs[1]\n~~~\n本文 [2]"} citations={CITATIONS} idPrefix="t" />);

		expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(["[2]"]);
	});

	it("keeps an unclosed fence as code to the end of the text", () => {
		render(<AnswerView text={"```\nxs[1]\n本文 [2]"} citations={CITATIONS} idPrefix="t" />);

		expect(screen.queryByRole("link")).toBeNull();
	});

	it("shows the newest text when the prop changes (delta, then the final answer)", () => {
		const { rerender } = render(<AnswerView text="途中" citations={undefined} idPrefix="t" />);
		expect(screen.getByText("途中")).toBeTruthy();

		rerender(<AnswerView text="確定した回答 [1]" citations={CITATIONS} idPrefix="t" />);

		expect(screen.queryByText("途中")).toBeNull();
		expect(screen.getByRole("link", { name: "[1]" })).toBeTruthy();
	});

	it("marks a no-evidence answer with a visible label", () => {
		render(
			<AnswerView
				text="根拠となる資料が見つかりませんでした。"
				citations={[]}
				noEvidence
				idPrefix="t"
			/>,
		);

		expect(screen.getByText("該当なし")).toBeTruthy();
		expect(screen.getByText("根拠となる資料が見つかりませんでした。")).toBeTruthy();
	});

	it("shows no no-evidence label for a normal answer", () => {
		render(<AnswerView text="回答です。" citations={CITATIONS} idPrefix="t" />);

		expect(screen.queryByText("該当なし")).toBeNull();
	});
});

// The client copies the server's footnote and code rules (it cannot import them), so the same
// inputs go through `resolveCitations` and `AnswerView` and must agree on which footnotes are real.
describe("AnswerView agrees with resolveCitations on what a footnote is", () => {
	const chunks = [1, 2, 3].map((n) => ({
		chunk: {
			id: `c${n}`,
			documentId: `d${n}`,
			documentTitle: `文書 ${n}`,
			ordinal: n,
			headingPath: [],
			page: n,
			body: `本文 ${n}`,
		},
		score: 1,
	}));
	const VECTORS: readonly [string, string][] = [
		[
			"a backtick line with more backticks after it is not a fence",
			"```js``` here [1].\nAnd later [2].",
		],
		["a closer indented by four spaces does not close the fence", "```\ncode\n    ```\nafter [1]"],
		["a closer indented by a tab does not close the fence", "```\ncode\n\t```\nafter [1]"],
		["a closer indented by three spaces closes it", "```\ncode [1]\n   ```\nafter [2]"],
		["a longer closing run closes it", "```\ncode [1]\n`````\nafter [2]"],
		["a shorter closing run does not", "````\ncode [1]\n```\nstill code [2]"],
		["a different marker does not", "```\ncode [1]\n~~~\nstill code [2]"],
		["text after the closing marker keeps the fence open", "```\ncode [1]\n``` x\nstill code [2]"],
		["a tilde fence", "~~~\ncode [1]\n~~~\nafter [2]"],
		["an unclosed fence", "text [1]\n```\ncode [2]"],
		["an inline code span", "use `xs[1]` and [2]"],
		["a Markdown link label", "see [1](https://example.test) and [2]"],
		["a group and a range", "[1, 3] and [1-2]"],
		["full-width numbers", "［２］ and ［１、３］"],
		["out-of-range numbers", "[1] [9] [2, 7]"],
	];

	it.each(VECTORS)("%s", (_name, text) => {
		const resolved = resolveCitations(text, chunks);
		const citations = resolved.citations;

		render(<AnswerView text={text} citations={citations} idPrefix="t" />);

		const linked = new Set(screen.queryAllByRole("link").map((link) => link.textContent));
		const expected = new Set(
			resolved.citations
				.filter((citation) => citation.cited)
				.map((citation) => `[${citation.label}]`),
		);
		// A link exists exactly for the footnotes the server counted as citations.
		expect(linked).toEqual(expected);
	});
});
