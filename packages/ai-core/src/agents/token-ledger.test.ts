import { describe, expect, it } from "vitest";
import { TokenLedger, usageFromRun } from "./token-ledger";

describe("TokenLedger", () => {
	it("starts empty", () => {
		expect(new TokenLedger().breakdown()).toEqual({
			byRole: {},
			total: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
		});
	});

	it("records usage per role and keeps the breakdown equal to the total", () => {
		const ledger = new TokenLedger();
		ledger.record("supervisor", { inputTokens: 100, outputTokens: 20, totalTokens: 120 });
		ledger.record("searcher", { inputTokens: 300, outputTokens: 50, totalTokens: 350 });
		ledger.record("writer", { inputTokens: 40, outputTokens: 10, totalTokens: 50 });

		const { byRole, total } = ledger.breakdown();

		expect(total).toEqual({ inputTokens: 440, outputTokens: 80, totalTokens: 520 });
		const sum = Object.values(byRole).reduce(
			(acc, usage) => acc + (usage === "unknown" ? 0 : usage.totalTokens),
			0,
		);
		expect(sum).toBe(total.totalTokens);
		expect(byRole.searcher).toMatchObject({ inputTokens: 300, outputTokens: 50, totalTokens: 350 });
	});

	it("adds up several records of the same role and counts the calls", () => {
		const ledger = new TokenLedger();
		ledger.record("searcher", { inputTokens: 10, outputTokens: 1, totalTokens: 11 });
		ledger.record("searcher", { inputTokens: 20, outputTokens: 2, totalTokens: 22 });

		expect(ledger.breakdown().byRole.searcher).toEqual({
			inputTokens: 30,
			outputTokens: 3,
			totalTokens: 33,
			calls: 2,
			unknownCalls: 0,
		});
	});

	it("derives totalTokens from input and output when the provider omits it", () => {
		const ledger = new TokenLedger();
		ledger.record("a", { inputTokens: 7, outputTokens: 5 });

		expect(ledger.breakdown().total.totalTokens).toBe(12);
	});

	it("marks a role whose usage is unavailable as unknown and adds nothing for it", () => {
		const ledger = new TokenLedger();
		ledger.record("supervisor", { inputTokens: 10, outputTokens: 5, totalTokens: 15 });
		ledger.record("local-model", undefined);
		ledger.record("empty", {});

		const { byRole, total } = ledger.breakdown();

		expect(byRole["local-model"]).toBe("unknown");
		expect(byRole.empty).toBe("unknown");
		expect(total).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
	});

	it("counts only the known calls of a role that has both known and unknown calls", () => {
		const ledger = new TokenLedger();
		ledger.record("searcher", { inputTokens: 10, outputTokens: 5, totalTokens: 15 });
		ledger.record("searcher", undefined);

		expect(ledger.breakdown().byRole.searcher).toEqual({
			inputTokens: 10,
			outputTokens: 5,
			totalTokens: 15,
			calls: 2,
			unknownCalls: 1,
		});
		expect(ledger.breakdown().total.totalTokens).toBe(15);
	});

	it("treats invalid numbers as unavailable instead of guessing", () => {
		const ledger = new TokenLedger();
		ledger.record("bad", { inputTokens: Number.NaN, outputTokens: -3 });

		expect(ledger.breakdown().byRole.bad).toBe("unknown");
		expect(ledger.breakdown().total.totalTokens).toBe(0);
	});

	it("returns a snapshot that later records do not change", () => {
		const ledger = new TokenLedger();
		ledger.record("a", { inputTokens: 1, outputTokens: 1, totalTokens: 2 });
		const before = ledger.breakdown();
		ledger.record("a", { inputTokens: 5, outputTokens: 5, totalTokens: 10 });

		expect(before.total.totalTokens).toBe(2);
		expect(ledger.breakdown().total.totalTokens).toBe(12);
	});

	it("rejects an empty role name", () => {
		expect(() => new TokenLedger().record("", { inputTokens: 1 })).toThrow(RangeError);
	});

	it("does not treat Object.prototype names as roles", () => {
		const ledger = new TokenLedger();
		ledger.record("__proto__", { inputTokens: 1, outputTokens: 1, totalTokens: 2 });

		expect(Object.keys(ledger.breakdown().byRole)).toEqual(["__proto__"]);
		expect(ledger.breakdown().total.totalTokens).toBe(2);
	});
});

describe("usageFromRun (W1 review F-10)", () => {
	const totals = (input: number, output: number) => ({ input, output, cacheRead: 0, reasoning: 0 });

	it("maps a run's token totals to the ledger's usage", () => {
		expect(usageFromRun({ totalTokens: totals(100, 20) })).toEqual({
			inputTokens: 100,
			outputTokens: 20,
			totalTokens: 120,
		});
	});

	it("does not count cache reads or reasoning again: they are inside input and output", () => {
		const usage = usageFromRun({
			totalTokens: { input: 100, output: 20, cacheRead: 80, reasoning: 15 },
		});
		expect(usage?.totalTokens).toBe(120);
	});

	it("says the usage is unknown when the run reported no tokens (no step ran, or the provider is silent)", () => {
		expect(usageFromRun({ totalTokens: totals(0, 0) })).toBeUndefined();
	});

	it("takes a provider that reports only the output as known", () => {
		expect(usageFromRun({ totalTokens: totals(0, 7) })).toEqual({
			inputTokens: 0,
			outputTokens: 7,
			totalTokens: 7,
		});
	});

	it("feeds the ledger so the role's total matches the run", () => {
		const ledger = new TokenLedger();
		ledger.record("search", usageFromRun({ totalTokens: totals(10, 5) }));
		ledger.record("market", usageFromRun({ totalTokens: totals(0, 0) }));
		expect(ledger.breakdown().byRole.search).toMatchObject({ totalTokens: 15 });
		expect(ledger.breakdown().byRole.market).toBe("unknown");
	});
});
