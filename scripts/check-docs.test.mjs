import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	checkModuleDoc,
	extractTestNames,
	inspectDocs,
	main,
	REQUIRED_TOPICS,
} from "./check-docs.mjs";
import { memoryIo } from "./lib/memory-io.mjs";

const TEST_FILE = "packages/demo/src/demo.test.ts";
const TEST_SOURCE = `
describe("demo suite", () => {
	it("keeps the stop reason", () => {});
	test('single quoted name', () => {});
	itLocal("needs a local model", () => {});
	it.skip("is skipped but named", () => {});
	it.each([1, 2])("dynamic case %i", () => {});
	it(\`template \${name}\`, () => {});
});
`;

function topicHeadings(id) {
	return (REQUIRED_TOPICS[id] ?? []).map((topic) => `## ${topic}\n\n本文。\n`).join("\n");
}

/** A document that satisfies every rule; tests break one rule at a time. */
function validDoc({ id = "1-2", refs = [`${TEST_FILE}#keeps the stop reason`] } = {}) {
	const checklist = refs.map((ref) => `- [ ] 項目 <!-- test: ${ref} -->`).join("\n");
	return `# モジュール ${id}

## 学習目標

目標。

## 主要トピック

${topicHeadings(id)}
## ハンズオン手順

### 手順 1: 起動する

- 実行モード: mock
- 外部サービス: なし

## 習熟度判定チェックリスト

${checklist}
- [ ] 手で確認する項目

## リファレンス実装とテストの所在

所在。

## 元教材との対照表

| 元教材 | TypeScript 版 | 移植で諦めたもの |
|---|---|---|
| A | B | C |

## 移植時の変更点

変更。

## Python / Streamlit 経験者向けコラム

コラム。

## 完成時点のタグ

\`module/${id}\`
`;
}

let root;

beforeEach(() => {
	root = mkdtempSync(path.join(tmpdir(), "check-docs-"));
	mkdirSync(path.join(root, "docs", "modules"), { recursive: true });
	mkdirSync(path.join(root, "docs", "phases"), { recursive: true });
	mkdirSync(path.join(root, path.dirname(TEST_FILE)), { recursive: true });
	writeFileSync(path.join(root, TEST_FILE), TEST_SOURCE);
	writeFileSync(
		path.join(root, "docs", "phases", "phase-1.md"),
		"# Phase 1\n\nIBM の成熟度モデル。\n",
	);
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

function writeModule(name, text) {
	writeFileSync(path.join(root, "docs", "modules", name), text);
}

function run(argv = []) {
	const io = memoryIo({ argv: ["--root", root, ...argv], cwd: root });
	return { code: main(io), io };
}

describe("extractTestNames", () => {
	it("reads the first string literal of describe, it, test and the local variants", () => {
		expect([...extractTestNames(TEST_SOURCE)].sort()).toEqual([
			"demo suite",
			"keeps the stop reason",
			"needs a local model",
			"single quoted name",
		]);
	});

	it("never names a test that does not run: skip, only, todo, fails", () => {
		const names = extractTestNames(`
it.skip("skipped", () => {});
it.only("focused", () => {});
it.todo("planned only");
it.fails("expected to fail", () => {});
describe.skip("skipped suite", () => {});
describe.concurrent("concurrent suite", () => {});
test.sequential("sequential case", () => {});
`);

		expect([...names].sort()).toEqual(["concurrent suite", "sequential case"]);
	});

	it("ignores .test(...) calls that are not test declarations", () => {
		const names = extractTestNames(`
if (PATTERN.test("not a test")) {}
const ok = schema.it("not a test either");
it("real test", () => {});
`);

		expect([...names]).toEqual(["real test"]);
	});

	it("cannot name tests built with it.each or a template literal", () => {
		const names = extractTestNames(TEST_SOURCE);

		expect(names.has("dynamic case %i")).toBe(false);
		expect(names.has(`template ${"$"}{name}`)).toBe(false);
	});
});

describe("checkModuleDoc", () => {
	it("accepts a document with every required section, topic and step label", () => {
		expect(checkModuleDoc({ id: "1-2", text: validDoc() })).toEqual([]);
	});

	it("reports a missing required section by name", () => {
		const text = validDoc().replace("## 移植時の変更点", "## 別の見出し");

		expect(checkModuleDoc({ id: "1-2", text })).toEqual(["missing section: 移植時の変更点"]);
	});

	it("reports each missing required topic heading of the module", () => {
		const topic = REQUIRED_TOPICS["1-2"][0];
		const text = validDoc().replace(`## ${topic}`, "## 別の話題");

		expect(checkModuleDoc({ id: "1-2", text })).toEqual([`missing topic heading: ${topic}`]);
	});

	it.each(["2-1", "2-2"])(
		"requires module %s to explain what a green mock run cannot show",
		(id) => {
			const topics = REQUIRED_TOPICS[id];

			expect(topics.length).toBeGreaterThan(0);
			expect(topics.some((topic) => topic.includes("mock"))).toBe(true);
			expect(topics.some((topic) => topic.includes("日本語の埋め込みでの閾値の限界"))).toBe(true);
			expect(checkModuleDoc({ id, text: validDoc({ id }) })).toEqual([]);
		},
	);

	it.each(["2-1", "2-2"])("reports each missing required topic heading of module %s", (id) => {
		for (const topic of REQUIRED_TOPICS[id]) {
			const text = validDoc({ id }).replace(`## ${topic}`, "## 別の話題");

			expect(checkModuleDoc({ id, text }), topic).toEqual([`missing topic heading: ${topic}`]);
		}
	});

	it("keeps the Phase 2 topics defined for all four modules", () => {
		for (const id of ["2-1", "2-2", "2-3", "2-4"]) {
			expect(Object.keys(REQUIRED_TOPICS), id).toContain(id);
		}
	});

	it("requires the Python / Streamlit column only in Phase 1 modules", () => {
		const without = validDoc({ id: "2-3" }).replace(
			"## Python / Streamlit 経験者向けコラム",
			"## 別",
		);

		expect(checkModuleDoc({ id: "1-2", text: without })).toContain(
			"missing section: Python / Streamlit 経験者向けコラム",
		);
		expect(checkModuleDoc({ id: "2-3", text: without })).toEqual([]);
	});

	it("requires each hands-on step to state its run mode and external service", () => {
		const text = validDoc().replace("- 外部サービス: なし\n", "");

		expect(checkModuleDoc({ id: "1-2", text })).toEqual([
			"hands-on step '手順 1: 起動する' lacks 外部サービス",
		]);
	});

	it("requires at least one hands-on step", () => {
		const text = validDoc().replace("### 手順 1: 起動する", "### 準備");

		expect(checkModuleDoc({ id: "1-2", text })).toEqual(["no hands-on step (### 手順 N)"]);
	});

	it("requires the 'given up in the port' column in the comparison table", () => {
		const text = validDoc().replace("移植で諦めたもの", "備考");

		expect(checkModuleDoc({ id: "1-2", text })).toEqual([
			"comparison table lacks the 移植で諦めたもの column",
		]);
	});
});

describe("inspectDocs", () => {
	it("counts documents and verified test references", () => {
		writeModule("1-2-demo.md", validDoc());

		const result = inspectDocs(root);

		expect(result.problems).toEqual([]);
		expect(result.modules).toBe(1);
		expect(result.references).toBe(1);
	});

	it("fails when a reference points to a missing file", () => {
		writeModule("1-2-demo.md", validDoc({ refs: ["packages/demo/src/gone.test.ts#x"] }));

		expect(inspectDocs(root).problems).toEqual([
			"1-2-demo.md: test file not found: packages/demo/src/gone.test.ts",
		]);
	});

	it("fails when the file exists but has no test with that literal name", () => {
		writeModule("1-2-demo.md", validDoc({ refs: [`${TEST_FILE}#dynamic case %i`] }));

		expect(inspectDocs(root).problems).toEqual([
			`1-2-demo.md: no test named 'dynamic case %i' in ${TEST_FILE}`,
		]);
	});

	it("fails on a marker that is not path#name", () => {
		writeModule("1-2-demo.md", validDoc({ refs: ["no-hash-here"] }));

		expect(inspectDocs(root).problems).toEqual([
			"1-2-demo.md: malformed test reference 'no-hash-here' (expected path#name)",
		]);
	});

	it("rejects a reference that escapes the repository root", () => {
		writeModule("1-2-demo.md", validDoc({ refs: ["../outside.test.ts#x"] }));

		expect(inspectDocs(root).problems).toEqual([
			"1-2-demo.md: test reference leaves the repository: ../outside.test.ts",
		]);
	});

	it("only reads references from the proficiency checklist", () => {
		writeModule(
			"1-2-demo.md",
			`${validDoc()}\n<!-- test: packages/demo/src/gone.test.ts#elsewhere -->\n`.replace(
				"## 完成時点のタグ",
				"## 完成時点のタグ\n\n<!-- test: packages/demo/src/gone.test.ts#elsewhere -->",
			),
		);

		expect(inspectDocs(root).problems).toEqual([]);
	});

	it("ignores the template and the index, which are not module documents", () => {
		writeModule("_template.md", "# template\n");
		writeModule("index.md", "# index\n");
		writeModule("1-2-demo.md", validDoc());

		expect(inspectDocs(root).modules).toBe(1);
	});

	it("fails when no module document was scanned", () => {
		expect(inspectDocs(root).problems).toEqual(["scanned 0 module documents in docs/modules"]);
	});

	it("fails when module documents carry no test reference at all", () => {
		writeModule("1-2-demo.md", validDoc({ refs: [] }));

		expect(inspectDocs(root).problems).toEqual(["scanned 0 test references in the checklists"]);
	});

	it("requires a phase document to state the IBM maturity level", () => {
		writeModule("1-2-demo.md", validDoc());
		writeFileSync(path.join(root, "docs", "phases", "phase-1.md"), "# Phase 1\n");

		expect(inspectDocs(root).problems).toEqual([
			"phase-1.md: must state the IBM maturity-model level (成熟度)",
		]);
	});
});

describe("check-docs", () => {
	it("exits 0 and reports the scan size for valid documents", () => {
		writeModule("1-2-demo.md", validDoc());

		const { code, io } = run();

		expect(code).toBe(0);
		expect(io.stdoutText()).toBe("Docs: 1 module documents, 1 test references verified\n");
	});

	it("exits 1 and lists every problem on stderr", () => {
		writeModule("1-2-demo.md", validDoc().replace("## 完成時点のタグ", "## 別"));

		const { code, io } = run();

		expect(code).toBe(1);
		expect(io.stderrText()).toContain("1-2-demo.md: missing section: 完成時点のタグ");
	});

	it("rejects unknown options", () => {
		const { code, io } = run(["--bogus", "x"]);

		expect(code).toBe(1);
		expect(io.stderrText()).toContain("unknown option --bogus");
	});
});
