import type { Clock } from "@platform/ai-core/ports";

// In-process learner sessions (plan C13, CL-8, CL-11): a session lives in memory, is identified by
// an id the server hands out, and is disposed of when it has been idle for `idleTimeoutMs` (counted
// with the injected `Clock`) or when its owner ends it. Nothing is persisted: this is a single-learner
// learning app, and a restart ends the sessions.

export interface SessionRegistryOptions<T> {
	readonly clock: Pick<Clock, "now">;
	readonly idleTimeoutMs: number;
	/** Called once with a session's value when it is disposed of, however that happens. */
	readonly onDispose?: (id: string, value: T) => void;
}

export interface SessionRegistry<T> {
	/** The live session, or undefined. An expired session is disposed of here and not returned. */
	get(id: string): T | undefined;
	/** Creates a session. Throws if a live session already has this id; the factory's throw leaves nothing behind. */
	create(id: string, factory: () => T): T;
	/** Counts as activity. A plain `get` does not. Unknown ids are ignored. */
	touch(id: string): void;
	/** Ends a session. True if there was one. A throwing hook does not keep it alive. */
	dispose(id: string): boolean;
	/** Disposes of every expired session and returns their ids. */
	sweep(): readonly string[];
	size(): number;
}

interface Entry<T> {
	readonly value: T;
	lastActive: number;
}

/** A process-local registry; see the module comment. */
export function createSessionRegistry<T>(options: SessionRegistryOptions<T>): SessionRegistry<T> {
	const { clock, idleTimeoutMs } = options;
	if (!Number.isFinite(idleTimeoutMs) || idleTimeoutMs <= 0) {
		throw new RangeError("idleTimeoutMs must be a positive finite number");
	}
	const entries = new Map<string, Entry<T>>();

	const expired = (entry: Entry<T>) => clock.now() - entry.lastActive > idleTimeoutMs;

	function remove(id: string, entry: Entry<T>): void {
		entries.delete(id);
		try {
			options.onDispose?.(id, entry.value);
		} catch {
			// The session is gone either way; a failing hook must not stop the caller or a sweep.
		}
	}

	function live(id: string): Entry<T> | undefined {
		const entry = entries.get(id);
		if (!entry) return undefined;
		if (expired(entry)) {
			remove(id, entry);
			return undefined;
		}
		return entry;
	}

	return {
		get: (id) => live(id)?.value,

		create(id, factory) {
			if (id === "") throw new RangeError("session id must not be empty");
			if (live(id)) throw new RangeError(`session ${id} already exists`);
			const value = factory();
			entries.set(id, { value, lastActive: clock.now() });
			return value;
		},

		touch(id) {
			const entry = live(id);
			if (entry) entry.lastActive = clock.now();
		},

		dispose(id) {
			const entry = entries.get(id);
			if (!entry) return false;
			remove(id, entry);
			return true;
		},

		sweep() {
			const gone: string[] = [];
			for (const [id, entry] of [...entries]) {
				if (!expired(entry)) continue;
				remove(id, entry);
				gone.push(id);
			}
			return gone;
		},

		size: () => entries.size,
	};
}

// --- The registries of the process ---

// Kept on `globalThis` like the platform: a Route Handler can be a separate bundle, and the dev
// server reloads modules, so a registry in a module variable would not hold the session another
// route created. Each name is created once, with the options of its first caller.
const REGISTRIES_KEY = Symbol.for("from-genai-to-agentic-ai.session-registries");

type RegistryHolder = { [REGISTRIES_KEY]?: Map<string, SessionRegistry<unknown>> };

/** The shared registry called `name`, created with `options` on first use. */
export function getSessionRegistry<T>(
	name: string,
	options: SessionRegistryOptions<T>,
): SessionRegistry<T> {
	const holder = globalThis as RegistryHolder;
	const registries = holder[REGISTRIES_KEY] ?? new Map<string, SessionRegistry<unknown>>();
	holder[REGISTRIES_KEY] = registries;
	const existing = registries.get(name);
	if (existing) return existing as SessionRegistry<T>;
	const created = createSessionRegistry(options);
	registries.set(name, created as SessionRegistry<unknown>);
	return created;
}

/** Test seam: forgets every shared registry. */
export function resetSessionRegistriesForTesting(): void {
	delete (globalThis as RegistryHolder)[REGISTRIES_KEY];
}
