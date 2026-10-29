import { DEFAULT_SANDBOX } from "../../config/defaults";
import { PlatformError } from "../../errors";
import { type Clock, systemClock } from "../../ports/clock";
import type {
	SandboxExecutionError,
	SandboxProvider,
	SandboxRunResult,
	SandboxSession,
} from "../../ports/sandbox";
import { assertSandboxFileName } from "../file-name";
import { demuxDockerStream } from "./demux";
import type { DockerContainerSpec, DockerEngine } from "./engine";

/** The user the image runs as: numeric and never root. `docker/sandbox/Dockerfile` creates it. */
export const SANDBOX_USER = "10001:10001";
/** Where the code of a run is placed. Reserved: `writeFile` refuses this name. */
export const SANDBOX_MAIN_FILE = "_sandbox_main.py";

const WORK_DIRECTORY = "/work";
// A read-only root accepts files only in a volume, and a tmpfs is mounted over whatever the
// daemon wrote before start, so `/work` is an anonymous volume (measured, research S-5). The only
// writable place for the code is this small tmpfs; it has no execute bit.
const TMP_OPTIONS = "rw,noexec,nosuid,size=64m";
const MAX_LOG_BYTES = 16 * 1024 * 1024;
// What the daemon keeps of a container's output: without a cap, code that prints in a loop writes
// to the host's disk until the run's timeout removes the container.
const LOG_CONFIG = { Type: "json-file", Config: { "max-size": "16m", "max-file": "1" } } as const;
/** Marks every container the provider makes, so leftovers can be found (`mise run sandbox:clean`). */
export const SANDBOX_LABEL = "agentic-ai.sandbox";
const REMOVE_ATTEMPTS = 2;

export interface DockerLimits {
	readonly memoryBytes: number;
	readonly cpus: number;
	readonly pidsLimit: number;
}

export interface DockerProviderParams {
	readonly engine: DockerEngine;
	/** The sandbox image (`DEFAULT_SANDBOX.image` unless `DOCKER_SANDBOX_IMAGE` says otherwise). */
	readonly image: string;
	readonly limits?: Partial<DockerLimits>;
	/** Time source for the run timeout and the session lifetime. */
	readonly clock?: Clock;
	/** Told about a container that could not be removed. Receives text with no secrets in it. */
	readonly onWarning?: (message: string) => void;
}

const CLOSED = "サンドボックスは終了しています。";
const EXPIRED = "サンドボックスの有効期限が切れました。もう一度実行してください。";

function unavailable(message: string): PlatformError {
	return new PlatformError("provider-unavailable", message);
}

function buildSpec(image: string, limits: DockerLimits): DockerContainerSpec {
	return {
		Image: image,
		Cmd: ["python", `${WORK_DIRECTORY}/${SANDBOX_MAIN_FILE}`],
		User: SANDBOX_USER,
		WorkingDir: WORK_DIRECTORY,
		Env: [
			"HOME=/tmp",
			"MPLCONFIGDIR=/tmp/matplotlib",
			"PYTHONDONTWRITEBYTECODE=1",
			"PYTHONUNBUFFERED=1",
			"PYTHONIOENCODING=utf-8",
		],
		NetworkDisabled: true,
		Labels: { [SANDBOX_LABEL]: "1" },
		HostConfig: {
			NetworkMode: "none",
			ReadonlyRootfs: true,
			Memory: limits.memoryBytes,
			MemorySwap: limits.memoryBytes,
			NanoCpus: Math.round(limits.cpus * 1_000_000_000),
			PidsLimit: limits.pidsLimit,
			LogConfig: LOG_CONFIG,
			CapDrop: ["ALL"],
			SecurityOpt: ["no-new-privileges"],
			Tmpfs: { "/tmp": TMP_OPTIONS },
			Mounts: [{ Type: "volume", Target: WORK_DIRECTORY }],
		},
	};
}

const EXCEPTION_LINE = /^([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)(?::\s*(.*))?$/;
const TRACEBACK_HEADER = "Traceback (most recent call last):";

/** Reads the final exception of a Python traceback. Undefined when stderr holds none. */
function parseTraceback(stderr: string): SandboxExecutionError | undefined {
	const text = stderr.trimEnd();
	const lines = text.split("\n");
	for (let index = lines.length - 1; index >= 0; index -= 1) {
		const match = EXCEPTION_LINE.exec(lines[index] ?? "");
		const name = match?.[1];
		if (name && /(Error|Exception|Exit|Interrupt|Warning)$/.test(name)) {
			const start = text.lastIndexOf(TRACEBACK_HEADER);
			return {
				name,
				message: match[2] ?? "",
				traceback: start >= 0 ? text.slice(start) : text,
			};
		}
	}
	return undefined;
}

function failureOfExit(exitCode: number, stderr: string): SandboxExecutionError {
	const parsed = parseTraceback(stderr);
	if (parsed) return parsed;
	if (exitCode === 137) {
		return {
			name: "Killed",
			message:
				"プロセスが強制終了されました（メモリの上限を超えた可能性があります）。使うメモリを減らしてください。",
			traceback: "",
		};
	}
	return {
		name: "ExitCode",
		message: `プロセスが終了コード ${exitCode} で終了しました。`,
		traceback: stderr.trimEnd(),
	};
}

/**
 * Runs generated code in a throwaway local container per run (Req 3.8): no network, a read-only
 * root, no capabilities, a non-root user and memory, CPU and process limits. The session keeps the
 * input files in memory and places them in each run's own container, which is always removed.
 */
export function createDockerProvider(params: DockerProviderParams): SandboxProvider {
	const { engine, image, onWarning } = params;
	const clock = params.clock ?? systemClock;
	const limits: DockerLimits = {
		memoryBytes: params.limits?.memoryBytes ?? DEFAULT_SANDBOX.memoryBytes,
		cpus: params.limits?.cpus ?? DEFAULT_SANDBOX.cpus,
		pidsLimit: params.limits?.pidsLimit ?? DEFAULT_SANDBOX.pidsLimit,
	};

	return {
		kind: "docker",
		async create({ timeoutMs, signal }): Promise<SandboxSession> {
			signal?.throwIfAborted();
			const expiresAt = clock.now() + timeoutMs;
			const files = new Map<string, Uint8Array>();
			const active = new Set<string>();
			const leaked = new Set<string>();
			let closed = false;

			function assertUsable(): void {
				if (closed) throw unavailable(CLOSED);
				if (clock.now() > expiresAt) throw unavailable(EXPIRED);
			}

			async function removeQuietly(id: string): Promise<boolean> {
				for (let attempt = 0; attempt < REMOVE_ATTEMPTS; attempt += 1) {
					try {
						await engine.remove(id);
						return true;
					} catch {
						// Try again, then give up and report it.
					}
				}
				return false;
			}

			async function removeAfterRun(id: string): Promise<void> {
				const removed = await removeQuietly(id);
				active.delete(id);
				if (removed) return;
				leaked.add(id);
				onWarning?.(`Docker のコンテナ ${id} を削除できませんでした。手動で削除してください。`);
			}

			async function readLogs(id: string): Promise<{ stdout: string; stderr: string }> {
				const demuxed = demuxDockerStream(await engine.logs(id, { maxBytes: MAX_LOG_BYTES }));
				const note = demuxed.warnings.length > 0 ? `\n[注意] ${demuxed.warnings.join(" ")}\n` : "";
				return { stdout: demuxed.stdout, stderr: demuxed.stderr + note };
			}

			async function run(code: string, timeoutMs: number): Promise<SandboxRunResult> {
				// The files as they are now: a write or a close during the run cannot change this run's set.
				const inputs = [...files];
				const id = await engine.createContainer(buildSpec(image, limits));
				active.add(id);
				try {
					// `close` removes only the containers it knew of, so a session closed while this one
					// was being made ends the run here (the `finally` removes the container).
					if (closed) throw unavailable(CLOSED);
					for (const [name, bytes] of inputs) {
						await engine.putFile(id, WORK_DIRECTORY, name, bytes);
					}
					await engine.putFile(
						id,
						WORK_DIRECTORY,
						SANDBOX_MAIN_FILE,
						new TextEncoder().encode(code),
					);
					if (closed) throw unavailable(CLOSED);
					await engine.start(id);

					const deadline = clock.timeoutSignal(timeoutMs);
					let exitCode: number;
					try {
						exitCode = await engine.wait(id, { signal: deadline });
					} catch (error) {
						if (!deadline.aborted) throw error;
						// Out of time: keep what was printed, then the `finally` removes (kills) the container.
						const partial = await readLogs(id).catch(() => ({ stdout: "", stderr: "" }));
						return {
							...partial,
							error: {
								name: "TimeoutError",
								message: `実行が ${timeoutMs} ms を超えたため中断しました。`,
								traceback: "",
							},
						};
					}

					const logs = await readLogs(id);
					if (exitCode === 0) return logs;
					return { ...logs, error: failureOfExit(exitCode, logs.stderr) };
				} finally {
					await removeAfterRun(id);
				}
			}

			return {
				async writeFile(name, bytes) {
					assertUsable();
					assertSandboxFileName(name);
					if (name === SANDBOX_MAIN_FILE) {
						throw new PlatformError(
							"invalid-request",
							"このファイル名はサンドボックスが使うため指定できません。",
						);
					}
					files.set(name, bytes.slice());
				},

				async runPython(code, { timeoutMs }) {
					assertUsable();
					return run(code, timeoutMs);
				},

				async isAlive() {
					return !closed && clock.now() <= expiresAt;
				},

				async close() {
					if (closed) return;
					closed = true;
					// A run in progress is cut short: removing its container ends its `wait`.
					const pending = [...active, ...leaked];
					const removed = await Promise.all(pending.map((id) => removeQuietly(id)));
					pending.forEach((id, index) => {
						if (!removed[index]) {
							onWarning?.(
								`Docker のコンテナ ${id} を削除できませんでした。手動で削除してください。`,
							);
						}
					});
					active.clear();
					leaked.clear();
					files.clear();
				},
			};
		},
	};
}
