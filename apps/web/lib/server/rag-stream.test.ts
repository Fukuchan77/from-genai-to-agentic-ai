import { PlatformError } from "@platform/ai-core/errors";
import type { RagEvent, RagResult, RetrievalTrace } from "@platform/ai-core/rag";
import { describe, expect, it } from "vitest";
import { GuardError, parseStreamErrorText } from "./errors";
import { toRagStreamError, writeRagEvents } from "./rag-stream";

type Part = { type: string; [key: string]: unknown };

function collector() {
	const parts: Part[] = [];
	return { parts, writer: { write: (part: Part) => void parts.push(part) } };
}

async function* events(...items: RagEvent[]): AsyncGenerator<RagEvent, void> {
	for (const item of items) yield item;
}

const TRACE = {
	settings: { topK: 5, minSimilarity: 0.5, pool: 20, methods: {} },
	vector: [],
	fullText: [],
	fused: [],
	rerank: { status: "disabled" },
	final: [],
	stages: [],
} as unknown as RetrievalTrace;

const RESULT: RagResult = {
	answer: "回答 [1]",
	citations: [],
	removedCitations: [],
	noEvidence: false,
	rerank: { status: "disabled" },
	settings: TRACE.settings,
	usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3, cacheReadTokens: 0 },
};

describe("writeRagEvents", () => {
	it("maps a stage event to data-rag-stage with an id per stage, so later events overwrite", async () => {
		const { parts, writer } = collector();
		await writeRagEvents(
			events(
				{ type: "stage", stage: "vector-search", status: "running" },
				{ type: "stage", stage: "vector-search", status: "done", detail: "3 件" },
				{ type: "stage", stage: "fusion", status: "skipped", detail: "無効" },
			),
			writer,
		);
		expect(parts).toEqual([
			{
				type: "data-rag-stage",
				id: "stage-vector-search",
				data: { stage: "vector-search", status: "running" },
			},
			{
				type: "data-rag-stage",
				id: "stage-vector-search",
				data: { stage: "vector-search", status: "done", detail: "3 件" },
			},
			{
				type: "data-rag-stage",
				id: "stage-fusion",
				data: { stage: "fusion", status: "skipped", detail: "無効" },
			},
		]);
	});

	it("maps the trace to data-rag-trace under the fixed id 'trace'", async () => {
		const { parts, writer } = collector();
		await writeRagEvents(
			events({ type: "trace", trace: TRACE }, { type: "trace", trace: TRACE }),
			writer,
		);
		expect(parts.map((part) => [part.type, part.id])).toEqual([
			["data-rag-trace", "trace"],
			["data-rag-trace", "trace"],
		]);
		expect(parts[0]?.data).toBe(TRACE);
	});

	it("maps text deltas to one text-start, the deltas, and a text-end before the result", async () => {
		const { parts, writer } = collector();
		await writeRagEvents(
			events(
				{ type: "text-delta", text: "答え" },
				{ type: "text-delta", text: "です" },
				{ type: "result", result: RESULT },
			),
			writer,
		);
		expect(parts.map((part) => part.type)).toEqual([
			"text-start",
			"text-delta",
			"text-delta",
			"text-end",
			"data-rag-result",
		]);
		const id = parts[0]?.id;
		expect(typeof id).toBe("string");
		expect(
			parts.filter((part) => part.type.startsWith("text")).every((part) => part.id === id),
		).toBe(true);
		expect(parts.filter((part) => part.type === "text-delta").map((part) => part.delta)).toEqual([
			"答え",
			"です",
		]);
	});

	it("maps the result to data-rag-result under the fixed id 'result'", async () => {
		const { parts, writer } = collector();
		await writeRagEvents(events({ type: "result", result: RESULT }), writer);
		expect(parts).toEqual([{ type: "data-rag-result", id: "result", data: RESULT }]);
	});

	it("writes no text parts when the answer has no text", async () => {
		const { parts, writer } = collector();
		await writeRagEvents(events({ type: "trace", trace: TRACE }), writer);
		expect(parts.some((part) => part.type.startsWith("text"))).toBe(false);
	});

	it("sends no data-rag-result when the event stream is cut by an abort", async () => {
		const { parts, writer } = collector();
		async function* aborted(): AsyncGenerator<RagEvent, void> {
			yield { type: "text-delta", text: "途中" };
			throw new DOMException("aborted", "AbortError");
		}
		await expect(writeRagEvents(aborted(), writer)).rejects.toThrow("aborted");
		expect(parts.some((part) => part.type === "data-rag-result")).toBe(false);
		expect(parts.some((part) => part.type === "text-end")).toBe(false);
	});

	it("propagates the failure of the event stream to the caller", async () => {
		const { writer } = collector();
		async function* failing(): AsyncGenerator<RagEvent, void> {
			yield { type: "stage", stage: "vector-search", status: "running" };
			throw new PlatformError("provider-unavailable", "失敗しました。");
		}
		await expect(writeRagEvents(failing(), writer)).rejects.toMatchObject({
			code: "provider-unavailable",
		});
	});
});

describe("toRagStreamError", () => {
	it("keeps the code and the Japanese message of a platform error", () => {
		const text = toRagStreamError(new PlatformError("output-invalid", "出力が不正です。"));
		expect(parseStreamErrorText(text)).toEqual({
			code: "output-invalid",
			message: "出力が不正です。",
		});
	});

	it("keeps a guard error's code", () => {
		const text = toRagStreamError(new GuardError("rate-limited", "しばらく待ってください。"));
		expect(parseStreamErrorText(text).code).toBe("rate-limited");
	});

	it("never forwards the message, stack or SQL of an unexpected error", () => {
		const error = new Error("select * from rag_chunks where key='sk-secret-123' failed");
		const text = toRagStreamError(error);
		expect(text).not.toContain("sk-secret-123");
		expect(text).not.toContain("rag_chunks");
		expect(text).not.toContain("stack");
		expect(parseStreamErrorText(text).code).toBe("unexpected");
	});

	it("does not leak details of a platform error either", () => {
		const text = toRagStreamError(
			new PlatformError("provider-unavailable", "接続できません。", {
				connectionString: "postgres://user:pw@host/db",
			}),
		);
		expect(text).not.toContain("postgres://");
	});
});
