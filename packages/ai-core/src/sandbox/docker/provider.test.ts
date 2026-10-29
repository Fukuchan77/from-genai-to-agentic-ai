import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SANDBOX } from "../../config/defaults";
import { PlatformError } from "../../errors";
import { createFakeClock } from "../../ports/clock";
import type { DockerContainerSpec, DockerEngine } from "./engine";
import { createDockerProvider, SANDBOX_MAIN_FILE, SANDBOX_USER } from "./provider";

const RUN = { timeoutMs: 5_000 };

function frame(stream: 1 | 2, text: string): Uint8Array {
	const body = new TextEncoder().encode(text);
	const out = new Uint8Array(8 + body.length);
	out[0] = stream;
	new DataView(out.buffer).setUint32(4, body.length, false);
	out.set(body, 8);
	return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
	const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
	let at = 0;
	for (const part of parts) {
		out.set(part, at);
		at += part.length;
	}
	return out;
}

interface FakeEngineOptions {
	exitCode?: number;
	logs?: Uint8Array;
	/** `wait` never resolves until its signal aborts. */
	waitHangs?: boolean;
	fail?: Partial<
		Record<"createContainer" | "putFile" | "start" | "wait" | "logs" | "remove", unknown>
	>;
	/** Make `remove` fail this many times before succeeding. */
	removeFailures?: number;
	/** `remove` never succeeds. */
	removeAlwaysFails?: boolean;
	/** Awaited inside `createContainer`, after the container exists on the daemon. */
	duringCreate?: () => Promise<void>;
	/** Called after each `putFile`. */
	afterPut?: (name: string) => Promise<void> | void;
}

function makeEngine(options: FakeEngineOptions = {}) {
	const calls: string[] = [];
	const specs: DockerContainerSpec[] = [];
	const puts: { id: string; directory: string; name: string; bytes: Uint8Array }[] = [];
	const logLimits: (number | undefined)[] = [];
	let counter = 0;
	let removeFailures = options.removeFailures ?? 0;
	const live = new Set<string>();

	function maybeFail(operation: keyof NonNullable<FakeEngineOptions["fail"]>) {
		const error = options.fail?.[operation];
		if (error) throw error;
	}

	const engine: DockerEngine = {
		async ping() {
			return true;
		},
		async imageExists() {
			return true;
		},
		async createContainer(spec) {
			calls.push("create");
			maybeFail("createContainer");
			specs.push(spec);
			counter += 1;
			const id = `c${counter}`;
			live.add(id);
			await options.duringCreate?.();
			return id;
		},
		async putFile(id, directory, name, bytes) {
			calls.push(`put:${name}`);
			maybeFail("putFile");
			puts.push({ id, directory, name, bytes: bytes.slice() });
			await options.afterPut?.(name);
		},
		async start() {
			calls.push("start");
			maybeFail("start");
		},
		async wait(_id, waitOptions) {
			calls.push("wait");
			maybeFail("wait");
			if (options.waitHangs) {
				await new Promise<never>((_resolve, reject) => {
					waitOptions?.signal?.addEventListener("abort", () => reject(waitOptions.signal?.reason), {
						once: true,
					});
				});
			}
			return options.exitCode ?? 0;
		},
		async logs(_id, logOptions) {
			calls.push("logs");
			logLimits.push(logOptions?.maxBytes);
			maybeFail("logs");
			return options.logs ?? new Uint8Array();
		},
		async remove(id) {
			calls.push("remove");
			if (options.removeAlwaysFails)
				throw new PlatformError("provider-unavailable", "remove failed");
			if (removeFailures > 0) {
				removeFailures -= 1;
				throw new PlatformError("provider-unavailable", "remove failed");
			}
			maybeFail("remove");
			live.delete(id);
		},
	};
	return { engine, calls, specs, puts, logLimits, live };
}

async function open(
	options: FakeEngineOptions = {},
	params: Partial<Parameters<typeof createDockerProvider>[0]> = {},
) {
	const fake = makeEngine(options);
	const provider = createDockerProvider({ engine: fake.engine, image: "img:1", ...params });
	const session = await provider.create({ timeoutMs: 600_000 });
	return { ...fake, provider, session };
}

describe("createDockerProvider", () => {
	it("reports its kind as docker", () => {
		expect(createDockerProvider({ engine: makeEngine().engine, image: "img:1" }).kind).toBe(
			"docker",
		);
	});

	describe("the container it creates", () => {
		it("has no network, a read-only root, a non-root user and every capability dropped", async () => {
			const { session, specs } = await open();
			await session.runPython("print(1)", RUN);

			const spec = specs[0] as DockerContainerSpec;
			expect(spec.Image).toBe("img:1");
			expect(spec.NetworkDisabled).toBe(true);
			expect(spec.HostConfig.NetworkMode).toBe("none");
			expect(spec.HostConfig.ReadonlyRootfs).toBe(true);
			expect(spec.HostConfig.CapDrop).toEqual(["ALL"]);
			expect(spec.HostConfig.SecurityOpt).toEqual(["no-new-privileges"]);
			expect(spec.User).toBe(SANDBOX_USER);
			expect(spec.User).toMatch(/^[1-9]\d*:[1-9]\d*$/); // numeric and never root (0)
		});

		it("limits memory (with no extra swap), CPU and the number of processes from the defaults", async () => {
			const { session, specs } = await open();
			await session.runPython("print(1)", RUN);

			const hostConfig = (specs[0] as DockerContainerSpec).HostConfig;
			expect(hostConfig.Memory).toBe(DEFAULT_SANDBOX.memoryBytes);
			expect(hostConfig.MemorySwap).toBe(DEFAULT_SANDBOX.memoryBytes);
			expect(hostConfig.NanoCpus).toBe(DEFAULT_SANDBOX.cpus * 1_000_000_000);
			expect(hostConfig.PidsLimit).toBe(DEFAULT_SANDBOX.pidsLimit);
		});

		it("takes other limits from the parameters", async () => {
			const { session, specs } = await open(
				{},
				{ limits: { memoryBytes: 1_000_000, cpus: 2, pidsLimit: 7 } },
			);
			await session.runPython("print(1)", RUN);

			const hostConfig = (specs[0] as DockerContainerSpec).HostConfig;
			expect(hostConfig).toMatchObject({
				Memory: 1_000_000,
				MemorySwap: 1_000_000,
				NanoCpus: 2_000_000_000,
				PidsLimit: 7,
			});
		});

		it("keeps /work in an anonymous volume (the only place a read-only root accepts a file) and /tmp in a small tmpfs", async () => {
			const { session, specs } = await open();
			await session.runPython("print(1)", RUN);

			const spec = specs[0] as DockerContainerSpec;
			expect(spec.WorkingDir).toBe("/work");
			expect(spec.HostConfig.Mounts).toEqual([{ Type: "volume", Target: "/work" }]);
			expect(spec.HostConfig.Tmpfs?.["/tmp"]).toMatch(/noexec/);
			expect(spec.HostConfig.Tmpfs?.["/tmp"]).toMatch(/nosuid/);
			expect(spec.HostConfig.Tmpfs?.["/tmp"]).toMatch(/size=\d+m/);
			expect(spec.Env).toEqual(
				expect.arrayContaining(["HOME=/tmp", "MPLCONFIGDIR=/tmp/matplotlib"]),
			);
		});

		it("runs the main file from /work with python", async () => {
			const { session, specs } = await open();
			await session.runPython("print(1)", RUN);

			expect((specs[0] as DockerContainerSpec).Cmd).toEqual([
				"python",
				`/work/${SANDBOX_MAIN_FILE}`,
			]);
		});
	});

	describe("a run", () => {
		it("creates, places the files and the code, starts, waits, reads the logs and removes, in that order", async () => {
			const { session, calls, puts } = await open({ logs: frame(1, "out\n") });
			await session.writeFile("data.csv", new TextEncoder().encode("a,b\n"));

			const result = await session.runPython("print('x')", RUN);

			expect(calls).toEqual([
				"create",
				"put:data.csv",
				`put:${SANDBOX_MAIN_FILE}`,
				"start",
				"wait",
				"logs",
				"remove",
			]);
			expect(result).toEqual({ stdout: "out\n", stderr: "" });
			expect(result).not.toHaveProperty("error");
			expect(puts.map((put) => put.directory)).toEqual(["/work", "/work"]);
			expect(new TextDecoder().decode(puts[1]?.bytes)).toBe("print('x')");
		});

		it("sends the files again to each run's own container", async () => {
			const { session, puts } = await open();
			await session.writeFile("data.csv", new Uint8Array([1, 2, 3]));

			await session.runPython("1", RUN);
			await session.runPython("2", RUN);

			const forCsv = puts.filter((put) => put.name === "data.csv");
			expect(forCsv.map((put) => put.id)).toEqual(["c1", "c2"]);
			expect(forCsv.map((put) => [...put.bytes])).toEqual([
				[1, 2, 3],
				[1, 2, 3],
			]);
		});

		it("stores a copy of the written bytes", async () => {
			const { session, puts } = await open();
			const bytes = new Uint8Array([1, 2, 3]);
			await session.writeFile("data.bin", bytes);
			bytes[0] = 99;

			await session.runPython("1", RUN);

			expect([...(puts.find((put) => put.name === "data.bin")?.bytes ?? [])]).toEqual([1, 2, 3]);
		});

		it("splits stdout and stderr from the multiplexed logs and reads at most a bounded amount", async () => {
			const { session, logLimits } = await open({
				logs: concat(frame(1, "a"), frame(2, "b"), frame(1, "c")),
			});

			const result = await session.runPython("1", RUN);

			expect(result).toEqual({ stdout: "ac", stderr: "b" });
			expect(logLimits[0]).toBeGreaterThan(0);
			expect(logLimits[0]).toBeLessThanOrEqual(64 * 1024 * 1024);
		});

		it("turns a Python traceback into the run's error and keeps what was printed before it", async () => {
			const traceback =
				"Traceback (most recent call last):\n  File \"/work/_sandbox_main.py\", line 3, in <module>\nKeyError: 'revenue'\n";
			const { session } = await open({
				exitCode: 1,
				logs: concat(frame(1, "loading\n"), frame(2, traceback)),
			});

			const result = await session.runPython("df['revenue']", RUN);

			expect(result.stdout).toBe("loading\n");
			expect(result.stderr).toBe(traceback);
			expect(result.error).toEqual({
				name: "KeyError",
				message: "'revenue'",
				traceback: traceback.trimEnd(),
			});
		});

		it("reads a multi-line message and a dotted exception name from the last line group", async () => {
			const stderr =
				'Traceback (most recent call last):\n  File "x", line 1\npandas.errors.ParserError: Error tokenizing data. C error: Expected 2 fields in line 3, saw 3\n';
			const { session } = await open({ exitCode: 1, logs: frame(2, stderr) });

			const result = await session.runPython("1", RUN);

			expect(result.error?.name).toBe("pandas.errors.ParserError");
			expect(result.error?.message).toContain("Expected 2 fields in line 3");
		});

		it("starts the reported traceback at its header, leaving earlier stderr output out of it", async () => {
			const stderr =
				'UserWarning: something first\nTraceback (most recent call last):\n  File "x", line 1\nValueError: bad\n';
			const { session } = await open({ exitCode: 1, logs: frame(2, stderr) });

			const result = await session.runPython("1", RUN);

			expect(result.error?.traceback).toBe(
				'Traceback (most recent call last):\n  File "x", line 1\nValueError: bad',
			);
			expect(result.stderr).toBe(stderr);
		});

		it("does not mistake a line that merely contains a colon for an exception", async () => {
			const { session } = await open({ exitCode: 2, logs: frame(2, "Notice: low disk space\n") });

			const result = await session.runPython("1", RUN);

			expect(result.error?.name).toBe("ExitCode");
		});

		it("reports a non-zero exit without a traceback as an error with the exit code", async () => {
			const { session } = await open({ exitCode: 3, logs: frame(2, "something odd\n") });

			const result = await session.runPython("1", RUN);

			expect(result.error).toMatchObject({ name: "ExitCode" });
			expect(result.error?.message).toContain("3");
		});

		it("explains exit code 137 as the process being killed, likely by the memory limit", async () => {
			const { session } = await open({ exitCode: 137 });

			const result = await session.runPython("1", RUN);

			expect(result.error?.name).toBe("Killed");
			expect(result.error?.message).toContain("メモリ");
		});

		it("adds a note to stderr when the logs were cut short", async () => {
			const cut = frame(1, "complete output\n");
			const { session } = await open({ logs: concat(cut, new Uint8Array([1, 0, 0])) });

			const result = await session.runPython("1", RUN);

			expect(result.stdout).toBe("complete output\n");
			expect(result.stderr).toContain("ログが途中で切れました");
		});

		it("can run two at once, each in its own container", async () => {
			const { session, specs, live } = await open();

			await Promise.all([session.runPython("1", RUN), session.runPython("2", RUN)]);

			expect(specs).toHaveLength(2);
			expect(live.size).toBe(0);
		});
	});

	describe("the timeout", () => {
		it("stops waiting at the limit, keeps the output so far, and reports a timeout error", async () => {
			const clock = createFakeClock();
			const { session, calls } = await open(
				{ waitHangs: true, logs: frame(1, "partial\n") },
				{ clock },
			);

			const running = session.runPython("while True: pass", { timeoutMs: 5_000 });
			await vi.waitFor(() => expect(calls).toContain("wait"));
			clock.advanceBy(5_000);
			const result = await running;

			expect(result.stdout).toBe("partial\n");
			expect(result.error?.name).toBe("TimeoutError");
			expect(result.error?.message).toContain("5000");
			expect(calls.at(-1)).toBe("remove");
			expect(calls.indexOf("logs")).toBeLessThan(calls.indexOf("remove"));
		});

		it("does not time out a run that finishes in time", async () => {
			const clock = createFakeClock();
			const { session } = await open({ logs: frame(1, "ok\n") }, { clock });

			const result = await session.runPython("print('ok')", { timeoutMs: 5_000 });
			clock.advanceBy(60_000);

			expect(result.error).toBeUndefined();
		});

		it("still reports the timeout when the logs cannot be read", async () => {
			const clock = createFakeClock();
			const { session, calls } = await open(
				{ waitHangs: true, fail: { logs: new PlatformError("provider-unavailable", "no logs") } },
				{ clock },
			);

			const running = session.runPython("while True: pass", { timeoutMs: 1_000 });
			await vi.waitFor(() => expect(calls).toContain("wait"));
			clock.advanceBy(1_000);
			const result = await running;

			expect(result.error?.name).toBe("TimeoutError");
			expect(result.stdout).toBe("");
		});
	});

	describe("removal", () => {
		const failure = new PlatformError("provider-unavailable", "engine failed");

		it.each([
			["a successful run", {}],
			["a failing run", { exitCode: 1 }],
			["a failure to place a file", { fail: { putFile: failure } }],
			["a failure to start", { fail: { start: failure } }],
			["a failure to wait", { fail: { wait: failure } }],
			["a failure to read the logs", { fail: { logs: failure } }],
		] satisfies [string, FakeEngineOptions][])(
			"removes the container after %s",
			async (_label, options) => {
				const { session, calls, live } = await open(options);
				await session.writeFile("d.csv", new Uint8Array());

				await session.runPython("1", RUN).catch(() => undefined);

				expect(calls.filter((call) => call === "remove")).toHaveLength(1);
				expect(live.size).toBe(0);
			},
		);

		it.each([
			["place a file", { fail: { putFile: new PlatformError("provider-unavailable", "p") } }],
			["start", { fail: { start: new PlatformError("provider-unavailable", "s") } }],
			["wait", { fail: { wait: new PlatformError("provider-unavailable", "w") } }],
			["read the logs", { fail: { logs: new PlatformError("provider-unavailable", "l") } }],
		] satisfies [string, FakeEngineOptions][])(
			"passes on a failure to %s as provider-unavailable",
			async (_label, options) => {
				const { session } = await open(options);

				await expect(session.runPython("1", RUN)).rejects.toMatchObject({
					code: "provider-unavailable",
				});
			},
		);

		it("does not remove anything when the container could not be created", async () => {
			const { session, calls } = await open({ fail: { createContainer: failure } });

			await expect(session.runPython("1", RUN)).rejects.toBe(failure);
			expect(calls).toEqual(["create"]);
		});

		it("returns the run's result and reports a warning when the removal fails, then retries on close", async () => {
			const onWarning = vi.fn();
			const { session, calls } = await open(
				{ logs: frame(1, "ok\n"), removeFailures: 2 },
				{ onWarning },
			);

			const result = await session.runPython("1", RUN);

			expect(result.stdout).toBe("ok\n");
			expect(onWarning).toHaveBeenCalledTimes(1);
			expect(String(onWarning.mock.calls[0]?.[0])).toContain("c1");
			// Two attempts in the run (both failed); the close tries again and succeeds.
			expect(calls.filter((call) => call === "remove")).toHaveLength(2);
			await session.close();
			expect(calls.filter((call) => call === "remove")).toHaveLength(3);
		});
	});

	describe("a session closed while a run is being set up", () => {
		it("removes a container that was still being created when the session closed, and runs nothing", async () => {
			let finishCreate: () => void = () => undefined;
			const created = new Promise<void>((resolve) => {
				finishCreate = resolve;
			});
			const { session, calls, live } = await open({ duringCreate: () => created });

			const running = session.runPython("print(1)", RUN).catch((error: unknown) => error);
			await vi.waitFor(() => expect(calls).toContain("create"));
			await session.close();
			finishCreate();
			const outcome = await running;

			expect(outcome).toMatchObject({ code: "provider-unavailable" });
			expect(calls).not.toContain("start");
			expect(calls.filter((call) => call.startsWith("put:"))).toEqual([]);
			expect(live.size).toBe(0);
		});

		it("does not start a container whose files were being placed when the session closed", async () => {
			let closeNow: () => Promise<void> = async () => undefined;
			const { session, calls, live } = await open({
				afterPut: async (name) => {
					if (name === "data.csv") await closeNow();
				},
			});
			closeNow = () => session.close();
			await session.writeFile("data.csv", new Uint8Array([1]));

			const outcome = await session.runPython("print(1)", RUN).catch((error: unknown) => error);

			expect(outcome).toMatchObject({ code: "provider-unavailable" });
			expect(calls).not.toContain("start");
			expect(live.size).toBe(0);
		});

		it("sends the files the run began with, even if the session's files change meanwhile", async () => {
			const { session, puts } = await open({
				afterPut: async () => undefined,
			});
			await session.writeFile("a.csv", new Uint8Array([1]));

			const first = session.runPython("1", RUN);
			await session.writeFile("b.csv", new Uint8Array([2]));
			await first;

			expect(puts.filter((put) => put.id === "c1").map((put) => put.name)).toEqual([
				"a.csv",
				SANDBOX_MAIN_FILE,
			]);
		});
	});

	describe("what the container is labelled and how its logs are kept", () => {
		it("limits the daemon's stored log, so output the code floods cannot fill the disk", async () => {
			const { session, specs } = await open();
			await session.runPython("print(1)", RUN);

			expect((specs[0] as DockerContainerSpec).HostConfig.LogConfig).toEqual({
				Type: "json-file",
				Config: { "max-size": "16m", "max-file": "1" },
			});
		});

		it("labels the container, so leftovers after a crash can be found and removed", async () => {
			const { session, specs } = await open();
			await session.runPython("print(1)", RUN);

			expect((specs[0] as DockerContainerSpec).Labels).toEqual({ "agentic-ai.sandbox": "1" });
		});
	});

	describe("file names", () => {
		it("rejects a name that is not a plain file name", async () => {
			const { session, puts } = await open();

			await expect(session.writeFile("../x", new Uint8Array())).rejects.toMatchObject({
				code: "invalid-request",
			});
			expect(puts).toEqual([]);
		});

		it("rejects the name reserved for the code itself", async () => {
			const { session } = await open();

			await expect(session.writeFile(SANDBOX_MAIN_FILE, new Uint8Array())).rejects.toMatchObject({
				code: "invalid-request",
			});
		});
	});

	describe("close and expiry", () => {
		it("reports a container that even close could not remove", async () => {
			const onWarning = vi.fn();
			const { session } = await open(
				{ removeAlwaysFails: true, logs: frame(1, "ok\n") },
				{ onWarning },
			);
			await session.runPython("1", RUN);
			expect(onWarning).toHaveBeenCalledTimes(1);

			await session.close();

			expect(onWarning).toHaveBeenCalledTimes(2);
			expect(String(onWarning.mock.calls[1]?.[0])).toContain("c1");
		});

		it("is alive until closed; close is idempotent; later calls fail with provider-unavailable and never reach the engine", async () => {
			const { session, calls } = await open();
			expect(await session.isAlive()).toBe(true);

			await session.close();
			await session.close();

			expect(await session.isAlive()).toBe(false);
			await expect(session.runPython("1", RUN)).rejects.toMatchObject({
				code: "provider-unavailable",
			});
			await expect(session.writeFile("a.csv", new Uint8Array())).rejects.toMatchObject({
				code: "provider-unavailable",
			});
			expect(calls).toEqual([]);
		});

		it("force-removes the container of a run in progress when the session closes", async () => {
			const clock = createFakeClock();
			const { session, calls, live } = await open({ waitHangs: true }, { clock });

			const running = session
				.runPython("while True: pass", { timeoutMs: 60_000 })
				.catch((error: unknown) => error);
			await vi.waitFor(() => expect(calls).toContain("wait"));
			await session.close();

			expect(live.size).toBe(0);
			clock.advanceBy(60_000);
			await running;
		});

		it("expires after the lifetime given at creation", async () => {
			const clock = createFakeClock();
			const fake = makeEngine();
			const session = await createDockerProvider({
				engine: fake.engine,
				image: "img:1",
				clock,
			}).create({
				timeoutMs: 10_000,
			});

			clock.advanceBy(10_000);
			expect(await session.isAlive()).toBe(true);
			clock.advanceBy(1);
			expect(await session.isAlive()).toBe(false);
			await expect(session.runPython("1", RUN)).rejects.toMatchObject({
				code: "provider-unavailable",
				message: expect.stringContaining("有効期限"),
			});
			expect(fake.calls).toEqual([]);
		});

		it("still accepts a run at the very last moment of the lifetime", async () => {
			const clock = createFakeClock();
			const fake = makeEngine();
			const session = await createDockerProvider({
				engine: fake.engine,
				image: "img:1",
				clock,
			}).create({
				timeoutMs: 10_000,
			});

			clock.advanceBy(10_000);

			await expect(session.runPython("1", RUN)).resolves.toBeDefined();
		});

		it("does not create a session when the signal is already aborted", async () => {
			const provider = createDockerProvider({ engine: makeEngine().engine, image: "img:1" });
			const controller = new AbortController();
			controller.abort(new Error("stop"));

			await expect(provider.create({ timeoutMs: 1000, signal: controller.signal })).rejects.toThrow(
				"stop",
			);
		});
	});
});
