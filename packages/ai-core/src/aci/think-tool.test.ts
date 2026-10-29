import type { Tool } from "ai";
import { describe, expect, it, vi } from "vitest";
import { createFakeClock } from "../ports/clock";
import { checkDescription } from "./description-check";
import { createThinkTool, THINK_TOOL_NAME } from "./think-tool";
import type { ToolOutcome } from "./types";

const runtime = { clock: createFakeClock(), toolTimeoutMs: 1_000 };

async function call(tool: Tool, input: unknown): Promise<ToolOutcome<string>> {
	const run = tool.execute;
	if (!run) throw new Error("think tool has no execute");
	return (await run(input as never, {
		toolCallId: "call-1",
		messages: [],
		context: undefined,
	})) as ToolOutcome<string>;
}

describe("createThinkTool", () => {
	it("returns undefined when disabled", () => {
		expect(createThinkTool({ enabled: false })).toBeUndefined();
	});

	it("is a read-only tool named think when enabled", () => {
		const think = createThinkTool({ enabled: true });

		expect(THINK_TOOL_NAME).toBe("think");
		expect(think?.name).toBe("think");
		expect(think?.risk).toBe("read-only");
	});

	it("has a description that passes the CL-18 check", () => {
		const think = createThinkTool({ enabled: true });
		if (!think) throw new Error("expected a think tool");

		expect(checkDescription(think.description, think.inputSchema)).toEqual([]);
	});

	it("acknowledges the call without echoing or storing the thought", async () => {
		const onCall = vi.fn();
		const think = createThinkTool({ enabled: true, onCall });
		if (!think) throw new Error("expected a think tool");
		const secret = "my-private-plan-xyz";

		const outcome = await call(think.toTool(runtime), { thought: secret });

		expect(outcome.ok).toBe(true);
		if (!outcome.ok) return;
		expect(outcome.data.length).toBeGreaterThan(0);
		expect(outcome.data).not.toContain(secret);
		expect(JSON.stringify(onCall.mock.calls)).not.toContain(secret);
	});

	it("reports every call to onCall, with no arguments", async () => {
		const onCall = vi.fn();
		const think = createThinkTool({ enabled: true, onCall });
		if (!think) throw new Error("expected a think tool");
		const tool = think.toTool(runtime);

		await call(tool, { thought: "a" });
		await call(tool, { thought: "b" });

		expect(onCall).toHaveBeenCalledTimes(2);
		expect(onCall).toHaveBeenNthCalledWith(1);
	});

	it("works without an onCall recorder", async () => {
		const think = createThinkTool({ enabled: true });
		if (!think) throw new Error("expected a think tool");

		await expect(call(think.toTool(runtime), { thought: "a" })).resolves.toMatchObject({
			ok: true,
		});
	});

	it("requires a non-empty thought of bounded size", () => {
		const think = createThinkTool({ enabled: true });
		if (!think) throw new Error("expected a think tool");
		const schema = think.inputSchema;

		expect(schema.safeParse({ thought: "" }).success).toBe(false);
		expect(schema.safeParse({ thought: "x".repeat(2_001) }).success).toBe(false);
		expect(schema.safeParse({ thought: "x" }).success).toBe(true);
	});
});
