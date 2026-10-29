import { beforeAll, beforeEach, describe } from "vitest";
import { DEFAULT_SANDBOX } from "../config/defaults";
import { probeDockerEnvironment } from "../sandbox/docker/probe";

// Skip helper for `*.container.test.ts` (003 CL-9, review F-16): the container suite needs a real
// Docker Engine and the sandbox image, and says why it skipped when either is missing. It mirrors
// `describeLocal`.

export interface ContainerAvailability {
	readonly available: boolean;
	readonly reason: string | null;
	readonly socketPath: string | null;
	readonly image: string;
}

type Probe = typeof probeDockerEnvironment;

export async function checkContainerAvailability(options: {
	readonly env: { readonly DOCKER_HOST?: string | undefined };
	readonly image: string;
	readonly probe?: Probe;
}): Promise<ContainerAvailability> {
	const { image } = options;
	const probe = options.probe ?? probeDockerEnvironment;
	try {
		const result = await probe({ env: options.env, image });
		if (!result.reachable) {
			return {
				available: false,
				reason:
					"No Docker Engine answered. Start Docker, or set DOCKER_HOST (for Rancher Desktop: unix://$HOME/.rd/docker.sock).",
				socketPath: null,
				image,
			};
		}
		if (!result.imagePresent) {
			return {
				available: false,
				reason: `The sandbox image ${image} is missing. Run \`mise run sandbox:build\`.`,
				socketPath: result.socketPath ?? null,
				image,
			};
		}
		return { available: true, reason: null, socketPath: result.socketPath ?? null, image };
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		return {
			available: false,
			reason: `The Docker check failed: ${detail}`,
			socketPath: null,
			image,
		};
	}
}

interface ContainerRegistrar {
	describe(name: string, factory: () => void): void;
	beforeAll(hook: () => Promise<void> | void): void;
	beforeEach(hook: (context: { skip(reason: string): unknown }) => unknown): void;
}

export interface ContainerTestApi {
	describeContainer(
		name: string,
		factory: (availability: () => ContainerAvailability) => void,
	): void;
}

/** Builds the registration helper; exported for deterministic contract tests. */
export function createContainerTestApi(options: {
	readonly check: () => Promise<ContainerAvailability>;
	readonly registrar: ContainerRegistrar;
}): ContainerTestApi {
	const { registrar } = options;
	return {
		describeContainer(name, factory) {
			registrar.describe(name, () => {
				let availability: ContainerAvailability | undefined;
				registrar.beforeAll(async () => {
					availability = await options.check();
				});
				registrar.beforeEach((context) => {
					if (availability === undefined)
						context.skip("The container environment was not checked.");
					else if (!availability.available)
						context.skip(availability.reason ?? "Docker is unavailable.");
				});
				factory(() => {
					if (availability === undefined)
						throw new Error("The container environment was not checked.");
					return availability;
				});
			});
		},
	};
}

const IMAGE = process.env.DOCKER_SANDBOX_IMAGE?.trim() || DEFAULT_SANDBOX.image;

const containerApi = createContainerTestApi({
	check: () =>
		checkContainerAvailability({ env: { DOCKER_HOST: process.env.DOCKER_HOST }, image: IMAGE }),
	registrar: {
		describe: (name, factory) => describe(name, factory),
		beforeAll: (hook) => beforeAll(hook),
		beforeEach: (hook) => beforeEach((context) => hook(context)),
	},
});

export const describeContainer = containerApi.describeContainer;
