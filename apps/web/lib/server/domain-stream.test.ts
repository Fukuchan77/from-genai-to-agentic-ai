import type { HelpdeskEvent } from "@platform/ai-core/helpdesk";
import { describe, expect, it } from "vitest";
import { createHelpdeskStreamer } from "./domain-stream";

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
