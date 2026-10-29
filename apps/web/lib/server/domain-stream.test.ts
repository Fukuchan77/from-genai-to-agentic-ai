import type { AnalysisEvent, AnalysisResult } from "@platform/ai-core/analysis";
import type { HelpdeskEvent } from "@platform/ai-core/helpdesk";
import type {
	CouncilResult,
	CouncilTurnEvent,
	Profile,
	RecommendResult,
} from "@platform/ai-core/marketing";
import type { Requirements, SufficiencyVerdict } from "@platform/ai-core/requirements";
import type { ResearchEvent, ResearchResult, ResearchUsage } from "@platform/ai-core/research";
import { describe, expect, it } from "vitest";
import {
	createAnalysisStreamer,
	createCouncilStreamer,
	createHelpdeskStreamer,
	createResearchStreamer,
	MAX_COUNCIL_TEXT_CHARACTERS,
	writeAnalysisResult,
	writeCouncilResult,
	writeCouncilVerdict,
	writeMarketingProfile,
	writeMarketingRecommendation,
	writeRequirementsJudgement,
	writeRequirementsPreview,
	writeRequirementsQuestions,
	writeResearchResult,
	writeResearchUsage,
} from "./domain-stream";

type Part = { type: string; [key: string]: unknown };

function collector() {
	const parts: Part[] = [];
	return { parts, writer: { write: (part: Part) => void parts.push(part) } };
}

// An obviously fake value that must never reach a part; assembled so no secret scanner matches it.
const FAKE_PASSWORD = ["Fake", "Pw", "0001"].join("-");

const PLAN_EVENT: HelpdeskEvent = {
	type: "plan",
	revision: 0,
	tasks: [
		{ id: "t1", description: "検索", dependsOn: [], state: "running" },
		{ id: "t2", description: "回答", dependsOn: ["t1"], state: "pending" },
	],
};

describe("createHelpdeskStreamer: state parts (overwritten by id)", () => {
	it("writes the plan as data-helpdesk-plan with id `plan`, and every later plan overwrites it", () => {
		const { parts, writer } = collector();
		const write = createHelpdeskStreamer(writer);

		write(PLAN_EVENT);
		write({ ...PLAN_EVENT, revision: 1, diff: { added: ["t3"], removed: [], changed: ["t2"] } });

		expect(parts).toEqual([
			{
				type: "data-helpdesk-plan",
				id: "plan",
				data: { revision: 0, tasks: PLAN_EVENT.type === "plan" ? PLAN_EVENT.tasks : [] },
			},
			{
				type: "data-helpdesk-plan",
				id: "plan",
				data: {
					revision: 1,
					tasks: PLAN_EVENT.type === "plan" ? PLAN_EVENT.tasks : [],
					diff: { added: ["t3"], removed: [], changed: ["t2"] },
				},
			},
		]);
	});

	it("writes progress as data-helpdesk-progress with id `progress`, leaving out what is not set", () => {
		const { parts, writer } = collector();
		const write = createHelpdeskStreamer(writer);

		write({ type: "progress", stepsUsed: 1, maxSteps: 12 });
		write({
			type: "progress",
			stepsUsed: 2,
			maxSteps: 12,
			current: "t2",
			decision: { decision: "continue", reason: "計画どおり" },
		});

		expect(parts).toEqual([
			{ type: "data-helpdesk-progress", id: "progress", data: { stepsUsed: 1, maxSteps: 12 } },
			{
				type: "data-helpdesk-progress",
				id: "progress",
				data: {
					stepsUsed: 2,
					maxSteps: 12,
					current: "t2",
					decision: { decision: "continue", reason: "計画どおり" },
				},
			},
		]);
		expect(Object.keys((parts[0]?.data ?? {}) as object)).not.toContain("current");
	});
});

describe("createHelpdeskStreamer: events (appended with a running number)", () => {
	it("writes each result as data-helpdesk-result with its own id", () => {
		const { parts, writer } = collector();
		const write = createHelpdeskStreamer(writer);

		write({ type: "result", ticketId: "T-0001", status: "resolved", answer: "回答" });
		write({ type: "result", ticketId: "T-0002", status: "open", remaining: ["t3"] });

		expect(parts.map((part) => [part.type, part.id])).toEqual([
			["data-helpdesk-result", "result-1"],
			["data-helpdesk-result", "result-2"],
		]);
		expect(parts[0]?.data).toEqual({ ticketId: "T-0001", status: "resolved", answer: "回答" });
		expect(parts[1]?.data).toEqual({ ticketId: "T-0002", status: "open", remaining: ["t3"] });
	});

	it("starts a new numbering for each streamer", () => {
		const first = collector();
		const second = collector();
		createHelpdeskStreamer(first.writer)({
			type: "result",
			ticketId: "T-0001",
			status: "escalated",
			reason: "r",
		});
		createHelpdeskStreamer(second.writer)({
			type: "result",
			ticketId: "T-0002",
			status: "escalated",
			reason: "r",
		});

		expect(first.parts[0]?.id).toBe("result-1");
		expect(second.parts[0]?.id).toBe("result-1");
	});
});

describe("createHelpdeskStreamer: credential kinds carry no value (Req 2.8)", () => {
	it("passes the kinds of the closed vocabulary", () => {
		const { parts, writer } = collector();

		createHelpdeskStreamer(writer)({
			type: "result",
			ticketId: "T-0001",
			status: "escalated",
			reason: "r",
			credentialKinds: ["plaintext-password", "api-key"],
		});

		const data = parts[0]?.data as { credentialKinds?: string[] } | undefined;
		expect(data?.credentialKinds).toEqual(["plaintext-password", "api-key"]);
	});

	it("drops anything outside the vocabulary, so a value cannot ride along as a kind", () => {
		const { parts, writer } = collector();

		createHelpdeskStreamer(writer)({
			type: "result",
			ticketId: "T-0001",
			status: "escalated",
			reason: "r",
			credentialKinds: ["plaintext-password", FAKE_PASSWORD] as never,
		});

		const data = parts[0]?.data as { credentialKinds?: string[] };
		expect(data.credentialKinds).toEqual(["plaintext-password"]);
		expect(JSON.stringify(parts)).not.toContain(FAKE_PASSWORD);
	});

	it("omits credentialKinds when nothing in it is a kind", () => {
		const { parts, writer } = collector();

		createHelpdeskStreamer(writer)({
			type: "result",
			ticketId: "T-0001",
			status: "escalated",
			reason: "r",
			credentialKinds: [FAKE_PASSWORD] as never,
		});

		expect(Object.keys(parts[0]?.data as object)).not.toContain("credentialKinds");
	});

	it("forwards only the fields of the event, not extra properties an event might carry", () => {
		const { parts, writer } = collector();

		createHelpdeskStreamer(writer)({
			type: "result",
			ticketId: "T-0001",
			status: "resolved",
			answer: "回答",
			rawAnswerDraft: FAKE_PASSWORD,
		} as never);

		expect(JSON.stringify(parts)).not.toContain(FAKE_PASSWORD);
	});
});

describe("createHelpdeskStreamer: timing (Req 2.5)", () => {
	it("writes the part before the call returns, so a state change reaches the client at once", () => {
		const { parts, writer } = collector();
		const write = createHelpdeskStreamer(writer);

		write(PLAN_EVENT);

		expect(parts).toHaveLength(1);
	});
});

// --- Data analysis (plan C13, Req 3.5, 3.6) ---

const PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const figure = (alt = "売上のグラフ", base64 = PNG_BASE64) => ({
	alt,
	mediaType: "image/png" as const,
	base64,
});
const table = (rows: number, totalRows = rows) => ({
	caption: "月別売上",
	columns: ["month", "sales"],
	rows: Array.from({ length: rows }, (_, index) => [`2026-${index}`, index] as [string, number]),
	totalRows,
});
const attempt = (index: number, extra: Record<string, unknown> = {}): AnalysisEvent => ({
	type: "attempt",
	fixes: Math.max(0, index - 1),
	attempt: { index, code: `code ${index}`, stdout: `out ${index}`, stderr: "", ...extra },
});

describe("createAnalysisStreamer", () => {
	it("writes attempts in order as data-analysis-attempt events with running ids", () => {
		const { parts, writer } = collector();
		const write = createAnalysisStreamer(writer);

		write(attempt(1, { stderr: "KeyError", errorSummary: "KeyError: 'x'" }));
		write(attempt(2));

		expect(parts).toEqual([
			{
				type: "data-analysis-attempt",
				id: "attempt-1",
				data: {
					index: 1,
					code: "code 1",
					stdout: "out 1",
					stderr: "KeyError",
					errorSummary: "KeyError: 'x'",
				},
			},
			{
				type: "data-analysis-attempt",
				id: "attempt-2",
				data: { index: 2, code: "code 2", stdout: "out 2", stderr: "" },
			},
		]);
	});

	it("writes a figure and a table with their own running ids", () => {
		const { parts, writer } = collector();
		const write = createAnalysisStreamer(writer);

		write({ type: "figure", figure: figure("一枚目") });
		write({ type: "figure", figure: figure("二枚目") });
		write({ type: "table", table: table(2) });

		expect(parts.map((part) => [part.type, part.id])).toEqual([
			["data-analysis-figure", "figure-1"],
			["data-analysis-figure", "figure-2"],
			["data-analysis-table", "table-1"],
		]);
		expect(parts[0]).toMatchObject({
			data: { alt: "一枚目", mediaType: "image/png", base64: PNG_BASE64 },
		});
		expect(parts[2]).toMatchObject({ data: { caption: "月別売上", totalRows: 2 } });
	});

	it("does not stream a figure without an alt, with an alt over 200 characters, or that is not a PNG", () => {
		const { parts, writer } = collector();
		const write = createAnalysisStreamer(writer);

		write({ type: "figure", figure: figure("") });
		write({ type: "figure", figure: figure("   ") });
		write({ type: "figure", figure: figure("あ".repeat(201)) });
		write({ type: "figure", figure: { ...figure(), mediaType: "image/svg+xml" as never } });

		expect(parts).toEqual([]);
	});

	it("streams a figure whose alt is exactly 200 characters", () => {
		const { parts, writer } = collector();

		createAnalysisStreamer(writer)({ type: "figure", figure: figure("あ".repeat(200)) });

		expect(parts).toHaveLength(1);
	});

	it("streams a figure of exactly 1 MiB and drops one byte more", () => {
		const { parts, writer } = collector();
		const write = createAnalysisStreamer(writer);
		const encode = (bytes: number) => Buffer.alloc(bytes, 1).toString("base64");

		write({ type: "figure", figure: figure("ちょうど", encode(1024 * 1024)) });
		write({ type: "figure", figure: figure("超過", encode(1024 * 1024 + 1)) });

		expect(parts.map((part) => (part.data as { alt: string }).alt)).toEqual(["ちょうど"]);
	});

	it("cuts a table to 200 rows and keeps the real row count", () => {
		const { parts, writer } = collector();
		const write = createAnalysisStreamer(writer);

		write({ type: "table", table: table(250, 250) });
		write({ type: "table", table: table(200, 200) });

		const first = parts[0]?.data as { rows: unknown[]; totalRows: number };
		const second = parts[1]?.data as { rows: unknown[]; totalRows: number };
		expect(first.rows).toHaveLength(200);
		expect(first.totalRows).toBe(250);
		expect(second.rows).toHaveLength(200);
	});

	it("copies fields by name, so an extra field on an event never reaches the stream", () => {
		const { parts, writer } = collector();
		const write = createAnalysisStreamer(writer);

		write({ type: "figure", figure: { ...figure(), secret: "x" } as never });
		write({ type: "table", table: { ...table(1), secret: "x" } as never });
		write(attempt(1, { secret: "x", fixes: 9 }));

		expect(JSON.stringify(parts)).not.toContain("secret");
	});

	it("tells the learner which figures or tables were dropped", () => {
		const { parts, writer } = collector();
		const write = createAnalysisStreamer(writer);

		write({ type: "rejected", reasons: ["図「a」を表示できません: PNG 画像ではありません。"] });
		write({ type: "rejected", reasons: ["表を表示できません: 行の形式が不正です。"] });

		expect(parts).toEqual([
			{
				type: "data-analysis-notice",
				id: "notice-1",
				data: { reasons: ["図「a」を表示できません: PNG 画像ではありません。"] },
			},
			{
				type: "data-analysis-notice",
				id: "notice-2",
				data: { reasons: ["表を表示できません: 行の形式が不正です。"] },
			},
		]);
	});
});

describe("writeAnalysisResult", () => {
	const result = (overrides: Partial<AnalysisResult> = {}): AnalysisResult => ({
		status: "succeeded",
		attempts: [
			{ index: 1, code: "a", stdout: "", stderr: "" },
			{ index: 2, code: "b", stdout: "", stderr: "" },
		],
		fixes: 1,
		figures: [],
		tables: [],
		text: "わかったこと",
		...overrides,
	});

	it("writes the status, the number of attempts and fixes, and the text", () => {
		const { parts, writer } = collector();

		writeAnalysisResult(writer, result());

		expect(parts).toEqual([
			{
				type: "data-analysis-result",
				id: "result",
				data: { status: "succeeded", attempts: 2, fixes: 1, text: "わかったこと" },
			},
		]);
	});

	it.each([
		"succeeded",
		"incomplete",
		"attempt-limit",
		"sandbox-unavailable",
		"unreadable",
		"stopped",
	] as const)("writes the status %s as it is", (status) => {
		const { parts, writer } = collector();

		writeAnalysisResult(writer, result({ status }));

		expect(parts[0]?.data).toMatchObject({ status });
	});

	it("does not stream the code or the figures again: the result is a summary", () => {
		const { parts, writer } = collector();

		writeAnalysisResult(writer, result({ figures: [figure()] }));

		expect(JSON.stringify(parts)).not.toContain(PNG_BASE64);
		expect(JSON.stringify(parts)).not.toContain('"code"');
	});
});

// --- Research (Req 4.2, 4.5, 4.6, 4.8-4.10) ---

describe("createResearchStreamer", () => {
	const card = {
		arxivId: "2401.01234",
		title: "Hierarchical Agents",
		authors: ["A. Author"],
		publishedAt: "2024-01-02",
		url: "https://arxiv.org/abs/2401.01234",
	};

	it("writes every event as data-research-event, numbered in order, with the agent and the kind", () => {
		const { parts, writer } = collector();
		const write = createResearchStreamer(writer);
		const events: ResearchEvent[] = [
			{ agent: "supervisor", kind: "call", detail: { callee: "search", task: "探す" } },
			{ agent: "search", kind: "tool", detail: { name: "searchArxiv", input: "agents" } },
			{ agent: "search", kind: "card", detail: card },
			{ agent: "search", kind: "summary", detail: { text: "2 件見つけた。" } },
			{ agent: "reading", kind: "error", detail: { reason: "ステップの上限" } },
			{ agent: "supervisor", kind: "summary", detail: { characters: 1200, missing: 1 } },
			{ agent: "market", kind: "summary", detail: { text: "影響は限定的。" } },
		];

		for (const event of events) write(event);

		expect(parts.map((part) => [part.type, part.id])).toEqual(
			events.map((_, index) => ["data-research-event", `event-${index + 1}`]),
		);
		expect(parts.map((part) => (part.data as { agent: string; kind: string }).agent)).toEqual(
			events.map((event) => event.agent),
		);
		expect(parts[0]?.data).toEqual({
			agent: "supervisor",
			kind: "call",
			detail: { callee: "search", task: "探す" },
		});
		expect(parts[2]?.data).toEqual({ agent: "search", kind: "card", detail: card });
		expect(parts[1]?.data).toEqual({
			agent: "search",
			kind: "tool",
			detail: { name: "searchArxiv", input: "agents" },
		});
		expect(parts[5]?.data).toEqual({
			agent: "supervisor",
			kind: "summary",
			detail: { characters: 1200, missing: 1 },
		});
		expect(parts[6]?.data).toEqual({
			agent: "market",
			kind: "summary",
			detail: { text: "影響は限定的。" },
		});
	});

	it("copies a detail by name, so an abstract or any other field never reaches the stream", () => {
		const { parts, writer } = collector();
		const write = createResearchStreamer(writer);

		write({
			agent: "search",
			kind: "card",
			detail: { ...card, abstract: "ABSTRACT-TEXT", secret: FAKE_PASSWORD },
		});
		write({
			agent: "reading",
			kind: "tool",
			detail: { name: "getPaperAbstract", input: "2401.01234", transcript: "INNER-TRANSCRIPT" },
		});

		const text = JSON.stringify(parts);
		expect(text).not.toContain("ABSTRACT-TEXT");
		expect(text).not.toContain(FAKE_PASSWORD);
		expect(text).not.toContain("INNER-TRANSCRIPT");
		expect(parts[0]?.data).toEqual({ agent: "search", kind: "card", detail: card });
	});

	it("leaves out a field of the wrong type instead of passing it on", () => {
		const { parts, writer } = collector();
		const write = createResearchStreamer(writer);

		write({
			agent: "search",
			kind: "card",
			detail: { ...card, authors: "not a list", title: { nested: true }, publishedAt: 5 },
		});
		write({
			agent: "search",
			kind: "card",
			detail: { ...card, authors: ["ok", 3, { x: 1 }] },
		});

		expect(parts[0]?.data).toEqual({
			agent: "search",
			kind: "card",
			detail: { arxivId: card.arxivId, url: card.url },
		});
		const second = parts[1]?.data as { detail: { authors: unknown } } | undefined;
		expect(second?.detail.authors).toEqual(["ok"]);
	});

	it("leaves out a number that arrives as text", () => {
		const { parts, writer } = collector();
		createResearchStreamer(writer)({
			agent: "supervisor",
			kind: "summary",
			detail: { characters: "1200", missing: 2 },
		});
		expect(parts[0]?.data).toEqual({
			agent: "supervisor",
			kind: "summary",
			detail: { missing: 2 },
		});
	});

	it("drops an event whose agent or kind is not in the vocabulary", () => {
		const { parts, writer } = collector();
		const write = createResearchStreamer(writer);

		write({ agent: "intruder", kind: "call", detail: {} } as unknown as ResearchEvent);
		write({ agent: "search", kind: "secret", detail: {} } as unknown as ResearchEvent);
		write({ agent: "search", kind: "summary", detail: { text: "ok" } });

		expect(parts).toHaveLength(1);
		expect(parts[0]?.id).toBe("event-1");
	});

	it("writes at once, so the event reaches the stream before the agent's next step", () => {
		const { parts, writer } = collector();
		createResearchStreamer(writer)({ agent: "search", kind: "summary", detail: { text: "x" } });
		expect(parts).toHaveLength(1);
	});

	it("keeps a separate count for each streamer", () => {
		const first = collector();
		const second = collector();
		createResearchStreamer(first.writer)({
			agent: "search",
			kind: "summary",
			detail: { text: "a" },
		});
		createResearchStreamer(second.writer)({
			agent: "search",
			kind: "summary",
			detail: { text: "b" },
		});
		expect(second.parts[0]?.id).toBe("event-1");
	});
});

describe("writeResearchUsage", () => {
	const usage: ResearchUsage = {
		usage: {
			byRole: {
				supervisor: {
					inputTokens: 600,
					outputTokens: 100,
					totalTokens: 700,
					calls: 4,
					unknownCalls: 0,
				},
				market: "unknown",
			},
			total: { inputTokens: 600, outputTokens: 100, totalTokens: 700 },
		},
		calls: 3,
		maxCalls: 8,
	};

	it("writes the breakdown and the call count as a state part with id `usage`", () => {
		const { parts, writer } = collector();
		writeResearchUsage(writer, usage);
		expect(parts).toEqual([
			{
				type: "data-research-usage",
				id: "usage",
				data: {
					byRole: {
						supervisor: {
							inputTokens: 600,
							outputTokens: 100,
							totalTokens: 700,
							calls: 4,
							unknownCalls: 0,
						},
						market: "unknown",
					},
					total: { inputTokens: 600, outputTokens: 100, totalTokens: 700 },
					calls: 3,
					maxCalls: 8,
				},
			},
		]);
	});

	it("writes under the same id every time, so the newest replaces the one before", () => {
		const { parts, writer } = collector();
		writeResearchUsage(writer, usage);
		writeResearchUsage(writer, { ...usage, calls: 4 });
		expect(parts.map((part) => part.id)).toEqual(["usage", "usage"]);
		const newest = parts[1]?.data as { calls: number } | undefined;
		expect(newest?.calls).toBe(4);
	});

	it("copies the fields by name", () => {
		const { parts, writer } = collector();
		writeResearchUsage(writer, {
			...usage,
			usage: {
				...usage.usage,
				byRole: {
					search: {
						inputTokens: 1,
						outputTokens: 2,
						totalTokens: 3,
						calls: 1,
						unknownCalls: 0,
						leaked: FAKE_PASSWORD,
					} as never,
				},
			},
		});
		expect(JSON.stringify(parts)).not.toContain(FAKE_PASSWORD);
	});
});

describe("writeResearchResult", () => {
	const result: ResearchResult = {
		report: "# レポート\n\n本文",
		warnings: ["警告 1"],
		missing: [{ agent: "reading", reason: "ステップの上限" }],
		usage: {
			byRole: {},
			total: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
		},
		calls: 3,
	};

	it("writes the checked report, the warnings and the gaps as data-research-result", () => {
		const { parts, writer } = collector();
		writeResearchResult(writer, result);
		expect(parts).toEqual([
			{
				type: "data-research-result",
				id: "result",
				data: {
					report: "# レポート\n\n本文",
					warnings: ["警告 1"],
					missing: [{ agent: "reading", reason: "ステップの上限" }],
				},
			},
		]);
	});

	it("copies a gap by name", () => {
		const { parts, writer } = collector();
		writeResearchResult(writer, {
			...result,
			missing: [{ agent: "reading", reason: "x", secret: FAKE_PASSWORD } as never],
		});
		expect(JSON.stringify(parts)).not.toContain(FAKE_PASSWORD);
	});

	it("leaves out the usage: the usage part holds it", () => {
		const { parts, writer } = collector();
		writeResearchResult(writer, result);
		expect(JSON.stringify(parts)).not.toContain("inputTokens");
	});
});

// --- Requirements (Req 5.3, 5.4) ---

describe("writeRequirementsPreview", () => {
	const requirements: Requirements = {
		functional: [{ text: "検索できる", personaId: "p1" }],
		nonFunctional: [],
		constraints: [{ text: "予算 100 万円", personaId: "p2" }],
		unconfirmed: [{ text: "「いつか」", personaId: "p1" }],
	};

	it("writes the requirements as a state part with id `preview`, each write replacing the one before", () => {
		const { parts, writer } = collector();
		writeRequirementsPreview(writer, requirements);
		writeRequirementsPreview(writer, { ...requirements, functional: [] });
		expect(parts.map((part) => [part.type, part.id])).toEqual([
			["data-requirements-preview", "preview"],
			["data-requirements-preview", "preview"],
		]);
		expect(parts[0]?.data).toEqual(requirements);
		expect((parts[1]?.data as { functional: unknown } | undefined)?.functional).toEqual([]);
	});

	it("copies every category and item by name", () => {
		const { parts, writer } = collector();
		writeRequirementsPreview(writer, {
			...requirements,
			functional: [{ text: "a", personaId: "p1", secret: FAKE_PASSWORD } as never],
			unconfirmed: [],
			extra: [{ text: FAKE_PASSWORD, personaId: "x" }],
		} as never);
		expect(JSON.stringify(parts)).not.toContain(FAKE_PASSWORD);
		expect(Object.keys(parts[0]?.data as object).sort()).toEqual([
			"constraints",
			"functional",
			"nonFunctional",
			"unconfirmed",
		]);
	});
});

describe("writeRequirementsJudgement", () => {
	const verdict: SufficiencyVerdict = { sufficient: false, missing: ["納期"], forcedEnd: true };

	it("writes the round and the verdict as an event part with a per-round id", () => {
		const { parts, writer } = collector();
		writeRequirementsJudgement(writer, 2, verdict);
		writeRequirementsJudgement(writer, 3, { sufficient: true, missing: [], forcedEnd: false });
		expect(parts).toEqual([
			{
				type: "data-requirements-judgement",
				id: "judgement-2",
				data: { round: 2, sufficient: false, missing: ["納期"], forcedEnd: true },
			},
			{
				type: "data-requirements-judgement",
				id: "judgement-3",
				data: { round: 3, sufficient: true, missing: [], forcedEnd: false },
			},
		]);
	});

	it("copies the verdict by name", () => {
		const { parts, writer } = collector();
		writeRequirementsJudgement(writer, 1, { ...verdict, leaked: FAKE_PASSWORD } as never);
		expect(JSON.stringify(parts)).not.toContain(FAKE_PASSWORD);
	});
});

describe("writeRequirementsQuestions", () => {
	const questions = [
		{ id: "q-1", personaId: "p-pm", text: "納期はいつですか。" },
		{ id: "q-2", personaId: "p-dev", text: "既存システムはありますか。" },
	];

	it("writes the round and the questions as an event part with a per-round id", () => {
		const { parts, writer } = collector();
		writeRequirementsQuestions(writer, 2, questions);
		writeRequirementsQuestions(writer, 3, [questions[0] as (typeof questions)[number]]);
		expect(parts).toEqual([
			{
				type: "data-requirements-questions",
				id: "questions-2",
				data: { round: 2, questions },
			},
			{
				type: "data-requirements-questions",
				id: "questions-3",
				data: { round: 3, questions: [questions[0]] },
			},
		]);
	});

	it("copies each question by name", () => {
		const { parts, writer } = collector();
		writeRequirementsQuestions(writer, 1, [{ ...questions[0], leaked: FAKE_PASSWORD } as never]);
		expect(JSON.stringify(parts)).not.toContain(FAKE_PASSWORD);
		const [part] = parts as [Part];
		expect((part.data as { questions: unknown[] }).questions[0]).toEqual(questions[0]);
	});

	it("clamps a question's text to the council limit in characters", () => {
		const { parts, writer } = collector();
		const long = (length: number) => ({ id: "q", personaId: "p", text: "あ".repeat(length) });
		writeRequirementsQuestions(writer, 1, [
			long(MAX_COUNCIL_TEXT_CHARACTERS),
			long(MAX_COUNCIL_TEXT_CHARACTERS + 1),
		]);
		const [part] = parts as [Part];
		const lengths = (part.data as { questions: { text: string }[] }).questions.map(
			(question) => [...question.text].length,
		);
		expect(lengths).toEqual([MAX_COUNCIL_TEXT_CHARACTERS, MAX_COUNCIL_TEXT_CHARACTERS]);
	});
});

// --- Marketing council (Req 6.2, 6.3) ---

const TURN: CouncilTurnEvent = {
	round: 1,
	personaId: "p-young",
	personaName: "20 代の会社員",
	text: "価格が気になります。",
	failed: false,
};

describe("createCouncilStreamer", () => {
	it("writes one data-council-turn part per statement, with the persona name", () => {
		const { parts, writer } = collector();
		const write = createCouncilStreamer(writer);
		write(TURN);
		write({ ...TURN, personaId: "p-senior", personaName: "シニア", text: "文字が小さい。" });
		expect(parts).toEqual([
			{
				type: "data-council-turn",
				id: "turn-1",
				data: {
					round: 1,
					personaId: "p-young",
					personaName: "20 代の会社員",
					text: "価格が気になります。",
					failed: false,
				},
			},
			{
				type: "data-council-turn",
				id: "turn-2",
				data: {
					round: 1,
					personaId: "p-senior",
					personaName: "シニア",
					text: "文字が小さい。",
					failed: false,
				},
			},
		]);
	});

	it("numbers the statements from 1 per streamer, across rounds", () => {
		const first = collector();
		const write = createCouncilStreamer(first.writer);
		write(TURN);
		write({ ...TURN, round: 2 });
		write({ ...TURN, round: 2, failed: true, text: "" });
		expect(first.parts.map((part) => part.id)).toEqual(["turn-1", "turn-2", "turn-3"]);
		expect(first.parts.map((part) => (part.data as { round: number } | undefined)?.round)).toEqual([
			1, 2, 2,
		]);
		expect((first.parts[2]?.data as { failed: boolean } | undefined)?.failed).toBe(true);
		const second = collector();
		createCouncilStreamer(second.writer)(TURN);
		expect(second.parts[0]?.id).toBe("turn-1");
	});

	it("copies the fields by name", () => {
		const { parts, writer } = collector();
		createCouncilStreamer(writer)({ ...TURN, secret: FAKE_PASSWORD } as never);
		expect(JSON.stringify(parts)).not.toContain(FAKE_PASSWORD);
	});

	it("cuts a statement at the limit and keeps one at the limit whole", () => {
		const { parts, writer } = collector();
		const write = createCouncilStreamer(writer);
		write({ ...TURN, text: "あ".repeat(MAX_COUNCIL_TEXT_CHARACTERS) });
		write({ ...TURN, text: "あ".repeat(MAX_COUNCIL_TEXT_CHARACTERS + 1) });
		const lengths = parts.map((part) => [...String((part.data as { text: string }).text)].length);
		expect(lengths).toEqual([MAX_COUNCIL_TEXT_CHARACTERS, MAX_COUNCIL_TEXT_CHARACTERS]);
	});
});

describe("writeCouncilVerdict", () => {
	it("writes the round's agreement verdict with its round, as an event part per round", () => {
		const { parts, writer } = collector();
		writeCouncilVerdict(writer, 2, {
			agreed: false,
			reason: "価格に異論",
			remainingObjections: ["高い"],
		});
		expect(parts).toEqual([
			{
				type: "data-council-verdict",
				id: "verdict-2",
				data: { round: 2, agreed: false, reason: "価格に異論", remainingObjections: ["高い"] },
			},
		]);
	});

	it("copies the verdict by name", () => {
		const { parts, writer } = collector();
		writeCouncilVerdict(writer, 1, {
			agreed: true,
			reason: "r",
			remainingObjections: [],
			usage: FAKE_PASSWORD,
		} as never);
		expect(JSON.stringify(parts)).not.toContain(FAKE_PASSWORD);
	});
});

describe("writeCouncilResult", () => {
	const result: CouncilResult = {
		improvedDraft: "改善後の文案",
		endReason: "max-rounds",
		rounds: [
			{
				round: 1,
				statements: [{ personaId: "p1", personaName: "A", text: "意見" }],
				missing: [{ personaId: "p2", personaName: "B", reason: "empty" }],
				verdict: { agreed: false, reason: "r", remainingObjections: ["x"] },
				draft: "途中の文案",
			},
			{ round: 2, statements: [], missing: [], draft: "最後" },
		],
		usage: {
			byRole: {
				p1: { inputTokens: 5, outputTokens: 2, totalTokens: 7, calls: 1, unknownCalls: 0 },
				moderator: "unknown",
			},
			total: { inputTokens: 5, outputTokens: 2, totalTokens: 7 },
		},
	};

	it("writes the draft, the end reason, a summary of the rounds and the usage", () => {
		const { parts, writer } = collector();
		writeCouncilResult(writer, result);
		expect(parts).toEqual([
			{
				type: "data-council-result",
				id: "result",
				data: {
					improvedDraft: "改善後の文案",
					endReason: "max-rounds",
					rounds: [
						{
							round: 1,
							statements: 1,
							missing: [{ personaId: "p2", personaName: "B", reason: "empty" }],
							verdict: { agreed: false, reason: "r", remainingObjections: ["x"] },
						},
						{ round: 2, statements: 0, missing: [] },
					],
					usage: {
						byRole: {
							p1: { inputTokens: 5, outputTokens: 2, totalTokens: 7, calls: 1, unknownCalls: 0 },
							moderator: "unknown",
						},
						total: { inputTokens: 5, outputTokens: 2, totalTokens: 7 },
					},
				},
			},
		]);
	});

	it("does not repeat the statements or the intermediate drafts", () => {
		const { parts, writer } = collector();
		writeCouncilResult(writer, result);
		const text = JSON.stringify(parts);
		expect(text).not.toContain("意見");
		expect(text).not.toContain("途中の文案");
	});

	it("copies by name and cuts the draft at the limit", () => {
		const { parts, writer } = collector();
		writeCouncilResult(writer, {
			...result,
			improvedDraft: "い".repeat(MAX_COUNCIL_TEXT_CHARACTERS + 1),
			rounds: [{ ...result.rounds[0], secret: FAKE_PASSWORD } as never],
		});
		expect(JSON.stringify(parts)).not.toContain(FAKE_PASSWORD);
		const data = parts[0]?.data as { improvedDraft: string };
		expect([...data.improvedDraft].length).toBe(MAX_COUNCIL_TEXT_CHARACTERS);
		const { parts: whole, writer: wholeWriter } = collector();
		writeCouncilResult(wholeWriter, {
			...result,
			improvedDraft: "い".repeat(MAX_COUNCIL_TEXT_CHARACTERS),
		});
		expect(
			[...String((whole[0]?.data as { improvedDraft: string } | undefined)?.improvedDraft)].length,
		).toBe(MAX_COUNCIL_TEXT_CHARACTERS);
	});
});

// --- Marketing profile and recommendation (Req 6.4, 6.5) ---

describe("writeMarketingProfile", () => {
	const profile: Profile = { interests: ["旅行"], budgetYen: 30000, concerns: ["重さ"] };

	it("writes the profile as a state part with id `profile`, each write replacing the one before", () => {
		const { parts, writer } = collector();
		writeMarketingProfile(writer, profile);
		writeMarketingProfile(writer, { ...profile, budgetYen: null });
		expect(parts).toEqual([
			{ type: "data-marketing-profile", id: "profile", data: profile },
			{
				type: "data-marketing-profile",
				id: "profile",
				data: { interests: ["旅行"], budgetYen: null, concerns: ["重さ"] },
			},
		]);
	});

	it("copies the fields by name", () => {
		const { parts, writer } = collector();
		writeMarketingProfile(writer, { ...profile, secret: FAKE_PASSWORD } as never);
		expect(JSON.stringify(parts)).not.toContain(FAKE_PASSWORD);
	});
});

describe("writeMarketingRecommendation", () => {
	const result: RecommendResult = {
		items: [
			{ productId: "p-1", name: "バッグ", priceYen: 12000, reason: "軽い", overBudget: false },
			{ productId: "p-2", name: "靴", priceYen: 40000, reason: "丈夫", overBudget: true },
		],
		dropped: 2,
		reason: "全体のコメント",
	};

	it("writes the items, the dropped count and the reason as an event part", () => {
		const { parts, writer } = collector();
		writeMarketingRecommendation(writer, result);
		expect(parts).toEqual([
			{
				type: "data-marketing-recommendation",
				id: "recommendation",
				data: { items: result.items, dropped: 2, reason: "全体のコメント" },
			},
		]);
	});

	it("leaves out the reason when there is none, and keeps an empty list with the dropped count", () => {
		const { parts, writer } = collector();
		writeMarketingRecommendation(writer, { items: [], dropped: 1 });
		expect(parts[0]?.data).toEqual({ items: [], dropped: 1 });
	});

	it("copies each item by name", () => {
		const { parts, writer } = collector();
		writeMarketingRecommendation(writer, {
			...result,
			items: [{ ...result.items[0], secret: FAKE_PASSWORD } as never],
		});
		expect(JSON.stringify(parts)).not.toContain(FAKE_PASSWORD);
	});
});
