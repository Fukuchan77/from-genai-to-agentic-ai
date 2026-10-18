import { PlatformError } from "../../errors";
import type { Clock } from "../../ports/clock";
import type { SandboxProvider } from "../../ports/sandbox";
import { createDockerEngine, type DockerEngine } from "./engine";
import type { DockerEnvironment } from "./probe";
import { createDockerProvider } from "./provider";

export interface LocalDockerParams {
	/** What `probeDockerEnvironment` found. */
	readonly environment: DockerEnvironment;
	readonly image: string;
	readonly clock?: Clock;
	readonly onWarning?: (message: string) => void;
	/** Builds the engine client for a socket. Defaults to the real one. */
	readonly createEngine?: (path: string) => DockerEngine;
}

/**
 * The Docker provider on the engine that was found. The socket stays inside this directory (rule
 * `sandbox-import-scope`): callers hand over what the probe returned and never name a socket.
 */
export function createLocalDockerProvider(params: LocalDockerParams): SandboxProvider {
	const { environment } = params;
	if (!environment.reachable || !environment.imagePresent || environment.socketPath === undefined) {
		throw new PlatformError(
			"provider-unavailable",
			"ローカルのコンテナ実行環境が使えません（Docker に接続できないか、サンドボックスの画像がありません）。",
		);
	}
	const createEngine =
		params.createEngine ?? ((socketPath: string) => createDockerEngine({ socketPath }));
	return createDockerProvider({
		engine: createEngine(environment.socketPath),
		image: params.image,
		...(params.clock ? { clock: params.clock } : {}),
		...(params.onWarning ? { onWarning: params.onWarning } : {}),
	});
}
