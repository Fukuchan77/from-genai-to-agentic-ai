import net from "node:net";
import { describe, expect, it, vi } from "vitest";
import { PlatformError } from "../errors";
import { createE2bProvider, type E2bExecution, type E2bSandbox, type E2bSdk } from "./e2b";

const KEY = "changeme-e2b-secret";
const RUN = { timeoutMs: 5_000 };

class NamedError extends Error {
	constructor(name: string, message: string) {
		super(message);
		this.name = name;
	}
}

interface FakeSandbox extends E2bSandbox {
	written: { path: string; bytes: Uint8Array }[];
	codes: string[];
	runOptions: { timeoutMs?: number | undefined }[];
	killCalls: number;
}

interface FakeOptions {
	execution?: E2bExecution;
	runError?: unknown;
	running?: boolean | Error;
	killError?: unknown;
}

function makeSandbox(options: FakeOptions = {}): FakeSandbox {
	const sandbox: FakeSandbox = {
		written: [],
		codes: [],
		runOptions: [],
		killCalls: 0,
		files: {
			async write(path, data) {
				sandbox.written.push({ path, bytes: new Uint8Array(data) });
			},
		},
		async runCode(code, opts) {
			sandbox.codes.push(code);
			sandbox.runOptions.push({ timeoutMs: opts?.timeoutMs });
			if (options.runError) throw options.runError;
			return options.execution ?? { results: [], logs: { stdout: [], stderr: [] } };
		},
		async isRunning() {
			if (options.running instanceof Error) throw options.running;
			return options.running ?? true;
		},
		async kill() {
			sandbox.killCalls += 1;
			if (options.killError) throw options.killError;
			return true;
		},
	};
	return sandbox;
}

function makeSdk(sandbox: E2bSandbox | Error) {
	const create = vi.fn(async (_options: Parameters<E2bSdk["Sandbox"]["create"]>[0]) => {
		if (sandbox instanceof Error) throw sandbox;
		return sandbox;
	});
	const sdk: E2bSdk = { Sandbox: { create } };
	return { sdk, create };
}

async function open(options: FakeOptions = {}) {
	const sandbox = makeSandbox(options);
	const { sdk, create } = makeSdk(sandbox);
	const session = await createE2bProvider({ apiKey: KEY, sdk }).create({ timeoutMs: 120_000 });
	return { sandbox, session, create };
}

describe("createE2bProvider", () => {
	it("reports its kind as e2b", () => {
		expect(createE2bProvider({ apiKey: KEY, sdk: makeSdk(makeSandbox()).sdk }).kind).toBe("e2b");
	});

	describe("create", () => {
		it("passes the key and the lifetime to the SDK and does not change its network default", async () => {
			const { create } = await open();

			expect(create).toHaveBeenCalledTimes(1);
			const options = create.mock.calls[0]?.[0];
			expect(options).toMatchObject({ apiKey: KEY, timeoutMs: 120_000 });
			expect(options).not.toHaveProperty("allowInternetAccess");
		});

		it("passes allowInternetAccess only when the provider was configured with it", async () => {
			const { sdk, create } = makeSdk(makeSandbox());
			await createE2bProvider({ apiKey: KEY, sdk, allowInternetAccess: false }).create({
				timeoutMs: 1000,
			});

			expect(create.mock.calls[0]?.[0]).toMatchObject({ allowInternetAccess: false });
		});

		it("kills a sandbox that finished creating after the signal was aborted, and rethrows", async () => {
			const sandbox = makeSandbox();
			const controller = new AbortController();
			const { sdk } = makeSdk(sandbox);
			const slow: E2bSdk = {
				Sandbox: {
					create: async (options) => {
						controller.abort(new Error("stop"));
						return sdk.Sandbox.create(options);
					},
				},
			};

			await expect(
				createE2bProvider({ apiKey: KEY, sdk: slow }).create({
					timeoutMs: 1000,
					signal: controller.signal,
				}),
			).rejects.toThrow("stop");
			expect(sandbox.killCalls).toBe(1);
		});

		it("does not call the SDK when the signal is already aborted", async () => {
			const { sdk, create } = makeSdk(makeSandbox());
			const controller = new AbortController();
			controller.abort(new Error("stop"));

			await expect(
				createE2bProvider({ apiKey: KEY, sdk }).create({
					timeoutMs: 1000,
					signal: controller.signal,
				}),
			).rejects.toThrow("stop");
			expect(create).not.toHaveBeenCalled();
		});

		it("loads a lazily supplied SDK once, on the first create, not when the provider is built", async () => {
			const { sdk } = makeSdk(makeSandbox());
			const load = vi.fn(async () => sdk);
			const provider = createE2bProvider({ apiKey: KEY, sdk: load });
			expect(load).not.toHaveBeenCalled();

			await provider.create({ timeoutMs: 1000 });
			await provider.create({ timeoutMs: 1000 });

			expect(load).toHaveBeenCalledTimes(1);
		});

		it.each([undefined, "", "   "])(
			"fails with provider-unavailable and loads nothing when the key is %j",
			async (apiKey) => {
				const load = vi.fn(async () => makeSdk(makeSandbox()).sdk);
				const provider = createE2bProvider({ apiKey, sdk: load });

				await expect(provider.create({ timeoutMs: 1000 })).rejects.toMatchObject({
					code: "provider-unavailable",
					message: expect.stringContaining("E2B_API_KEY"),
				});
				expect(load).not.toHaveBeenCalled();
			},
		);

		it("turns a failed creation into provider-unavailable without echoing the SDK's message", async () => {
			const { sdk } = makeSdk(new Error(`request failed for key ${KEY}`));
			const error = await createE2bProvider({ apiKey: KEY, sdk })
				.create({ timeoutMs: 1000 })
				.catch((caught: unknown) => caught);

			expect(error).toBeInstanceOf(PlatformError);
			expect((error as PlatformError).code).toBe("provider-unavailable");
			expect(
				JSON.stringify({
					message: (error as Error).message,
					details: (error as PlatformError).details,
				}),
			).not.toContain(KEY);
		});

		it("says the key is invalid when the SDK reports an authentication failure", async () => {
			const { sdk } = makeSdk(new NamedError("AuthenticationError", `bad key ${KEY}`));
			const error = await createE2bProvider({ apiKey: KEY, sdk })
				.create({ timeoutMs: 1000 })
				.catch((caught: unknown) => caught);

			expect((error as PlatformError).code).toBe("provider-unavailable");
			expect((error as Error).message).toContain("E2B_API_KEY");
			expect((error as Error).message).toContain("無効");
			expect((error as Error).message).not.toContain(KEY);
		});

		it("loads the real SDK on the first create and gets as far as connecting to the E2B API", async () => {
			// The connection is intercepted here (before the test setup's own block), so nothing is
			// sent and the destination can be read.
			const attempts: string[] = [];
			const connect = vi
				.spyOn(net.Socket.prototype, "connect")
				.mockImplementation(function intercepted(this: net.Socket, ...args: unknown[]) {
					attempts.push(JSON.stringify(args[0]));
					throw new Error("connection refused by the test");
				} as never);
			try {
				const provider = createE2bProvider({ apiKey: KEY });

				await expect(provider.create({ timeoutMs: 1_000 })).rejects.toMatchObject({
					code: "provider-unavailable",
				});

				// Reaching for the network means the package imported, `Sandbox.create` exists with the
				// shape the provider calls, and the key was handed over.
				expect(attempts.join(" ")).toMatch(/e2b/u);
			} finally {
				connect.mockRestore();
			}
		}, 30_000);

		it("turns a failure to load the SDK into provider-unavailable", async () => {
			const provider = createE2bProvider({
				apiKey: KEY,
				sdk: async () => {
					throw new Error("Cannot find module");
				},
			});

			await expect(provider.create({ timeoutMs: 1000 })).rejects.toMatchObject({
				code: "provider-unavailable",
			});
		});
	});

	describe("writeFile", () => {
		it("writes the raw bytes into the working directory", async () => {
			const { sandbox, session } = await open();
			const bytes = new Uint8Array([0, 255, 13, 10, 1]);

			await session.writeFile("data.csv", bytes);

			expect(sandbox.written).toEqual([{ path: "/home/user/data.csv", bytes }]);
		});

		it("sends a copy, so the caller changing its array later changes nothing", async () => {
			const { sandbox, session } = await open();
			const bytes = new Uint8Array([1, 2, 3]);
			await session.writeFile("a.bin", bytes);
			bytes[0] = 99;

			expect(sandbox.written[0]?.bytes[0]).toBe(1);
		});

		it("rejects a name that is not a plain file name, before calling the SDK", async () => {
			const { sandbox, session } = await open();

			await expect(session.writeFile("../etc/passwd", new Uint8Array())).rejects.toMatchObject({
				code: "invalid-request",
			});
			expect(sandbox.written).toEqual([]);
		});

		it("turns an SDK failure into provider-unavailable", async () => {
			const { sandbox, session } = await open();
			sandbox.files.write = async () => {
				throw new Error(`disk ${KEY}`);
			};

			const error = await session
				.writeFile("a.csv", new Uint8Array())
				.catch((caught: unknown) => caught);

			expect((error as PlatformError).code).toBe("provider-unavailable");
			expect((error as Error).message).not.toContain(KEY);
		});
	});

	describe("runPython", () => {
		it("joins the stdout and stderr lines and passes the code and the timeout", async () => {
			const { sandbox, session } = await open({
				execution: { results: [], logs: { stdout: ["a\n", "b\n"], stderr: ["warn\n"] } },
			});

			const result = await session.runPython("print('a')", RUN);

			expect(result).toEqual({ stdout: "a\nb\n", stderr: "warn\n" });
			expect(result).not.toHaveProperty("error");
			expect(sandbox.codes).toEqual(["print('a')"]);
			expect(sandbox.runOptions).toEqual([{ timeoutMs: 5_000 }]);
		});

		it("maps an execution error, renaming value to message", async () => {
			const { session } = await open({
				execution: {
					results: [],
					logs: { stdout: ["before\n"], stderr: [] },
					error: {
						name: "KeyError",
						value: "'revenue'",
						traceback: "Traceback...\nKeyError: 'revenue'",
					},
				},
			});

			const result = await session.runPython("df['revenue']", RUN);

			expect(result.stdout).toBe("before\n");
			expect(result.error).toEqual({
				name: "KeyError",
				message: "'revenue'",
				traceback: "Traceback...\nKeyError: 'revenue'",
			});
		});

		it("reports a timeout of the running code as an error of the code while the sandbox lives", async () => {
			const { session } = await open({
				runError: new NamedError("TimeoutError", "deadline"),
				running: true,
			});

			const result = await session.runPython("while True: pass", RUN);

			expect(result.error).toMatchObject({ name: "TimeoutError" });
			expect(result.error?.message).toContain("5000");
		});

		it("reports provider-unavailable when the timeout came from the sandbox expiring", async () => {
			const { session } = await open({
				runError: new NamedError("TimeoutError", "killed"),
				running: false,
			});

			await expect(session.runPython("1", RUN)).rejects.toMatchObject({
				code: "provider-unavailable",
				message: expect.stringContaining("有効期限"),
			});
		});

		it("reports provider-unavailable when the timeout check itself fails", async () => {
			const { session } = await open({
				runError: new NamedError("TimeoutError", "x"),
				running: new Error("network"),
			});

			await expect(session.runPython("1", RUN)).rejects.toMatchObject({
				code: "provider-unavailable",
			});
		});

		it.each(["SandboxNotFoundError", "NotFoundError"])(
			"reports provider-unavailable (expired) for %s",
			async (name) => {
				const { session } = await open({ runError: new NamedError(name, "gone") });

				await expect(session.runPython("1", RUN)).rejects.toMatchObject({
					code: "provider-unavailable",
					message: expect.stringContaining("有効期限"),
				});
			},
		);

		it("turns any other SDK failure into provider-unavailable without the SDK's message", async () => {
			const { session } = await open({ runError: new Error(`boom with ${KEY}`) });

			const error = await session.runPython("1", RUN).catch((caught: unknown) => caught);

			expect((error as PlatformError).code).toBe("provider-unavailable");
			expect((error as Error).message).not.toContain(KEY);
			expect((error as Error).message).not.toContain("boom");
		});
	});

	describe("isAlive and close", () => {
		it("asks the SDK whether the sandbox is running", async () => {
			expect(await (await open({ running: true })).session.isAlive()).toBe(true);
			expect(await (await open({ running: false })).session.isAlive()).toBe(false);
		});

		it("treats a failing liveness check as not alive", async () => {
			const { session } = await open({ running: new Error("network") });

			expect(await session.isAlive()).toBe(false);
		});

		it("kills the sandbox once and reports not alive without asking the SDK again", async () => {
			const { sandbox, session } = await open({ running: true });

			await session.close();
			await session.close();

			expect(sandbox.killCalls).toBe(1);
			expect(await session.isAlive()).toBe(false);
		});

		it("does not throw when the kill fails", async () => {
			const { session } = await open({ killError: new Error(`kill failed ${KEY}`) });

			await expect(session.close()).resolves.toBeUndefined();
			expect(await session.isAlive()).toBe(false);
		});

		it("rejects runPython and writeFile after close without calling the SDK", async () => {
			const { sandbox, session } = await open();
			await session.close();

			await expect(session.runPython("1", RUN)).rejects.toMatchObject({
				code: "provider-unavailable",
			});
			await expect(session.writeFile("a.csv", new Uint8Array())).rejects.toMatchObject({
				code: "provider-unavailable",
			});
			expect(sandbox.codes).toEqual([]);
			expect(sandbox.written).toEqual([]);
		});
	});
});
