import { PlatformError } from "../errors";
import type {
	SandboxExecutionError,
	SandboxProvider,
	SandboxRunResult,
	SandboxSession,
} from "../ports/sandbox";
import { assertSandboxFileName } from "./file-name";

// The only file that imports `@e2b/code-interpreter` (rule `sandbox-import-scope`, 003 C6). The
// types below are the slice of the SDK this provider uses, read from the 2.9.0 `.d.ts` (research
// S-4), so tests can pass a fake and the SDK stays out of every other file.

/** The directory E2B's default code context runs in; input files are written here. */
const WORK_DIRECTORY = "/home/user";

export interface E2bExecution {
	readonly results: readonly unknown[];
	readonly logs: { readonly stdout: readonly string[]; readonly stderr: readonly string[] };
	readonly error?:
		| { readonly name: string; readonly value: string; readonly traceback: string }
		| undefined;
}

export interface E2bSandbox {
	readonly files: { write(path: string, data: ArrayBuffer): Promise<unknown> };
	runCode(code: string, options?: { timeoutMs?: number | undefined }): Promise<E2bExecution>;
	isRunning(): Promise<boolean>;
	kill(): Promise<unknown>;
}

export interface E2bCreateOptions {
	readonly apiKey: string;
	readonly timeoutMs: number;
	readonly allowInternetAccess?: boolean;
}

export interface E2bSdk {
	readonly Sandbox: { create(options: E2bCreateOptions): Promise<E2bSandbox> };
}

export interface E2bProviderParams {
	/** `E2B_API_KEY`. Without it, `create` fails before the SDK is loaded. */
	readonly apiKey: string | undefined;
	/** The SDK, or a function that loads it on first use. Defaults to importing the real package. */
	readonly sdk?: E2bSdk | (() => Promise<E2bSdk>);
	/**
	 * Set to `false` to cut outbound network access from the sandbox. Left out, the SDK's own
	 * default applies (outbound access allowed; research S-4, handed to 004 by CL-21).
	 */
	readonly allowInternetAccess?: boolean;
}

async function loadRealSdk(): Promise<E2bSdk> {
	const { Sandbox } = await import("@e2b/code-interpreter");
	return {
		Sandbox: {
			create: (options) => Sandbox.create(options) as Promise<E2bSandbox>,
		},
	};
}

function errorName(error: unknown): string {
	return error instanceof Error ? error.name : "";
}

// Messages are fixed text: an SDK error can carry the request (and the key), so none is echoed.
function unavailable(message: string): PlatformError {
	return new PlatformError("provider-unavailable", message);
}

const CLOSED = "サンドボックスは終了しています。";
const EXPIRED = "サンドボックスの有効期限が切れました。もう一度実行してください。";

/** Runs generated code in an E2B cloud sandbox (Req 3.1). */
export function createE2bProvider(params: E2bProviderParams): SandboxProvider {
	const { apiKey, allowInternetAccess } = params;
	let loading: Promise<E2bSdk> | undefined;

	function sdk(): Promise<E2bSdk> {
		const source = params.sdk;
		if (source && typeof source !== "function") return Promise.resolve(source);
		loading ??= (source ?? loadRealSdk)();
		return loading;
	}

	return {
		kind: "e2b",
		async create({ timeoutMs, signal }): Promise<SandboxSession> {
			signal?.throwIfAborted();
			const key = apiKey?.trim();
			if (!key) {
				throw unavailable(
					"E2B_API_KEY が設定されていないため、E2B のサンドボックスを作成できません。",
				);
			}

			let sandbox: E2bSandbox;
			try {
				const loaded = await sdk();
				sandbox = await loaded.Sandbox.create({
					apiKey: key,
					timeoutMs,
					...(allowInternetAccess === undefined ? {} : { allowInternetAccess }),
				});
			} catch (error) {
				throw errorName(error) === "AuthenticationError"
					? unavailable("E2B_API_KEY が無効です。キーを確認してください。")
					: unavailable("E2B のサンドボックスを作成できませんでした。");
			}
			// `Sandbox.create` takes no signal, so an abort during creation is honoured afterwards:
			// the new sandbox is killed rather than left running.
			if (signal?.aborted) {
				await sandbox.kill().catch(() => undefined);
				signal.throwIfAborted();
			}
			return wrap(sandbox);
		},
	};
}

function wrap(sandbox: E2bSandbox): SandboxSession {
	let closed = false;

	// A timeout is either the code running too long (the code's failure, which the fix loop sees)
	// or the sandbox having expired under the request (the sandbox's failure). The SDK uses one
	// error class for both, so the liveness check tells them apart.
	async function resultOfFailedRun(error: unknown, timeoutMs: number): Promise<SandboxRunResult> {
		const name = errorName(error);
		if (name === "SandboxNotFoundError" || name === "NotFoundError") throw unavailable(EXPIRED);
		if (name !== "TimeoutError") {
			throw unavailable("E2B のサンドボックスでコードを実行できませんでした。");
		}
		if (!(await sandbox.isRunning().catch(() => false))) throw unavailable(EXPIRED);
		return {
			stdout: "",
			stderr: "",
			error: {
				name: "TimeoutError",
				message: `実行が ${timeoutMs} ms を超えたため中断しました。`,
				traceback: "",
			},
		};
	}

	return {
		async writeFile(name, bytes) {
			if (closed) throw unavailable(CLOSED);
			assertSandboxFileName(name);
			try {
				await sandbox.files.write(`${WORK_DIRECTORY}/${name}`, bytes.slice().buffer);
			} catch {
				throw unavailable("E2B のサンドボックスへファイルを書き込めませんでした。");
			}
		},

		async runPython(code, { timeoutMs }) {
			if (closed) throw unavailable(CLOSED);
			let execution: E2bExecution;
			try {
				execution = await sandbox.runCode(code, { timeoutMs });
			} catch (error) {
				return resultOfFailedRun(error, timeoutMs);
			}
			const result: SandboxRunResult = {
				stdout: execution.logs.stdout.join(""),
				stderr: execution.logs.stderr.join(""),
			};
			if (!execution.error) return result;
			const failure: SandboxExecutionError = {
				name: execution.error.name,
				message: execution.error.value,
				traceback: execution.error.traceback,
			};
			return { ...result, error: failure };
		},

		async isAlive() {
			if (closed) return false;
			return sandbox.isRunning().catch(() => false);
		},

		async close() {
			if (closed) return;
			closed = true;
			try {
				await sandbox.kill();
			} catch {
				// The sandbox also expires by itself; a failed kill must not block the caller.
			}
		},
	};
}
