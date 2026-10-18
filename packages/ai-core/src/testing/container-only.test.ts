import { describe, expect, it, vi } from "vitest";
import {
	type ContainerAvailability,
	checkContainerAvailability,
	createContainerTestApi,
} from "./container-only";

describe("checkContainerAvailability", () => {
	const image = "img:1";

	it("is available, with the socket, when Docker answers and the image exists", async () => {
		const probe = vi.fn(async () => ({
			reachable: true,
			imagePresent: true,
			socketPath: "/s.sock",
		}));

		const result = await checkContainerAvailability({
			env: { DOCKER_HOST: "unix:///s.sock" },
			image,
			probe,
		});

		expect(result).toEqual({ available: true, reason: null, socketPath: "/s.sock", image });
		expect(probe).toHaveBeenCalledWith(
			expect.objectContaining({ image, env: { DOCKER_HOST: "unix:///s.sock" } }),
		);
	});

	it("skips with a reason that names DOCKER_HOST when no Docker Engine answers", async () => {
		const result = await checkContainerAvailability({
			env: {},
			image,
			probe: async () => ({ reachable: false, imagePresent: false }),
		});

		expect(result.available).toBe(false);
		expect(result.reason).toContain("Docker Engine");
		expect(result.reason).toContain("DOCKER_HOST");
		expect(result.socketPath).toBeNull();
	});

	it("skips with the build task in the reason when the image is missing", async () => {
		const result = await checkContainerAvailability({
			env: {},
			image,
			probe: async () => ({ reachable: true, imagePresent: false, socketPath: "/s.sock" }),
		});

		expect(result.available).toBe(false);
		expect(result.reason).toContain("mise run sandbox:build");
		expect(result.reason).toContain(image);
	});

	it("skips with a reason, instead of failing, when the probe itself throws", async () => {
		const result = await checkContainerAvailability({
			env: {},
			image,
			probe: async () => {
				throw new Error("boom");
			},
		});

		expect(result.available).toBe(false);
		expect(result.reason).toContain("boom");
	});
});

describe("createContainerTestApi", () => {
	type Context = { skip(reason: string): void };

	function setup(availability: ContainerAvailability) {
		const hooks: {
			beforeAll: (() => Promise<void> | void)[];
			beforeEach: ((context: Context) => void)[];
		} = {
			beforeAll: [],
			beforeEach: [],
		};
		const suiteBody = vi.fn();
		const api = createContainerTestApi({
			check: async () => availability,
			registrar: {
				describe: (_name, factory) => factory(),
				beforeAll: (hook) => hooks.beforeAll.push(hook),
				beforeEach: (hook) => hooks.beforeEach.push(hook),
			},
		});
		api.describeContainer("suite", suiteBody);
		return { hooks, suiteBody };
	}

	it("skips every test with the reason when the container environment is unavailable", async () => {
		const { hooks, suiteBody } = setup({
			available: false,
			reason: "no docker",
			socketPath: null,
			image: "i",
		});
		await Promise.all(hooks.beforeAll.map((hook) => hook()));
		const skip = vi.fn();

		for (const hook of hooks.beforeEach) hook({ skip });

		expect(skip).toHaveBeenCalledWith("no docker");
		expect(suiteBody).toHaveBeenCalledTimes(1);
	});

	it("does not skip when the container environment is available, and hands the suite its availability", async () => {
		const availability = { available: true, reason: null, socketPath: "/s.sock", image: "i" };
		const { hooks, suiteBody } = setup(availability);
		await Promise.all(hooks.beforeAll.map((hook) => hook()));
		const skip = vi.fn();

		for (const hook of hooks.beforeEach) hook({ skip });

		expect(skip).not.toHaveBeenCalled();
		const getAvailability = suiteBody.mock.calls[0]?.[0] as () => ContainerAvailability;
		expect(getAvailability()).toEqual(availability);
	});

	it("skips, rather than runs, a test whose beforeAll has not finished", () => {
		const { hooks } = setup({ available: true, reason: null, socketPath: "/s.sock", image: "i" });
		const skip = vi.fn();

		// beforeAll never ran: the availability is unknown, which must not count as available.
		for (const hook of hooks.beforeEach) hook({ skip });

		expect(skip).toHaveBeenCalledWith(expect.stringContaining("not checked"));
	});
});
