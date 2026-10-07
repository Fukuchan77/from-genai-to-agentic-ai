import { describe, expect, it } from "vitest";
import { createFakeClock } from "../../ports/clock";
import type { AciTool, ToolOutcome, ToolRuntime } from "../types";
import { CURRENT_TIME_TOOL_NAME, createCurrentTimeTool } from "./current-time";

async function call<INPUT, OUTPUT>(
	aciTool: AciTool<INPUT, OUTPUT>,
	input: INPUT,
	runtime: ToolRuntime = { clock: createFakeClock(), toolTimeoutMs: 1_000 },
): Promise<ToolOutcome<OUTPUT>> {
	const execute = aciTool.toTool(runtime).execute;
	if (!execute) throw new Error(`${aciTool.name} must be executable`);
	return (await execute(input, {
		toolCallId: "call-1",
		messages: [],
		context: undefined,
	})) as ToolOutcome<OUTPUT>;
}

describe("createCurrentTimeTool", () => {
	const instant = Date.UTC(2026, 9, 7, 3, 4, 5);

	it("reads the time from the injected clock", async () => {
		const clock = createFakeClock(instant);
		const currentTime = createCurrentTimeTool(clock);
		expect(currentTime).toMatchObject({ name: CURRENT_TIME_TOOL_NAME, risk: "read-only" });
		expect(CURRENT_TIME_TOOL_NAME).toBe("currentTime");

		await expect(call(currentTime, {})).resolves.toEqual({
			ok: true,
			data: {
				epochMs: instant,
				iso: "2026-10-07T03:04:05.000Z",
				timeZone: "Asia/Tokyo",
				localDateTime: "2026-10-07 12:04:05",
				weekday: "水",
			},
		});

		clock.advanceBy(60 * 60 * 1_000);
		await expect(call(currentTime, { timeZone: "UTC" })).resolves.toMatchObject({
			ok: true,
			data: { timeZone: "UTC", localDateTime: "2026-10-07 04:04:05", weekday: "水" },
		});
	});

	it("crosses the date line in the requested time zone", async () => {
		const currentTime = createCurrentTimeTool(createFakeClock(instant));
		await expect(call(currentTime, { timeZone: "America/Los_Angeles" })).resolves.toMatchObject({
			ok: true,
			data: { localDateTime: "2026-10-06 20:04:05", weekday: "火" },
		});
	});

	it("returns an unknown time zone as a recoverable failure", async () => {
		const currentTime = createCurrentTimeTool(createFakeClock(instant));
		await expect(call(currentTime, { timeZone: "Mars/Olympus" })).resolves.toEqual({
			ok: false,
			failure: {
				kind: "recoverable",
				summary: "タイムゾーン「Mars/Olympus」は使えません。",
				nextAction: "IANA のタイムゾーン名（例: Asia/Tokyo、UTC）を指定してください。",
			},
		});
	});
});
