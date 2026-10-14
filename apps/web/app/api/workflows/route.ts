import { DEFAULT_INPUT_LIMITS } from "@platform/ai-core/config";
import { PlatformError } from "@platform/ai-core/errors";
import {
	PATTERN_DEMO_NAMES,
	patternDemoMaxCalls,
	runPatternDemo,
} from "@platform/ai-core/patterns";
import {
	runWorkflowDemo,
	WORKFLOW_DEMO_NAMES,
	workflowDemoMaxCalls,
} from "@platform/ai-core/workflows";
import { AISDKError } from "ai";
import { toErrorResponse } from "@/lib/server/errors";
import { type GuardPolicy, type GuardSchema, guardRequest } from "@/lib/server/guard";
import { getPlatform } from "@/lib/server/platform";

// POST /api/workflows (plan C13, Req 3.1, 4.1): guard -> run the named workflow or pattern demo ->
// JSON `{ name, result, usage }`. The route only checks the request and calls `runWorkflowDemo` /
// `runPatternDemo`; the compositions, the option limits and the model calls live in `ai-core`.

export const dynamic = "force-dynamic";

const TASK_MAX_CHARACTERS = 4_000;
const KINDS = ["workflow", "pattern"] as const;
const BODY_KEYS: ReadonlySet<string> = new Set(["kind", "name", "task", "options"]);
const PROVIDER_FAILURE_MESSAGE =
	"モデルの呼び出しに失敗しました。設定とネットワークを確認して、もう一度お試しください。";

interface WorkflowsRequest {
	readonly kind: (typeof KINDS)[number];
	readonly name: string;
	readonly task: string;
	readonly options?: Record<string, unknown> | undefined;
}

const NAMES: Readonly<Record<WorkflowsRequest["kind"], readonly string[]>> = {
	workflow: WORKFLOW_DEMO_NAMES,
	pattern: PATTERN_DEMO_NAMES,
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failure(path: string): { success: false; error: { issues: { path: string[] }[] } } {
	return { success: false, error: { issues: [{ path: [path] }] } };
}

/** The request is a strict object: the closed vocabularies are part of its format. */
const REQUEST_SCHEMA: GuardSchema<WorkflowsRequest> = {
	safeParse(data) {
		if (!isPlainObject(data)) return failure("");
		const unknownKey = Object.keys(data).find((key) => !BODY_KEYS.has(key));
		if (unknownKey !== undefined) return failure("");
		const { kind, name, task, options } = data;
		if (kind !== "workflow" && kind !== "pattern") return failure("kind");
		if (typeof name !== "string" || !NAMES[kind].includes(name)) return failure("name");
		if (typeof task !== "string" || task.trim() === "" || [...task].length > TASK_MAX_CHARACTERS) {
			return failure("task");
		}
		if (options !== undefined && !isPlainObject(options)) return failure("options");
		return { success: true, data: { kind, name, task, options } };
	},
};

export async function POST(request: Request): Promise<Response> {
	try {
		const platform = await getPlatform();
		const agentLimits = platform.config.agent;
		const policy: GuardPolicy<WorkflowsRequest> = {
			schema: REQUEST_SCHEMA,
			limits: DEFAULT_INPUT_LIMITS,
			// The option values are checked against the demo's limits here, before the rate limiter. An
			// over-limit value throws `invalid-request`, which answers 400 like a rejected body.
			inspect: (body) => {
				if (body.kind === "workflow") workflowDemoMaxCalls(body.name, body.options);
				else patternDemoMaxCalls(body.name, body.options, agentLimits);
				return undefined;
			},
		};
		const guarded = await guardRequest(request, policy, {
			limiter: platform.limiter,
			mode: platform.mode,
		});
		if (!guarded.ok) return guarded.response;
		const { body } = guarded;
		const input = { task: body.task, options: body.options };

		try {
			const run =
				body.kind === "workflow"
					? await runWorkflowDemo(
							body.name,
							{ gateway: platform.gateway, signal: request.signal },
							input,
						)
					: await runPatternDemo(
							body.name,
							{
								gateway: platform.gateway,
								clock: platform.clock,
								agentLimits,
								signal: request.signal,
							},
							input,
						);
			return Response.json({ name: run.name, result: run.result, usage: run.usage });
		} catch (error) {
			// The SDK's errors can carry the provider's response; only a fixed message leaves.
			if (AISDKError.isInstance(error)) {
				throw new PlatformError("provider-unavailable", PROVIDER_FAILURE_MESSAGE);
			}
			throw error;
		}
	} catch (error) {
		return toErrorResponse(error);
	}
}
