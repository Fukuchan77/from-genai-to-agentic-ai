import { PlatformError } from "../errors";
import type { Clock } from "../ports/clock";
import type { SandboxProvider, SandboxSession } from "../ports/sandbox";

/** One caller's hold on a session's sandbox. While any hold is open, `sweep` leaves it alone. */
export interface SandboxLease {
	readonly session: SandboxSession;
	/** True when the previous sandbox of this session had expired and this one replaced it. */
	readonly recreated: boolean;
	/** Ends the hold and counts as activity. Calling it again does nothing. */
	done(): void;
}

export interface SandboxRegistry {
	acquire(sessionId: string, options?: { readonly signal?: AbortSignal }): Promise<SandboxLease>;
	/** Counts as activity for the idle timeout. Unknown sessions are ignored. */
	touch(sessionId: string): void;
	/** Closes the session's sandbox. Resolves true if there was one. */
	release(sessionId: string): Promise<boolean>;
	/** Closes every session idle for longer than the timeout and not in use. Returns their ids. */
	sweep(): Promise<readonly string[]>;
	/** True while a lease of the session is open (a run is using its sandbox). */
	isBusy(sessionId: string): boolean;
	/** Closes every session, in use or not (the setup is being replaced or the process ends). */
	closeAll(): Promise<readonly string[]>;
}

export interface SandboxRegistryParams {
	readonly provider: SandboxProvider;
	readonly clock: Clock;
	readonly idleTimeoutMs: number;
	/** Hard lifetime handed to the provider as a backstop for leaks. Defaults to three idle timeouts. */
	readonly lifetimeMs?: number;
	/**
	 * The most sandboxes alive at once. A new session over the cap evicts the idle one used longest
	 * ago; when every session is in use it is refused. Unlimited when omitted.
	 */
	readonly maxSessions?: number;
}

interface Entry {
	readonly session: SandboxSession;
	lastActive: number;
	inUse: number;
}

async function closeQuietly(session: SandboxSession): Promise<void> {
	try {
		await session.close();
	} catch {
		// The sandbox is forgotten either way; a failed close must not block the caller.
	}
}

async function aliveQuietly(session: SandboxSession): Promise<boolean> {
	try {
		return await session.isAlive();
	} catch {
		return false;
	}
}

/**
 * One sandbox per learner session (Req 3.7), created on demand and closed on release or after the
 * idle timeout. Time comes from the injected `Clock`. Calls for the same session run one after
 * another, so concurrent requests share one sandbox instead of racing to create two.
 */
export function createSandboxRegistry(params: SandboxRegistryParams): SandboxRegistry {
	const { provider, clock, idleTimeoutMs } = params;
	const lifetimeMs = params.lifetimeMs ?? idleTimeoutMs * 3;
	const { maxSessions } = params;
	if (maxSessions !== undefined && (!Number.isInteger(maxSessions) || maxSessions < 1)) {
		throw new RangeError("maxSessions must be a positive integer");
	}
	const entries = new Map<string, Entry>();
	const locks = new Map<string, Promise<void>>();

	function serialized<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
		const previous = locks.get(sessionId) ?? Promise.resolve();
		const run = previous.then(task);
		const tail = run.then(
			() => undefined,
			() => undefined,
		);
		locks.set(sessionId, tail);
		void tail.then(() => {
			if (locks.get(sessionId) === tail) locks.delete(sessionId);
		});
		return run;
	}

	function lease(entry: Entry, recreated: boolean): SandboxLease {
		let open = true;
		return {
			session: entry.session,
			recreated,
			done() {
				if (!open) return;
				open = false;
				entry.inUse -= 1;
				entry.lastActive = clock.now();
			},
		};
	}

	/** Makes room for one more session, or refuses when every session is in use. */
	async function makeRoom(): Promise<void> {
		if (maxSessions === undefined) return;
		while (entries.size >= maxSessions) {
			let oldest: [string, Entry] | undefined;
			for (const candidate of entries) {
				if (
					candidate[1].inUse === 0 &&
					(!oldest || candidate[1].lastActive < oldest[1].lastActive)
				) {
					oldest = candidate;
				}
			}
			if (!oldest) {
				throw new PlatformError(
					"provider-unavailable",
					`同時に使えるサンドボックスの上限（${maxSessions} 個）に達しました。使っていないセッションを終了してから、もう一度お試しください。`,
				);
			}
			entries.delete(oldest[0]);
			await closeQuietly(oldest[1].session);
		}
	}

	async function create(
		sessionId: string,
		recreated: boolean,
		signal: AbortSignal | undefined,
	): Promise<SandboxLease> {
		await makeRoom();
		const session = await provider.create({ timeoutMs: lifetimeMs, signal });
		const entry: Entry = { session, lastActive: clock.now(), inUse: 1 };
		entries.set(sessionId, entry);
		return lease(entry, recreated);
	}

	return {
		acquire(sessionId, options = {}) {
			return serialized(sessionId, async () => {
				const entry = entries.get(sessionId);
				if (entry) {
					entry.inUse += 1;
					if (await aliveQuietly(entry.session)) return lease(entry, false);
					// Expired: replace it once. The replacement is not probed again in this call.
					if (entries.get(sessionId) === entry) entries.delete(sessionId);
					await closeQuietly(entry.session);
					return create(sessionId, true, options.signal);
				}
				return create(sessionId, false, options.signal);
			});
		},

		touch(sessionId) {
			const entry = entries.get(sessionId);
			if (entry) entry.lastActive = clock.now();
		},

		release(sessionId) {
			return serialized(sessionId, async () => {
				const entry = entries.get(sessionId);
				if (!entry) return false;
				entries.delete(sessionId);
				await closeQuietly(entry.session);
				return true;
			});
		},

		isBusy: (sessionId) => (entries.get(sessionId)?.inUse ?? 0) > 0,

		async closeAll() {
			const all = [...entries];
			entries.clear();
			await Promise.all(all.map(([, entry]) => closeQuietly(entry.session)));
			return all.map(([sessionId]) => sessionId);
		},

		async sweep() {
			const now = clock.now();
			const expired: [string, Entry][] = [];
			for (const [sessionId, entry] of entries) {
				if (entry.inUse === 0 && now - entry.lastActive > idleTimeoutMs) {
					expired.push([sessionId, entry]);
				}
			}
			for (const [sessionId] of expired) entries.delete(sessionId);
			await Promise.all(expired.map(([, entry]) => closeQuietly(entry.session)));
			return expired.map(([sessionId]) => sessionId);
		},
	};
}
