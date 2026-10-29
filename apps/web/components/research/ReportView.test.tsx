import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ReportView, type ResearchResultData } from "./ReportView";

afterEach(cleanup);

function result(over: Partial<ResearchResultData> = {}): ResearchResultData {
	return { report: "", warnings: [], missing: [], ...over };
}

describe("ReportView", () => {
	it("renders nothing before the result arrives", () => {
		const { container } = render(<ReportView result={undefined} />);

		expect(container.firstChild).toBeNull();
	});

	it("draws headings, paragraphs and lists of a Markdown report", () => {
		render(
			<ReportView
				result={result({
					report: [
						"# 調査レポート",
						"",
						"## 手法",
						"最初の段落です。",
						"続きの行です。",
						"",
						"- 項目 A",
						"- 項目 B",
						"",
						"1. 手順 1",
						"2. 手順 2",
					].join("\n"),
				})}
			/>,
		);

		expect(screen.getByRole("heading", { level: 3, name: "調査レポート" })).toBeTruthy();
		expect(screen.getByRole("heading", { level: 4, name: "手法" })).toBeTruthy();
		expect(screen.getByText("最初の段落です。 続きの行です。")).toBeTruthy();
		const lists = screen.getAllByRole("list");
		expect(
			within(lists[0] as HTMLElement)
				.getAllByRole("listitem")
				.map((li) => li.textContent),
		).toEqual(["項目 A", "項目 B"]);
		expect(lists[0]?.tagName).toBe("UL");
		expect(lists[1]?.tagName).toBe("OL");
	});

	it("draws code blocks and inline code and bold text", () => {
		const { container } = render(
			<ReportView
				result={result({
					report: "文中の `inline` と **強調** です。\n\n```ts\nconst x = 1;\n# not a heading\n```",
				})}
			/>,
		);

		expect(container.querySelector("pre")?.textContent).toBe("const x = 1;\n# not a heading");
		expect(screen.getByText("inline").tagName).toBe("CODE");
		expect(screen.getByText("強調").tagName).toBe("STRONG");
		expect(screen.queryByRole("heading", { name: "not a heading" })).toBeNull();
	});

	it("keeps the report in a named article region", () => {
		render(<ReportView result={result({ report: "本文" })} />);

		expect(screen.getByRole("article", { name: "レポート" }).textContent).toBe("本文");
	});

	it("reads CRLF line breaks, blank lines with spaces, and closing hashes", () => {
		render(
			<ReportView result={result({ report: "## 手法 ##\r\n\r\n一つ目\n  \n二つ目\r\r三つ目" })} />,
		);

		expect(screen.getByRole("heading", { level: 4 }).textContent).toBe("手法");
		expect(screen.getByRole("article").querySelectorAll("p")).toHaveLength(3);
	});

	it("never goes below h6 for deep headings", () => {
		render(<ReportView result={result({ report: "#### 四\n\n##### 五\n\n###### 六" })} />);

		expect(screen.getAllByRole("heading").map((h) => h.tagName)).toEqual(["H6", "H6", "H6"]);
	});

	it("ends a list or paragraph when a different block starts without a blank line", () => {
		const { container } = render(
			<ReportView result={result({ report: "前置き\n- 点 A\n1. 手順\n後置き" })} />,
		);

		const tags = [...(container.querySelector("article")?.children ?? [])].map((el) => el.tagName);
		expect(tags).toEqual(["P", "UL", "OL", "P"]);
	});

	it("closes a code block only with a fence of the same marker, at least as long, with nothing after it", () => {
		const { container } = render(
			<ReportView
				result={result({ report: "````\ncode\n```\n~~~~\n```` not a closer\n````\n\n後ろの段落" })}
			/>,
		);

		expect(container.querySelector("pre")?.textContent).toBe("code\n```\n~~~~\n```` not a closer");
		expect(screen.getByText("後ろの段落")).toBeTruthy();
	});

	it("keeps an unclosed code block to the end of the report", () => {
		const { container } = render(<ReportView result={result({ report: "```\n一行目\n二行目" })} />);

		expect(container.querySelector("pre")?.textContent).toBe("一行目\n二行目");
	});

	it("does not turn Markdown image syntax into a link", () => {
		render(<ReportView result={result({ report: "![画像](https://evil.example/a.png)" })} />);

		expect(screen.queryByRole("link")).toBeNull();
		expect(screen.getByText("![画像](https://evil.example/a.png)")).toBeTruthy();
	});

	it("links only https addresses; others stay as text", () => {
		render(
			<ReportView
				result={result({
					report:
						"[論文](https://arxiv.org/abs/2401.00001) と [罠](javascript:alert(1)) と [平文](http://example.com/x)。",
				})}
			/>,
		);

		const links = screen.getAllByRole("link");
		expect(links).toHaveLength(1);
		expect(links[0]?.getAttribute("href")).toBe("https://arxiv.org/abs/2401.00001");
		expect(links[0]?.getAttribute("rel")).toBe("noopener noreferrer");
		expect(screen.getByText(/\[罠\]\(javascript:alert\(1\)\)/)).toBeTruthy();
	});

	it("links arXiv paper pages but shows the host of any other https link as text (F-14)", () => {
		render(
			<ReportView
				result={result({
					report:
						"[論文](https://arxiv.org/abs/2401.00001) [PDF](https://export.arxiv.org/pdf/2401.00002v2) [偽](https://example.com/login?x=1) [ルート](https://arxiv.org.evil.example/abs/2401.00001)",
				})}
			/>,
		);

		const links = screen.getAllByRole("link");
		expect(links.map((link) => link.getAttribute("href"))).toEqual([
			"https://arxiv.org/abs/2401.00001",
			"https://export.arxiv.org/pdf/2401.00002v2",
		]);
		for (const link of links) expect(link.getAttribute("rel")).toBe("noopener noreferrer");
		expect(screen.getByText(/偽（example\.com）/)).toBeTruthy();
		expect(screen.getByText(/ルート（arxiv\.org\.evil\.example）/)).toBeTruthy();
	});

	it("shows raw HTML in the report as text, never as elements", () => {
		const report = [
			"# <script>alert(1)</script>",
			"",
			'<img src=x onerror="alert(2)"> 段落',
			"",
			'- <iframe src="https://evil.example"></iframe>',
			"",
			"[<img src=y onerror=alert(3)>](https://arxiv.org/abs/2401.00001)",
			"",
			"![画像](https://evil.example/a.png)",
			"",
			"```html",
			"<script>alert(4)</script>",
			"```",
		].join("\n");
		const { container } = render(<ReportView result={result({ report })} />);

		expect(container.querySelector("script, img, iframe, style, object, embed")).toBeNull();
		expect(container.querySelector("[onerror]")).toBeNull();
		expect(screen.getByRole("heading", { level: 3 }).textContent).toBe("<script>alert(1)</script>");
		expect(screen.getByText(/<img src=x onerror="alert\(2\)"> 段落/)).toBeTruthy();
		expect(container.querySelector("pre")?.textContent).toBe("<script>alert(4)</script>");
	});

	it("lists the citation warnings in a polite live region", () => {
		render(
			<ReportView
				result={result({
					report: "本文",
					warnings: ["未知の ID 2499.99999 を除去しました。", "論文名だけの参照があります。"],
				})}
			/>,
		);

		const warnings = screen.getByRole("status", { name: "引用の警告" });
		expect(
			within(warnings)
				.getAllByRole("listitem")
				.map((li) => li.textContent),
		).toEqual(["未知の ID 2499.99999 を除去しました。", "論文名だけの参照があります。"]);
	});

	it("shows no warning or gap section when there are none", () => {
		render(<ReportView result={result({ report: "本文" })} />);

		expect(screen.queryByRole("status")).toBeNull();
		expect(screen.queryByText("欠落した観点")).toBeNull();
	});

	it("names each missing aspect by agent with its reason", () => {
		render(
			<ReportView
				result={result({
					report: "本文",
					missing: [
						{ agent: "search", reason: "arXiv に到達できませんでした。" },
						{ agent: "market", reason: "予算が尽きました。" },
					],
				})}
			/>,
		);

		const gaps = screen.getByRole("status", { name: "欠落した観点" });
		const items = within(gaps).getAllByRole("listitem");
		expect(items.map((li) => li.textContent)).toEqual([
			"検索: arXiv に到達できませんでした。",
			"市場: 予算が尽きました。",
		]);
	});

	it("shows warning and gap text as text too", () => {
		const hostile = "<img src=z onerror=alert(5)>";
		const { container } = render(
			<ReportView
				result={result({
					report: "本文",
					warnings: [hostile],
					missing: [{ agent: "reading", reason: hostile }],
				})}
			/>,
		);

		expect(container.querySelector("img")).toBeNull();
		expect(screen.getAllByText(hostile, { exact: false })).toHaveLength(2);
	});

	it("says so when the report is empty", () => {
		render(<ReportView result={result({ report: "  \n" })} />);

		expect(screen.getByText("レポートは空です。")).toBeTruthy();
	});
});
