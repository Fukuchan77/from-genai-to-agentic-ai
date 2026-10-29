import errorFixture from "../../fixtures/sandbox/mock-error.json";
import successFixture from "../../fixtures/sandbox/mock-success.json";
import { PlatformError } from "../errors";
import type {
	SandboxExecutionError,
	SandboxProvider,
	SandboxRunResult,
	SandboxSession,
} from "../ports/sandbox";
import { assertSandboxFileName } from "./file-name";
import { MOCK_ERROR_MARKER } from "./mock-marker";

export { MOCK_ERROR_MARKER };

interface Fixture {
	readonly stdout: string;
	readonly stderr: string;
	readonly error?: SandboxExecutionError;
}

const SUCCESS: SandboxRunResult = successFixture satisfies Fixture;
const FAILURE: SandboxRunResult = errorFixture satisfies Fixture;

/** What a test sees of one session the mock handed out. */
export interface MockSandboxRecord {
	/** Raw bytes per path, copied at write time. */
	readonly files: ReadonlyMap<string, Uint8Array>;
	/** The code of every `runPython` call, in order. */
	readonly runs: readonly string[];
	/** How many times `close` actually released the session (idempotent calls count once). */
	readonly closeCount: number;
}

export interface MockSandboxProvider extends SandboxProvider {
	readonly kind: "mock";
	/** Every session created so far, in creation order. */
	readonly sessions: readonly MockSandboxRecord[];
}

export interface MockSandboxOptions {
	/** Chooses the result of a run. `index` counts the runs of that session from 0. */
	readonly respond?: (code: string, index: number) => SandboxRunResult;
}

function defaultRespond(code: string): SandboxRunResult {
	return code.includes(MOCK_ERROR_MARKER) ? FAILURE : SUCCESS;
}

function closedError(): PlatformError {
	return new PlatformError("provider-unavailable", "サンドボックスは終了しています。");
}

/**
 * A stand-in for a real sandbox (Req 3.10). It runs nothing: it answers from fixtures, so the
 * fix loop, the output parsing and the lifecycle can be checked without Docker or E2B.
 */
export function createMockSandboxProvider(options: MockSandboxOptions = {}): MockSandboxProvider {
	const respond = options.respond ?? defaultRespond;
	const sessions: MutableRecord[] = [];

	return {
		kind: "mock",
		sessions,
		async create({ signal }): Promise<SandboxSession> {
			signal?.throwIfAborted();
			const record: MutableRecord = { files: new Map(), runs: [], closeCount: 0 };
			sessions.push(record);
			let closed = false;
			return {
				async writeFile(path, bytes) {
					if (closed) throw closedError();
					assertSandboxFileName(path);
					record.files.set(path, bytes.slice());
				},
				async runPython(code) {
					if (closed) throw closedError();
					const index = record.runs.length;
					record.runs.push(code);
					return respond(code, index);
				},
				async isAlive() {
					return !closed;
				},
				async close() {
					if (closed) return;
					closed = true;
					record.closeCount += 1;
					// A session that is over keeps no upload: the mock runs in the Web app's `mock` mode too.
					record.files.clear();
				},
			};
		},
	};
}

interface MutableRecord {
	readonly files: Map<string, Uint8Array>;
	readonly runs: string[];
	closeCount: number;
}
