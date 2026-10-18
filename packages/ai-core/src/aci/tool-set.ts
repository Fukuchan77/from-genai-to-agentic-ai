import type { Tool, ToolSet } from "ai";
import { FEATURE_REQUIREMENTS } from "../config/feature-requirements";
import { ConfigError, type PlatformConfig } from "../config/load";
import { assertValidToolRuntime, isDefinedAciTool } from "./define-tool";
import type { FatalLatch } from "./fatal";
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
		if (!isDefinedAciTool(aciTool)) {
			throw new ConfigError(
				`ツール「${String(aciTool.name)}」は defineAciTool で定義されていません。ツールは defineAciTool で定義してください。`,
			);
		}
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

const latchOfToolSet = new WeakMap<object, FatalLatch>();

/**
 * The latch a tool set was built with (`runtime.fatal`), so `createGuardedAgent` reads the same
 * instance instead of taking it a second time from the caller.
 */
export function fatalLatchOf(tools: GuardedToolSet): FatalLatch | undefined {
	return latchOfToolSet.get(tools);
}

const LATCH_REFUSAL_SUMMARY =
	"致命的なエラーが起きたため、この実行は終了します。このツールは実行されませんでした。";
const LATCH_REFUSAL_NEXT_ACTION =
	"ツールを呼び出さず、これまでの結果と起きたことを説明して回答を終えてください。";

/**
 * Once the run's latch is tripped no tool body runs again: the call returns a refusal result
 * instead. A call that already started is not interrupted (its result is dropped with the run).
 */
function refuseAfterLatch(
	registered: Tool,
	latch: FatalLatch,
	queue: { tail: Promise<unknown> },
): Tool {
	const run = registered.execute;
	if (run === undefined) return registered;
	const refusal = {
		ok: false,
		failure: {
			kind: "recoverable",
			summary: LATCH_REFUSAL_SUMMARY,
			nextAction: LATCH_REFUSAL_NEXT_ACTION,
		},
	};
	return {
		...registered,
		// Calls of one step start together, so a plain check would let a sibling run before the
		// failing call has tripped the latch. Calls therefore run one after another (a run with a
		// latch trades the step's parallelism for "nothing runs after a fatal error", Req 1.3).
		execute: (input, options) => {
			const result = queue.tail.then(async () =>
				latch.error === undefined ? await run(input, options) : refusal,
			);
			queue.tail = result.catch(() => undefined);
			return result;
		},
	} as Tool;
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
	const serial: { tail: Promise<unknown> } = { tail: Promise.resolve() };
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
		const converted = aciTool.toTool(runtime);
		registered[aciTool.name] =
			runtime.fatal === undefined ? converted : refuseAfterLatch(converted, runtime.fatal, serial);
	}
	// Frozen so that a raw tool cannot be added to an already checked set.
	const guarded = Object.freeze(registered) as ToolSet as GuardedToolSet;
	if (runtime.fatal !== undefined) latchOfToolSet.set(guarded, runtime.fatal);
	return Object.freeze({ tools: guarded, disabled: Object.freeze(disabled) });
}

/** Derives tool availability from the validated platform configuration. */
export function toolAvailabilityFromConfig(
	config: Pick<PlatformConfig, "credentials">,
): ToolAvailability {
	return { "web-search": config.credentials.tavily !== undefined };
}
