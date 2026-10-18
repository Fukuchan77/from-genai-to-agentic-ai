// Types only: the implementations live in `sandbox/` (E2B, local container, mock). Neither E2B's
// nor Docker's types appear here, so callers depend on this port and nothing else (003 C6).

/** Which implementation backs a sandbox. */
export type SandboxKind = "e2b" | "docker" | "mock";

/** The failure of the code that ran inside the sandbox (not a failure of the sandbox itself). */
export interface SandboxExecutionError {
	readonly name: string;
	readonly message: string;
	readonly traceback: string;
}

export interface SandboxRunResult {
	readonly stdout: string;
	readonly stderr: string;
	/** Set when the Python code raised; `stdout` and `stderr` still hold what was printed before. */
	readonly error?: SandboxExecutionError | undefined;
}

/** One learner's isolated workspace. Generated code runs only here, never on the host. */
export interface SandboxSession {
	writeFile(path: string, bytes: Uint8Array): Promise<void>;
	runPython(code: string, options: { readonly timeoutMs: number }): Promise<SandboxRunResult>;
	/** False once the sandbox expired or was closed. */
	isAlive(): Promise<boolean>;
	close(): Promise<void>;
}

export interface SandboxProvider {
	readonly kind: SandboxKind;
	create(options: {
		readonly timeoutMs: number;
		readonly signal?: AbortSignal | undefined;
	}): Promise<SandboxSession>;
}
