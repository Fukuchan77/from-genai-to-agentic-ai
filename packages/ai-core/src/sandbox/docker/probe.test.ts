import { describe, expect, it, vi } from "vitest";
import type { DockerEngine } from "./engine";
import { probeDockerEnvironment, probeDockerSocket } from "./probe";

const HOME = "/Users/learner";
const DEFAULTS = [`${HOME}/.docker/run/docker.sock`, "/var/run/docker.sock"];

function pingOnly(reachable: readonly string[]) {
	const asked: string[] = [];
	const ping = vi.fn(async (socketPath: string) => {
		asked.push(socketPath);
		return reachable.includes(socketPath);
	});
	return { ping, asked };
}

describe("probeDockerSocket", () => {
	it("tries DOCKER_HOST, then the user's socket, then the system socket, in that order", async () => {
		const { ping, asked } = pingOnly([]);

		const result = await probeDockerSocket(
			{ DOCKER_HOST: "unix:///custom/engine.sock" },
			{ homeDirectory: HOME, ping },
		);

		expect(asked).toEqual(["/custom/engine.sock", ...DEFAULTS]);
		expect(result).toEqual({ reachable: false, tried: ["/custom/engine.sock", ...DEFAULTS] });
	});

	it("stops at the first socket that answers and reports it", async () => {
		const { ping, asked } = pingOnly([DEFAULTS[0] as string, DEFAULTS[1] as string]);

		const result = await probeDockerSocket({}, { homeDirectory: HOME, ping });

		expect(result).toEqual({ reachable: true, socketPath: DEFAULTS[0], tried: [DEFAULTS[0]] });
		expect(asked).toEqual([DEFAULTS[0]]);
	});

	it("falls through to the next socket when one does not answer", async () => {
		const { ping } = pingOnly(["/var/run/docker.sock"]);

		const result = await probeDockerSocket({}, { homeDirectory: HOME, ping });

		expect(result).toMatchObject({ reachable: true, socketPath: "/var/run/docker.sock" });
		expect(result.tried).toEqual(DEFAULTS);
	});

	it("treats a ping that throws as an unreachable socket and carries on", async () => {
		const ping = vi.fn(async (socketPath: string) => {
			if (socketPath === DEFAULTS[0]) throw new Error("EACCES");
			return socketPath === DEFAULTS[1];
		});

		const result = await probeDockerSocket({}, { homeDirectory: HOME, ping });

		expect(result).toMatchObject({ reachable: true, socketPath: DEFAULTS[1] });
	});

	it("trims blanks around DOCKER_HOST", async () => {
		const { ping, asked } = pingOnly([]);

		await probeDockerSocket(
			{ DOCKER_HOST: "  unix:///custom/engine.sock  " },
			{ homeDirectory: HOME, ping },
		);

		expect(asked[0]).toBe("/custom/engine.sock");
	});

	it("asks a socket listed twice only once", async () => {
		const { ping, asked } = pingOnly([]);

		await probeDockerSocket(
			{ DOCKER_HOST: "unix:///var/run/docker.sock" },
			{ homeDirectory: HOME, ping },
		);

		expect(asked).toEqual(["/var/run/docker.sock", DEFAULTS[0]]);
	});

	it.each([
		["a TCP address", "tcp://127.0.0.1:2375"],
		["an ssh address", "ssh://user@host"],
		["a bare path", "/var/run/other.sock"],
		["an empty value", ""],
		["only blanks", "   "],
		["a unix address without a path", "unix://"],
		["a unix address with a relative path", "unix://relative/engine.sock"],
	])("ignores DOCKER_HOST when it is %s", async (_label, value) => {
		const { ping, asked } = pingOnly([]);

		await probeDockerSocket({ DOCKER_HOST: value }, { homeDirectory: HOME, ping });

		expect(asked).toEqual(DEFAULTS);
	});
});

function fakeEngine(overrides: Partial<DockerEngine>): DockerEngine {
	const unused = async () => {
		throw new Error("not used");
	};
	return {
		ping: unused,
		imageExists: unused,
		createContainer: unused,
		putFile: unused,
		start: unused,
		wait: unused,
		logs: unused,
		remove: unused,
		...overrides,
	};
}

describe("probeDockerEnvironment", () => {
	const base = { env: {}, homeDirectory: HOME };

	it("is unreachable, with no image check, when no socket answers", async () => {
		const imageExists = vi.fn();
		const result = await probeDockerEnvironment({
			...base,
			image: "img:1",
			createEngine: () => fakeEngine({ ping: async () => false, imageExists }),
		});

		expect(result).toEqual({ reachable: false, imagePresent: false });
		expect(imageExists).not.toHaveBeenCalled();
	});

	it.each([true, false])(
		"reports the image presence (%s) from the socket that answered",
		async (present) => {
			const created: string[] = [];
			const result = await probeDockerEnvironment({
				...base,
				env: { DOCKER_HOST: "unix:///custom/engine.sock" },
				image: "img:1",
				createEngine: (socketPath) => {
					created.push(socketPath);
					return fakeEngine({
						ping: async () => socketPath === "/custom/engine.sock",
						imageExists: async (name) => present && name === "img:1",
					});
				},
			});

			expect(result).toEqual({
				reachable: true,
				imagePresent: present,
				socketPath: "/custom/engine.sock",
			});
			expect(created).toContain("/custom/engine.sock");
		},
	);

	it("is reachable without the image when the image check itself fails", async () => {
		const result = await probeDockerEnvironment({
			...base,
			image: "img:1",
			createEngine: () =>
				fakeEngine({
					ping: async () => true,
					imageExists: async () => {
						throw new Error("boom");
					},
				}),
		});

		expect(result).toMatchObject({ reachable: true, imagePresent: false });
	});
});
