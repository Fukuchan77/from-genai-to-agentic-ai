export interface Clock {
	now(): number;
	timeoutSignal(ms: number): AbortSignal;
}

export interface FakeClock extends Clock {
	advanceBy(ms: number): void;
	set(time: number): void;
}

function assertFiniteNonNegative(value: number, name: string): void {
	if (!Number.isFinite(value) || value < 0) {
		throw new RangeError(`${name} must be a finite non-negative number`);
	}
}

function timeoutReason(): DOMException {
	return new DOMException("The operation timed out", "TimeoutError");
}

export const systemClock: Clock = Object.freeze({
	now: () => Date.now(),
	timeoutSignal: (ms: number) => {
		assertFiniteNonNegative(ms, "timeout");
		return AbortSignal.timeout(ms);
	},
});

export function createFakeClock(initialTime = 0): FakeClock {
	assertFiniteNonNegative(initialTime, "initialTime");
	let currentTime = initialTime;
	const deadlines = new Map<AbortController, number>();

	function abortExpired(): void {
		for (const [controller, deadline] of deadlines) {
			if (deadline <= currentTime) {
				controller.abort(timeoutReason());
				deadlines.delete(controller);
			}
		}
	}

	return {
		now: () => currentTime,
		timeoutSignal: (ms) => {
			assertFiniteNonNegative(ms, "timeout");
			const controller = new AbortController();
			deadlines.set(controller, currentTime + ms);
			abortExpired();
			return controller.signal;
		},
		advanceBy: (ms) => {
			assertFiniteNonNegative(ms, "advanceBy");
			currentTime += ms;
			abortExpired();
		},
		set: (time) => {
			assertFiniteNonNegative(time, "time");
			if (time < currentTime) throw new RangeError("Fake clock cannot move backwards");
			currentTime = time;
			abortExpired();
		},
	};
}
