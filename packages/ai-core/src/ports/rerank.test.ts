import { createCohere } from "@ai-sdk/cohere";
import { rerank as aiRerank } from "ai";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { PlatformError } from "../errors";
import { defaultRerankModel } from "../models/catalog";
import { createCohereRerank, type RerankProvider, type RerankSdkCall } from "./index";

const cohereSdk = vi.hoisted(() => ({
	reranking: vi.fn((modelId: string) => ({ modelId })),
	rerank: vi.fn(),
}));
vi.mock("@ai-sdk/cohere", () => ({
	createCohere: vi.fn(() => ({ reranking: cohereSdk.reranking })),
}));
vi.mock("ai", async (importOriginal) => ({
	...(await importOriginal<typeof import("ai")>()),
	rerank: cohereSdk.rerank,
}));

const CANDIDATES = [
	{ id: "a", text: "alpha" },
	{ id: "b", text: "bravo" },
	{ id: "c", text: "charlie" },
] as const;

function sdkReturning(ranking: unknown): ReturnType<typeof vi.fn<RerankSdkCall>> {
	return vi.fn<RerankSdkCall>().mockResolvedValue({ ranking });
}

afterEach(() => vi.useRealTimers());

describe("createCohereRerank", () => {
	it("returns candidate IDs ordered by descending score and sends texts in candidate order", async () => {
		const sdk = sdkReturning([
			{ originalIndex: 2, score: 0.9 },
			{ originalIndex: 0, score: 0.4 },
			{ originalIndex: 1, score: 0.1 },
		]);
		const rerank = createCohereRerank("test-key", { sdk });

		const result = await rerank.rerank("query", CANDIDATES, { topN: 3 });

		expect(result).toEqual([
			{ id: "c", score: 0.9 },
			{ id: "a", score: 0.4 },
			{ id: "b", score: 0.1 },
		]);
		expect(sdk).toHaveBeenCalledWith(
			expect.objectContaining({
				query: "query",
				documents: ["alpha", "bravo", "charlie"],
				topN: 3,
			}),
		);
		expectTypeOf(rerank).toMatchTypeOf<RerankProvider>();
	});

	it("applies topN even when the provider returns more rows, and sorts by score", async () => {
		const rerank = createCohereRerank("test-key", {
			sdk: sdkReturning([
				{ originalIndex: 0, score: 0.2 },
				{ originalIndex: 1, score: 0.8 },
				{ originalIndex: 2, score: 0.5 },
			]),
		});

		await expect(rerank.rerank("q", CANDIDATES, { topN: 2 })).resolves.toEqual([
			{ id: "b", score: 0.8 },
			{ id: "c", score: 0.5 },
		]);
	});

	it("clamps topN to the candidate count and skips the provider for no candidates", async () => {
		const sdk = sdkReturning([{ originalIndex: 0, score: 0.5 }]);
		const rerank = createCohereRerank("test-key", { sdk });

		await rerank.rerank("q", [{ id: "a", text: "alpha" }], { topN: 10 });
		expect(sdk).toHaveBeenCalledWith(expect.objectContaining({ topN: 1 }));

		sdk.mockClear();
		await expect(rerank.rerank("q", [], { topN: 5 })).resolves.toEqual([]);
		expect(sdk).not.toHaveBeenCalled();
	});

	it.each([
		["a non-positive topN", 0],
		["a fractional topN", 1.5],
	])("rejects %s as invalid-request without calling the provider", async (_case, topN) => {
		const sdk = sdkReturning([]);
		const rerank = createCohereRerank("test-key", { sdk });

		await expect(rerank.rerank("q", CANDIDATES, { topN })).rejects.toMatchObject({
			code: "invalid-request",
		});
		expect(sdk).not.toHaveBeenCalled();
	});

	it("keeps the model ID from the catalog default unless one is given", () => {
		expect(createCohereRerank("test-key", { sdk: sdkReturning([]) }).modelId).toBe(
			defaultRerankModel().id,
		);
		expect(
			createCohereRerank("test-key", { sdk: sdkReturning([]), modelId: "custom-rerank" }).modelId,
		).toBe("custom-rerank");
	});

	it.each([
		["a missing ranking", {}],
		["a ranking that is not an array", { ranking: "nope" }],
		["a missing originalIndex", { ranking: [{ score: 0.5 }] }],
		["a negative index", { ranking: [{ originalIndex: -1, score: 0.5 }] }],
		["an out-of-range index", { ranking: [{ originalIndex: 3, score: 0.5 }] }],
		["a fractional index", { ranking: [{ originalIndex: 0.5, score: 0.5 }] }],
		[
			"a duplicated index",
			{
				ranking: [
					{ originalIndex: 1, score: 0.5 },
					{ originalIndex: 1, score: 0.4 },
				],
			},
		],
		["a string score", { ranking: [{ originalIndex: 0, score: "0.5" }] }],
		["a NaN score", { ranking: [{ originalIndex: 0, score: Number.NaN }] }],
		["a non-object response", null],
	])("rejects %s as source-unavailable", async (_case, response) => {
		const rerank = createCohereRerank("test-key", {
			sdk: vi.fn<RerankSdkCall>().mockResolvedValue(response),
		});

		const promise = rerank.rerank("q", CANDIDATES, { topN: 3 });
		await expect(promise).rejects.toBeInstanceOf(PlatformError);
		await expect(promise).rejects.toMatchObject({
			code: "source-unavailable",
			details: { provider: "cohere" },
		});
	});

	it("wraps SDK failures as source-unavailable with a closed classification only", async () => {
		const failure = Object.assign(new TypeError("status 429"), { statusCode: 429 });
		const rerank = createCohereRerank("test-key", {
			sdk: vi.fn<RerankSdkCall>().mockRejectedValue(failure),
		});

		const promise = rerank.rerank("q", CANDIDATES, { topN: 3 });
		await expect(promise).rejects.toMatchObject({
			code: "source-unavailable",
			details: { provider: "cohere", errorName: "TypeError", status: 429 },
		});
	});

	it("keeps the API key, the query, and candidate texts out of the error", async () => {
		const secret = "secret-key-123";
		const rerank = createCohereRerank(secret, {
			sdk: vi
				.fn<RerankSdkCall>()
				.mockRejectedValue(
					new Error(`401 for key ${secret}, query SECRET-QUERY, text alpha-private`),
				),
		});

		const error = await rerank
			.rerank("SECRET-QUERY", [{ id: "a", text: "alpha-private" }], { topN: 1 })
			.catch((thrown: unknown) => thrown as PlatformError);

		const serialized = JSON.stringify([(error as Error).message, (error as PlatformError).details]);
		for (const text of [secret, "SECRET-QUERY", "alpha-private"]) {
			expect(serialized).not.toContain(text);
		}
	});

	it("clears its timer on success and on failure", async () => {
		vi.useFakeTimers();
		const ok = createCohereRerank("test-key", {
			sdk: sdkReturning([{ originalIndex: 0, score: 1 }]),
			timeoutMs: 500,
		});
		await ok.rerank("q", CANDIDATES, { topN: 1 });
		expect(vi.getTimerCount()).toBe(0);

		const failing = createCohereRerank("test-key", {
			sdk: vi.fn<RerankSdkCall>().mockRejectedValue(new Error("boom")),
			timeoutMs: 500,
		});
		await failing.rerank("q", CANDIDATES, { topN: 1 }).catch(() => undefined);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("removes its abort listener from a long-lived caller signal after every call", async () => {
		const controller = new AbortController();
		const added = vi.spyOn(controller.signal, "addEventListener");
		const removed = vi.spyOn(controller.signal, "removeEventListener");
		const ok = createCohereRerank("test-key", {
			sdk: sdkReturning([{ originalIndex: 0, score: 1 }]),
		});
		const failing = createCohereRerank("test-key", {
			sdk: vi.fn<RerankSdkCall>().mockRejectedValue(new Error("boom")),
		});

		await ok.rerank("q", CANDIDATES, { topN: 1, signal: controller.signal });
		await failing
			.rerank("q", CANDIDATES, { topN: 1, signal: controller.signal })
			.catch(() => undefined);

		const abortListeners = (spy: typeof added) =>
			spy.mock.calls.filter(([type]) => type === "abort").length;
		expect(abortListeners(added)).toBe(2);
		expect(abortListeners(removed)).toBe(2);
	});

	it("fails with a timeout reason and aborts the SDK call when the provider is too slow", async () => {
		vi.useFakeTimers();
		let received: AbortSignal | undefined;
		const sdk = vi.fn<RerankSdkCall>(({ abortSignal }) => {
			received = abortSignal;
			return new Promise(() => {});
		});
		const rerank = createCohereRerank("test-key", { sdk, timeoutMs: 500 });

		const outcome = rerank.rerank("q", CANDIDATES, { topN: 3 }).catch((error: unknown) => error);
		await vi.advanceTimersByTimeAsync(499);
		expect(received?.aborted).toBe(false);
		await vi.advanceTimersByTimeAsync(1);

		await expect(outcome).resolves.toMatchObject({
			code: "source-unavailable",
			details: { provider: "cohere", reason: "timeout" },
		});
		expect(received?.aborted).toBe(true);
	});

	it("propagates the caller's abort as the signal's reason, not as source-unavailable", async () => {
		let received: AbortSignal | undefined;
		const sdk = vi.fn<RerankSdkCall>(({ abortSignal }) => {
			received = abortSignal;
			return new Promise(() => {});
		});
		const rerank = createCohereRerank("test-key", { sdk });
		const controller = new AbortController();

		const outcome = rerank
			.rerank("q", CANDIDATES, { topN: 3, signal: controller.signal })
			.catch((error: unknown) => error);
		controller.abort(new DOMException("Stopped", "AbortError"));

		await expect(outcome).resolves.toMatchObject({ name: "AbortError" });
		expect(received?.aborted).toBe(true);
	});

	it("does not call the provider when the signal is already aborted", async () => {
		const sdk = sdkReturning([]);
		const rerank = createCohereRerank("test-key", { sdk });

		await expect(
			rerank.rerank("q", CANDIDATES, { topN: 3, signal: AbortSignal.abort() }),
		).rejects.toMatchObject({ name: "AbortError" });
		expect(sdk).not.toHaveBeenCalled();
	});

	it("builds the default SDK call from the Cohere provider and the catalog model", async () => {
		cohereSdk.rerank.mockResolvedValue({ ranking: [{ originalIndex: 1, score: 0.7 }] });
		const rerank = createCohereRerank("test-key");

		await expect(rerank.rerank("q", CANDIDATES, { topN: 1 })).resolves.toEqual([
			{ id: "b", score: 0.7 },
		]);
		expect(createCohere).toHaveBeenCalledWith({ apiKey: "test-key" });
		expect(cohereSdk.reranking).toHaveBeenCalledWith(defaultRerankModel().id);
		expect(aiRerank).toHaveBeenCalledWith(
			expect.objectContaining({
				model: { modelId: defaultRerankModel().id },
				documents: ["alpha", "bravo", "charlie"],
				query: "q",
				topN: 1,
				maxRetries: 0,
				abortSignal: expect.any(AbortSignal),
			}),
		);
	});
});
