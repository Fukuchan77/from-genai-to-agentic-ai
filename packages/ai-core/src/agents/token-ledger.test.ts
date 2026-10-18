import { describe, expect, it } from "vitest";
import { TokenLedger } from "./token-ledger";

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
