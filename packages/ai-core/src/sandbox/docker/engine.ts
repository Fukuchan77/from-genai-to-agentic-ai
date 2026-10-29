import http from "node:http";
import { PlatformError } from "../../errors";
import { assertSandboxFileName } from "../file-name";
import { createSingleFileTar } from "./tar";

// A thin client for the Docker Engine API over a unix socket, with `node:http` and nothing else
// (ADR-4: no `dockerode`). Only the calls the sandbox needs: create, put a file, start, wait,
// logs, remove. This directory is the only place allowed to open a Docker connection (rule
// `sandbox-import-scope`).

const DEFAULT_API_VERSION = "1.44";
const DEFAULT_MAX_LOG_BYTES = 32 * 1024 * 1024;
// A daemon that accepts a connection and never answers (starting up, paused VM) must not hang the
// caller: every call but `wait` has a limit. Moving a 20 MiB input takes longer than a check.
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_QUICK_TIMEOUT_MS = 3_000;
const CONTAINER_ID = /^[0-9a-f]{12,64}$/;
const IMAGE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.:/@-]*$/;

/** The body of `POST /containers/create`, limited to the fields the sandbox sets. */
export interface DockerContainerSpec {
	readonly Image: string;
	readonly Cmd: readonly string[];
	readonly User: string;
	readonly WorkingDir: string;
	readonly Env?: readonly string[];
	readonly NetworkDisabled: boolean;
	readonly Labels?: Readonly<Record<string, string>>;
	readonly HostConfig: {
		readonly NetworkMode: "none";
		readonly ReadonlyRootfs: boolean;
		readonly Memory?: number;
		readonly MemorySwap?: number;
		readonly NanoCpus?: number;
		readonly PidsLimit?: number;
		readonly LogConfig?: {
			readonly Type: string;
			readonly Config: Readonly<Record<string, string>>;
		};
		readonly CapDrop?: readonly string[];
		readonly SecurityOpt?: readonly string[];
		readonly Tmpfs?: Readonly<Record<string, string>>;
		readonly Mounts?: readonly { readonly Type: "volume"; readonly Target: string }[];
	};
}

interface CallOptions {
	readonly signal?: AbortSignal | undefined;
}

export interface DockerEngine {
	/** True when the daemon answers; never throws. */
	ping(): Promise<boolean>;
	imageExists(name: string): Promise<boolean>;
	createContainer(spec: DockerContainerSpec): Promise<string>;
	/** Puts one file into `directory` of the container (a volume path when the root is read-only). */
	putFile(id: string, directory: string, name: string, bytes: Uint8Array): Promise<void>;
	start(id: string): Promise<void>;
	/** Resolves with the exit code once the container stops. Abort the signal to stop waiting. */
	wait(id: string, options?: CallOptions): Promise<number>;
	/** The raw multiplexed log stream (`demuxDockerStream` splits it), at most `maxBytes` of it. */
	logs(id: string, options?: { readonly maxBytes?: number }): Promise<Uint8Array>;
	/** Force-removes the container and its anonymous volumes. A container already gone is fine. */
	remove(id: string): Promise<void>;
}

export interface DockerEngineParams {
	readonly socketPath: string;
	/** Defaults to 1.44, the oldest API of the Docker versions still supported. */
	readonly apiVersion?: string;
	/** Replaces the connection (tests pass an in-memory agent). */
	readonly agent?: http.Agent;
	/** Limit for the calls that move data or change something. Defaults to 30 s. */
	readonly requestTimeoutMs?: number;
	/** Limit for `ping` and `imageExists`. Defaults to 3 s. */
	readonly quickTimeoutMs?: number;
}

interface RawRequest {
	readonly method: "GET" | "POST" | "PUT" | "DELETE";
	readonly path: string;
	readonly body?: Uint8Array | string;
	readonly contentType?: string;
	readonly signal?: AbortSignal | undefined;
	/** Give up after this long (the whole exchange, including the body). Not set for `wait`. */
	readonly timeoutMs?: number;
	/** Stop reading the response after this many bytes. */
	readonly maxBytes?: number;
}

interface RawResponse {
	readonly status: number;
	readonly body: Buffer;
}

// Messages are fixed text; the daemon's own message can hold host paths, so only its status is kept.
function unavailable(operation: string, message: string, status?: number): PlatformError {
	return new PlatformError("provider-unavailable", message, {
		operation,
		...(status === undefined ? {} : { status }),
	});
}

function assertContainerId(id: string): void {
	if (!CONTAINER_ID.test(id)) {
		throw new PlatformError("invalid-request", "Docker のコンテナ ID の形式が不正です。");
	}
}

export function createDockerEngine(params: DockerEngineParams): DockerEngine {
	const prefix = `/v${params.apiVersion ?? DEFAULT_API_VERSION}`;
	const requestTimeoutMs = params.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
	const quickTimeoutMs = params.quickTimeoutMs ?? DEFAULT_QUICK_TIMEOUT_MS;

	function send(request: RawRequest): Promise<RawResponse> {
		const callerSignal = request.signal;
		const timeout =
			request.timeoutMs === undefined ? undefined : AbortSignal.timeout(request.timeoutMs);
		const signals = [callerSignal, timeout].filter(
			(item): item is AbortSignal => item !== undefined,
		);
		const signal = signals.length > 1 ? AbortSignal.any(signals) : signals[0];
		return new Promise((resolve, reject) => {
			const body = request.body === undefined ? undefined : Buffer.from(request.body);
			const clientRequest = http.request(
				{
					socketPath: params.socketPath,
					method: request.method,
					path: request.path,
					...(params.agent ? { agent: params.agent } : {}),
					headers: {
						...(body ? { "Content-Length": String(body.length) } : {}),
						...(request.contentType ? { "Content-Type": request.contentType } : {}),
					},
					...(signal ? { signal } : {}),
				},
				(response) => {
					const chunks: Buffer[] = [];
					let size = 0;
					const limit = request.maxBytes ?? Number.POSITIVE_INFINITY;
					response.on("data", (chunk: Buffer) => {
						const room = limit - size;
						chunks.push(room < chunk.length ? chunk.subarray(0, room) : chunk);
						size += Math.min(chunk.length, room);
						if (size >= limit) response.destroy();
					});
					// A body cut short because the call was aborted or timed out is a failure, not a
					// smaller answer; one cut short by the byte limit above is the answer.
					const finish = () =>
						signal?.aborted
							? reject(callerSignal?.aborted ? callerSignal.reason : signal.reason)
							: resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks) });
					response.on("end", finish);
					response.on("close", finish);
					response.on("error", reject);
				},
			);
			clientRequest.on("error", (error) => {
				reject(callerSignal?.aborted ? callerSignal.reason : error);
			});
			if (body) clientRequest.write(body);
			clientRequest.end();
		});
	}

	// A connection-level failure becomes a provider-unavailable error; an abort passes through.
	async function call(
		operation: string,
		message: string,
		request: RawRequest,
	): Promise<RawResponse> {
		try {
			return await send(request);
		} catch (error) {
			if (request.signal?.aborted) throw error;
			throw unavailable(operation, message);
		}
	}

	return {
		async ping() {
			try {
				const response = await send({ method: "GET", path: "/_ping", timeoutMs: quickTimeoutMs });
				return response.status === 200;
			} catch {
				return false;
			}
		},

		async imageExists(name) {
			if (!IMAGE_NAME.test(name)) {
				throw new PlatformError("invalid-request", "サンドボックスの画像名の形式が不正です。");
			}
			const message = "Docker から画像の有無を取得できませんでした。";
			const response = await call("image", message, {
				method: "GET",
				path: `${prefix}/images/${name}/json`,
				timeoutMs: quickTimeoutMs,
			});
			if (response.status === 200) return true;
			if (response.status === 404) return false;
			throw unavailable("image", message, response.status);
		},

		async createContainer(spec) {
			const response = await call("create", "Docker でコンテナを作成できませんでした。", {
				method: "POST",
				path: `${prefix}/containers/create`,
				body: JSON.stringify(spec),
				contentType: "application/json",
				timeoutMs: requestTimeoutMs,
			});
			if (response.status === 404) {
				throw unavailable(
					"create",
					"サンドボックスの画像が見つかりません。`mise run sandbox:build` で作成してください。",
					404,
				);
			}
			const id = response.status === 201 ? parseId(response.body) : undefined;
			if (!id)
				throw unavailable("create", "Docker でコンテナを作成できませんでした。", response.status);
			return id;
		},

		async putFile(id, directory, name, bytes) {
			assertContainerId(id);
			assertSandboxFileName(name);
			const message = "Docker のコンテナへファイルを配置できませんでした。";
			const response = await call("archive", message, {
				method: "PUT",
				path: `${prefix}/containers/${id}/archive?path=${encodeURIComponent(directory)}`,
				body: createSingleFileTar(name, bytes),
				contentType: "application/x-tar",
				timeoutMs: requestTimeoutMs,
			});
			if (response.status !== 200) throw unavailable("archive", message, response.status);
		},

		async start(id) {
			assertContainerId(id);
			const message = "Docker のコンテナを起動できませんでした。";
			const response = await call("start", message, {
				method: "POST",
				path: `${prefix}/containers/${id}/start`,
				timeoutMs: requestTimeoutMs,
			});
			if (response.status !== 204 && response.status !== 304) {
				throw unavailable("start", message, response.status);
			}
		},

		async wait(id, options = {}) {
			assertContainerId(id);
			const message = "Docker のコンテナの終了を待てませんでした。";
			const response = await call("wait", message, {
				method: "POST",
				path: `${prefix}/containers/${id}/wait?condition=not-running`,
				signal: options.signal,
			});
			const code = response.status === 200 ? parseStatusCode(response.body) : undefined;
			if (code === undefined) throw unavailable("wait", message, response.status);
			return code;
		},

		async logs(id, options = {}) {
			assertContainerId(id);
			const message = "Docker のコンテナのログを取得できませんでした。";
			const response = await call("logs", message, {
				method: "GET",
				path: `${prefix}/containers/${id}/logs?stdout=1&stderr=1`,
				maxBytes: options.maxBytes ?? DEFAULT_MAX_LOG_BYTES,
				timeoutMs: requestTimeoutMs,
			});
			if (response.status !== 200) throw unavailable("logs", message, response.status);
			return new Uint8Array(response.body);
		},

		async remove(id) {
			assertContainerId(id);
			const message = "Docker のコンテナを削除できませんでした。";
			const response = await call("remove", message, {
				method: "DELETE",
				path: `${prefix}/containers/${id}?force=1&v=1`,
				timeoutMs: requestTimeoutMs,
			});
			if (response.status !== 204 && response.status !== 404) {
				throw unavailable("remove", message, response.status);
			}
		},
	};
}

function parseJson(body: Buffer): unknown {
	try {
		return JSON.parse(body.toString("utf8"));
	} catch {
		return undefined;
	}
}

function parseId(body: Buffer): string | undefined {
	const value = parseJson(body);
	if (typeof value !== "object" || value === null || !("Id" in value)) return undefined;
	return typeof value.Id === "string" && CONTAINER_ID.test(value.Id) ? value.Id : undefined;
}

function parseStatusCode(body: Buffer): number | undefined {
	const value = parseJson(body);
	if (typeof value !== "object" || value === null || !("StatusCode" in value)) return undefined;
	return typeof value.StatusCode === "number" ? value.StatusCode : undefined;
}
