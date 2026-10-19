import type { AnalysisEvent, AnalysisResult } from "@platform/ai-core/analysis";
import type { HelpdeskEvent } from "@platform/ai-core/helpdesk";
import type { ResearchEvent, ResearchResult, ResearchUsage } from "@platform/ai-core/research";
import { describe, expect, it } from "vitest";
import {
	createAnalysisStreamer,
	createHelpdeskStreamer,
	createResearchStreamer,
	writeAnalysisResult,
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
