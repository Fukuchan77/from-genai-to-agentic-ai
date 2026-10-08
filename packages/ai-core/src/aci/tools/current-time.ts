import { z } from "zod";
import type { Clock } from "../../ports/clock";
import { defineAciTool, ToolExecutionError } from "../define-tool";
import type { AciTool } from "../types";

export const CURRENT_TIME_TOOL_NAME = "currentTime";
const DEFAULT_TIME_ZONE = "Asia/Tokyo";

export interface CurrentTimeResult {
	readonly epochMs: number;
	readonly iso: string;
	readonly timeZone: string;
	/** `YYYY-MM-DD HH:mm:ss` in `timeZone`. */
	readonly localDateTime: string;
	/** Japanese short weekday in `timeZone` (e.g. `水`). */
	readonly weekday: string;
}

function formatter(timeZone: string): Intl.DateTimeFormat {
	try {
		return new Intl.DateTimeFormat("ja-JP", {
			timeZone,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			hourCycle: "h23",
			weekday: "short",
		});
	} catch {
		throw new ToolExecutionError(`タイムゾーン「${timeZone}」は使えません。`, {
			nextAction: "IANA のタイムゾーン名（例: Asia/Tokyo、UTC）を指定してください。",
		});
	}
}

function describeInstant(epochMs: number, timeZone: string): CurrentTimeResult {
	const parts = Object.fromEntries(
		formatter(timeZone)
			.formatToParts(epochMs)
			.map((part) => [part.type, part.value]),
	);
	return {
		epochMs,
		iso: new Date(epochMs).toISOString(),
		timeZone,
		localDateTime: `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`,
		weekday: String(parts.weekday),
	};
}

const currentTimeInputSchema = z.object({
	timeZone: z
		.string()
		.max(64)
		.optional()
		.describe(`IANA のタイムゾーン名。省略時は ${DEFAULT_TIME_ZONE}。`),
});

/** Returns the current time from the injected clock; never reads the system time (Req 5.7). */
export function createCurrentTimeTool(
	clock: Clock,
): AciTool<z.output<typeof currentTimeInputSchema>, CurrentTimeResult> {
	return defineAciTool({
		name: CURRENT_TIME_TOOL_NAME,
		description: "現在の日時を返します。日付や時刻、曜日を答えるときに使ってください。",
		inputSchema: currentTimeInputSchema,
		risk: "read-only",
		execute: ({ timeZone }) => describeInstant(clock.now(), timeZone ?? DEFAULT_TIME_ZONE),
	});
}
