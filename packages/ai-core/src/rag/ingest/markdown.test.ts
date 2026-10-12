import { describe, expect, it } from "vitest";
import { readFrontMatterTags, splitMarkdown } from "./markdown";

describe("splitMarkdown", () => {
	it("splits at heading boundaries so no section spans two headings", () => {
		const sections = splitMarkdown(
			["# Alpha", "alpha body", "", "## Beta", "beta body", "", "# Gamma", "gamma body"].join("\n"),
		);

		expect(sections).toEqual([
			{ headingPath: ["Alpha"], body: "alpha body" },
			{ headingPath: ["Alpha", "Beta"], body: "beta body" },
			{ headingPath: ["Gamma"], body: "gamma body" },
		]);
		for (const section of sections) {
			expect(section.body).not.toMatch(/^#{1,6}\s/m);
		}
	});

	it("does not treat # lines inside fenced code blocks as headings", () => {
		const text = [
			"# Title",
			"intro",
			"```bash",
			"# not a heading",
			"## still not",
			"```",
			"~~~",
			"# tilde fence content",
			"~~~",
			"after",
		].join("\n");

		const sections = splitMarkdown(text);

		expect(sections).toHaveLength(1);
		expect(sections[0]?.headingPath).toEqual(["Title"]);
		expect(sections[0]?.body).toContain("# not a heading");
		expect(sections[0]?.body).toContain("# tilde fence content");
		expect(sections[0]?.body).toContain("after");
	});

	it("only closes a fence with the same character and at least the same length", () => {
		const text = ["# T", "````", "```", "# inside", "````", "## After"].join("\n");

		const sections = splitMarkdown(text);

		expect(sections.map((s) => s.headingPath)).toEqual([["T"], ["T", "After"]]);
		expect(sections[0]?.body).toContain("# inside");
	});

	it("keeps an unclosed fence open until the end of the document", () => {
		const sections = splitMarkdown(["# T", "```", "# trapped", "text"].join("\n"));

		expect(sections).toHaveLength(1);
		expect(sections[0]?.body).toContain("# trapped");
	});

	it("emits text before the first heading as a section with an empty heading path", () => {
		const sections = splitMarkdown(["preamble line", "", "# First", "body"].join("\n"));

		expect(sections).toEqual([
			{ headingPath: [], body: "preamble line" },
			{ headingPath: ["First"], body: "body" },
		]);
	});

	it("emits no preamble section when nothing precedes the first heading", () => {
		const sections = splitMarkdown("\n\n# First\nbody");

		expect(sections).toEqual([{ headingPath: ["First"], body: "body" }]);
	});

	it("keeps a heading with an empty body as an empty section", () => {
		const sections = splitMarkdown(["# Parent", "## Child", "child body", "# Empty"].join("\n"));

		expect(sections).toEqual([
			{ headingPath: ["Parent"], body: "" },
			{ headingPath: ["Parent", "Child"], body: "child body" },
			{ headingPath: ["Empty"], body: "" },
		]);
	});

	it("returns no sections for empty or whitespace-only input", () => {
		expect(splitMarkdown("")).toEqual([]);
		expect(splitMarkdown("  \n\n\t\n")).toEqual([]);
	});

	it("builds the heading path for deep nesting up to six levels", () => {
		const text = ["# h1", "## h2", "### h3", "#### h4", "##### h5", "###### h6", "deep body"].join(
			"\n",
		);

		const sections = splitMarkdown(text);

		expect(sections.at(-1)).toEqual({
			headingPath: ["h1", "h2", "h3", "h4", "h5", "h6"],
			body: "deep body",
		});
	});

	it("pops the path when a heading of the same or a shallower level appears", () => {
		const text = ["# a", "## b", "### c", "x", "## d", "y", "# e", "z"].join("\n");

		const paths = splitMarkdown(text).map((s) => s.headingPath);

		expect(paths).toEqual([["a"], ["a", "b"], ["a", "b", "c"], ["a", "d"], ["e"]]);
	});

	it("handles skipped levels by nesting under the nearest shallower heading", () => {
		const paths = splitMarkdown(["# a", "### c", "x"].join("\n")).map((s) => s.headingPath);

		expect(paths).toEqual([["a"], ["a", "c"]]);
	});

	it("treats seven hashes, missing space, and indented code as body text", () => {
		const text = ["# Real", "####### seven", "#nospace", "    # indented code"].join("\n");

		const sections = splitMarkdown(text);

		expect(sections).toHaveLength(1);
		expect(sections[0]?.body).toBe("####### seven\n#nospace\n    # indented code");
	});

	it("strips closing hashes and surrounding whitespace from heading text", () => {
		const sections = splitMarkdown(["##   Title with closer  ##  ", "x"].join("\n"));

		expect(sections[0]?.headingPath).toEqual(["Title with closer"]);
	});

	it("treats a hash-only line without text as body text", () => {
		const sections = splitMarkdown(["# Real", "#", "text"].join("\n"));

		expect(sections).toHaveLength(1);
		expect(sections[0]?.body).toBe("#\ntext");
	});

	it("normalises CRLF line endings", () => {
		const sections = splitMarkdown("# A\r\nline one\r\nline two\r\n# B\r\nx");

		expect(sections).toEqual([
			{ headingPath: ["A"], body: "line one\nline two" },
			{ headingPath: ["B"], body: "x" },
		]);
	});

	it("excludes the front matter from the sections", () => {
		const text = ["---", "tags: [a, b]", "title: ignored", "---", "# Head", "body"].join("\n");

		expect(splitMarkdown(text)).toEqual([{ headingPath: ["Head"], body: "body" }]);
	});

	it("keeps a leading --- block as body text when it is never closed", () => {
		const sections = splitMarkdown(["---", "tags: [a]", "# Head"].join("\n"));

		expect(sections[0]).toEqual({ headingPath: [], body: "---\ntags: [a]" });
	});

	it("splits Japanese headings and bodies", () => {
		const sections = splitMarkdown(
			["# 検索の基礎", "全文検索の説明。", "## ベクトル検索", "埋め込み。"].join("\n"),
		);

		expect(sections).toEqual([
			{ headingPath: ["検索の基礎"], body: "全文検索の説明。" },
			{ headingPath: ["検索の基礎", "ベクトル検索"], body: "埋め込み。" },
		]);
	});
});

describe("readFrontMatterTags", () => {
	it("returns an empty list when there is no front matter", () => {
		expect(readFrontMatterTags("# Title\nbody")).toEqual([]);
		expect(readFrontMatterTags("")).toEqual([]);
	});

	it("returns an empty list when the front matter has no tags key", () => {
		expect(readFrontMatterTags("---\ntitle: x\n---\nbody")).toEqual([]);
	});

	it("reads a flow sequence of tags", () => {
		expect(readFrontMatterTags("---\ntags: [rag, \"search\", 'ja']\n---\nbody")).toEqual([
			"rag",
			"search",
			"ja",
		]);
	});

	it("reads a block sequence of tags", () => {
		const text =
			'---\ntitle: x\ntags:\n  - rag\n  - "vector search"\n  - 検索\nother: 1\n---\nbody';

		expect(readFrontMatterTags(text)).toEqual(["rag", "vector search", "検索"]);
	});

	it("reads only tags and ignores every other key", () => {
		expect(readFrontMatterTags("---\ncategories: [x]\ntags: [y]\n---\n")).toEqual(["y"]);
	});

	it("drops empty items and duplicates", () => {
		expect(readFrontMatterTags("---\ntags: [a, , a, b]\n---\n")).toEqual(["a", "b"]);
	});

	it("returns an empty list for malformed shapes", () => {
		expect(readFrontMatterTags("---\ntags: just-a-scalar\n---\n")).toEqual([]);
		expect(readFrontMatterTags("---\ntags: 42\n---\n")).toEqual([]);
		expect(readFrontMatterTags("---\ntags: [a, [b]]\n---\n")).toEqual([]);
		expect(readFrontMatterTags("---\ntags: [unterminated\n---\n")).toEqual([]);
		expect(readFrontMatterTags("---\ntags: {a: 1}\n---\n")).toEqual([]);
		expect(readFrontMatterTags("---\ntags:\n  key: value\n---\n")).toEqual([]);
		expect(readFrontMatterTags("---\ntags:\n---\n")).toEqual([]);
	});

	it("ignores a tags key that sits outside the front matter", () => {
		expect(readFrontMatterTags("# Title\n\ntags: [a]\n")).toEqual([]);
		expect(readFrontMatterTags("---\ntitle: x\n---\ntags: [a]\n")).toEqual([]);
	});

	it("ignores an unclosed front matter block", () => {
		expect(readFrontMatterTags("---\ntags: [a]\n# Title")).toEqual([]);
	});

	it("handles CRLF line endings and a leading BOM", () => {
		expect(readFrontMatterTags("﻿---\r\ntags: [a, b]\r\n---\r\nbody")).toEqual(["a", "b"]);
	});
});
