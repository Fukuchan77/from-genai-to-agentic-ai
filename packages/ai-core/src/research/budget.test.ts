import { describe, expect, it } from "vitest";
import { createBudget } from "./budget";

describe("createBudget", () => {
	describe("calls", () => {
		it("grants calls up to the limit and refuses the next one", () => {
			const budget = createBudget({ maxCalls: 3, maxTotalTokens: 1_000 });
			expect([budget.takeCall(), budget.takeCall(), budget.takeCall()]).toEqual([true, true, true]);
			expect(budget.takeCall()).toBe(false);
			expect(budget.takeCall()).toBe(false);
		});

		it("counts only the calls that were granted", () => {
			const budget = createBudget({ maxCalls: 2, maxTotalTokens: 1_000 });
			budget.takeCall();
			budget.takeCall();
			budget.takeCall();
			expect(budget.status()).toMatchObject({ calls: 2, maxCalls: 2 });
		});

		it("grants exactly one call when the limit is 1", () => {
			const budget = createBudget({ maxCalls: 1, maxTotalTokens: 1_000 });
			expect(budget.takeCall()).toBe(true);
			expect(budget.takeCall()).toBe(false);
		});
	});

	describe("tokens", () => {
		it("starts with the whole budget", () => {
			expect(createBudget({ maxCalls: 1, maxTotalTokens: 1_000 }).remainingTokens()).toBe(1_000);
		});

		it("takes the tokens of every role off the remaining budget", () => {
			const budget = createBudget({ maxCalls: 8, maxTotalTokens: 1_000 });
			budget.recordUsage("supervisor", { inputTokens: 100, outputTokens: 50 });
			budget.recordUsage("search", { totalTokens: 200 });
			expect(budget.remainingTokens()).toBe(650);
		});

		it("never reports a negative remainder when a role overshoots", () => {
			const budget = createBudget({ maxCalls: 8, maxTotalTokens: 100 });
			budget.recordUsage("search", { totalTokens: 250 });
			expect(budget.remainingTokens()).toBe(0);
		});

		it("does not run a call that the remaining tokens cannot fund, and does not use up a call for it", () => {
			const budget = createBudget({ maxCalls: 8, maxTotalTokens: 100 });
			budget.recordUsage("search", { totalTokens: 100 });
			expect(budget.takeCall()).toBe(false);
			expect(budget.status()).toMatchObject({ calls: 0, exhausted: "tokens" });
		});

		it("still funds a call when one token is left", () => {
			const budget = createBudget({ maxCalls: 8, maxTotalTokens: 100 });
			budget.recordUsage("search", { totalTokens: 99 });
			expect(budget.takeCall()).toBe(true);
		});
	});

	describe("status", () => {
		it("is not exhausted while calls and tokens remain", () => {
			const budget = createBudget({ maxCalls: 2, maxTotalTokens: 100 });
			expect(budget.status()).toEqual({
				calls: 0,
				maxCalls: 2,
				remainingTokens: 100,
				exhausted: undefined,
			});
		});

		it("names the call limit as the reason when the calls are used up", () => {
			const budget = createBudget({ maxCalls: 1, maxTotalTokens: 100 });
			budget.takeCall();
			expect(budget.status().exhausted).toBe("calls");
		});

		it("names the call limit first when both are used up", () => {
			const budget = createBudget({ maxCalls: 1, maxTotalTokens: 100 });
			budget.takeCall();
			budget.recordUsage("search", { totalTokens: 100 });
			expect(budget.status().exhausted).toBe("calls");
		});
	});

	describe("breakdown by role", () => {
		it("adds the roles up to the total", () => {
			const budget = createBudget({ maxCalls: 8, maxTotalTokens: 10_000 });
			budget.recordUsage("supervisor", { inputTokens: 10, outputTokens: 5, totalTokens: 15 });
			budget.recordUsage("search", { inputTokens: 20, outputTokens: 10, totalTokens: 30 });
			budget.recordUsage("search", { inputTokens: 1, outputTokens: 1, totalTokens: 2 });
			budget.recordUsage("reading", { inputTokens: 7, outputTokens: 3, totalTokens: 10 });
			const { byRole, total } = budget.breakdown();
			const sum = Object.values(byRole).reduce(
				(acc, role) => (role === "unknown" ? acc : acc + role.totalTokens),
				0,
			);
			expect(sum).toBe(total.totalTokens);
			expect(total.totalTokens).toBe(57);
			expect(byRole["search"]).toMatchObject({ totalTokens: 32, calls: 2 });
		});

		it("marks a role whose usage is unavailable as unknown and adds nothing for it", () => {
			const budget = createBudget({ maxCalls: 8, maxTotalTokens: 1_000 });
			budget.recordUsage("supervisor", { totalTokens: 100 });
			budget.recordUsage("market", undefined);
			expect(budget.breakdown().byRole["market"]).toBe("unknown");
			expect(budget.breakdown().total.totalTokens).toBe(100);
			expect(budget.remainingTokens()).toBe(900);
		});
	});

	describe("invalid limits", () => {
		it.each([
			["zero calls", { maxCalls: 0, maxTotalTokens: 10 }],
			["negative calls", { maxCalls: -1, maxTotalTokens: 10 }],
			["fractional calls", { maxCalls: 1.5, maxTotalTokens: 10 }],
			["zero tokens", { maxCalls: 1, maxTotalTokens: 0 }],
			["NaN tokens", { maxCalls: 1, maxTotalTokens: Number.NaN }],
			["infinite tokens", { maxCalls: 1, maxTotalTokens: Number.POSITIVE_INFINITY }],
		])("rejects %s", (_name, limits) => {
			expect(() => createBudget(limits)).toThrow(RangeError);
		});
	});

	describe("a reserve for one role (W5 review F-1)", () => {
		const reserved = (reserve = 400) =>
			createBudget({
				maxCalls: 8,
				maxTotalTokens: 1_000,
				reserve: { role: "supervisor", tokens: reserve },
			});

		it("keeps the reserve out of what the others may spend", () => {
			expect(reserved().remainingTokens()).toBe(600);
		});

		it("counts the others' spend against the rest, not against the reserve", () => {
			const budget = reserved();
			budget.recordUsage("search", { totalTokens: 250 });
			expect(budget.remainingTokens()).toBe(350);
		});

		it("lets the reserved role spend its reserve without lowering what the others have", () => {
			const budget = reserved();
			budget.recordUsage("supervisor", { totalTokens: 300 });
			expect(budget.remainingTokens()).toBe(600);
		});

		it("takes what the reserved role spent beyond its reserve off the rest", () => {
			const budget = reserved();
			budget.recordUsage("supervisor", { totalTokens: 500 });
			expect(budget.remainingTokens()).toBe(500);
		});

		it("never reports a negative remainder", () => {
			const budget = reserved();
			budget.recordUsage("search", { totalTokens: 900 });
			expect(budget.remainingTokens()).toBe(0);
			expect(budget.takeCall()).toBe(false);
		});

		it("does not change the breakdown or the total", () => {
			const budget = reserved();
			budget.recordUsage("supervisor", { totalTokens: 100 });
			budget.recordUsage("search", { totalTokens: 50 });
			expect(budget.breakdown().total.totalTokens).toBe(150);
		});

		it.each([0, -1, 1.5, 1_000, 1_001])("rejects a reserve of %s", (tokens) => {
			expect(() =>
				createBudget({ maxCalls: 1, maxTotalTokens: 1_000, reserve: { role: "s", tokens } }),
			).toThrow(RangeError);
		});

		it("rejects an empty role name", () => {
			expect(() =>
				createBudget({ maxCalls: 1, maxTotalTokens: 1_000, reserve: { role: "", tokens: 10 } }),
			).toThrow(RangeError);
		});
	});
});
