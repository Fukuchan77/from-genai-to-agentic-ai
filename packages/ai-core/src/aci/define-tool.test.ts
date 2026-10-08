import { generateText, type Tool } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ConfigError } from "../config/load";
import { createFakeClock, type FakeClock } from "../ports/clock";
import { createToolCallingModel } from "../testing/mock-models";
import { defineAciTool, effectiveToolTimeoutMs, ToolExecutionError } from "./define-tool";
import type { AciToolContext, ToolOutcome, ToolRisk } from "./types";

const echoSchema = z.object({ text: z.string() });

function never<T>(): Promise<T> {
	return new Promise<T>(() => {});
}

async function run<INPUT, OUTPUT>(
	converted: Tool<INPUT, ToolOutcome<OUTPUT>>,
	input: INPUT,
	abortSignal?: AbortSignal,
): Promise<ToolOutcome<OUTPUT>> {
	const execute = converted.execute;
	if (!execute) throw new Error("converted tool must be executable");
	return (await execute(input, {
		toolCallId: "call-1",
		messages: [],
		context: undefined,
		...(abortSignal ? { abortSignal } : {}),
	})) as ToolOutcome<OUTPUT>;
}

/** Settles pending microtasks so that a resolved race is observable. */
async function flush(): Promise<void> {
	for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

function track<T>(promise: Promise<T>): { settled: () => boolean; promise: Promise<T> } {
	let settled = false;
	const tracked = promise.finally(() => {
		settled = true;
	});
	return { settled: () => settled, promise: tracked };
}

function hangingTool(timeoutMs?: number) {
	return defineAciTool({
		name: "hang",
		description: "Never finishes.",
		inputSchema: echoSchema,
		risk: "read-only",
		...(timeoutMs === undefined ? {} : { timeoutMs }),
		execute: () => never<string>(),
	});
}

async function expectTimeoutAt(clock: FakeClock, outcome: Promise<unknown>, ms: number) {
	const tracked = track(outcome);
	clock.advanceBy(ms - 1);
	await flush();
	expect(tracked.settled()).toBe(false);
	clock.advanceBy(1);
	await expect(tracked.promise).resolves.toMatchObject({
		ok: false,
		failure: { kind: "timeout" },
	});
}

describe("effectiveToolTimeoutMs", () => {
	it("uses the runtime limit when the definition has none", () => {
		expect(effectiveToolTimeoutMs(undefined, 1_000)).toBe(1_000);
	});

	it("lets a definition shorten the runtime limit", () => {
		expect(effectiveToolTimeoutMs(500, 1_000)).toBe(500);
	});

	it("never lets a definition extend the runtime limit", () => {
		expect(effectiveToolTimeoutMs(5_000, 1_000)).toBe(1_000);
	});
});

describe("defineAciTool", () => {
	it("returns the data of a successful execution as an ok outcome", async () => {
		const clock = createFakeClock(10);
		let seen: AciToolContext | undefined;
		const echo = defineAciTool({
			name: "echo",
			description: "Echoes the text.",
			inputSchema: echoSchema,
			risk: "read-only",
			execute: (input, context) => {
				seen = context;
				return { echoed: input.text };
			},
		});

		const converted = echo.toTool({ clock, toolTimeoutMs: 1_000 });
		await expect(run(converted, { text: "hi" })).resolves.toEqual({
			ok: true,
			data: { echoed: "hi" },
		});
		expect(converted.description).toBe("Echoes the text.");
		expect(converted.inputSchema).toBe(echoSchema);
		expect(seen?.clock).toBe(clock);
		expect(seen?.toolCallId).toBe("call-1");
		expect(seen?.abortSignal.aborted).toBe(false);
		expect(echo).toMatchObject({ name: "echo", risk: "read-only", timeoutMs: undefined });
	});

	it("times out at the runtime limit when the definition has no timeout", async () => {
		const clock = createFakeClock();
		const converted = hangingTool().toTool({ clock, toolTimeoutMs: 1_000 });
		await expectTimeoutAt(clock, run(converted, { text: "x" }), 1_000);
	});

	it("times out at a definition timeout shorter than the runtime limit", async () => {
		const clock = createFakeClock();
		const converted = hangingTool(500).toTool({ clock, toolTimeoutMs: 1_000 });
		await expectTimeoutAt(clock, run(converted, { text: "x" }), 500);
	});

	it("caps a definition timeout longer than the runtime limit", async () => {
		const clock = createFakeClock();
		const converted = hangingTool(5_000).toTool({ clock, toolTimeoutMs: 1_000 });
		await expectTimeoutAt(clock, run(converted, { text: "x" }), 1_000);
	});

	it("turns a timeout into a timeout outcome and aborts the tool's signal", async () => {
		const clock = createFakeClock();
		let signal: AbortSignal | undefined;
		const slow = defineAciTool({
			name: "slow",
			description: "Waits for its signal.",
			inputSchema: echoSchema,
			risk: "read-only",
			execute: (_input, context) => {
				signal = context.abortSignal;
				return never<string>();
			},
		});
		const pending = run(slow.toTool({ clock, toolTimeoutMs: 200 }), { text: "x" });
		clock.advanceBy(200);

		const outcome = await pending;
		expect(outcome).toEqual({
			ok: false,
			failure: {
				kind: "timeout",
				summary: "ツール「slow」が時間上限（200 ミリ秒）内に完了しませんでした。",
				nextAction: "入力を小さくして再試行するか、ツールを使わずに回答してください。",
			},
		});
		expect(signal?.aborted).toBe(true);
	});

	it("turns a ToolExecutionError into a recoverable outcome with its summary and next action", async () => {
		const failing = defineAciTool({
			name: "failing",
			description: "Always fails.",
			inputSchema: echoSchema,
			risk: "read-only",
			execute: () => {
				throw new ToolExecutionError("入力が不正です。", { nextAction: "括弧を閉じてください。" });
			},
		});
		const outcome = await run(failing.toTool({ clock: createFakeClock(), toolTimeoutMs: 100 }), {
			text: "x",
		});
		expect(outcome).toEqual({
			ok: false,
			failure: {
				kind: "recoverable",
				summary: "入力が不正です。",
				nextAction: "括弧を閉じてください。",
			},
		});
	});

	it("does not leak the message of an unexpected error into the outcome", async () => {
		const failing = defineAciTool({
			name: "leaky",
			description: "Fails with a secret in the message.",
			inputSchema: echoSchema,
			risk: "read-only",
			execute: async () => {
				throw new TypeError("https://api.example.test/?api_key=sk-secret");
			},
		});
		const outcome = await run(failing.toTool({ clock: createFakeClock(), toolTimeoutMs: 100 }), {
			text: "x",
		});
		expect(outcome).toEqual({
			ok: false,
			failure: {
				kind: "recoverable",
				summary: "ツール「leaky」の実行に失敗しました（TypeError）。",
				nextAction: "入力を見直して再試行するか、ツールを使わずに回答してください。",
			},
		});
		expect(JSON.stringify(outcome)).not.toContain("sk-secret");
	});

	it("propagates the caller's abort to the tool and rejects with the caller's reason", async () => {
		const clock = createFakeClock();
		const caller = new AbortController();
		let signal: AbortSignal | undefined;
		const waiting = defineAciTool({
			name: "waiting",
			description: "Waits for its signal.",
			inputSchema: echoSchema,
			risk: "read-only",
			execute: (_input, context) => {
				signal = context.abortSignal;
				return never<string>();
			},
		});
		const pending = run(
			waiting.toTool({ clock, toolTimeoutMs: 1_000 }),
			{ text: "x" },
			caller.signal,
		);
		await flush();
		expect(signal?.aborted).toBe(false);
		const reason = new DOMException("stopped by learner", "AbortError");
		caller.abort(reason);

		expect(signal?.aborted).toBe(true);
		expect(signal?.reason).toBe(reason);
		await expect(pending).rejects.toBe(reason);
	});

	it("rejects immediately when the caller has already aborted", async () => {
		const caller = new AbortController();
		const reason = new Error("already stopped");
		caller.abort(reason);
		let executed = false;
		const tool = defineAciTool({
			name: "noop",
			description: "Does nothing.",
			inputSchema: echoSchema,
			risk: "read-only",
			execute: () => {
				executed = true;
				return "done";
			},
		});
		const converted = tool.toTool({ clock: createFakeClock(), toolTimeoutMs: 100 });
		await expect(run(converted, { text: "x" }, caller.signal)).rejects.toBe(reason);
		expect(executed).toBe(false);
	});

	it("returns a failing tool's outcome as a tool result so the agent loop can continue", async () => {
		const failing = defineAciTool({
			name: "failing",
			description: "Always fails.",
			inputSchema: echoSchema,
			risk: "read-only",
			execute: () => {
				throw new ToolExecutionError("失敗しました。");
			},
		});
		const result = await generateText({
			model: createToolCallingModel({
				toolCallId: "call-1",
				toolName: "failing",
				input: { text: "x" },
			}),
			prompt: "call the tool",
			tools: { failing: failing.toTool({ clock: createFakeClock(), toolTimeoutMs: 100 }) },
		});

		expect(result.toolResults).toHaveLength(1);
		expect(result.toolResults[0]?.output).toEqual({
			ok: false,
			failure: { kind: "recoverable", summary: "失敗しました。" },
		});
		expect(result.content.some((part) => part.type === "tool-error")).toBe(false);
	});

	it.each([
		["an empty name", { name: "" }],
		["a name with spaces", { name: "two words" }],
		["a non-integer timeout", { timeoutMs: 1.5 }],
		["a zero timeout", { timeoutMs: 0 }],
	])("rejects %s with a ConfigError", (_label, override) => {
		expect(() =>
			defineAciTool({
				name: "valid",
				description: "Valid.",
				inputSchema: echoSchema,
				risk: "read-only",
				execute: () => "ok",
				...override,
			}),
		).toThrow(ConfigError);
	});

	it("rejects an undeclared risk class at runtime", () => {
		expect(() =>
			defineAciTool({
				name: "untyped",
				description: "Called from untyped code.",
				inputSchema: echoSchema,
				risk: "unknown" as ToolRisk,
				execute: () => "ok",
			}),
		).toThrow(ConfigError);
	});

	it.each([0, -1, 1.5, Number.POSITIVE_INFINITY])(
		"rejects a runtime tool timeout of %s with a ConfigError",
		(toolTimeoutMs) => {
			const tool = defineAciTool({
				name: "valid",
				description: "Valid.",
				inputSchema: echoSchema,
				risk: "read-only",
				execute: () => "ok",
			});
			expect(() => tool.toTool({ clock: createFakeClock(), toolTimeoutMs })).toThrow(ConfigError);
		},
	);
});
