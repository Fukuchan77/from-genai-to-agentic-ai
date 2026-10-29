import { raceWithAbort } from "../../ports/abort";
import type { Clock } from "../../ports/clock";

/**
 * Resolves when `ms` have passed on the injected clock, or rejects with the signal's reason as soon
 * as it aborts. `Clock` has no sleep, so the wait is the clock's own timeout signal (a `FakeClock`
 * moves it with `advanceBy`).
 */
export function waitFor(clock: Clock, ms: number, signal?: AbortSignal): Promise<void> {
	if (signal?.aborted) return Promise.reject(signal.reason);
	if (ms <= 0) return Promise.resolve();
	return new Promise<void>((resolve, reject) => {
		const timeout = clock.timeoutSignal(ms);
		const onAbort = () => reject(signal?.reason);
		const onTimeout = () => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		};
		timeout.addEventListener("abort", onTimeout, { once: true });
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

export interface RequestQueueOptions {
	readonly clock: Clock;
	readonly minIntervalMs: number;
}

export interface RequestQueue {
	/**
	 * Runs `task` after every earlier task has finished and `minIntervalMs` has passed since the last
	 * one ended. A failed task still counts as a request. Aborting rejects the caller at once; a task
	 * that never started is skipped and leaves no gap.
	 */
	run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T>;
}

/**
 * The arXiv terms of use ask for one connection and a pause of three seconds between requests
 * (plan C8). The interval is counted from the end of the previous request, the cautious reading.
 */
export function createRequestQueue(options: RequestQueueOptions): RequestQueue {
	const { clock, minIntervalMs } = options;
	if (!Number.isFinite(minIntervalMs) || minIntervalMs < 0) {
		throw new RangeError("minIntervalMs must be a finite non-negative number");
	}
	let tail: Promise<unknown> = Promise.resolve();
	let nextSlotAt = Number.NEGATIVE_INFINITY;

	return {
		run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
			const turn = tail.then(async () => {
				// `waitFor` rejects at once for a signal that is already aborted, so the task never starts.
				await waitFor(clock, nextSlotAt - clock.now(), signal);
				try {
					return await task();
				} finally {
					nextSlotAt = clock.now() + minIntervalMs;
				}
			});
			// A failure belongs to the caller; it must not stop the tasks behind it.
			tail = turn.catch(() => undefined);
			return raceWithAbort(turn, signal);
		},
	};
}
