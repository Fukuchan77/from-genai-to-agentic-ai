import { describe, expect, it, vi } from "vitest";
import type { AgentRunSummary, RunObserver } from "./guarded-agent";
import {
	createExternalContentLog,
	createNamedObserver,
	EXTERNAL_CONTENT_KINDS,
	type RunEvent,
} from "./observer";

const SUMMARY: AgentRunSummary = Object.freeze({
	stopReason: "completed",
	steps: 2,
	totalTokens: Object.freeze({ input: 1, output: 2, cacheRead: 0, reasoning: 0 }),
	elapsedMs: 5,
	toolsCalled: Object.freeze(["calculator"]),
	error: undefined,
});

describe("createNamedObserver", () => {
	it("attaches the agent name to the event and passes the summary through unchanged", () => {
		const events: RunEvent[] = [];
		const observer: RunObserver = createNamedObserver("searcher", (event) => events.push(event));

		observer.onRunEnd(SUMMARY);

		expect(events).toEqual([{ agent: "searcher", summary: SUMMARY }]);
		expect(events[0]?.summary).toBe(SUMMARY);
	});

	it("leaves the agent undefined when no name is given", () => {
		const handler = vi.fn();
		createNamedObserver(undefined, handler).onRunEnd(SUMMARY);

		expect(handler).toHaveBeenCalledWith({ agent: undefined, summary: SUMMARY });
	});

	it("is a plain RunObserver: it only exposes onRunEnd", () => {
		const observer = createNamedObserver("a", () => {});

		expect(Object.keys(observer)).toEqual(["onRunEnd"]);
	});

	it("rejects an empty agent name", () => {
		expect(() => createNamedObserver("", () => {})).toThrow(RangeError);
	});
});

describe("createExternalContentLog (CL-10)", () => {
	it("publishes the closed set of kinds", () => {
		expect(EXTERNAL_CONTENT_KINDS).toEqual(["arxiv-abstract", "file-content", "mcp-response"]);
	});

	it("records the kind and the source, in order", () => {
		const log = createExternalContentLog();
		log.record({ kind: "file-content", source: "notes/a.md" });
		log.record({ kind: "arxiv-abstract", source: "arXiv:2401.00001" });

		expect(log.entries()).toEqual([
			{ kind: "file-content", source: "notes/a.md" },
			{ kind: "arxiv-abstract", source: "arXiv:2401.00001" },
		]);
	});

	it("keeps only the kind and the source, never the content", () => {
		const log = createExternalContentLog();
		const secret = "SECRET-BODY-TEXT";
		log.record({ kind: "mcp-response", source: "github:get_file", content: secret } as never);

		expect(log.entries()).toEqual([{ kind: "mcp-response", source: "github:get_file" }]);
		expect(JSON.stringify(log.entries())).not.toContain(secret);
	});

	it("returns a snapshot that later records do not change", () => {
		const log = createExternalContentLog();
		log.record({ kind: "file-content", source: "a" });
		const before = log.entries();
		log.record({ kind: "file-content", source: "b" });

		expect(before).toHaveLength(1);
		expect(log.entries()).toHaveLength(2);
	});

	it("rejects an unknown kind and an empty source", () => {
		const log = createExternalContentLog();

		expect(() => log.record({ kind: "web-page" as never, source: "x" })).toThrow(RangeError);
		expect(() => log.record({ kind: "file-content", source: "" })).toThrow(RangeError);
	});

	it("is independent per log (one per run)", () => {
		const first = createExternalContentLog();
		const second = createExternalContentLog();
		first.record({ kind: "file-content", source: "a" });

		expect(second.entries()).toEqual([]);
	});

	describe("the agent that took the content in (W1 review F-11)", () => {
		it("stamps the agent name on what a per-agent view records, in the shared log", () => {
			const log = createExternalContentLog();
			log.forAgent("search").record({ kind: "arxiv-abstract", source: "2401.00001" });
			log.forAgent("reading").record({ kind: "arxiv-abstract", source: "2401.00002" });
			log.record({ kind: "file-content", source: "a.md" });

			expect(log.entries()).toEqual([
				{ kind: "arxiv-abstract", source: "2401.00001", agent: "search" },
				{ kind: "arxiv-abstract", source: "2401.00002", agent: "reading" },
				{ kind: "file-content", source: "a.md" },
			]);
		});

		it("lets the view's agent win over one the caller put on the record", () => {
			const log = createExternalContentLog();
			log.forAgent("search").record({ kind: "file-content", source: "a", agent: "other" });
			expect(log.entries()).toEqual([{ kind: "file-content", source: "a", agent: "search" }]);
		});

		it("adds no agent key at all to a record that has no agent", () => {
			const log = createExternalContentLog();
			log.record({ kind: "file-content", source: "a.md" });
			expect(log.entries()).toStrictEqual([{ kind: "file-content", source: "a.md" }]);
		});

		it("rejects an empty agent name", () => {
			expect(() => createExternalContentLog().forAgent("")).toThrow(RangeError);
		});

		it("keeps the checks of the log on a view", () => {
			const view = createExternalContentLog().forAgent("search");
			expect(() => view.record({ kind: "web-page" as never, source: "x" })).toThrow(RangeError);
			expect(() => view.record({ kind: "file-content", source: "" })).toThrow(RangeError);
		});
	});

	describe("the length of a source", () => {
		it("accepts a source of exactly 512 characters", () => {
			const log = createExternalContentLog();
			log.record({ kind: "file-content", source: "x".repeat(512) });
			expect(log.entries()).toHaveLength(1);
		});

		it("rejects a source of 513 characters, so content cannot be passed as a source", () => {
			const log = createExternalContentLog();
			expect(() => log.record({ kind: "file-content", source: "x".repeat(513) })).toThrow(
				RangeError,
			);
			expect(log.entries()).toEqual([]);
		});

		it("counts characters, not UTF-16 units", () => {
			const log = createExternalContentLog();
			log.record({ kind: "file-content", source: "😀".repeat(512) });
			expect(log.entries()).toHaveLength(1);
		});
	});
});
