import { describe, expect, it } from "vitest";
import { createFakeClock } from "../../ports/clock";
import { createRequestQueue, waitFor } from "./queue";

/** Lets every promise continuation that is ready run. */
async function flush(): Promise<void> {
	for (let turn = 0; turn < 10; turn += 1)
		await new Promise<void>((resolve) => setImmediate(resolve));
}

interface Deferred<T> {
	readonly promise: Promise<T>;
	resolve(value: T): void;
	reject(reason: unknown): void;
}

function deferred<T = void>(): Deferred<T> {
	let resolve: (value: T) => void = () => {};
	let reject: (reason: unknown) => void = () => {};
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

describe("createRequestQueue", () => {
	it("runs the first task at once, with no wait", async () => {
		const clock = createFakeClock(1_000);
		const queue = createRequestQueue({ clock, minIntervalMs: 3_000 });
		await expect(queue.run(async () => "first")).resolves.toBe("first");
		expect(clock.now()).toBe(1_000);
	});

	it("starts the second task exactly one interval after the first finished", async () => {
		const clock = createFakeClock();
		const queue = createRequestQueue({ clock, minIntervalMs: 3_000 });
		const started: number[] = [];
		const task = async () => {
			started.push(clock.now());
		};
		void queue.run(task);
		void queue.run(task);
		await flush();
		expect(started).toEqual([0]);

		clock.advanceBy(2_999);
		await flush();
		expect(started).toEqual([0]);

		clock.advanceBy(1);
		await flush();
		expect(started).toEqual([0, 3_000]);
	});

	it("counts the interval from the end of the previous task, not from its start", async () => {
		const clock = createFakeClock();
		const queue = createRequestQueue({ clock, minIntervalMs: 3_000 });
		const started: number[] = [];
		const slow = async () => {
			started.push(clock.now());
			clock.advanceBy(2_000); // the request itself takes 2 s
		};
		void queue.run(slow);
		void queue.run(async () => {
			started.push(clock.now());
		});
		await flush();
		expect(started).toEqual([0]);

		clock.advanceBy(2_999);
		await flush();
		expect(started).toEqual([0]);

		clock.advanceBy(1);
		await flush();
		expect(started).toEqual([0, 5_000]);
	});

	it("never runs two tasks at the same time and keeps the order of the calls", async () => {
		const clock = createFakeClock();
		const queue = createRequestQueue({ clock, minIntervalMs: 3_000 });
		let running = 0;
		let peak = 0;
		const order: string[] = [];
		const gates = [deferred(), deferred(), deferred()];
		const names = ["a", "b", "c"] as const;
		const results = names.map((name, index) =>
			queue.run(async () => {
				running += 1;
				peak = Math.max(peak, running);
				order.push(`${name}@${clock.now()}`);
				await gates[index]?.promise;
				running -= 1;
				return name;
			}),
		);
		await flush();
		expect(order).toEqual(["a@0"]);

		gates[0]?.resolve();
		await flush();
		clock.advanceBy(3_000);
		await flush();
		expect(order).toEqual(["a@0", "b@3000"]);

		gates[1]?.resolve();
		await flush();
		clock.advanceBy(3_000);
		await flush();
		gates[2]?.resolve();
		await flush();

		expect(order).toEqual(["a@0", "b@3000", "c@6000"]);
		expect(peak).toBe(1);
		await expect(Promise.all(results)).resolves.toEqual(["a", "b", "c"]);
	});

	it("does not stop the tasks behind one that failed, and reports the failure to its caller", async () => {
		const clock = createFakeClock();
		const queue = createRequestQueue({ clock, minIntervalMs: 3_000 });
		const failure = new Error("boom");
		const first = queue.run(async () => {
			throw failure;
		});
		const second = queue.run(async () => "second");
		const firstOutcome = first.then(
			() => "resolved",
			(error: unknown) => error,
		);
		await flush();
		expect(await firstOutcome).toBe(failure);

		// The failed request still counts as a request: the next one waits the full interval.
		clock.advanceBy(2_999);
		await flush();
		let secondDone = false;
		void second.then(() => {
			secondDone = true;
		});
		await flush();
		expect(secondDone).toBe(false);
		clock.advanceBy(1);
		await flush();
		await expect(second).resolves.toBe("second");
	});

	it("rejects a waiting caller at once when it aborts, without running its task", async () => {
		const clock = createFakeClock();
		const queue = createRequestQueue({ clock, minIntervalMs: 3_000 });
		const controller = new AbortController();
		const ran: string[] = [];
		void queue.run(async () => {
			ran.push("first");
		});
		const aborted = queue.run(async () => {
			ran.push("aborted");
		}, controller.signal);
		const third = queue.run(async () => {
			ran.push("third");
		});
		await flush();

		const reason = new Error("learner stopped");
		controller.abort(reason);
		await expect(aborted).rejects.toBe(reason);

		clock.advanceBy(3_000);
		await flush();
		await expect(third).resolves.toBeUndefined();
		// The aborted request left no gap: the third ran at the first slot after the first request.
		expect(ran).toEqual(["first", "third"]);
	});

	it("rejects a caller that aborts while an earlier task is still running", async () => {
		const clock = createFakeClock();
		const queue = createRequestQueue({ clock, minIntervalMs: 3_000 });
		const gate = deferred();
		void queue.run(() => gate.promise);
		const controller = new AbortController();
		let ran = false;
		const waiting = queue.run(async () => {
			ran = true;
		}, controller.signal);
		await flush();

		const reason = new Error("stop");
		controller.abort(reason);
		// The earlier task has not finished, yet the caller is released.
		await expect(waiting).rejects.toBe(reason);
		gate.resolve();
		clock.advanceBy(10_000);
		await flush();
		expect(ran).toBe(false);
	});

	it("rejects a caller that aborts while it is waiting out the interval", async () => {
		const clock = createFakeClock();
		const queue = createRequestQueue({ clock, minIntervalMs: 3_000 });
		await queue.run(async () => undefined);
		const controller = new AbortController();
		let ran = false;
		const waiting = queue.run(async () => {
			ran = true;
		}, controller.signal);
		await flush();
		clock.advanceBy(1_000);
		await flush();

		const reason = new Error("stop");
		controller.abort(reason);
		await expect(waiting).rejects.toBe(reason);
		clock.advanceBy(10_000);
		await flush();
		expect(ran).toBe(false);
	});

	it("rejects with the reason of a signal that is already aborted, without running", async () => {
		const queue = createRequestQueue({ clock: createFakeClock(), minIntervalMs: 3_000 });
		const reason = new Error("already");
		let ran = false;
		await expect(
			queue.run(async () => {
				ran = true;
			}, AbortSignal.abort(reason)),
		).rejects.toBe(reason);
		expect(ran).toBe(false);
	});

	it("does not move the next slot when a task is skipped because its caller aborted", async () => {
		const clock = createFakeClock();
		const queue = createRequestQueue({ clock, minIntervalMs: 3_000 });
		const controller = new AbortController();
		const started: number[] = [];
		void queue.run(async () => {
			started.push(clock.now());
		});
		const skipped = queue.run(async () => {
			started.push(-1);
		}, controller.signal);
		void skipped.catch(() => undefined);
		controller.abort(new Error("x"));
		const later = queue.run(async () => {
			started.push(clock.now());
		});
		await flush();
		clock.advanceBy(3_000);
		await flush();
		await later;
		expect(started).toEqual([0, 3_000]);
	});

	it("does not wait at all when the interval is 0", async () => {
		const clock = createFakeClock();
		const queue = createRequestQueue({ clock, minIntervalMs: 0 });
		await queue.run(async () => 1);
		await expect(queue.run(async () => 2)).resolves.toBe(2);
		expect(clock.now()).toBe(0);
	});

	it.each([
		["negative", -1],
		["not a number", Number.NaN],
		["infinite", Number.POSITIVE_INFINITY],
	])("rejects an interval that is %s", (_name, minIntervalMs) => {
		expect(() => createRequestQueue({ clock: createFakeClock(), minIntervalMs })).toThrow(
			RangeError,
		);
	});
});

describe("waitFor", () => {
	it("resolves when the clock reaches the deadline, and not before", async () => {
		const clock = createFakeClock();
		let done = false;
		void waitFor(clock, 500).then(() => {
			done = true;
		});
		clock.advanceBy(499);
		await flush();
		expect(done).toBe(false);
		clock.advanceBy(1);
		await flush();
		expect(done).toBe(true);
	});

	it("resolves at once for 0 ms or less", async () => {
		const clock = createFakeClock();
		await expect(waitFor(clock, 0)).resolves.toBeUndefined();
		await expect(waitFor(clock, -5)).resolves.toBeUndefined();
	});

	it("rejects with the abort reason as soon as the signal aborts", async () => {
		const clock = createFakeClock();
		const controller = new AbortController();
		const waiting = waitFor(clock, 10_000, controller.signal);
		const reason = new Error("stop");
		controller.abort(reason);
		await expect(waiting).rejects.toBe(reason);
	});

	it("rejects at once with the reason of a signal that is already aborted", async () => {
		const reason = new Error("early");
		await expect(waitFor(createFakeClock(), 10_000, AbortSignal.abort(reason))).rejects.toBe(
			reason,
		);
	});

	it("does not leave the abort listener behind once the wait is over", async () => {
		const clock = createFakeClock();
		const controller = new AbortController();
		const removed: string[] = [];
		const signal = controller.signal;
		const original = signal.removeEventListener.bind(signal);
		signal.removeEventListener = ((type: string, ...rest: unknown[]) => {
			removed.push(type);
			return (original as (...args: unknown[]) => void)(type, ...rest);
		}) as typeof signal.removeEventListener;
		const waiting = waitFor(clock, 100, signal);
		clock.advanceBy(100);
		await waiting;
		expect(removed).toContain("abort");
	});
});
