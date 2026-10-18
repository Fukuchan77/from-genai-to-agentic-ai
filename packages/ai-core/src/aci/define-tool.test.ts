import { asSchema, generateText, isStepCount, type Tool } from "ai";
import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { ConfigError } from "../config/load";
import { createFakeClock, type FakeClock } from "../ports/clock";
import { createToolCallingModel } from "../testing/mock-models";
import { describeTool } from "../testing/tool-description";
import { defineAciTool, effectiveToolTimeoutMs, ToolExecutionError } from "./define-tool";
import { checkDescription } from "./description-check";
import { createCalculatorTool } from "./tools/calculator";
import { createCurrencyConvertTool } from "./tools/currency";
import { createCurrentTimeTool } from "./tools/current-time";
import { createSearchKnowledgeBaseTool } from "./tools/search-knowledge-base";
import { createWeatherTool } from "./tools/weather";
import { createWebSearchTool } from "./tools/web-search";
import type { AciToolContext, AciToolDefinition, ToolOutcome, ToolRisk } from "./types";

const echoSchema = z.object({ text: z.string().describe("入力のテキスト") });

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
		description: describeTool("Never finishes."),
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
			description: describeTool("Echoes the text."),
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
		expect(converted.description).toBe(echo.description);
		expect(echo.description).toContain("Echoes the text.");
		// The schema is wrapped to give the model a fix guide (CL-2) but sends the same JSON Schema,
		// so recorded cassette keys do not change.
		expect(asSchema(converted.inputSchema).jsonSchema).toEqual(asSchema(echoSchema).jsonSchema);
		expect(echo.inputSchema).toBe(echoSchema);
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
			description: describeTool("Waits for its signal."),
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
			description: describeTool("Always fails."),
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
			description: describeTool("Fails with a secret in the message."),
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
			description: describeTool("Waits for its signal."),
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
			description: describeTool("Does nothing."),
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
			description: describeTool("Always fails."),
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
				description: describeTool("Valid."),
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
				description: describeTool("Called from untyped code."),
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
				description: describeTool("Valid."),
				inputSchema: echoSchema,
				risk: "read-only",
				execute: () => "ok",
			});
			expect(() => tool.toTool({ clock: createFakeClock(), toolTimeoutMs })).toThrow(ConfigError);
		},
	);
});

describe("defineAciTool: description check (CL-18)", () => {
	function define(overrides: { description: string; inputSchema?: z.ZodType<{ text: string }> }) {
		return defineAciTool({
			name: "checked",
			inputSchema: echoSchema,
			risk: "read-only",
			execute: () => "ok",
			...overrides,
		});
	}

	it("rejects a description without the three heading lines and names what is missing", () => {
		const build = () => define({ description: "Just a sentence." });

		expect(build).toThrow(ConfigError);
		expect(build).toThrow("checked");
		expect(build).toThrow("使うとき:");
		expect(build).toThrow("例:");
	});

	it("rejects an input field without .describe() and names the field", () => {
		const build = () =>
			define({
				description: describeTool("Has an undescribed field."),
				inputSchema: z.object({ text: z.string() }),
			});

		expect(build).toThrow(ConfigError);
		expect(build).toThrow("text");
	});

	it("rejects an input schema the AI SDK cannot send (a Date)", () => {
		const build = () =>
			define({
				description: describeTool("Takes a date."),
				inputSchema: z.object({
					text: z.string().describe("t"),
					when: z.date().describe("w"),
				}) as never,
			});

		expect(build).toThrow(ConfigError);
		expect(build).toThrow("JSON Schema");
	});

	it("accepts a description that follows the format", () => {
		const tool = define({ description: describeTool("Fine.") });

		expect(tool.name).toBe("checked");
		expect(tool.description).toContain("使うとき:");
	});

	it("still requires a declared risk class, at the type level and at run time", () => {
		expectTypeOf<AciToolDefinition<unknown, unknown>>().toHaveProperty("risk");
		expectTypeOf<AciToolDefinition<unknown, unknown>["risk"]>().toEqualTypeOf<ToolRisk>();
		expect(() =>
			defineAciTool({
				name: "norisk",
				description: describeTool("No risk."),
				inputSchema: echoSchema,
				risk: undefined as unknown as ToolRisk,
				execute: () => "ok",
			}),
		).toThrow(ConfigError);
	});

	it("passes for all six M1 tools", () => {
		const fetcher = { fetch: async () => ({ status: 200, headers: {}, body: "" }) };
		const tools = [
			createCalculatorTool(),
			createCurrencyConvertTool(),
			createCurrentTimeTool(createFakeClock()),
			createWeatherTool(fetcher),
			createWebSearchTool({ search: async () => [] }),
			createSearchKnowledgeBaseTool({
				search: async () => [],
				registry: { register: () => 1 },
			}),
		];

		expect(tools).toHaveLength(6);
		for (const aciTool of tools) {
			expect(checkDescription(aciTool.description, aciTool.inputSchema), aciTool.name).toEqual([]);
		}
	});
});

describe("defineAciTool: input fix guide (CL-2)", () => {
	it("does not run the tool body for an invalid input and shows the model a fix guide", async () => {
		let bodyRuns = 0;
		const guarded = defineAciTool({
			name: "guarded",
			description: describeTool("Needs text."),
			inputSchema: echoSchema,
			risk: "read-only",
			execute: () => {
				bodyRuns += 1;
				return "ok";
			},
		});

		const result = await generateText({
			model: createToolCallingModel({
				toolCallId: "call-1",
				toolName: "guarded",
				input: { text: 42 },
			}),
			prompt: "call the tool",
			tools: { guarded: guarded.toTool({ clock: createFakeClock(), toolTimeoutMs: 100 }) },
			stopWhen: isStepCount(1),
		});

		expect(bodyRuns).toBe(0);
		const toolError = result.content.find((part) => part.type === "tool-error");
		expect(toolError).toBeDefined();
		const failure = (toolError as { error: unknown }).error;
		const text = failure instanceof Error ? failure.message : String(failure);
		expect(text).toContain("text（入力のテキスト）");
		expect(text).toContain("string 型");
		expect(text).toContain("正しい入力の例:");
		expect(text).not.toContain("invalid_type");
	});

	it("runs the body and passes the parsed value when the input is valid", async () => {
		const seen: unknown[] = [];
		const echo = defineAciTool({
			name: "echoer",
			description: describeTool("Echoes."),
			inputSchema: z.object({ count: z.coerce.number().describe("回数") }),
			risk: "read-only",
			execute: (input) => {
				seen.push(input);
				return input.count;
			},
		});

		const result = await generateText({
			model: createToolCallingModel({
				toolCallId: "call-1",
				toolName: "echoer",
				input: { count: "3" },
			}),
			prompt: "call the tool",
			tools: { echoer: echo.toTool({ clock: createFakeClock(), toolTimeoutMs: 100 }) },
			stopWhen: isStepCount(1),
		});

		expect(seen).toEqual([{ count: 3 }]);
		expect(result.toolResults[0]?.output).toEqual({ ok: true, data: 3 });
	});
});

describe("defineAciTool with an external JSON Schema (003 CL-25)", () => {
	const external = {
		type: "object",
		properties: { owner: { type: "string", description: "リポジトリの所有者" } },
		required: ["owner"],
		additionalProperties: false,
	};
	const description = [
		"所有者のリポジトリを調べる。",
		"使うとき: owner のリポジトリの情報が欲しいとき。",
		"使わないとき: 書き込みのとき。",
		'例: {"owner":"octocat"}',
	].join("\n");

	function externalTool(
		overrides: Partial<AciToolDefinition<{ owner?: string | undefined }, string>> = {},
	) {
		return defineAciTool<{ owner?: string | undefined }, string>({
			name: "lookup",
			description,
			inputSchema: z.looseObject({ owner: z.string().optional() }),
			externalInputSchema: external,
			risk: "read-only",
			execute: (input) => `owner=${input.owner}`,
			...overrides,
		});
	}

	it("sends the external schema to the model unchanged", async () => {
		const converted = externalTool().toTool({ clock: createFakeClock(), toolTimeoutMs: 100 });
		const schema = asSchema(converted.inputSchema);
		expect(await schema.jsonSchema).toEqual(external);
	});

	it("checks the description against the external schema, not the Zod placeholder", () => {
		// The Zod placeholder has an undescribed field; only the JSON Schema check applies.
		expect(() => externalTool()).not.toThrow();
		expect(() => externalTool({ description: "short description without headings" })).toThrow(
			ConfigError,
		);
		expect(() =>
			externalTool({
				externalInputSchema: { type: "object", properties: { zzz: {} } },
			}),
		).toThrow(/zzz/u);
	});

	it("still checks a Zod-only tool the old way", () => {
		expect(() =>
			defineAciTool({
				name: "plain",
				description,
				inputSchema: z.object({ owner: z.string() }),
				risk: "read-only",
				execute: () => "x",
			}),
		).toThrow(ConfigError);
	});

	it("validates the input with the placeholder schema and returns the fix guide on failure", async () => {
		const converted = externalTool({
			inputSchema: z.object({ owner: z.string().describe("所有者") }),
		}).toTool({ clock: createFakeClock(), toolTimeoutMs: 100 });
		const schema = asSchema(converted.inputSchema);
		const bad = await schema.validate?.({ owner: 3 });
		expect(bad?.success).toBe(false);
		if (bad && !bad.success) expect(bad.error.message).toContain("owner");
		const good = await schema.validate?.({ owner: "octocat" });
		expect(good).toEqual({ success: true, value: { owner: "octocat" } });
	});
});
