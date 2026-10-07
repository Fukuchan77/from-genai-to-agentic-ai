import { describe, expect, expectTypeOf, it } from "vitest";
import { createStopConditionRecord, type StopConditionName } from "./stop-conditions";
import {
	deriveStopReason,
	STOP_REASONS,
	type StopReason,
	type StopReasonInput,
} from "./stop-reason";

const ALL_FIRED: readonly StopConditionName[] = ["step-limit", "token-budget", "timeout"];

describe("STOP_REASONS", () => {
	it("is the closed vocabulary of Req 6.2", () => {
		expect(STOP_REASONS).toEqual([
			"completed",
			"step-limit",
			"token-budget",
			"timeout",
			"aborted",
			"error",
		]);
		expect(Object.isFrozen(STOP_REASONS)).toBe(true);
		expectTypeOf<StopReason>().toEqualTypeOf<
			"completed" | "step-limit" | "token-budget" | "timeout" | "aborted" | "error"
		>();
	});
});

describe("deriveStopReason", () => {
	it.each<[StopReason, StopReasonInput]>([
		["completed", { errored: false, fired: [] }],
		["step-limit", { errored: false, fired: ["step-limit"] }],
		["token-budget", { errored: false, fired: ["token-budget"] }],
		["timeout", { errored: false, fired: ["timeout"] }],
		["timeout", { abort: "timeout", errored: false, fired: [] }],
		["aborted", { abort: "caller", errored: false, fired: [] }],
		["error", { errored: true, fired: [] }],
	])("derives %s from %o", (expected, input) => {
		expect(deriveStopReason(input)).toBe(expected);
	});

	it("puts a caller abort above everything else", () => {
		expect(deriveStopReason({ abort: "caller", errored: true, fired: ALL_FIRED })).toBe("aborted");
	});

	it("puts a timeout abort above an error and the fired conditions", () => {
		expect(
			deriveStopReason({ abort: "timeout", errored: true, fired: ["step-limit", "token-budget"] }),
		).toBe("timeout");
	});

	it("puts an error above every fired stop condition", () => {
		expect(deriveStopReason({ errored: true, fired: ALL_FIRED })).toBe("error");
	});

	it("ranks fired conditions timeout, then token-budget, then step-limit", () => {
		expect(deriveStopReason({ errored: false, fired: ALL_FIRED })).toBe("timeout");
		expect(deriveStopReason({ errored: false, fired: ["step-limit", "token-budget"] })).toBe(
			"token-budget",
		);
		expect(deriveStopReason({ errored: false, fired: ["token-budget", "step-limit"] })).toBe(
			"token-budget",
		);
		expect(deriveStopReason({ errored: false, fired: ["timeout", "step-limit"] })).toBe("timeout");
	});

	it("accepts the run's stop-condition record directly", () => {
		const record = createStopConditionRecord();
		expect(deriveStopReason({ errored: false, fired: record })).toBe("completed");

		record.mark("step-limit");
		expect(deriveStopReason({ errored: false, fired: record })).toBe("step-limit");
	});

	it("covers every reason in the vocabulary", () => {
		const derived = new Set<StopReason>([
			deriveStopReason({ errored: false, fired: [] }),
			deriveStopReason({ errored: false, fired: ["step-limit"] }),
			deriveStopReason({ errored: false, fired: ["token-budget"] }),
			deriveStopReason({ abort: "timeout", errored: false, fired: [] }),
			deriveStopReason({ abort: "caller", errored: false, fired: [] }),
			deriveStopReason({ errored: true, fired: [] }),
		]);
		expect([...derived].sort()).toEqual([...STOP_REASONS].sort());
	});
});
