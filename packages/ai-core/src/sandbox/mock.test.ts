import { describe, expect, it } from "vitest";
import { PlatformError } from "../errors";
import { createMockSandboxProvider, MOCK_ERROR_MARKER } from "./mock";

const NO_TIMEOUT = { timeoutMs: 1000 };

describe("createMockSandboxProvider", () => {
	it("reports its kind as mock", () => {
		expect(createMockSandboxProvider().kind).toBe("mock");
	});

	it("returns the success fixture, with a PNG and a table marker line, for ordinary code", async () => {
		const session = await createMockSandboxProvider().create({ timeoutMs: 1000 });
		const result = await session.runPython("print('hello')", NO_TIMEOUT);

		expect(result.error).toBeUndefined();
		expect(result.stderr).toBe("");
		expect(result.stdout).toContain("rows: 3");
		const png = result.stdout.split("\n").find((line) => line.startsWith("__PNG__:"));
		expect(png).toBeDefined();
		const figure = JSON.parse((png ?? "").slice("__PNG__:".length)) as { base64: string };
		// The PNG signature: the fixture is a real (tiny) image, not a placeholder string.
		expect(Buffer.from(figure.base64, "base64").subarray(0, 8)).toEqual(
			Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		);
		expect(result.stdout).toContain("__TABLE__:");
	});

	it("returns the error fixture, with a stderr traceback and an error, when the code carries the marker", async () => {
		const session = await createMockSandboxProvider().create({ timeoutMs: 1000 });
		const result = await session.runPython(
			`${MOCK_ERROR_MARKER}\nprint(df['revenue'])`,
			NO_TIMEOUT,
		);

		expect(result.error).toEqual({
			name: "KeyError",
			message: "'revenue'",
			traceback: expect.stringContaining("KeyError: 'revenue'"),
		});
		expect(result.stderr).toContain("KeyError: 'revenue'");
		expect(result.stdout).toBe("loading data\n");
	});

	it("switches the response per run, so a failure can be followed by a success", async () => {
		const session = await createMockSandboxProvider().create({ timeoutMs: 1000 });
		const first = await session.runPython(`${MOCK_ERROR_MARKER}\n1`, NO_TIMEOUT);
		const second = await session.runPython("print(1)", NO_TIMEOUT);

		expect(first.error?.name).toBe("KeyError");
		expect(second.error).toBeUndefined();
	});

	it("lets a test script the responses and see the call index", async () => {
		const calls: number[] = [];
		const provider = createMockSandboxProvider({
			respond: (_code, index) => {
				calls.push(index);
				return { stdout: `run ${index}`, stderr: "" };
			},
		});
		const session = await provider.create({ timeoutMs: 1000 });

		expect((await session.runPython("a", NO_TIMEOUT)).stdout).toBe("run 0");
		expect((await session.runPython("b", NO_TIMEOUT)).stdout).toBe("run 1");
		expect(calls).toEqual([0, 1]);
	});

	it("records the files written (as raw bytes) and the code that ran, per session", async () => {
		const provider = createMockSandboxProvider();
		const session = await provider.create({ timeoutMs: 1000 });
		const bytes = new Uint8Array([0, 255, 10, 13]);
		await session.writeFile("data.csv", bytes);
		await session.runPython("print(1)", NO_TIMEOUT);

		expect(provider.sessions).toHaveLength(1);
		const [recorded] = provider.sessions;
		expect(recorded?.files.get("data.csv")).toEqual(bytes);
		expect(recorded?.runs).toEqual(["print(1)"]);
		// The stored bytes are a copy: changing the caller's array later does not change the record.
		bytes[0] = 99;
		expect(recorded?.files.get("data.csv")?.[0]).toBe(0);
	});

	it("applies the same file-name rule as the real sandboxes", async () => {
		const session = await createMockSandboxProvider().create({ timeoutMs: 1000 });

		await expect(session.writeFile("/work/data.csv", new Uint8Array())).rejects.toMatchObject({
			code: "invalid-request",
		});
	});

	it("is alive until it is closed, and close is idempotent", async () => {
		const provider = createMockSandboxProvider();
		const session = await provider.create({ timeoutMs: 1000 });
		expect(await session.isAlive()).toBe(true);

		await session.close();
		await session.close();

		expect(await session.isAlive()).toBe(false);
		expect(provider.sessions[0]?.closeCount).toBe(1);
	});

	it("lets go of the files it was given when it closes, so a long-running process does not keep every upload", async () => {
		const provider = createMockSandboxProvider();
		const session = await provider.create({ timeoutMs: 1000 });
		await session.writeFile("data.csv", new Uint8Array([1, 2, 3]));
		await session.runPython("print(1)", NO_TIMEOUT);

		await session.close();

		expect(provider.sessions[0]?.files.size).toBe(0);
		// What ran stays on record: tests read it after the session ended.
		expect(provider.sessions[0]?.runs).toEqual(["print(1)"]);
		expect(provider.sessions[0]?.closeCount).toBe(1);
	});

	it("rejects runPython and writeFile after close with provider-unavailable", async () => {
		const session = await createMockSandboxProvider().create({ timeoutMs: 1000 });
		await session.close();

		await expect(session.runPython("print(1)", NO_TIMEOUT)).rejects.toMatchObject({
			code: "provider-unavailable",
		});
		await expect(session.writeFile("/work/a", new Uint8Array())).rejects.toBeInstanceOf(
			PlatformError,
		);
	});

	it("does not create a session when the signal is already aborted", async () => {
		const provider = createMockSandboxProvider();
		const controller = new AbortController();
		controller.abort(new Error("stop"));

		await expect(provider.create({ timeoutMs: 1000, signal: controller.signal })).rejects.toThrow(
			"stop",
		);
		expect(provider.sessions).toHaveLength(0);
	});

	it("gives each session its own record and call counter", async () => {
		const provider = createMockSandboxProvider();
		const a = await provider.create({ timeoutMs: 1000 });
		const b = await provider.create({ timeoutMs: 1000 });
		await a.runPython("1", NO_TIMEOUT);

		expect(provider.sessions.map((s) => s.runs.length)).toEqual([1, 0]);
		await b.runPython("2", NO_TIMEOUT);
		expect(provider.sessions.map((s) => s.runs)).toEqual([["1"], ["2"]]);
	});
});
