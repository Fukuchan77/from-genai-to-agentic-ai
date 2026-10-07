import type { Tool, ToolSet } from "ai";
import { FEATURE_REQUIREMENTS } from "../config/feature-requirements";
import { ConfigError, type PlatformConfig } from "../config/load";
import { assertValidToolRuntime } from "./define-tool";
import type {
	AnyAciTool,
	BuiltToolSet,
	DisabledTool,
	GuardedToolSet,
	ToolAvailability,
	ToolRuntime,
} from "./types";

const DISABLED_REASON = "必要な設定が未設定のため、このツールは無効です。";

function assertRegistrable(tools: readonly AnyAciTool[]): void {
	const names = new Set<string>();
	for (const aciTool of tools) {
		// Until the approval gate (004 Req 4) exists, only read-only tools may reach an agent.
		if (aciTool.risk !== "read-only") {
			throw new ConfigError(
				`ツール「${aciTool.name}」のリスク区分は ${aciTool.risk} です。承認ゲートが実装されるまで、read-only 以外のツールは登録できません。`,
			);
		}
		if (names.has(aciTool.name)) {
			throw new ConfigError(`ツール名「${aciTool.name}」が重複しています。`);
		}
		names.add(aciTool.name);
	}
}

/**
 * Converts ACI tools with `runtime` and returns the only kind of tool set an agent accepts.
 * Tools whose required feature is unavailable are left out and listed in `disabled` (Req 5.4).
 */
export function buildToolSet(
	tools: readonly AnyAciTool[],
	availability: ToolAvailability,
	runtime: ToolRuntime,
): BuiltToolSet {
	assertValidToolRuntime(runtime);
	assertRegistrable(tools);

	const registered: Record<string, Tool> = {};
	const disabled: DisabledTool[] = [];
	for (const aciTool of tools) {
		const feature = aciTool.requiredFeature;
		if (feature !== undefined && availability[feature] !== true) {
			disabled.push(
				Object.freeze({
					name: aciTool.name,
					reason: DISABLED_REASON,
					requiredEnv: FEATURE_REQUIREMENTS[feature],
				}),
			);
			continue;
		}
		registered[aciTool.name] = aciTool.toTool(runtime);
	}
	// Frozen so that a raw tool cannot be added to an already checked set.
	const guarded = Object.freeze(registered) as ToolSet as GuardedToolSet;
	return Object.freeze({ tools: guarded, disabled: Object.freeze(disabled) });
}

/** Derives tool availability from the validated platform configuration. */
export function toolAvailabilityFromConfig(
	config: Pick<PlatformConfig, "credentials">,
): ToolAvailability {
	return { "web-search": config.credentials.tavily !== undefined };
}
