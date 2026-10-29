import { describe, expect, it } from "vitest";
import { PlatformError } from "../../errors";
import { createDockerEngine, type DockerContainerSpec, type DockerEngine } from "./engine";
import { createFakeEngine, type FakeEngineHandler } from "./fake-socket";
import { createSingleFileTar } from "./tar";

const ID = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const SPEC: DockerContainerSpec = {
	Image: "agentic-ai-sandbox:local",
	Cmd: ["python", "/work/code.py"],
	User: "10001:10001",
	WorkingDir: "/work",
	NetworkDisabled: true,
	HostConfig: {
		NetworkMode: "none",
		ReadonlyRootfs: true,
		Mounts: [{ Type: "volume", Target: "/work" }],
	},
};

function setup(
	handler: FakeEngineHandler,
	timeouts: { requestTimeoutMs?: number; quickTimeoutMs?: number } = {},
): {
	engine: DockerEngine;
	requests: ReturnType<typeof createFakeEngine>["requests"];
} {
	const fake = createFakeEngine(handler);
	return {
		engine: createDockerEngine({ socketPath: "/fake/docker.sock", agent: fake.agent, ...timeouts }),
		requests: fake.requests,
	};
}

const json = (status: number, value: unknown) => ({
	status,
	body: JSON.stringify(value),
	headers: { "Content-Type": "application/json" },
});

describe("createDockerEngine", () => {
	describe("ping", () => {
		it("is true when the daemon answers OK", async () => {
			const { engine, requests } = setup(() => ({ status: 200, body: "OK" }));

			expect(await engine.ping()).toBe(true);
			expect(requests[0]).toMatchObject({ method: "GET", path: "/_ping" });
		});

		it("is false, not an exception, when the daemon answers an error or the connection fails", async () => {
			expect(await setup(() => ({ status: 500 })).engine.ping()).toBe(false);
			expect(await setup(() => ({ status: 200, destroy: true })).engine.ping()).toBe(false);
		});
	});

	describe("imageExists", () => {
		it("asks for the image by name, keeping the tag and a registry path readable", async () => {
			const { engine, requests } = setup(() => json(200, {}));

			expect(await engine.imageExists("registry.example:5000/team/sandbox:1.2")).toBe(true);
			expect(requests[0]).toMatchObject({
				method: "GET",
				path: "/v1.44/images/registry.example:5000/team/sandbox:1.2/json",
			});
		});

		it("is false on 404 and fails on any other status", async () => {
			expect(
				await setup(() => json(404, { message: "No such image" })).engine.imageExists("a:b"),
			).toBe(false);
			await expect(
				setup(() => json(500, { message: "boom" })).engine.imageExists("a:b"),
			).rejects.toMatchObject({
				code: "provider-unavailable",
			});
		});

		it.each(["", "a b", "a?x=1", "a#b", "../x", "a\n"])(
			"rejects the image name %j without a request",
			async (name) => {
				const { engine, requests } = setup(() => json(200, {}));

				await expect(engine.imageExists(name)).rejects.toMatchObject({ code: "invalid-request" });
				expect(requests).toEqual([]);
			},
		);
	});

	describe("createContainer", () => {
		it("posts the spec as JSON and returns the id", async () => {
			const { engine, requests } = setup(() => json(201, { Id: ID, Warnings: [] }));

			expect(await engine.createContainer(SPEC)).toBe(ID);
			const request = requests[0];
			expect(request).toMatchObject({ method: "POST", path: "/v1.44/containers/create" });
			expect(request?.headers["content-type"]).toBe("application/json");
			expect(JSON.parse(request?.body.toString() ?? "")).toEqual(SPEC);
		});

		it("explains a missing image with the build task", async () => {
			const { engine } = setup(() =>
				json(404, { message: "No such image: agentic-ai-sandbox:local" }),
			);

			const error = await engine.createContainer(SPEC).catch((caught: unknown) => caught);

			expect(error).toBeInstanceOf(PlatformError);
			expect((error as PlatformError).code).toBe("provider-unavailable");
			expect((error as Error).message).toContain("mise run sandbox:build");
		});

		it.each([
			["a server error", () => json(500, { message: "boom" })],
			["a body without an id", () => json(201, {})],
			["a body that is not JSON", () => ({ status: 201, body: "not json" })],
			["a dropped connection", () => ({ status: 201, destroy: true })],
			["a 200 where 201 is expected", () => json(200, { Id: ID })],
			["an id that is not a container id", () => json(201, { Id: "../images/json" })],
		])("fails with provider-unavailable on %s", async (_label, handler) => {
			await expect(setup(handler).engine.createContainer(SPEC)).rejects.toMatchObject({
				code: "provider-unavailable",
			});
		});
	});

	describe("putFile", () => {
		it("puts a one-file tar into the directory", async () => {
			const { engine, requests } = setup(() => ({ status: 200 }));
			const bytes = new TextEncoder().encode("a,b\n1,2\n");

			await engine.putFile(ID, "/work", "data.csv", bytes);

			const request = requests[0];
			expect(request).toMatchObject({
				method: "PUT",
				path: `/v1.44/containers/${ID}/archive?path=%2Fwork`,
			});
			expect(request?.headers["content-type"]).toBe("application/x-tar");
			expect(request?.headers["content-length"]).toBe(String(request?.body.length));
			expect(new Uint8Array(request?.body ?? [])).toEqual(createSingleFileTar("data.csv", bytes));
		});

		it("fails with provider-unavailable when the daemon refuses (for example a read-only path)", async () => {
			const { engine } = setup(() =>
				json(403, { message: "container rootfs is marked read-only" }),
			);

			await expect(engine.putFile(ID, "/work", "a.csv", new Uint8Array())).rejects.toMatchObject({
				code: "provider-unavailable",
			});
		});

		it("rejects a file name the tar cannot hold, before any request", async () => {
			const { engine, requests } = setup(() => ({ status: 200 }));

			await expect(engine.putFile(ID, "/work", "a/b.csv", new Uint8Array())).rejects.toMatchObject({
				code: "invalid-request",
			});
			expect(requests).toEqual([]);
		});
	});

	describe("container ids", () => {
		it.each([
			"",
			"../images",
			"abc def",
			"ABCDEF0123456789",
			"g".repeat(64),
			"0123456789ab/../images",
		])("rejects the id %j before any request", async (id) => {
			const { engine, requests } = setup(() => ({ status: 204 }));

			await expect(engine.start(id)).rejects.toMatchObject({ code: "invalid-request" });
			await expect(engine.remove(id)).rejects.toMatchObject({ code: "invalid-request" });
			expect(requests).toEqual([]);
		});
	});

	describe("start", () => {
		it.each([204, 304])("succeeds on %i", async (status) => {
			const { engine, requests } = setup(() => ({ status }));

			await engine.start(ID);

			expect(requests[0]).toMatchObject({ method: "POST", path: `/v1.44/containers/${ID}/start` });
		});

		it("fails on 404 and 500", async () => {
			await expect(setup(() => ({ status: 404 })).engine.start(ID)).rejects.toMatchObject({
				code: "provider-unavailable",
			});
			await expect(setup(() => ({ status: 500 })).engine.start(ID)).rejects.toMatchObject({
				code: "provider-unavailable",
			});
		});
	});

	describe("wait", () => {
		it("returns the exit code", async () => {
			const { engine, requests } = setup(() => json(200, { StatusCode: 3 }));

			expect(await engine.wait(ID)).toBe(3);
			expect(requests[0]).toMatchObject({
				method: "POST",
				path: `/v1.44/containers/${ID}/wait?condition=not-running`,
			});
		});

		it("fails on a body without a status code", async () => {
			await expect(setup(() => json(200, {})).engine.wait(ID)).rejects.toMatchObject({
				code: "provider-unavailable",
			});
		});

		it("stops waiting and rejects with the reason when the signal aborts", async () => {
			const { engine } = setup(() => ({ status: 200, hang: true }));
			const controller = new AbortController();
			const pending = engine.wait(ID, { signal: controller.signal });
			const outcome = pending.catch((error: unknown) => error);

			controller.abort(new Error("timed out"));

			expect(((await outcome) as Error).message).toBe("timed out");
		});

		it("rejects at once when the signal is already aborted", async () => {
			const { engine, requests } = setup(() => json(200, { StatusCode: 0 }));
			const controller = new AbortController();
			controller.abort(new Error("already"));

			await expect(engine.wait(ID, { signal: controller.signal })).rejects.toThrow("already");
			expect(requests).toEqual([]);
		});
	});

	describe("logs", () => {
		it("returns the raw multiplexed bytes of stdout and stderr", async () => {
			const bytes = new Uint8Array([1, 0, 0, 0, 0, 0, 0, 2, 104, 105]);
			const { engine, requests } = setup(() => ({ status: 200, body: bytes }));

			expect(await engine.logs(ID)).toEqual(bytes);
			expect(requests[0]).toMatchObject({
				method: "GET",
				path: `/v1.44/containers/${ID}/logs?stdout=1&stderr=1`,
			});
		});

		it("stops reading at the byte limit", async () => {
			const { engine } = setup(() => ({ status: 200, body: new Uint8Array(100).fill(7) }));

			const result = await engine.logs(ID, { maxBytes: 10 });

			expect(result.length).toBe(10);
		});

		it("stops reading a stream that never ends once the limit is reached", async () => {
			const { engine } = setup(() => ({
				status: 200,
				body: new Uint8Array(100).fill(7),
				hang: true,
			}));

			const result = await engine.logs(ID, { maxBytes: 10 });

			expect(result.length).toBe(10);
		});

		it("fails on a non-200 answer", async () => {
			await expect(setup(() => ({ status: 404 })).engine.logs(ID)).rejects.toMatchObject({
				code: "provider-unavailable",
			});
		});
	});

	describe("remove", () => {
		it("force-deletes the container together with its anonymous volumes", async () => {
			const { engine, requests } = setup(() => ({ status: 204 }));

			await engine.remove(ID);

			expect(requests[0]).toMatchObject({
				method: "DELETE",
				path: `/v1.44/containers/${ID}?force=1&v=1`,
			});
		});

		it("treats a container that is already gone (404) as removed", async () => {
			await expect(setup(() => ({ status: 404 })).engine.remove(ID)).resolves.toBeUndefined();
		});

		it("fails on other errors", async () => {
			await expect(setup(() => ({ status: 500 })).engine.remove(ID)).rejects.toMatchObject({
				code: "provider-unavailable",
			});
		});
	});

	describe("a daemon that never answers", () => {
		const SILENT = () => ({ status: 200, silent: true });
		const FAST = { requestTimeoutMs: 60, quickTimeoutMs: 60 };

		it("lets ping give up and report false, so a hung daemon is simply not there", async () => {
			expect(await setup(SILENT, FAST).engine.ping()).toBe(false);
		});

		it.each([
			["imageExists", (engine: DockerEngine) => engine.imageExists("a:b")],
			["createContainer", (engine: DockerEngine) => engine.createContainer(SPEC)],
			["putFile", (engine: DockerEngine) => engine.putFile(ID, "/work", "a.csv", new Uint8Array())],
			["start", (engine: DockerEngine) => engine.start(ID)],
			["logs", (engine: DockerEngine) => engine.logs(ID)],
			["remove", (engine: DockerEngine) => engine.remove(ID)],
		])("fails %s with provider-unavailable instead of waiting forever", async (_name, call) => {
			const failure = await call(setup(SILENT, FAST).engine).catch((error: unknown) => error);

			expect(failure).toMatchObject({ code: "provider-unavailable" });
		});

		it("also gives up on a response that starts and then stops", async () => {
			const { engine } = setup(() => ({ status: 200, hang: true, body: "partial" }), FAST);

			await expect(engine.logs(ID, { maxBytes: 1_000_000 })).rejects.toMatchObject({
				code: "provider-unavailable",
			});
		});

		it("does not time wait out: it ends only by the container or by its own signal", async () => {
			const { engine } = setup(() => ({ status: 200, hang: true }), FAST);
			const controller = new AbortController();
			const waiting = engine
				.wait(ID, { signal: controller.signal })
				.catch((error: unknown) => error);

			await new Promise((resolve) => setTimeout(resolve, 200));
			controller.abort(new Error("deadline"));

			expect(((await waiting) as Error).message).toBe("deadline");
		});

		it("keeps the longer limit for the calls that move data and the shorter one for the quick checks", async () => {
			// ping and imageExists give up at quickTimeoutMs; createContainer is still waiting then.
			const slow = setup(SILENT, { requestTimeoutMs: 400, quickTimeoutMs: 40 });
			const started = Date.now();

			await slow.engine.ping();
			const quick = Date.now() - started;
			const create = slow.engine.createContainer(SPEC).catch(() => Date.now() - started);

			expect(quick).toBeLessThan(300);
			expect(await create).toBeGreaterThanOrEqual(300);
		});
	});

	it("does not put the daemon's error text in the learner-facing message", async () => {
		const { engine } = setup(() => json(500, { message: "internal path /Users/secret/dir" }));

		const error = await engine.start(ID).catch((caught: unknown) => caught);

		expect((error as Error).message).not.toContain("/Users/secret");
		expect(JSON.stringify((error as PlatformError).details)).not.toContain("/Users/secret");
	});

	it("does not put a connection error's text or the socket path in the message", async () => {
		const { engine } = setup(() => ({ status: 200, destroy: true }));

		const error = await engine.start(ID).catch((caught: unknown) => caught);

		expect((error as PlatformError).code).toBe("provider-unavailable");
		expect((error as Error).message).not.toContain("connection reset");
		expect((error as Error).message).not.toContain("/fake/docker.sock");
	});
});
