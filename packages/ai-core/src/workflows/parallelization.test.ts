import { describe, expect, it, vi } from "vitest";
import { PlatformError } from "../errors";
import { WorkflowStepError } from "./errors";
import { parallelSections, parallelVote } from "./parallelization";

function named(count: number): { name: string }[] {
	return Array.from({ length: count }, (_, index) => ({ name: `section-${index + 1}` }));
}

/** Resolves once `count` callers have arrived; a sequential implementation never gets there. */
function barrier(count: number) {
	let arrived = 0;
	let release: () => void = () => {};
	const open = new Promise<void>((resolve) => {
		release = resolve;
	});
	return {
		async arrive() {
			arrived += 1;
			if (arrived >= count) release();
			await open;
		},
		arrived: () => arrived,
	};
}

function abortable(signal: AbortSignal): Promise<never> {
	return new Promise((_, reject) => {
		if (signal.aborted) reject(signal.reason);
		signal.addEventListener("abort", () => reject(signal.reason), { once: true });
	});
}

describe("parallelSections", () => {
	it("starts every section before any of them finishes", { timeout: 1_000 }, async () => {
		const gate = barrier(3);

		const results = await parallelSections({
			sections: named(3),
			run: async (section) => {
				await gate.arrive();
				return section.name;
			},
		});

		expect(gate.arrived()).toBe(3);
		expect(results).toEqual(["section-1", "section-2", "section-3"]);
	});

	it("returns the results in section order even when they finish out of order", async () => {
		const finishOrder: string[] = [];

		const results = await parallelSections({
			sections: named(3),
			run: async (section, _signal) => {
				const index = Number(section.name.at(-1));
				await new Promise((resolve) => setTimeout(resolve, (4 - index) * 10));
				finishOrder.push(section.name);
				return `done-${index}`;
			},
		});

		expect(finishOrder).toEqual(["section-3", "section-2", "section-1"]);
		expect(results).toEqual(["done-1", "done-2", "done-3"]);
	});

	it("aborts the other sections when one fails and names the failed section", async () => {
		const observed: boolean[] = [];

		const error = await parallelSections({
			sections: named(3),
			run: async (section, signal) => {
				if (section.name === "section-2") throw new Error("boom");
				try {
					await abortable(signal);
				} catch {
					observed.push(signal.aborted);
				}
				return "never used";
			},
		}).catch((thrown: unknown) => thrown);

		expect(error).toBeInstanceOf(WorkflowStepError);
		expect(error).toMatchObject({ step: "section-2", code: "output-invalid" });
		expect((error as WorkflowStepError).cause).toEqual(new Error("boom"));
		expect(observed).toEqual([true, true]);
	});

	it("reports the first failure when several sections fail", async () => {
		const error = await parallelSections({
			sections: named(3),
			run: async (section) => {
				if (section.name === "section-1") {
					await new Promise((resolve) => setTimeout(resolve, 20));
				}
				throw new Error(`fail-${section.name}`);
			},
		}).catch((thrown: unknown) => thrown);

		expect(error).toMatchObject({ step: "section-2" });
	});

	it("keeps the code of an environment error instead of wrapping it as output-invalid", async () => {
		const unavailable = new PlatformError("provider-unavailable", "down");

		const error = await parallelSections({
			sections: named(2),
			run: async () => {
				throw unavailable;
			},
		}).catch((thrown: unknown) => thrown);

		expect(error).toBe(unavailable);
	});

	it("rejects more sections than the limit without running any", async () => {
		const run = vi.fn(async () => "x");

		const error = await parallelSections({ sections: named(9), run }).catch(
			(thrown: unknown) => thrown,
		);

		expect(error).toMatchObject({ code: "invalid-request" });
		expect(run).not.toHaveBeenCalled();
	});

	it("names the limited setting in the error", async () => {
		const sections = await parallelSections({ sections: named(9), run: async () => "x" }).catch(
			(thrown: unknown) => thrown,
		);
		const votes = await parallelVote({
			task: "t",
			votes: 10,
			run: async () => "x",
			normalize: (value: string) => value,
		}).catch((thrown: unknown) => thrown);

		expect(sections).toMatchObject({ details: { name: "sections", value: 9, max: 8 } });
		expect(votes).toMatchObject({ details: { name: "votes", value: 10, max: 9 } });
	});

	it("accepts exactly the limit and honours a lower custom limit", async () => {
		await expect(
			parallelSections({ sections: named(8), run: async () => "x" }),
		).resolves.toHaveLength(8);
		await expect(
			parallelSections({ sections: named(3), run: async () => "x", limits: { maxSections: 2 } }),
		).rejects.toMatchObject({ code: "invalid-request" });
	});

	it("rejects an empty section list", async () => {
		await expect(parallelSections({ sections: [], run: async () => "x" })).rejects.toMatchObject({
			code: "invalid-request",
		});
	});

	it("rethrows the caller's abort reason unwrapped and stops the sections", async () => {
		const controller = new AbortController();
		const reason = new Error("user stopped");

		const result = parallelSections({
			sections: named(2),
			run: (_section, signal) => abortable(signal),
			signal: controller.signal,
		});
		controller.abort(reason);

		await expect(result).rejects.toBe(reason);
	});

	it("does not start when the signal is already aborted", async () => {
		const controller = new AbortController();
		controller.abort(new Error("stop"));
		const run = vi.fn(async () => "x");

		await expect(
			parallelSections({ sections: named(2), run, signal: controller.signal }),
		).rejects.toThrow("stop");
		expect(run).not.toHaveBeenCalled();
	});
});

describe("parallelVote", () => {
	const normalize = (value: string) => value.trim().toLowerCase();

	function ballotsOf(values: readonly string[]) {
		let call = 0;
		return async () => {
			const value = values[call];
			call += 1;
			return value ?? "";
		};
	}

	it("returns the majority conclusion with the tally and every ballot", async () => {
		const result = await parallelVote({
			task: "is it safe?",
			run: ballotsOf(["yes", "no", "yes"]),
			normalize,
		});

		expect(result).toEqual({
			outcome: "majority",
			conclusion: "yes",
			tally: [
				{ label: "yes", count: 2 },
				{ label: "no", count: 1 },
			],
			ballots: [
				{ index: 1, value: "yes", label: "yes" },
				{ index: 2, value: "no", label: "no" },
				{ index: 3, value: "yes", label: "yes" },
			],
		});
	});

	it("returns a tie without choosing a conclusion when the top counts are equal", async () => {
		const result = await parallelVote({
			task: "t",
			votes: 4,
			run: ballotsOf(["a", "b", "a", "b"]),
			normalize,
		});

		expect(result).toEqual({
			outcome: "tie",
			tiedLabels: ["a", "b"],
			tally: [
				{ label: "a", count: 2 },
				{ label: "b", count: 2 },
			],
			ballots: expect.any(Array),
		});
		expect(result).not.toHaveProperty("conclusion");
	});

	it("lists the tally with the most votes first, not in order of appearance", async () => {
		const result = await parallelVote({
			task: "t",
			run: ballotsOf(["no", "yes", "yes"]),
			normalize,
		});

		expect(result).toMatchObject({
			outcome: "majority",
			conclusion: "yes",
			tally: [
				{ label: "yes", count: 2 },
				{ label: "no", count: 1 },
			],
		});
	});

	it("treats three different votes as a tie among all three", async () => {
		const result = await parallelVote({ task: "t", run: ballotsOf(["a", "b", "c"]), normalize });

		expect(result).toMatchObject({ outcome: "tie", tiedLabels: ["a", "b", "c"] });
	});

	it("ignores a lower-count label when listing the tied labels", async () => {
		const result = await parallelVote({
			task: "t",
			votes: 5,
			run: ballotsOf(["a", "b", "a", "b", "c"]),
			normalize,
		});

		expect(result).toMatchObject({ outcome: "tie", tiedLabels: ["a", "b"] });
	});

	it("groups ballots by the normalized label but keeps the raw value", async () => {
		const result = await parallelVote({
			task: "t",
			run: ballotsOf(["Yes ", "YES", "no"]),
			normalize,
		});

		expect(result).toMatchObject({
			outcome: "majority",
			conclusion: "yes",
			tally: [
				{ label: "yes", count: 2 },
				{ label: "no", count: 1 },
			],
		});
		expect(result.ballots.map((ballot) => ballot.value)).toEqual(["Yes ", "YES", "no"]);
	});

	it("runs three votes by default, all started before any finishes", {
		timeout: 1_000,
	}, async () => {
		const gate = barrier(3);
		const run = vi.fn(async () => {
			await gate.arrive();
			return "x";
		});

		const result = await parallelVote({ task: "t", run, normalize });

		expect(run).toHaveBeenCalledTimes(3);
		expect(result.ballots).toHaveLength(3);
	});

	it("passes the task and the vote number to each run", async () => {
		const run = vi.fn(async () => "x");

		await parallelVote({ task: "the task", votes: 2, run, normalize });

		expect(run).toHaveBeenCalledWith("the task", 1, expect.any(AbortSignal));
		expect(run).toHaveBeenCalledWith("the task", 2, expect.any(AbortSignal));
	});

	it("allows exactly maxVotes and rejects one more without running", async () => {
		await expect(
			parallelVote({ task: "t", votes: 9, run: async () => "x", normalize }),
		).resolves.toMatchObject({ outcome: "majority" });
		const run = vi.fn(async () => "x");

		await expect(parallelVote({ task: "t", votes: 10, run, normalize })).rejects.toMatchObject({
			code: "invalid-request",
		});
		expect(run).not.toHaveBeenCalled();
	});

	it.each([0, 1.5, -2])("rejects votes=%s", async (votes) => {
		await expect(
			parallelVote({ task: "t", votes, run: async () => "x", normalize }),
		).rejects.toMatchObject({ code: "invalid-request" });
	});

	it("fails with the failed vote's name and aborts the rest when one vote fails", async () => {
		const error = await parallelVote({
			task: "t",
			run: async (_task, index, signal) => {
				if (index === 2) throw new Error("boom");
				return abortable(signal);
			},
			normalize,
		}).catch((thrown: unknown) => thrown);

		expect(error).toMatchObject({ step: "vote-2" });
	});
});
