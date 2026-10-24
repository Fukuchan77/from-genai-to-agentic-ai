import { PlatformError } from "../errors";
import type { Clock } from "../ports";
import type { Question } from "./interview";
import type { Persona } from "./personas";
import type { InterviewState } from "./session";

// The shape of an interview session in the web app's registry (plan CL-8, CL-11), shared by the
// three requirements routes: `sessions` creates it, `[id]/messages` advances it and `[id]/document`
// reads it. `ai-core` cannot import the registry (it lives in `apps/web`), so the accessor takes the
// registry getter as an argument and only this module knows the name, the idle limit and the value.

export const REQUIREMENTS_SESSION_REGISTRY = "requirements";
/** 10 minutes of inactivity (plan CL-8), counted with the injected `Clock`. */
export const REQUIREMENTS_SESSION_IDLE_MS = 600_000;

/** What the registry holds for one interview. The routes replace fields as the interview goes on. */
export interface RequirementsSession {
	readonly overview: string;
	readonly personas: readonly Persona[];
	/** The model the learner asked for; the next rounds resolve the same one. */
	readonly modelId?: string | undefined;
	state: InterviewState;
	/** Every question asked so far, in order, across rounds. */
	questions: readonly Question[];
	/** The rendered requirements document (Markdown), or null until the interview has ended. */
	document: string | null;
}

/** At most this many interviews are held at once; the registry otherwise only drops idle ones. */
export const REQUIREMENTS_MAX_SESSIONS = 100;

/** The part of `SessionRegistry<T>` (apps/web/lib/server/sessions.ts) that this module needs. */
export interface RawRequirementsSessionStore {
	get(id: string): RequirementsSession | undefined;
	create(id: string, factory: () => RequirementsSession): RequirementsSession;
	touch(id: string): void;
	dispose(id: string): boolean;
	/** Disposes of every expired session. */
	sweep(): readonly string[];
	size(): number;
}

/** What the routes use: the registry plus a sweep and a size cap on creation (W6 F-14). */
export interface RequirementsSessionStore {
	get(id: string): RequirementsSession | undefined;
	/** Sweeps expired sessions, then refuses (`provider-unavailable`) at the cap before it creates. */
	create(id: string, factory: () => RequirementsSession): RequirementsSession;
	touch(id: string): void;
	dispose(id: string): boolean;
	/** Sweeps, then throws `provider-unavailable` when no session can be added. Call it before any LLM call. */
	ensureCapacity(): void;
}

/** `getSessionRegistry` of `apps/web/lib/server/sessions.ts`, as far as this module needs it. */
export type SessionStoreFactory = (
	name: string,
	options: { readonly clock: Pick<Clock, "now">; readonly idleTimeoutMs: number },
) => RawRequirementsSessionStore;

/**
 * The shared interview registry. Call it as
 * `getRequirementsSessions(getSessionRegistry, platform.clock)`; every route gets the same store.
 */
export function getRequirementsSessions(
	getRegistry: SessionStoreFactory,
	clock: Pick<Clock, "now">,
): RequirementsSessionStore {
	const raw = getRegistry(REQUIREMENTS_SESSION_REGISTRY, {
		clock,
		idleTimeoutMs: REQUIREMENTS_SESSION_IDLE_MS,
	});
	// Expiry in the registry is lazy and only a sandbox registry is swept by a timer, so abandoned
	// interviews would stay for the life of the process: sweep whenever a session is added.
	const ensureCapacity = (): void => {
		raw.sweep();
		if (raw.size() >= REQUIREMENTS_MAX_SESSIONS) {
			throw new PlatformError(
				"provider-unavailable",
				"同時に進められる面接の数の上限に達しました。しばらくしてからもう一度お試しください。",
				{ max: REQUIREMENTS_MAX_SESSIONS },
			);
		}
	};
	return {
		get: (id) => raw.get(id),
		create(id, factory) {
			ensureCapacity();
			return raw.create(id, factory);
		},
		touch: (id) => raw.touch(id),
		dispose: (id) => raw.dispose(id),
		ensureCapacity,
	};
}
