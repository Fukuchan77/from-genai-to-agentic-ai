import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { type Clock, createFakeClock, systemClock } from "./clock";

describe("Clock", () => {
	it("advances fake time deterministically", () => {
		const clock = createFakeClock(1_000);

		expect(clock.now()).toBe(1_000);
		clock.advanceBy(250);
		expect(clock.now()).toBe(1_250);
		clock.set(2_000);
		expect(clock.now()).toBe(2_000);
		expectTypeOf(clock).toMatchTypeOf<Clock>();
	});

	it("aborts timeout signals only after their deadline", () => {
		const clock = createFakeClock();
		const early = clock.timeoutSignal(10);
		const late = clock.timeoutSignal(25);
		const onAbort = vi.fn();
		late.addEventListener("abort", onAbort);

		clock.advanceBy(9);
		expect(early.aborted).toBe(false);
		expect(late.aborted).toBe(false);

		clock.advanceBy(1);
		expect(early.aborted).toBe(true);
		expect(early.reason).toBeInstanceOf(DOMException);
		expect(early.reason.name).toBe("TimeoutError");
		expect(late.aborted).toBe(false);

		clock.advanceBy(15);
		expect(late.aborted).toBe(true);
		expect(onAbort).toHaveBeenCalledOnce();
	});

	it("uses the system clock and native timeout signals in production", () => {
		expect(Math.abs(systemClock.now() - Date.now())).toBeLessThan(100);
		expect(systemClock.timeoutSignal(1)).toBeInstanceOf(AbortSignal);
	});
});
