import { describe, expect, it } from "vitest";
import { SummaryValidationError } from "./errors";
import { type AttemptOutcome, MAX_REGENERATIONS, withRegeneration } from "./retry";

type Event = string;

async function drain<T>(
	generator: AsyncGenerator<Event, T>,
): Promise<{ events: Event[]; result: T }> {
	const events: Event[] = [];
	for (;;) {
		const next = await generator.next();
		if (next.done) return { events, result: next.value };
		events.push(next.value);
	}
}

/** Builds an attempt function whose n-th call yields `partial-n` and returns outcomes[n - 1]. */
function scriptedAttempts(outcomes: readonly AttemptOutcome<string>[]) {
	const calls: { attempt: number; previousIssues: readonly string[] | undefined }[] = [];
	const run = async function* (
		attempt: number,
		previousIssues: readonly string[] | undefined,
	): AsyncGenerator<Event, AttemptOutcome<string>> {
		calls.push({ attempt, previousIssues });
		yield `partial-${attempt}`;
		const outcome = outcomes[attempt - 1];
		if (!outcome) throw new Error(`unexpected attempt ${attempt}`);
		return outcome;
	};
	return { run, calls };
}

const restartEvent = ({ attempt, issues }: { attempt: number; issues: readonly string[] }) =>
	`restart-${attempt}:${issues.join("|")}`;

describe("withRegeneration", () => {
	it("allows at most two regenerations", () => {
		expect(MAX_REGENERATIONS).toBe(2);
	});

	it("returns the first valid result without regenerating", async () => {
		const { run, calls } = scriptedAttempts([{ ok: true, value: "summary" }]);

		const { events, result } = await drain(withRegeneration(run, restartEvent));

		expect(result).toEqual({ value: "summary", attempts: 1 });
		expect(events).toEqual(["partial-1"]);
		expect(calls).toEqual([{ attempt: 1, previousIssues: undefined }]);
	});

	it("regenerates once after a validation failure and passes the issues on", async () => {
		const { run, calls } = scriptedAttempts([
			{ ok: false, issues: ["keyPoints: too small"] },
			{ ok: true, value: "summary" },
		]);

		const { events, result } = await drain(withRegeneration(run, restartEvent));

		expect(result).toEqual({ value: "summary", attempts: 2 });
		expect(events).toEqual(["partial-1", "restart-2:keyPoints: too small", "partial-2"]);
		expect(calls).toEqual([
			{ attempt: 1, previousIssues: undefined },
			{ attempt: 2, previousIssues: ["keyPoints: too small"] },
		]);
	});

	it("succeeds on the second regeneration (third attempt)", async () => {
		const { run, calls } = scriptedAttempts([
			{ ok: false, issues: ["a"] },
			{ ok: false, issues: ["b"] },
			{ ok: true, value: "summary" },
		]);

		const { events, result } = await drain(withRegeneration(run, restartEvent));

		expect(result).toEqual({ value: "summary", attempts: 3 });
		expect(events).toEqual(["partial-1", "restart-2:a", "partial-2", "restart-3:b", "partial-3"]);
		expect(calls.at(-1)).toEqual({ attempt: 3, previousIssues: ["b"] });
	});

	it("fails with every attempt's issues after the third invalid attempt", async () => {
		const { run, calls } = scriptedAttempts([
			{ ok: false, issues: ["a"] },
			{ ok: false, issues: ["b"] },
			{ ok: false, issues: ["c1", "c2"] },
		]);
		const events: Event[] = [];

		const error = await (async () => {
			for await (const event of withRegeneration(run, restartEvent)) events.push(event);
		})().catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(SummaryValidationError);
		expect(error).toMatchObject({
			attempts: 3,
			issues: ["c1", "c2"],
			issuesByAttempt: [["a"], ["b"], ["c1", "c2"]],
		});
		expect(calls).toHaveLength(3);
		expect(events).toEqual(["partial-1", "restart-2:a", "partial-2", "restart-3:b", "partial-3"]);
	});

	it("does not retry an error that is not a validation failure", async () => {
		const failure = new Error("provider down");
		let calls = 0;
		const run = async function* (): AsyncGenerator<Event, AttemptOutcome<string>> {
			calls += 1;
			yield "partial";
			throw failure;
		};

		await expect(drain(withRegeneration(run, restartEvent))).rejects.toBe(failure);
		expect(calls).toBe(1);
	});

	it("yields nothing for a restart when the mapper returns undefined", async () => {
		const { run } = scriptedAttempts([
			{ ok: false, issues: ["a"] },
			{ ok: true, value: "summary" },
		]);

		const { events, result } = await drain(withRegeneration(run, () => undefined));

		expect(events).toEqual(["partial-1", "partial-2"]);
		expect(result.attempts).toBe(2);
	});
});
