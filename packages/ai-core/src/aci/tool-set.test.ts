import { type ToolSet, tool } from "ai";
import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { ConfigError } from "../config/load";
import type { Clock } from "../ports/clock";
import { createFakeClock } from "../ports/clock";
import { describeTool } from "../testing/tool-description";
import { defineAciTool } from "./define-tool";
import { FatalLatch, FatalToolError } from "./fatal";
import { buildToolSet, toolAvailabilityFromConfig } from "./tool-set";
import type {
	AciTool,
	AnyAciTool,
	GuardedToolSet,
	ToolOutcome,
	ToolRisk,
	ToolRuntime,
} from "./types";

const inputSchema = z.object({});

function hangingTool(name: string, seen: Clock[]): AciTool<Record<string, never>, string> {
	return defineAciTool({
		name,
		description: describeTool(`${name} never finishes.`),
		inputSchema,
		risk: "read-only",
		execute: (_input, context) => {
			seen.push(context.clock);
			return new Promise<string>(() => {});
		},
	});
}

function riskyTool(risk: ToolRisk): AciTool<Record<string, never>, string> {
	return defineAciTool({
		name: `risky-${risk}`,
		description: describeTool("Changes something."),
		inputSchema,
		risk,
		execute: () => "changed",
	});
}

const searchTool = defineAciTool({
	name: "webSearch",
	description: describeTool("Searches the web."),
	inputSchema,
	risk: "read-only",
	requiredFeature: "web-search",
	execute: () => "results",
});

async function execute(tools: ToolSet, name: string): Promise<ToolOutcome<unknown>> {
	const run = tools[name]?.execute;
	if (!run) throw new Error(`tool ${name} is not registered`);
	return (await run({}, { toolCallId: `call-${name}`, messages: [], context: undefined })) as
		| ToolOutcome<unknown>
		| never;
}

async function flush(): Promise<void> {
	for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

describe("buildToolSet", () => {
	it("delivers the runtime clock and tool timeout to every tool", async () => {
		const clock = createFakeClock();
		const runtime: ToolRuntime = { clock, toolTimeoutMs: 300 };
		const seen: Clock[] = [];
		const { tools, disabled } = buildToolSet(
			[hangingTool("first", seen), hangingTool("second", seen)],
			{},
			runtime,
		);

		expect(Object.keys(tools)).toEqual(["first", "second"]);
		expect(disabled).toEqual([]);
		let settled = false;
		const outcomes = Promise.all([execute(tools, "first"), execute(tools, "second")]).finally(
			() => {
				settled = true;
			},
		);
		clock.advanceBy(299);
		await flush();
		expect(settled).toBe(false);
		clock.advanceBy(1);
		await flush();
		expect(settled).toBe(true);

		await expect(outcomes).resolves.toEqual([
			expect.objectContaining({ ok: false, failure: expect.objectContaining({ kind: "timeout" }) }),
			expect.objectContaining({ ok: false, failure: expect.objectContaining({ kind: "timeout" }) }),
		]);
		expect(seen).toHaveLength(2);
		expect(seen.every((seenClock) => seenClock === clock)).toBe(true);
	});

	it("returns a frozen GuardedToolSet that a raw ToolSet cannot stand in for", () => {
		const { tools } = buildToolSet(
			[searchTool],
			{ "web-search": true },
			{
				clock: createFakeClock(),
				toolTimeoutMs: 100,
			},
		);

		expectTypeOf(tools).toEqualTypeOf<GuardedToolSet>();
		expect(Object.isFrozen(tools)).toBe(true);
		expect(Object.keys(tools)).toEqual(["webSearch"]);

		const raw: ToolSet = { raw: tool({ inputSchema, execute: () => "raw" }) };
		// @ts-expect-error A raw ToolSet does not carry the GuardedToolSet brand.
		const forged: GuardedToolSet = raw;
		expect(forged).toBe(raw);
	});

	it("does not register a tool whose feature is unavailable and reports why", () => {
		const { tools, disabled } = buildToolSet(
			[searchTool],
			{},
			{
				clock: createFakeClock(),
				toolTimeoutMs: 100,
			},
		);

		expect(Object.keys(tools)).toEqual([]);
		expect(disabled).toEqual([
			{
				name: "webSearch",
				reason: "必要な設定が未設定のため、このツールは無効です。",
				requiredEnv: ["TAVILY_API_KEY"],
			},
		]);
	});

	it("treats an explicitly disabled feature as unavailable", () => {
		const { tools, disabled } = buildToolSet(
			[searchTool],
			{ "web-search": false },
			{
				clock: createFakeClock(),
				toolTimeoutMs: 100,
			},
		);
		expect(Object.keys(tools)).toEqual([]);
		expect(disabled.map((entry) => entry.name)).toEqual(["webSearch"]);
	});

	it.each(["write", "destructive"] as const)("rejects a %s tool with a ConfigError", (risk) => {
		const build = () =>
			buildToolSet([riskyTool(risk)], {}, { clock: createFakeClock(), toolTimeoutMs: 100 });
		expect(build).toThrow(ConfigError);
		expect(build).toThrow(`ツール「risky-${risk}」のリスク区分は ${risk} です。`);
	});

	it("rejects a non-read-only tool even when its feature would disable it", () => {
		const risky = defineAciTool({
			name: "riskySearch",
			description: describeTool("Writes somewhere."),
			inputSchema,
			risk: "write",
			requiredFeature: "web-search",
			execute: () => "changed",
		});
		expect(() =>
			buildToolSet([risky], {}, { clock: createFakeClock(), toolTimeoutMs: 100 }),
		).toThrow(ConfigError);
	});

	it("rejects duplicate tool names with a ConfigError", () => {
		const seen: Clock[] = [];
		expect(() =>
			buildToolSet(
				[hangingTool("same", seen), hangingTool("same", seen)],
				{},
				{
					clock: createFakeClock(),
					toolTimeoutMs: 100,
				},
			),
		).toThrow(ConfigError);
	});

	it("rejects an invalid runtime tool timeout with a ConfigError", () => {
		expect(() => buildToolSet([], {}, { clock: createFakeClock(), toolTimeoutMs: 0 })).toThrow(
			ConfigError,
		);
	});
});

describe("buildToolSet: only defineAciTool output", () => {
	const runtime: ToolRuntime = { clock: createFakeClock(), toolTimeoutMs: 1_000 };

	function forgedTool() {
		return {
			name: "forged",
			description: "Skips defineAciTool.",
			risk: "read-only" as const,
			timeoutMs: undefined,
			requiredFeature: undefined,
			toTool: () => tool({ description: "raw", inputSchema, execute: async () => "raw" }),
		};
	}

	it("rejects a hand-built tool object with ConfigError", () => {
		const forged = forgedTool() as unknown as AnyAciTool;

		expect(() => buildToolSet([forged], {}, runtime)).toThrow(ConfigError);
		expect(() => buildToolSet([forged], {}, runtime)).toThrow(/defineAciTool/u);
	});

	it("rejects a copy of a defined tool, which loses the defineAciTool registration", () => {
		const copy: AnyAciTool = { ...searchTool, requiredFeature: undefined };

		expect(() => buildToolSet([copy], {}, runtime)).toThrow(ConfigError);
	});

	it("rejects a hand-built object even when its feature is unavailable", () => {
		const forged = { ...forgedTool(), requiredFeature: "web-search" } as unknown as AnyAciTool;

		expect(() => buildToolSet([forged], {}, runtime)).toThrow(ConfigError);
	});

	it("makes a hand-built object a type error where an AnyAciTool is required", () => {
		// @ts-expect-error a hand-built object lacks the brand that only defineAciTool adds
		const typed: AnyAciTool = forgedTool();
		expectTypeOf(searchTool).toExtend<AnyAciTool>();
		expect(typed.name).toBe("forged");
	});
});

describe("buildToolSet: fatal latch", () => {
	function counting(name: string, behaviour: () => unknown) {
		const calls = { count: 0 };
		const aciTool = defineAciTool({
			name,
			description: describeTool(`${name} for the latch tests.`),
			inputSchema,
			risk: "read-only",
			execute: () => {
				calls.count += 1;
				return behaviour();
			},
		});
		return { aciTool, calls };
	}

	function setup(withLatch: boolean) {
		const latch = new FatalLatch();
		const fatal = counting("fatalTool", () => {
			throw new FatalToolError("not-allowed", "許可されていない操作です。");
		});
		const other = counting("otherTool", () => "other-result");
		const flaky = counting("flakyTool", () => {
			throw new Error("temporary glitch");
		});
		const unauthorized = counting("unauthorizedTool", () => {
			throw Object.assign(new Error("Unauthorized"), { status: 401 });
		});
		const { tools } = buildToolSet(
			[fatal.aciTool, other.aciTool, flaky.aciTool, unauthorized.aciTool],
			{},
			{
				clock: createFakeClock(),
				toolTimeoutMs: 1_000,
				...(withLatch ? { fatal: latch } : {}),
			},
		);
		return { latch, tools, fatal, other, flaky, unauthorized };
	}

	it("trips the latch when a tool throws a FatalToolError and still returns an outcome", async () => {
		const { latch, tools } = setup(true);

		const outcome = await execute(tools, "fatalTool");

		expect(latch.error).toMatchObject({
			code: "not-allowed",
			learnerMessage: "許可されていない操作です。",
		});
		expect(outcome.ok).toBe(false);
	});

	it("does not run any tool after the latch is tripped, and says why", async () => {
		const { tools, other, fatal } = setup(true);

		await execute(tools, "fatalTool");
		const refused = await execute(tools, "otherTool");
		await execute(tools, "fatalTool");

		expect(other.calls.count).toBe(0);
		expect(fatal.calls.count).toBe(1);
		expect(refused).toMatchObject({ ok: false });
		if (refused.ok) throw new Error("expected a refusal");
		expect(refused.failure.summary).toContain("実行されませんでした");
	});

	it("refuses a sibling call that starts together with the failing call (one step)", async () => {
		const { latch, tools, other, fatal } = setup(true);

		const [first, second] = await Promise.all([
			execute(tools, "fatalTool"),
			execute(tools, "otherTool"),
		]);

		expect(latch.error?.code).toBe("not-allowed");
		expect(fatal.calls.count).toBe(1);
		expect(other.calls.count).toBe(0);
		expect(first.ok).toBe(false);
		expect(second).toMatchObject({ ok: false });
	});

	it("keeps the first fatal error when later calls would also fail", async () => {
		const { latch, tools } = setup(true);

		await execute(tools, "unauthorizedTool");
		await execute(tools, "fatalTool");

		expect(latch.error?.code).toBe("auth-failed");
	});

	it("treats an HTTP 401 thrown by a tool as fatal auth-failed", async () => {
		const { latch, tools } = setup(true);

		await execute(tools, "unauthorizedTool");

		expect(latch.error?.code).toBe("auth-failed");
	});

	it("returns a summary and a next action for a recoverable error and keeps running tools", async () => {
		const { latch, tools, other } = setup(true);

		const outcome = await execute(tools, "flakyTool");
		const next = await execute(tools, "otherTool");

		expect(latch.error).toBeUndefined();
		expect(outcome).toMatchObject({
			ok: false,
			failure: { kind: "recoverable", summary: expect.stringContaining("flakyTool") },
		});
		expect(next).toEqual({ ok: true, data: "other-result" });
		expect(other.calls.count).toBe(1);
	});

	it("behaves like M1 without a latch: a FatalToolError is an ordinary failure and nothing is refused", async () => {
		const { tools, other } = setup(false);

		const outcome = await execute(tools, "fatalTool");
		const next = await execute(tools, "otherTool");

		expect(outcome.ok).toBe(false);
		expect(next).toEqual({ ok: true, data: "other-result" });
		expect(other.calls.count).toBe(1);
	});
});

describe("toolAvailabilityFromConfig", () => {
	it("enables web search only when the Tavily key is configured", () => {
		expect(toolAvailabilityFromConfig({ credentials: { tavily: "tvly-test" } })).toEqual({
			"web-search": true,
		});
		expect(toolAvailabilityFromConfig({ credentials: {} })).toEqual({ "web-search": false });
	});
});
