import { describe, expect, it, vi } from "vitest";
import type { DockerEngine } from "./engine";
import { createLocalDockerProvider } from "./local";

function fakeEngine(): DockerEngine & { created: string[] } {
	const created: string[] = [];
	const unused = async () => {
		throw new Error("not used");
	};
	return {
		created,
		ping: async () => true,
		imageExists: async () => true,
		createContainer: async (spec) => {
			created.push(spec.Image);
			return "c0123456789ab";
		},
		putFile: async () => undefined,
		start: async () => undefined,
		wait: async () => 0,
		logs: async () => new Uint8Array(),
		remove: async () => undefined,
		...{ unused },
	};
}

describe("createLocalDockerProvider", () => {
	it("builds a Docker provider on the engine of the socket that answered", async () => {
		const engine = fakeEngine();
		const createEngine = vi.fn(() => engine);

		const provider = createLocalDockerProvider({
			environment: { reachable: true, imagePresent: true, socketPath: "/s/docker.sock" },
			image: "img:1",
			createEngine,
		});
		const session = await provider.create({ timeoutMs: 1000 });
		await session.runPython("print(1)", { timeoutMs: 1000 });

		expect(provider.kind).toBe("docker");
		expect(createEngine).toHaveBeenCalledWith("/s/docker.sock");
		expect(engine.created).toEqual(["img:1"]);
	});

	it.each([
		["unreachable", { reachable: false, imagePresent: false }],
		[
			"marked unreachable even with an image and a path",
			{ reachable: false, imagePresent: true, socketPath: "/s" },
		],
		["reachable without a socket path", { reachable: true, imagePresent: true }],
		["reachable without the image", { reachable: true, imagePresent: false, socketPath: "/s" }],
	])("refuses an environment that is %s, before building an engine", (_label, environment) => {
		const createEngine = vi.fn(() => fakeEngine());

		expect(() => createLocalDockerProvider({ environment, image: "img:1", createEngine })).toThrow(
			expect.objectContaining({ code: "provider-unavailable" }),
		);
		expect(createEngine).not.toHaveBeenCalled();
	});

	it("passes the warning callback on to the provider", async () => {
		const engine = fakeEngine();
		engine.remove = async () => {
			throw new Error("cannot remove");
		};
		const onWarning = vi.fn();
		const provider = createLocalDockerProvider({
			environment: { reachable: true, imagePresent: true, socketPath: "/s/docker.sock" },
			image: "img:1",
			createEngine: () => engine,
			onWarning,
		});
		const session = await provider.create({ timeoutMs: 1000 });

		await session.runPython("print(1)", { timeoutMs: 1000 });

		expect(onWarning).toHaveBeenCalledTimes(1);
	});
});
