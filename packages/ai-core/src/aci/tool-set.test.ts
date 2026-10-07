import { type ToolSet, tool } from "ai";
import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { ConfigError } from "../config/load";
import type { Clock } from "../ports/clock";
import { createFakeClock } from "../ports/clock";
import { defineAciTool } from "./define-tool";
import { buildToolSet, toolAvailabilityFromConfig } from "./tool-set";
import type { AciTool, GuardedToolSet, ToolOutcome, ToolRisk, ToolRuntime } from "./types";

const inputSchema = z.object({});

function hangingTool(name: string, seen: Clock[]): AciTool<Record<string, never>, string> {
	return defineAciTool({
		name,
		description: `${name} never finishes.`,
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
		description: "Changes something.",
		inputSchema,
		risk,
		execute: () => "changed",
	});
}

const searchTool = defineAciTool({
	name: "webSearch",
	description: "Searches the web.",
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
			description: "Writes somewhere.",
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

describe("toolAvailabilityFromConfig", () => {
	it("enables web search only when the Tavily key is configured", () => {
		expect(toolAvailabilityFromConfig({ credentials: { tavily: "tvly-test" } })).toEqual({
			"web-search": true,
		});
		expect(toolAvailabilityFromConfig({ credentials: {} })).toEqual({ "web-search": false });
	});
});
