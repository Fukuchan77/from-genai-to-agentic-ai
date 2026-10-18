import os from "node:os";
import path from "node:path";
import { createDockerEngine, type DockerEngine } from "./engine";

// Finds the local Docker Engine without starting or installing anything (003 C6, Req 3.8).

const SYSTEM_SOCKET = "/var/run/docker.sock";

export interface DockerSocketProbe {
	readonly reachable: boolean;
	readonly socketPath?: string;
	/** The sockets asked, in order (the last one is the one that answered, if any did). */
	readonly tried: readonly string[];
}

export interface DockerSocketDeps {
	/** The home directory that holds `.docker/run/docker.sock`. Defaults to the current user's. */
	readonly homeDirectory?: string;
	/** Whether a daemon answers on the socket. Defaults to a real ping. */
	readonly ping?: (socketPath: string) => Promise<boolean>;
}

/** The unix socket named by `DOCKER_HOST`; other address forms are not supported and are ignored. */
function socketFromDockerHost(value: string | undefined): string | undefined {
	const prefix = "unix://";
	const trimmed = value?.trim();
	if (!trimmed?.startsWith(prefix)) return undefined;
	const socketPath = trimmed.slice(prefix.length);
	return socketPath.startsWith("/") ? socketPath : undefined;
}

/**
 * Asks, in order, the socket in `DOCKER_HOST`, `~/.docker/run/docker.sock` and
 * `/var/run/docker.sock`, and stops at the first that answers. A socket that errors counts as one
 * that does not answer.
 */
export async function probeDockerSocket(
	env: { readonly DOCKER_HOST?: string | undefined },
	deps: DockerSocketDeps = {},
): Promise<DockerSocketProbe> {
	const home = deps.homeDirectory ?? os.homedir();
	const ping = deps.ping ?? ((socketPath) => createDockerEngine({ socketPath }).ping());
	const candidates = [
		socketFromDockerHost(env.DOCKER_HOST),
		path.join(home, ".docker", "run", "docker.sock"),
		SYSTEM_SOCKET,
	].filter((candidate): candidate is string => candidate !== undefined);

	const tried: string[] = [];
	for (const socketPath of new Set(candidates)) {
		tried.push(socketPath);
		const answered = await ping(socketPath).catch(() => false);
		if (answered) return { reachable: true, socketPath, tried };
	}
	return { reachable: false, tried };
}

export interface DockerEnvironment {
	readonly reachable: boolean;
	/** The sandbox image exists locally. Always false when the engine is unreachable. */
	readonly imagePresent: boolean;
	readonly socketPath?: string;
}

export interface ProbeDockerParams {
	readonly env: { readonly DOCKER_HOST?: string | undefined };
	readonly image: string;
	readonly homeDirectory?: string;
	/** Builds the engine client for a socket. Defaults to the real one. */
	readonly createEngine?: (socketPath: string) => DockerEngine;
}

/** What `selectSandboxProvider` needs: is the engine reachable, and is the sandbox image built. */
export async function probeDockerEnvironment(
	params: ProbeDockerParams,
): Promise<DockerEnvironment> {
	const createEngine = params.createEngine ?? ((socketPath) => createDockerEngine({ socketPath }));
	const probe = await probeDockerSocket(params.env, {
		...(params.homeDirectory === undefined ? {} : { homeDirectory: params.homeDirectory }),
		ping: (socketPath) => createEngine(socketPath).ping(),
	});
	if (!probe.reachable || probe.socketPath === undefined) {
		return { reachable: false, imagePresent: false };
	}
	const imagePresent = await createEngine(probe.socketPath)
		.imageExists(params.image)
		.catch(() => false);
	return { reachable: true, imagePresent, socketPath: probe.socketPath };
}
