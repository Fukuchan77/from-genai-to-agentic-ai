import { describe, expect, it } from "vitest";
import { DEFAULT_WORKFLOW_LIMITS } from "../config";
import { PlatformError } from "../errors";
import { assertWithinLimit, resolveWorkflowLimits } from "./limits";

function rejection(run: () => void): PlatformError {
	try {
		run();
	} catch (error) {
		expect(error).toBeInstanceOf(PlatformError);
		return error as PlatformError;
	}
	throw new Error("expected the call to throw");
}

describe("assertWithinLimit", () => {
	it("accepts a value exactly at the limit", () => {
		expect(() => assertWithinLimit("votes", 9, 9)).not.toThrow();
	});

	it("accepts the smallest valid value", () => {
		expect(() => assertWithinLimit("votes", 1, 9)).not.toThrow();
	});

	it("rejects a value one above the limit as invalid-request", () => {
		const error = rejection(() => assertWithinLimit("votes", 10, 9));

		expect(error.code).toBe("invalid-request");
		expect(error.message).toContain("votes");
		expect(error.message).toContain("9");
		expect(error.details).toEqual({ name: "votes", value: 10, max: 9 });
	});

	it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
		"rejects %s, which is not a positive integer",
		(value) => {
			expect(rejection(() => assertWithinLimit("sections", value, 8)).code).toBe("invalid-request");
		},
	);

	it("uses the shipped defaults as the limits callers compare against", () => {
		const { maxVotes, maxSections } = DEFAULT_WORKFLOW_LIMITS;

		expect(() => assertWithinLimit("votes", maxVotes, maxVotes)).not.toThrow();
		expect(() => assertWithinLimit("sections", maxSections + 1, maxSections)).toThrow(
			PlatformError,
		);
	});
});

describe("resolveWorkflowLimits", () => {
	it("returns the defaults when nothing is overridden", () => {
		expect(resolveWorkflowLimits()).toEqual(DEFAULT_WORKFLOW_LIMITS);
		expect(resolveWorkflowLimits({})).toEqual(DEFAULT_WORKFLOW_LIMITS);
	});

	it("overrides only the given fields", () => {
		const limits = resolveWorkflowLimits({ maxSections: 2 });

		expect(limits.maxSections).toBe(2);
		expect(limits.maxVotes).toBe(DEFAULT_WORKFLOW_LIMITS.maxVotes);
	});

	it("ignores an undefined override instead of erasing the default", () => {
		const limits = resolveWorkflowLimits({ maxSections: undefined });

		expect(limits.maxSections).toBe(DEFAULT_WORKFLOW_LIMITS.maxSections);
	});

	it("rejects an override that raises a limit above the shipped default", () => {
		const error = rejection(() =>
			resolveWorkflowLimits({ maxSections: DEFAULT_WORKFLOW_LIMITS.maxSections + 1 }),
		);

		expect(error.code).toBe("invalid-request");
	});

	it("rejects an override that is not a positive integer", () => {
		expect(rejection(() => resolveWorkflowLimits({ maxVotes: 0 })).code).toBe("invalid-request");
	});

	it("returns a frozen object", () => {
		expect(Object.isFrozen(resolveWorkflowLimits())).toBe(true);
	});
});
