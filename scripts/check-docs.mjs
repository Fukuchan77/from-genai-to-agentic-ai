import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { runIfMain } from "./lib/cli.mjs";

const MODULES_DIRECTORY = path.join("docs", "modules");
const PHASES_DIRECTORY = path.join("docs", "phases");
const MODULE_FILE = /^(\d-\d)-.+\.md$/u;
const PHASE_FILE = /^phase-\d+\.md$/u;
const TEST_MARKER = /<!--\s*test:\s*(.*?)\s*-->/gu;
const TEST_CALL =
	/\b(?:describe|it|test|describeLocal|itLocal)(?:\.(?:skip|only|todo|concurrent|sequential|fails))*\(\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/gu;

const HANDS_ON = "ハンズオン手順";
const CHECKLIST = "習熟度判定チェックリスト";
const COMPARISON = "元教材との対照表";
const PYTHON_COLUMN = "Python / Streamlit 経験者向けコラム";
const GIVEN_UP_COLUMN = "移植で諦めたもの";

/** Sections every module document carries (plan C22). The Python column is Phase 1 only (Req 7.10). */
const REQUIRED_SECTIONS = [
	"学習目標",
	"主要トピック",
	HANDS_ON,
	CHECKLIST,
	"リファレンス実装とテストの所在",
	COMPARISON,
	"移植時の変更点",
	"完成時点のタグ",
];

/**
 * Required topic headings per module (Req 7.9 table; for 1-0 also the Req 7.8 contents). A heading
 * at any level must contain the topic text, so a document cannot satisfy a topic by a passing
 * mention in prose.
 */
export const REQUIRED_TOPICS = Object.freeze({
	"1-0": [
		"7段階閉ループ",
		"「テキストの生成」から「状態の変更」へ",
		"LLM は認知・計画エンジン",
		"IBM の3段階成熟度モデル",
		"生成AIとの比較マトリクス",
		"7段階とモジュールの対応表",
	],
	"1-1": [
		"Streamlit の全行再実行モデルと App Router の差分ストリーミング",
		"Server / Client Components の境界",
		"API キーのサーバー側実行",
	],
	"1-2": [
		"ロール設計（system / user / assistant / tool）",
		"テンプレートによるプロンプト構築",
		"Few-shot / CoT",
		"推論モデルが計画に与えた影響",
		"LangChain AgentExecutor と `ToolLoopAgent` の対比",
	],
	"1-3": ["Map-Reduce が不要になった理由と分割が必要な境界", "プロンプトキャッシュの原理とコスト"],
	"2-3": ["ワークフローとエージェントの峻別", "5パターンの利点とトレードオフ"],
	"2-4": [
		"18 パターンの体系",
		"LangGraph のグラフ定義で書く場合と TypeScript の関数で書く場合の比較",
	],
	"3-1": [
		"ACI の失敗の多くはモデルではなくツール定義に起因する",
		"Ground Truth に基づく進行",
		"エージェント設計の3原則",
	],
	"4-1": ["システムプロンプトの適正高度", "Context Rot と注意バジェット"],
	"4-3": ["評価は 20〜50 問の実失敗から始める", "グレーダー3種の選定基準", "過剰トリガー防止"],
	"4-4": ["ブラスト半径"],
});

/** Test names that `describe` / `it` / `test` (and the local variants) declare with a literal. */
export function extractTestNames(source) {
	const names = new Set();
	for (const match of source.matchAll(TEST_CALL)) {
		const name = match[2];
		// A template literal with interpolation is a dynamic name that cannot be referenced.
		if (match[1] === "`" && name.includes("${")) continue;
		names.add(name);
	}
	return names;
}

function parseHeadings(text) {
	const lines = text.split("\n");
	const headings = [];
	let inFence = false;
	for (const [index, line] of lines.entries()) {
		if (/^\s*```/u.test(line)) inFence = !inFence;
		const match = inFence ? null : /^(#{1,6})\s+(.+?)\s*$/u.exec(line);
		if (match) headings.push({ level: match[1].length, title: match[2], line: index });
	}
	return { lines, headings };
}

/** The body of the first heading whose title contains `keyword`, with its sub-headings. */
function sectionOf({ lines, headings }, keyword) {
	const position = headings.findIndex((heading) => heading.title.includes(keyword));
	if (position === -1) return undefined;
	const { level, line } = headings[position];
	const next = headings.slice(position + 1).find((heading) => heading.level <= level);
	return {
		body: lines.slice(line + 1, next ? next.line : lines.length).join("\n"),
		level,
		position,
	};
}

function checkHandsOn(parsed, section) {
	const { lines, headings } = parsed;
	const steps = [];
	for (let index = section.position + 1; index < headings.length; index += 1) {
		const heading = headings[index];
		if (heading.level <= section.level) break;
		if (!heading.title.startsWith("手順")) continue;
		const following = headings[index + 1];
		steps.push({
			title: heading.title,
			body: lines.slice(heading.line + 1, following ? following.line : lines.length).join("\n"),
		});
	}
	if (steps.length === 0) return ["no hands-on step (### 手順 N)"];
	const problems = [];
	for (const step of steps) {
		for (const label of ["実行モード", "外部サービス"]) {
			if (!new RegExp(`${label}(?:\\*\\*)?\\s*[:：]`, "u").test(step.body)) {
				problems.push(`hands-on step '${step.title}' lacks ${label}`);
			}
		}
	}
	return problems;
}

/** Structural problems of one module document: sections, topic headings, step labels, table column. */
export function checkModuleDoc({ id, text }) {
	const parsed = parseHeadings(text);
	const problems = [];
	const required = id.startsWith("1-") ? [...REQUIRED_SECTIONS, PYTHON_COLUMN] : REQUIRED_SECTIONS;
	for (const keyword of required) {
		if (!sectionOf(parsed, keyword)) problems.push(`missing section: ${keyword}`);
	}
	for (const topic of REQUIRED_TOPICS[id] ?? []) {
		if (!parsed.headings.some((heading) => heading.title.includes(topic))) {
			problems.push(`missing topic heading: ${topic}`);
		}
	}
	const handsOn = sectionOf(parsed, HANDS_ON);
	if (handsOn) problems.push(...checkHandsOn(parsed, handsOn));
	const comparison = sectionOf(parsed, COMPARISON);
	if (comparison && !/^\s*\|.*移植で諦めたもの.*\|/mu.test(comparison.body)) {
		problems.push(`comparison table lacks the ${GIVEN_UP_COLUMN} column`);
	}
	return problems;
}

function checklistReferences(text) {
	const section = sectionOf(parseHeadings(text), CHECKLIST);
	if (!section) return [];
	return [...section.body.matchAll(TEST_MARKER)].map((match) => match[1]);
}

function checkReference({ root, reference, cache }) {
	const hash = reference.indexOf("#");
	if (hash <= 0 || hash === reference.length - 1) {
		return `malformed test reference '${reference}' (expected path#name)`;
	}
	const relative = reference.slice(0, hash);
	const name = reference.slice(hash + 1);
	const resolved = path.resolve(root, relative);
	if (path.relative(root, resolved).startsWith("..")) {
		return `test reference leaves the repository: ${relative}`;
	}
	if (!existsSync(resolved)) return `test file not found: ${relative}`;
	if (!cache.has(resolved)) cache.set(resolved, extractTestNames(readFileSync(resolved, "utf8")));
	if (!cache.get(resolved).has(name)) return `no test named '${name}' in ${relative}`;
	return undefined;
}

function listFiles(directory, pattern) {
	if (!existsSync(directory)) return [];
	return readdirSync(directory, { withFileTypes: true })
		.filter((entry) => entry.isFile() && pattern.test(entry.name))
		.map((entry) => entry.name)
		.sort();
}

/**
 * Checks every module document under `docs/modules` and phase document under `docs/phases`.
 * Zero module documents or zero verified references is itself a problem, so an empty scan cannot
 * pass (Req 7.6).
 */
export function inspectDocs(root) {
	const problems = [];
	const cache = new Map();
	const modulesDirectory = path.join(root, MODULES_DIRECTORY);
	const moduleFiles = listFiles(modulesDirectory, MODULE_FILE);
	let references = 0;
	for (const file of moduleFiles) {
		const id = MODULE_FILE.exec(file)[1];
		const text = readFileSync(path.join(modulesDirectory, file), "utf8");
		for (const problem of checkModuleDoc({ id, text })) problems.push(`${file}: ${problem}`);
		for (const reference of checklistReferences(text)) {
			references += 1;
			const problem = checkReference({ root, reference, cache });
			if (problem) problems.push(`${file}: ${problem}`);
		}
	}
	if (moduleFiles.length === 0) {
		problems.push(`scanned 0 module documents in ${MODULES_DIRECTORY.replaceAll(path.sep, "/")}`);
	} else if (references === 0) {
		problems.push("scanned 0 test references in the checklists");
	}
	const phasesDirectory = path.join(root, PHASES_DIRECTORY);
	for (const file of listFiles(phasesDirectory, PHASE_FILE)) {
		const text = readFileSync(path.join(phasesDirectory, file), "utf8");
		if (!text.includes("成熟度")) {
			problems.push(`${file}: must state the IBM maturity-model level (成熟度)`);
		}
	}
	return { modules: moduleFiles.length, references, problems };
}

function readRoot(argv) {
	let root;
	for (let index = 0; index < argv.length; index += 2) {
		const flag = argv[index];
		const value = argv[index + 1];
		if (flag !== "--root") throw new Error(`unknown option ${flag}`);
		if (value === undefined || value === "") throw new Error(`${flag} needs a value`);
		root = value;
	}
	return root;
}

export function main({ argv, cwd, stdout, stderr }) {
	try {
		const root = path.resolve(cwd, readRoot(argv) ?? ".");
		const { modules, references, problems } = inspectDocs(root);
		if (problems.length > 0) {
			stderr.write(`check-docs: ${problems.length} problem(s):\n${problems.join("\n")}\n`);
			return 1;
		}
		stdout.write(`Docs: ${modules} module documents, ${references} test references verified\n`);
		return 0;
	} catch (error) {
		stderr.write(`check-docs: ${error instanceof Error ? error.message : String(error)}\n`);
		return 1;
	}
}

await runIfMain(import.meta.url, main);
