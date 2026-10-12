import { describe, expect, it } from "vitest";
import { createFakeClock } from "../../ports/clock";
import type { ScoredChunk } from "../store";
import {
	createTraceBuilder,
	type RetrievalSettings,
	type RetrievalTrace,
	type StageEvent,
} from "./trace";

const SETTINGS: RetrievalSettings = {
	topK: 5,
	minSimilarity: 0.5,
	pool: 20,
	filter: { tags: ["guide"] },
	methods: { hyde: false, multiQuery: true, hybrid: true, rerank: true },
};

function scored(id: string, score: number): ScoredChunk {
	return {
		chunk: {
			id,
			documentId: `kb:${id}.md`,
			documentTitle: id,
			ordinal: 0,
			headingPath: [],
			page: null,
			body: `body of ${id}`,
		},
		score,
	};
}

function setup(onStage?: (event: StageEvent) => void) {
	const clock = createFakeClock(1_000);
	const builder = createTraceBuilder({
		settings: SETTINGS,
		clock,
		...(onStage ? { onStage } : {}),
	});
	return { clock, builder };
}

describe("createTraceBuilder: intermediate results", () => {
	it("starts with the settings and empty intermediate results", () => {
		const { builder } = setup();

		const trace = builder.build();

		expect(trace.settings).toEqual(SETTINGS);
		expect(trace.vector).toEqual([]);
		expect(trace.fullText).toEqual([]);
		expect(trace.fused).toEqual([]);
		expect(trace.final).toEqual([]);
		expect(trace.stages).toEqual([]);
		expect(trace.rerank).toEqual({ status: "disabled" });
	});

	it("omits the optional fields that were never set", () => {
		const { builder } = setup();

		const trace = builder.build();

		expect("hypotheticalAnswer" in trace).toBe(false);
		expect("subQueries" in trace).toBe(false);
		expect("reranked" in trace).toBe(false);
	});

	it("keeps each search's query next to its candidates, in the order they were added", () => {
		const { builder } = setup();
		builder.addVector("q1", [scored("a", 0.9)]);
		builder.addVector("q2", [scored("b", 0.8)]);
		builder.addFullText("q1", [scored("c", 0.2)]);

		const trace = builder.build();

		expect(trace.vector).toEqual([
			{ query: "q1", candidates: [scored("a", 0.9)] },
			{ query: "q2", candidates: [scored("b", 0.8)] },
		]);
		expect(trace.fullText).toEqual([{ query: "q1", candidates: [scored("c", 0.2)] }]);
	});

	it("records the hypothetical answer, sub-queries, fused, reranked and final lists", () => {
		const { builder } = setup();
		builder.setHypotheticalAnswer("A hypothetical answer.");
		builder.setSubQueries(["s1", "s2", "s3"]);
		builder.setFused([scored("a", 0.03)]);
		builder.setReranked([scored("a", 0.9)]);
		builder.setFinal([scored("a", 0.9)]);

		const trace = builder.build();

		expect(trace.hypotheticalAnswer).toBe("A hypothetical answer.");
		expect(trace.subQueries).toEqual(["s1", "s2", "s3"]);
		expect(trace.fused).toEqual([scored("a", 0.03)]);
		expect(trace.reranked).toEqual([scored("a", 0.9)]);
		expect(trace.final).toEqual([scored("a", 0.9)]);
	});

	it("returns a snapshot that later builder calls do not change", () => {
		const { builder } = setup();
		builder.addVector("q1", [scored("a", 0.9)]);
		const first = builder.build();

		builder.addVector("q2", [scored("b", 0.8)]);
		builder.setFinal([scored("b", 0.8)]);

		expect(first.vector).toHaveLength(1);
		expect(first.final).toEqual([]);
	});

	it("copies the settings, so changing the original afterwards does not alter the trace", () => {
		const settings = structuredClone(SETTINGS) as {
			-readonly [K in keyof RetrievalSettings]: RetrievalSettings[K];
		};
		const builder = createTraceBuilder({ settings, clock: createFakeClock() });

		settings.topK = 99;
		(settings.methods as { hyde: boolean }).hyde = true;

		const trace = builder.build();
		expect(trace.settings.topK).toBe(5);
		expect(trace.settings.methods.hyde).toBe(false);
	});
});

describe("createTraceBuilder: rerank outcome", () => {
	it.each<[RetrievalTrace["rerank"]]>([
		[{ status: "applied" }],
		[{ status: "disabled" }],
		[{ status: "skipped", reason: "api-key-missing" }],
		[{ status: "skipped", reason: "provider-error" }],
	])("records %o", (outcome) => {
		const { builder } = setup();

		builder.setRerank(outcome);

		expect(builder.build().rerank).toEqual(outcome);
	});
});

describe("createTraceBuilder: stages", () => {
	it("records a finished stage with its name, status and duration from the clock", () => {
		const { builder, clock } = setup();

		builder.begin("vector-search");
		clock.advanceBy(40);
		builder.done("vector-search");

		expect(builder.build().stages).toEqual([
			{ stage: "vector-search", status: "done", durationMs: 40 },
		]);
	});

	it("measures each stage separately and lists them in the order they finished", () => {
		const { builder, clock } = setup();

		builder.begin("vector-search");
		clock.advanceBy(10);
		builder.done("vector-search");
		builder.begin("fusion");
		clock.advanceBy(3);
		builder.done("fusion");

		expect(builder.build().stages).toEqual([
			{ stage: "vector-search", status: "done", durationMs: 10 },
			{ stage: "fusion", status: "done", durationMs: 3 },
		]);
	});

	it("measures a stage that overlaps another from its own start", () => {
		const { builder, clock } = setup();

		builder.begin("vector-search");
		clock.advanceBy(5);
		builder.begin("full-text-search");
		clock.advanceBy(7);
		builder.done("vector-search");
		clock.advanceBy(8);
		builder.done("full-text-search");

		const durations = Object.fromEntries(
			builder.build().stages.map((stage) => [stage.stage, stage.durationMs]),
		);
		expect(durations).toEqual({ "vector-search": 12, "full-text-search": 15 });
	});

	it("keeps the detail of a finished stage", () => {
		const { builder } = setup();

		builder.begin("multi-query");
		builder.done("multi-query", "3 sub-queries");

		expect(builder.build().stages).toEqual([
			{ stage: "multi-query", status: "done", durationMs: 0, detail: "3 sub-queries" },
		]);
	});

	it("records a skipped stage with the reason and no time spent", () => {
		const { builder, clock } = setup();
		clock.advanceBy(100);

		builder.skip("rerank", "api-key-missing");

		expect(builder.build().stages).toEqual([
			{ stage: "rerank", status: "skipped", durationMs: 0, detail: "api-key-missing" },
		]);
	});

	it("records a stage skipped after it started as skipped, not as done", () => {
		const { builder, clock } = setup();

		builder.begin("rerank");
		clock.advanceBy(25);
		builder.skip("rerank", "provider-error");

		expect(builder.build().stages).toEqual([
			{ stage: "rerank", status: "skipped", durationMs: 25, detail: "provider-error" },
		]);
	});

	it("leaves a stage that never finished out of the record", () => {
		const { builder } = setup();

		builder.begin("hyde");

		expect(builder.build().stages).toEqual([]);
	});
});

describe("createTraceBuilder: stage events", () => {
	it("emits running, done and skipped events in call order", () => {
		const events: StageEvent[] = [];
		const { builder } = setup((event) => events.push(event));

		builder.begin("hyde");
		builder.done("hyde");
		builder.skip("rerank", "api-key-missing");

		expect(events).toEqual([
			{ stage: "hyde", status: "running" },
			{ stage: "hyde", status: "done" },
			{ stage: "rerank", status: "skipped", detail: "api-key-missing" },
		]);
	});

	it("passes the detail on to the event", () => {
		const events: StageEvent[] = [];
		const { builder } = setup((event) => events.push(event));

		builder.begin("multi-query", "expanding");
		builder.done("multi-query", "3 sub-queries");

		expect(events).toEqual([
			{ stage: "multi-query", status: "running", detail: "expanding" },
			{ stage: "multi-query", status: "done", detail: "3 sub-queries" },
		]);
	});

	it("does not put durations into the events", () => {
		const events: StageEvent[] = [];
		const { builder, clock } = setup((event) => events.push(event));

		builder.begin("fusion");
		clock.advanceBy(9);
		builder.done("fusion");

		for (const event of events) expect(Object.keys(event)).not.toContain("durationMs");
	});

	it("works without a listener", () => {
		const { builder } = setup();

		expect(() => {
			builder.begin("fusion");
			builder.done("fusion");
		}).not.toThrow();
	});
});
