import { APICallError } from "ai";
import { describe, expect, it } from "vitest";
import { PlatformError } from "../errors";
import { toStepError, WorkflowStepError } from "./errors";

describe("WorkflowStepError", () => {
	it("is a PlatformError with the output-invalid code", () => {
		const error = new WorkflowStepError("draft", new Error("boom"));

		expect(error).toBeInstanceOf(PlatformError);
		expect(error).toBeInstanceOf(WorkflowStepError);
		expect(error.code).toBe("output-invalid");
		expect(error.name).toBe("WorkflowStepError");
	});

	it("keeps the failed step's name and the cause", () => {
		const cause = new Error("boom");

		const error = new WorkflowStepError("draft", cause);

		expect(error.step).toBe("draft");
		expect(error.cause).toBe(cause);
		expect(error.message).toContain("draft");
		expect(error.details).toEqual({ step: "draft" });
	});

	it("never copies the cause's message into the learner-facing message or details", () => {
		const error = new WorkflowStepError("draft", new Error("secret-token-123"));

		expect(JSON.stringify([error.message, error.details])).not.toContain("secret-token-123");
	});
});

describe("toStepError", () => {
	it("wraps an ordinary error with the stage name", () => {
		const cause = new Error("boom");

		const error = toStepError("draft", cause);

		expect(error).toBeInstanceOf(WorkflowStepError);
		expect(error).toMatchObject({ step: "draft", cause });
	});

	it("keeps an existing WorkflowStepError, so the innermost stage stays named", () => {
		const inner = new WorkflowStepError("inner", new Error("boom"));

		expect(toStepError("outer", inner)).toBe(inner);
	});

	it("keeps a PlatformError about the request or the environment unwrapped", () => {
		for (const code of [
			"invalid-request",
			"capability-unsupported",
			"provider-unavailable",
			"source-unavailable",
		] as const) {
			const error = new PlatformError(code, "x");
			expect(toStepError("draft", error), code).toBe(error);
		}
	});

	it("wraps an output-invalid PlatformError, which is about the stage's own output", () => {
		const cause = new PlatformError("output-invalid", "bad");

		expect(toStepError("draft", cause)).toMatchObject({ step: "draft", cause });
	});

	it("wraps a non-Error throw", () => {
		expect(toStepError("draft", "just a string")).toBeInstanceOf(WorkflowStepError);
	});

	it("keeps an AI SDK provider error unwrapped, so the route answers 503 and not 502", () => {
		const cause = new APICallError({
			message: "upstream down",
			url: "https://example.invalid",
			requestBodyValues: {},
		});

		expect(toStepError("draft", cause)).toBe(cause);
	});
});
